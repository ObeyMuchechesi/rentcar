const express = require('express');
const Vehicle = require('../models/Vehicle');
const User = require('../models/User');
const { Booking, ACTIVE_STATUSES } = require('../models/Booking');
const { asyncHandler } = require('../middleware/errors');
const { authenticate, requireRole } = require('../middleware/auth');
const { toIsoDate } = require('../lib/dates');

const router = express.Router();

const MONTH_GROUP = { $dateToString: { format: '%Y-%m', date: '$pickUpDate' } };
// A cancelled or declined rental never became revenue, so it stays out of every money figure.
const EARNED_STATUSES = ['confirmed', 'picked_up', 'returned'];

const revenueByCurrency = (rows) => {
  const byCurrency = new Map();
  for (const row of rows) {
    const entry = byCurrency.get(row._id.currency) || [];
    entry.push(row);
    byCurrency.set(row._id.currency, entry);
  }
  return [...byCurrency.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, months]) => ({
      currency,
      months: months
        .sort((a, b) => a._id.month.localeCompare(b._id.month))
        .map((m) => ({ month: m._id.month, revenue: +m.revenue.toFixed(2), bookings: m.bookings })),
      thisMonth: +months.filter((m) => m._id.month === toIsoDate(new Date()).slice(0, 7)).reduce((s, m) => s + m.revenue, 0).toFixed(2),
      allTime: +months.reduce((s, m) => s + m.revenue, 0).toFixed(2),
    }));
};

const earnedRows = () =>
  Booking.aggregate([
    { $match: { status: { $in: EARNED_STATUSES } } },
    { $group: { _id: { month: MONTH_GROUP, currency: '$currency' }, revenue: { $sum: '$rentalTotal' }, bookings: { $sum: 1 } } },
  ]);

const overview = asyncHandler(async (_req, res) => {
  const now = new Date();
  const [vehicleGroups, statusGroups, revenueRows, upcoming, customers, awaitingManager, awaitingCustomer, branchRows, countries] =
    await Promise.all([
      Vehicle.aggregate([{ $match: { status: { $ne: 'retired' } } }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
      Booking.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
      earnedRows(),
      Booking.find({ status: { $in: ACTIVE_STATUSES }, pickUpDate: { $gte: now } })
        .sort({ pickUpDate: 1 })
        .limit(8)
        .populate('vehicle', 'make model year licensePlate location country currency')
        .populate('customer', 'name email'),
      User.countDocuments({ role: 'customer', active: true }),
      Booking.countDocuments({ status: 'pending', customerAccepted: true, managerApproved: false }),
      Booking.countDocuments({ status: 'pending', customerAccepted: false }),
      Vehicle.aggregate([
        { $match: { status: { $ne: 'retired' } } },
        { $group: { _id: { country: '$country', location: '$location' } } },
        { $count: 'branches' },
      ]),
      Vehicle.distinct('country', { status: { $ne: 'retired' } }),
    ]);

  const byStatus = Object.fromEntries(statusGroups.map((g) => [g._id, g.count]));

  res.json({
    stats: {
      fleet: Object.fromEntries(vehicleGroups.map((g) => [g._id, g.count])),
      vehiclesTotal: vehicleGroups.reduce((s, g) => s + g.count, 0),
      branches: branchRows[0]?.branches || 0,
      countries: countries.length,
      bookings: byStatus,
      activeBookings: ACTIVE_STATUSES.reduce((s, st) => s + (byStatus[st] || 0), 0),
      awaitingManager,
      awaitingCustomer,
      customers,
      revenue: revenueByCurrency(revenueRows),
    },
    upcomingPickUps: upcoming,
  });
});

const revenue = asyncHandler(async (_req, res) => {
  res.json({ currencies: revenueByCurrency(await earnedRows()) });
});

router.use(authenticate, requireRole('manager'));
router.get('/overview', overview);
router.get('/revenue', revenue);

module.exports = router;
