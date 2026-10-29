const express = require('express');
const mongoose = require('mongoose');
const crypto = require('crypto');
const Vehicle = require('../models/Vehicle');
const User = require('../models/User');
const { Booking, TRANSITIONS, DECIDABLE_STATUSES } = require('../models/Booking');
const { ApiError, asyncHandler } = require('../middleware/errors');
const { authenticate, requireRole } = require('../middleware/auth');
const { priceRental } = require('../lib/pricing');
const { withReservation } = require('../lib/reservation');
const { isTransactionConflict } = require('../lib/transaction');
const { toDateOnly, toIsoDate } = require('../lib/dates');

const router = express.Router();

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateCode() {
  let out = '';
  for (let i = 0; i < 8; i += 1) out += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  return `RC-${out}`;
}

function parseDates(body) {
  let pickUpDate;
  let returnDate;
  try {
    pickUpDate = toDateOnly(body.pickUpDate, 'pickUpDate');
    returnDate = toDateOnly(body.returnDate, 'returnDate');
  } catch (err) {
    throw new ApiError(400, err.message);
  }
  return { pickUpDate, returnDate };
}

const create = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const { pickUpDate, returnDate } = parseDates(body);
  const today = new Date(`${toIsoDate(new Date())}T00:00:00.000Z`);

  if (pickUpDate < today) throw new ApiError(400, 'Pick-up date cannot be in the past');
  if (!mongoose.isValidObjectId(body.vehicleId)) throw new ApiError(400, 'Invalid vehicleId');

  const vehicle = await Vehicle.findById(body.vehicleId);
  if (!vehicle) throw new ApiError(404, 'Vehicle not found');
  if (vehicle.status !== 'available') throw new ApiError(409, `${vehicle.displayName} is ${vehicle.status}`);

  // A manager booking for a walk-in customer starts unsigned on the customer's side, so the
  // quote only becomes a confirmed rental once that person accepts it themselves.
  if (body.customerId && req.user.role !== 'manager') {
    throw new ApiError(403, 'Only the branch can attach a booking to another account');
  }
  let renter = req.user;
  let customerAccepted = true;
  if (body.customerId) {
    if (!mongoose.isValidObjectId(body.customerId)) throw new ApiError(400, 'Invalid customerId');
    const found = await User.findById(body.customerId);
    if (!found) throw new ApiError(404, 'Customer not found');
    if (!found.active) throw new ApiError(409, `${found.name}'s account is deactivated`);
    renter = found;
    customerAccepted = false;
  }

  let priced;
  try {
    priced = priceRental({
      dailyRate: vehicle.dailyRate,
      currency: vehicle.currency,
      pickUpDate,
      returnDate,
      extraDriver: Boolean(body.extraDriver),
      childSeat: Boolean(body.childSeat),
    });
  } catch (err) {
    throw new ApiError(400, err.message);
  }

  let booking;
  try {
    booking = await withReservation(String(vehicle._id), async (session) => {
      const withSession = session ? { session } : {};
      const clash = await Booking.findOne(
        Booking.overlappingQuery(vehicle._id, pickUpDate, returnDate),
        { pickUpDate: 1, returnDate: 1 },
        withSession
      ).lean();
      if (clash) {
        throw new ApiError(
          409,
          `${vehicle.displayName} is already booked ${toIsoDate(clash.pickUpDate)} to ${toIsoDate(clash.returnDate)} for those dates`
        );
      }

      const draft = new Booking({
        code: generateCode(),
        customer: renter._id,
        vehicle: vehicle._id,
        pickUpDate,
        returnDate,
        pickUpLocation: body.pickUpLocation || vehicle.location,
        returnLocation: body.returnLocation || body.pickUpLocation || vehicle.location,
        days: priced.days,
        rentalTotal: priced.breakdown.rentalTotal,
        deposit: vehicle.deposit,
        currency: priced.currency,
        breakdown: priced.breakdown,
        extras: { extraDriver: Boolean(body.extraDriver), childSeat: Boolean(body.childSeat) },
        notes: body.notes,
        // Submitting the quote the customer was just shown is their half of the agreement;
        // the branch still has to approve before the booking is confirmed.
        customerAccepted,
      });

      try {
        if (session) {
          // Writing the vehicle row inside the transaction is what makes two simultaneous
          // bookings on different instances abort each other instead of both committing.
          await Vehicle.updateOne({ _id: vehicle._id }, { $inc: { bookingEpoch: 1 } }, { session });
        }
        await draft.save(withSession);
      } catch (err) {
        if (err.code === 11000) throw new ApiError(409, 'That booking has already been taken, please retry');
        throw err;
      }
      return draft;
    });
  } catch (err) {
    if (isTransactionConflict(err)) {
      throw new ApiError(409, `${vehicle.displayName} was booked by someone else at the same moment, please retry`);
    }
    throw err;
  }

  res.status(201).json({ booking: await booking.populate('vehicle') });
});

