const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const User = require('../models/User');
const { Booking, ACTIVE_STATUSES } = require('../models/Booking');
const { ApiError, asyncHandler } = require('../middleware/errors');
const { signToken, authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { message: 'Too many attempts, try again later' } },
});

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ISO_COUNTRY = /^[A-Z]{2}$/;
// E.164 is the only phone form that means the same thing in every country.
const E164 = /^\+[1-9]\d{6,14}$/;
const BOOKED_STATUSES = ['confirmed', 'picked_up', 'returned'];

function validateCredentials({ email, password, name }) {
  const errors = [];
  if (!EMAIL.test(String(email || ''))) errors.push('A valid email is required');
  if (typeof password !== 'string' || password.length < 8) errors.push('Password must be at least 8 characters');
  if (name !== undefined && String(name).trim().length < 2) errors.push('Name must be at least 2 characters');
  if (errors.length) throw new ApiError(400, errors.join('; '));
}

function normalisePhone(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const digits = String(value).replace(/[^+\d]/g, '');
  if (!E164.test(digits)) throw new ApiError(400, 'Phone must be an international number, e.g. +1 415 555 0100');
  return digits;
}

function normaliseCountry(value, label) {
  if (value === undefined || value === null || value === '') return undefined;
  const code = String(value).trim().toUpperCase();
  if (!ISO_COUNTRY.test(code)) throw new ApiError(400, `${label} must be a two-letter country code, e.g. US`);
  return code;
}

// The fields a person may carry on their own profile, already normalised for storage.
function profilePatch(body) {
  const patch = {};
  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (name.length < 2) throw new ApiError(400, 'Name must be at least 2 characters');
    patch.name = name;
  }
  if (body.email !== undefined) {
    const email = String(body.email).trim().toLowerCase();
    if (!EMAIL.test(email)) throw new ApiError(400, 'A valid email is required');
    patch.email = email;
  }
  if (body.phone !== undefined) patch.phone = normalisePhone(body.phone);
  if (body.country !== undefined) patch.country = normaliseCountry(body.country, 'Country');
  if (body.drivingLicenceCountry !== undefined) {
    patch.drivingLicenceCountry = normaliseCountry(body.drivingLicenceCountry, 'Licence country');
  }
  if (body.drivingLicenceNumber !== undefined) {
    const licence = String(body.drivingLicenceNumber).trim();
    if (licence.length > 40) throw new ApiError(400, 'Licence number is too long');
    patch.drivingLicenceNumber = licence;
  }
  return patch;
}

function validateNewPassword(password) {
  if (typeof password !== 'string' || password.length < 8) throw new ApiError(400, 'Password must be at least 8 characters');
}

async function ensurePasswordChangeIsAuthorised(req, body, target, { requireCurrentPassword }) {
  const wantsNewPassword = body.password !== undefined;
  if (!wantsNewPassword) return undefined;
  validateNewPassword(body.password);

  if (requireCurrentPassword) {
    if (!body.currentPassword) throw new ApiError(400, 'Your current password is required to set a new one');
    const withHash = await User.findById(target._id).select('+passwordHash');
    if (!(await bcrypt.compare(String(body.currentPassword), withHash.passwordHash))) {
      throw new ApiError(401, 'Current password is incorrect');
    }
  }
  return bcrypt.hash(body.password, 10);
}

async function login(req, res) {
  const { email, password } = req.body || {};
  const user = await User.findOne({ email: String(email || '').toLowerCase() }).select('+passwordHash');
  const ok = user && user.active && (await bcrypt.compare(String(password || ''), user.passwordHash));
  if (!ok) throw new ApiError(401, 'Email or password is incorrect');
  res.json({ token: signToken(user), user });
}

// Anyone can open a customer account for themselves; the role is never taken from the body.
async function register(req, res) {
  const body = req.body || {};
  validateCredentials(body);
  const profile = profilePatch(body);
  if (await User.exists({ email: profile.email })) throw new ApiError(409, 'An account with that email already exists');

  const user = await User.create({
    ...profile,
    passwordHash: await bcrypt.hash(body.password, 10),
    role: 'customer',
  });
  res.status(201).json({ token: signToken(user), user });
}

async function me(req, res) {
  res.json({ user: req.user });
}

async function updateMe(req, res) {
  const body = req.body || {};
  const patch = profilePatch(body);
  if (body.role !== undefined && body.role !== req.user.role) {
    throw new ApiError(400, 'Role changes go through the accounts desk, not your own profile');
  }

  if (patch.email && patch.email !== req.user.email) {
    if (!body.currentPassword) throw new ApiError(400, 'Your current password is required to change your email');
    if (await User.exists({ email: patch.email })) throw new ApiError(409, 'That email address is already registered');
    const withHash = await User.findById(req.user._id).select('+passwordHash');
    if (!(await bcrypt.compare(String(body.currentPassword), withHash.passwordHash))) {
      throw new ApiError(401, 'Current password is incorrect');
    }
  }

  const passwordHash = await ensurePasswordChangeIsAuthorised(req, body, req.user, { requireCurrentPassword: true });
  if (passwordHash) patch.passwordHash = passwordHash;

  Object.assign(req.user, patch);
  await req.user.save();
  res.json({ user: req.user });
}

