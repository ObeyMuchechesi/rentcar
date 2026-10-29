const express = require('express');
const mongoose = require('mongoose');
const Vehicle = require('../models/Vehicle');
const { Booking } = require('../models/Booking');
const { ApiError, asyncHandler } = require('../middleware/errors');
const { authenticate, authenticateOptional, requireRole } = require('../middleware/auth');
const { toDateOnly, toIsoDate } = require('../lib/dates');
const { priceRental } = require('../lib/pricing');

const router = express.Router();

const CLASSES = ['economy', 'sedan', 'suv', 'van', 'pickup', 'luxury', 'sports'];
const WRITABLE = [
  'make', 'model', 'year', 'licensePlate', 'vehicleClass', 'transmission', 'fuel',
  'seats', 'luggage', 'dailyRate', 'deposit', 'location', 'mileageLimitKm', 'status', 'features', 'imageUrl',
];

function parseDate(value, field) {
  try {
    return toDateOnly(value, field);
  } catch (err) {
    throw new ApiError(400, err.message);
  }
}

// Vehicles under a date filter are trimmed to the ones free for the whole requested interval.
async function applyAvailability(filter, req) {
  const { startDate, endDate } = req.query;
  if (!startDate && !endDate) return filter;
  if (!startDate || !endDate) throw new ApiError(400, 'Both startDate and endDate are required');

  const pickUpDate = parseDate(startDate, 'startDate');
  const returnDate = parseDate(endDate, 'endDate');
  if (returnDate <= pickUpDate) throw new ApiError(400, 'endDate must be after startDate');

  const busy = await Booking.find(
    {
      status: { $in: Booking.ACTIVE_STATUSES },
      pickUpDate: { $lt: returnDate },
      returnDate: { $gt: pickUpDate },
    },
    { vehicle: 1 }
  ).lean();

  filter.$and = filter.$and || [];
  filter.$and.push({ _id: { $nin: busy.map((b) => b.vehicle) } });
  return filter;
}

function buildFilter(query, req) {
  // Retired stock stays hidden from the public catalogue; managers can pull it back up for reactivation.
  const showAll = req.user?.role === 'manager' && query.status === 'all';
  const filter = showAll ? {} : { status: { $ne: 'retired' } };
  if (query.location) filter.location = new RegExp(`^${query.location}$`, 'i');
  if (query.vehicleClass && CLASSES.includes(query.vehicleClass)) filter.vehicleClass = query.vehicleClass;
  if (query.transmission === 'automatic' || query.transmission === 'manual') filter.transmission = query.transmission;
  if (query.fuel) filter.fuel = new RegExp(`^${query.fuel}$`, 'i');
  if (query.minSeats) filter.seats = { $gte: Number(query.minSeats) || 2 };
  if (query.maxDailyRate) filter.dailyRate = { ...(filter.dailyRate || {}), $lte: Number(query.maxDailyRate) || Infinity };
  return filter;
}

const SORTS = {
  price_asc: { dailyRate: 1, make: 1 },
  price_desc: { dailyRate: -1, make: 1 },
  newest: { createdAt: -1 },
};

const list = asyncHandler(async (req, res) => {
  const filter = await applyAvailability(buildFilter(req.query, req), req);
  const sort = SORTS[req.query.sort] || SORTS.price_asc;
  const limit = Math.min(Number(req.query.limit) || 100, 200);
  const vehicles = await Vehicle.find(filter).sort(sort).limit(limit);
  res.json({ count: vehicles.length, vehicles });
});

const locations = asyncHandler(async (_req, res) => {
  const values = await Vehicle.distinct('location', { status: { $ne: 'retired' } });
  res.json({ locations: values.sort() });
});

const getOne = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw new ApiError(400, 'Invalid vehicle id');
  const vehicle = await Vehicle.findById(req.params.id);
  if (!vehicle) throw new ApiError(404, 'Vehicle not found');

  const { startDate, endDate } = req.query;
  let availableFor = null;
  if (startDate && endDate) {
    const pickUpDate = parseDate(startDate, 'startDate');
    const returnDate = parseDate(endDate, 'endDate');
    const clash = await Booking.exists(Booking.overlappingQuery(vehicle._id, pickUpDate, returnDate));
    availableFor = { startDate, endDate, available: !clash };
  }
  res.json({ vehicle, availableFor });
});

function pickBody(body) {
  const data = {};
  for (const key of WRITABLE) if (body[key] !== undefined) data[key] = body[key];
  return data;
}

const quote = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw new ApiError(400, 'Invalid vehicle id');
  const { startDate, endDate } = req.query;
  if (!startDate || !endDate) throw new ApiError(400, 'startDate and endDate are required');

  const vehicle = await Vehicle.findById(req.params.id);
  if (!vehicle) throw new ApiError(404, 'Vehicle not found');

  const pickUpDate = parseDate(startDate, 'startDate');
  const returnDate = parseDate(endDate, 'endDate');

  let priced;
  try {
    priced = priceRental({
      dailyRate: vehicle.dailyRate,
      pickUpDate,
      returnDate,
      extraDriver: req.query.extraDriver === 'true',
      childSeat: req.query.childSeat === 'true',
    });
  } catch (err) {
    throw new ApiError(400, err.message);
  }

  const clash = await Booking.findOne(Booking.overlappingQuery(vehicle._id, pickUpDate, returnDate), {
    pickUpDate: 1,
    returnDate: 1,
  }).lean();

  res.json({
    vehicle: { id: vehicle.id, displayName: vehicle.displayName, deposit: vehicle.deposit, status: vehicle.status },
    available: !clash && vehicle.status === 'available',
    bookedWindow: clash ? { startDate: toIsoDate(clash.pickUpDate), endDate: toIsoDate(clash.returnDate) } : null,
    ...priced,
  });
});

const create = asyncHandler(async (req, res) => {
  const vehicle = await Vehicle.create(pickBody(req.body || {}));
  res.status(201).json({ vehicle });
});

const update = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw new ApiError(400, 'Invalid vehicle id');
  const booked = await Booking.exists({ vehicle: req.params.id, status: { $in: Booking.ACTIVE_STATUSES } });
  const data = pickBody(req.body || {});
  if (booked && ('dailyRate' in data || 'deposit' in data)) {
    throw new ApiError(409, 'Rate and deposit are locked while the vehicle has active bookings');
  }
  const vehicle = await Vehicle.findByIdAndUpdate(req.params.id, data, { new: true, runValidators: true });
  if (!vehicle) throw new ApiError(404, 'Vehicle not found');
  res.json({ vehicle });
});

const remove = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw new ApiError(400, 'Invalid vehicle id');
  const booked = await Booking.exists({ vehicle: req.params.id, status: { $in: Booking.ACTIVE_STATUSES } });
  if (booked) throw new ApiError(409, 'Vehicle has active bookings and cannot be removed');

  const vehicle = await Vehicle.findByIdAndDelete(req.params.id);
  if (!vehicle) throw new ApiError(404, 'Vehicle not found');
  res.status(204).end();
});

router.get('/', authenticateOptional, list);
router.get('/locations', locations);
router.get('/:id', getOne);
router.get('/:id/quote', quote);
router.post('/', authenticate, requireRole('manager'), create);
router.patch('/:id', authenticate, requireRole('manager'), update);
router.delete('/:id', authenticate, requireRole('manager'), remove);

module.exports = router;
