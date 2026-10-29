const express = require('express');
const Vehicle = require('../models/Vehicle');
const User = require('../models/User');
const { Booking, ACTIVE_STATUSES } = require('../models/Booking');
const { asyncHandler } = require('../middleware/errors');
const { authenticate, requireRole } = require('../middleware/auth');
const { toIsoDate } = require('../lib/dates');

const router = express.Router();

const MONTH_GROUP = { $dateToString: { format: '%Y-%m', date: '$pickUpDate' } };

const overview = asyncHandler(async (_req, res) => {
  const now = new Date();
  const currentMonth = toIsoDate(now).slice(0, 7);
  const [vehicleGroups, statusGroups, revenue, upcoming, customers] = await Promise.all([
    Vehicle.aggregate([{ $match: { status: { $ne: 'retired' } } }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
    Booking.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    Booking.aggregate([
      { $match: { status: { $ne: 'cancelled' } } },
      { $group: { _id: MONTH_GROUP, revenue: { $sum: '$rentalTotal' } } },
    ]),
    Booking.find({ status: { $in: ACTIVE_STATUSES }, pickUpDate: { $gte: now } })
      .sort({ pickUpDate: 1 })
      .limit(8)
      .populate('vehicle', 'make model year licensePlate')
      .populate('customer', 'name email'),
    User.countDocuments({ role: 'customer' }),
  ]);

  const byStatus = Object.fromEntries(statusGroups.map((g) => [g._id, g.count]));
  const thisMonth = revenue.filter((r) => r._id === currentMonth).reduce((s, r) => s + r.revenue, 0);

  res.json({
    stats: {
      fleet: Object.fromEntries(vehicleGroups.map((g) => [g._id, g.count])),
      vehiclesTotal: vehicleGroups.reduce((s, g) => s + g.count, 0),
      bookings: byStatus,
      activeBookings: ACTIVE_STATUSES.reduce((s, st) => s + (byStatus[st] || 0), 0),
      customers,
      revenueThisMonth: +thisMonth.toFixed(2),
      revenueAllTime: +revenue.reduce((s, r) => s + r.revenue, 0).toFixed(2),
    },
    upcomingPickUps: upcoming,
  });
});

const revenue = asyncHandler(async (_req, res) => {
  const rows = await Booking.aggregate([
    { $match: { status: { $ne: 'cancelled' } } },
    { $group: { _id: MONTH_GROUP, revenue: { $sum: '$rentalTotal' }, bookings: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ]);
  res.json({ months: rows.map((r) => ({ month: r._id, revenue: +r.revenue.toFixed(2), bookings: r.bookings })) });
});

router.use(authenticate, requireRole('manager'));
router.get('/overview', overview);
router.get('/revenue', revenue);

module.exports = router;