async function loadAccount(req) {
  const target = await User.findById(req.params.id);
  if (!target) throw new ApiError(404, 'Account not found');
  return target;
}

// The system must never be left without somebody who can sign in and run it.
async function guardLastManager(target, { role, active }) {
  const stillManager = role === undefined ? target.role === 'manager' : role === 'manager';
  const stillActive = active === undefined ? target.active : Boolean(active);
  if (target.role !== 'manager' || (stillManager && stillActive)) return;

  const others = await User.countDocuments({ role: 'manager', active: true, _id: { $ne: target._id } });
  if (!others) {
    throw new ApiError(409, 'Promote another manager first — the system cannot be left without an active manager account');
  }
}

async function listAccounts(req, res) {
  const { role = 'all', search } = req.query;
  const filter = role === 'all' ? {} : { role };
  if (search) {
    const safe = String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = [{ name: new RegExp(safe, 'i') }, { email: new RegExp(safe, 'i') }];
  }

  const accounts = await User.find(filter).sort({ createdAt: -1 }).limit(500);
  const rows = await Booking.aggregate([
    { $match: { customer: { $in: accounts.map((a) => a._id) } } },
    {
      $group: {
        _id: { customer: '$customer', currency: '$currency' },
        bookings: { $sum: 1 },
        active: { $sum: { $cond: [{ $in: ['$status', ACTIVE_STATUSES] }, 1, 0] } },
        spend: { $sum: { $cond: [{ $in: ['$status', BOOKED_STATUSES] }, '$rentalTotal', 0] } },
      },
    },
  ]);

  const statsByAccount = new Map();
  for (const row of rows) {
    const key = String(row._id.customer);
    const entry = statsByAccount.get(key) || { bookings: 0, active: 0, spend: [] };
    entry.bookings += row.bookings;
    entry.active += row.active;
    entry.spend.push({ currency: row._id.currency, amount: +row.spend.toFixed(2) });
    statsByAccount.set(key, entry);
  }

  res.json({
    accounts: accounts.map((account) => ({
      ...account.toJSON(),
      stats: statsByAccount.get(account.id) || { bookings: 0, active: 0, spend: [] },
    })),
  });
}

async function createAccount(req, res) {
  const body = req.body || {};
  validateCredentials(body);
  const profile = profilePatch(body);
  const role = body.role === 'manager' ? 'manager' : 'customer';
  if (await User.exists({ email: profile.email })) throw new ApiError(409, 'An account with that email already exists');

  const user = await User.create({
    ...profile,
    passwordHash: await bcrypt.hash(body.password, 10),
    role,
  });
  res.status(201).json({ user });
}

async function updateAccount(req, res) {
  const body = req.body || {};
  const target = await loadAccount(req);
  const patch = profilePatch(body);

  if (patch.email && patch.email !== target.email) {
    if (await User.exists({ email: patch.email })) throw new ApiError(409, 'That email address is already registered');
  }

  const role = body.role === undefined ? undefined : body.role === 'manager' ? 'manager' : 'customer';
  const active = body.active === undefined ? undefined : Boolean(body.active);
  if (active === false && String(target._id) === String(req.user._id)) {
    throw new ApiError(409, 'You cannot deactivate your own account');
  }
  await guardLastManager(target, { role, active });

  const passwordHash = await ensurePasswordChangeIsAuthorised(req, body, target, { requireCurrentPassword: false });
  if (passwordHash) patch.passwordHash = passwordHash;

  Object.assign(target, patch);
  if (role) target.role = role;
  if (active !== undefined) target.active = active;
  await target.save();
  res.json({ user: target });
}

async function deleteAccount(req, res) {
  const target = await loadAccount(req);
  if (String(target._id) === String(req.user._id)) {
    throw new ApiError(409, 'You cannot delete the account you are signed in with');
  }

  const history = await Booking.countDocuments({ customer: target._id });
  if (history) {
    throw new ApiError(
      409,
      `${target.name} has ${history} booking${history === 1 ? '' : 's'} on file — deactivate the account instead of deleting it, so the rental history stays intact`
    );
  }
  await guardLastManager(target, { role: 'customer', active: false });

  await target.deleteOne();
  res.json({ deleted: target.id });
}

router.post('/login', authLimiter, asyncHandler(login));
router.post('/register', authLimiter, asyncHandler(register));
router.get('/me', authenticate, asyncHandler(me));
router.patch('/me', authenticate, asyncHandler(updateMe));

router.use('/accounts', authenticate, requireRole('manager'));
router.get('/accounts', asyncHandler(listAccounts));
router.post('/accounts', asyncHandler(createAccount));
router.patch('/accounts/:id', asyncHandler(updateAccount));
router.delete('/accounts/:id', asyncHandler(deleteAccount));

module.exports = router;