const listMine = asyncHandler(async (req, res) => {
  const bookings = await Booking.find({ customer: req.user._id })
    .sort({ pickUpDate: -1 })
    .populate('vehicle')
    .limit(100);
  res.json({ bookings });
});

const listAll = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.status && req.query.status !== 'all') filter.status = req.query.status;
  if (req.query.code) filter.code = new RegExp(`^${String(req.query.code).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');
  if (req.query.customer) {
    if (!mongoose.isValidObjectId(req.query.customer)) throw new ApiError(400, 'Invalid customer id');
    filter.customer = req.query.customer;
  }
  // The branch queue is pending bookings that only need their decision.
  if (req.query.awaiting === 'manager') Object.assign(filter, { status: 'pending', customerAccepted: true, managerApproved: false });
  if (req.query.awaiting === 'customer') Object.assign(filter, { status: 'pending', customerAccepted: false });

  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const bookings = await Booking.find(filter)
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate('vehicle', 'make model year licensePlate location dailyRate currency country')
    .populate('customer', 'name email phone');
  res.json({ bookings });
});

async function loadForUser(req) {
  if (!mongoose.isValidObjectId(req.params.id)) throw new ApiError(400, 'Invalid booking id');
  const booking = await Booking.findById(req.params.id).populate('vehicle').populate('customer', 'name email phone');
  if (!booking) throw new ApiError(404, 'Booking not found');
  if (req.user.role !== 'manager' && String(booking.customer._id) !== String(req.user._id)) {
    throw new ApiError(403, 'You can only manage your own bookings');
  }
  return booking;
}

const getOne = asyncHandler(async (req, res) => {
  res.json({ booking: await loadForUser(req) });
});

// Managers move a booking along the rental lifecycle; customers may only cancel.
const setStatus = asyncHandler(async (req, res) => {
  const booking = await loadForUser(req);
  const { status } = req.body || {};
  if (!TRANSITIONS[booking.status]) throw new ApiError(400, 'Unknown status');
  if (!TRANSITIONS[booking.status].includes(status)) {
    throw new ApiError(409, `Cannot move a ${booking.status} booking to ${status || 'unset'}`);
  }

  booking.status = status;
  if (status === 'cancelled' || status === 'no_show') booking.cancelledAt = new Date();
  if (status === 'confirmed') booking.managerApproved = true;
  if (status === 'declined') {
    booking.declinedBy = 'manager';
    booking.declinedAt = new Date();
  }
  await booking.save();
  await booking.populate([
    { path: 'vehicle' },
    { path: 'customer', select: 'name email phone' },
  ]);
  res.json({ booking });
});

// A rental needs two yeses: the customer accepts the quote, the branch approves the booking.
// Either side can still say no until the car is handed over.
function applyDecision(booking, actor, action) {
  if (!DECIDABLE_STATUSES.includes(booking.status)) {
    throw new ApiError(409, `A ${booking.status} booking can no longer be ${action === 'accept' ? 'accepted' : 'declined'}`);
  }
  const at = new Date();

  if (action === 'decline') {
    if (actor === 'manager') {
      booking.status = 'declined';
    } else {
      booking.status = 'cancelled';
      booking.cancelledAt = at;
    }
    booking.declinedBy = actor;
    booking.declinedAt = at;
    return;
  }

  if (actor === 'manager') booking.managerApproved = true;
  else booking.customerAccepted = true;
  if (booking.customerAccepted && booking.managerApproved) booking.status = 'confirmed';
}

async function decide(req, actor, action) {
  const booking = await loadForUser(req);
  applyDecision(booking, actor, action);
  await booking.save();
  await booking.populate([
    { path: 'vehicle' },
    { path: 'customer', select: 'name email phone' },
  ]);
  return booking;
}

const actorFor = (req) => (req.user.role === 'manager' ? 'manager' : 'customer');

const decideRoute = asyncHandler(async (req, res) => {
  const { action } = req.body || {};
  if (!['accept', 'decline'].includes(action)) throw new ApiError(400, 'Action must be accept or decline');
  res.json({ booking: await decide(req, actorFor(req), action) });
});

const cancel = asyncHandler(async (req, res) => {
  res.json({ booking: await decide(req, actorFor(req), 'decline') });
});

router.use(authenticate);
router.post('/', create);
router.get('/mine', listMine);
router.get('/all', requireRole('manager'), listAll);
router.get('/:id', getOne);
router.patch('/:id/status', requireRole('manager'), setStatus);
router.post('/:id/decision', decideRoute);
router.post('/:id/cancel', cancel);

module.exports = router;
