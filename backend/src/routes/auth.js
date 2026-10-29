const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const User = require('../models/User');
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

function validateCredentials({ email, password, name }) {
  const errors = [];
  if (!EMAIL.test(String(email || ''))) errors.push('A valid email is required');
  if (typeof password !== 'string' || password.length < 8) errors.push('Password must be at least 8 characters');
  if (name !== undefined && String(name).trim().length < 2) errors.push('Name must be at least 2 characters');
  if (errors.length) throw new ApiError(400, errors.join('; '));
}

async function login(req, res) {
  const { email, password } = req.body || {};
  const user = await User.findOne({ email: String(email || '').toLowerCase() }).select('+passwordHash');
  const ok = user && user.active && (await bcrypt.compare(String(password || ''), user.passwordHash));
  if (!ok) throw new ApiError(401, 'Email or password is incorrect');
  res.json({ token: signToken(user), user });
}

async function register(req, res) {
  validateCredentials(req.body || {});
  const { email, password, name, phone, drivingLicenceNumber } = req.body;
  const normalised = String(email).toLowerCase();
  if (await User.exists({ email: normalised })) throw new ApiError(409, 'An account with that email already exists');

  const user = await User.create({
    name: String(name).trim(),
    email: normalised,
    phone,
    drivingLicenceNumber,
    passwordHash: await bcrypt.hash(password, 10),
    role: 'customer',
  });
  res.status(201).json({ token: signToken(user), user });
}

async function me(req, res) {
  res.json({ user: req.user });
}

async function createCustomer(req, res) {
  validateCredentials(req.body || {});
  const { email, password, name, phone } = req.body;
  const normalised = String(email).toLowerCase();
  if (await User.exists({ email: normalised })) throw new ApiError(409, 'An account with that email already exists');

  const user = await User.create({
    name: String(name).trim(),
    email: normalised,
    phone,
    passwordHash: await bcrypt.hash(password, 10),
    role: 'customer',
  });
  res.status(201).json({ user });
}

async function listCustomers(req, res) {
  const customers = await User.find({ role: 'customer' }).sort({ createdAt: -1 });
  res.json({ customers });
}

router.post('/login', authLimiter, asyncHandler(login));
router.post('/register', authLimiter, asyncHandler(register));
router.get('/me', authenticate, asyncHandler(me));
router.post('/customers', authenticate, requireRole('manager'), asyncHandler(createCustomer));
router.get('/customers', authenticate, requireRole('manager'), asyncHandler(listCustomers));

module.exports = router;
