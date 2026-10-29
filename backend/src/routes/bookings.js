const express = require('express');
const mongoose = require('mongoose');
const crypto = require('crypto');
const Vehicle = require('../models/Vehicle');
const { Booking, TRANSITIONS } = require('../models/Booking');
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

  let priced;
  try {
    priced = priceRental({
      dailyRate: vehicle.dailyRate,
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
        customer: req.user._id,
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

  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const bookings = await Booking.find(filter)
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate('vehicle', 'make model year licensePlate dailyRate')
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
  await booking.save();
  await booking.populate([
    { path: 'vehicle' },
    { path: 'customer', select: 'name email phone' },
  ]);
  res.json({ booking });
});

const cancel = asyncHandler(async (req, res) => {
  const booking = await loadForUser(req);
  if (!['pending', 'confirmed'].includes(booking.status)) {
    throw new ApiError(409, `A ${booking.status} booking cannot be cancelled`);
  }
  booking.status = 'cancelled';
  booking.cancelledAt = new Date();
  await booking.save();
  res.json({ booking });
});

router.use(authenticate);
router.post('/', create);
router.get('/mine', listMine);
router.get('/all', requireRole('manager'), listAll);
router.get('/:id', getOne);
router.patch('/:id/status', requireRole('manager'), setStatus);
router.post('/:id/cancel', cancel);

module.exports = router;
