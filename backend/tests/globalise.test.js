const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const mongoose = require('mongoose');
const { startDb, stopDb, clear } = require('./helpers');

const { globalise } = require('../scripts/globalise');
const User = require('../src/models/User');
const Vehicle = require('../src/models/Vehicle');
const { Booking } = require('../src/models/Booking');

before(async () => {
  await startDb();
});

after(async () => {
  await stopDb();
});

beforeEach(async () => {
  await clear();
});

// Documents as they were written before the worldwide change: no country, no currency,
// rates in the dollars the old build formatted everything as, phone straight from the keyboard,
// and no handshake flags on the booking.
async function insertLegacyFleet() {
  const vehicle = await Vehicle.collection
    .insertOne({
      make: 'Nissan',
      model: 'Almera',
      year: 2022,
      licensePlate: 'LEGACY-1',
      vehicleClass: 'economy',
      transmission: 'manual',
      fuel: 'petrol',
      seats: 5,
      luggage: 2,
      dailyRate: 42,
      deposit: 250,
      location: 'Cape Town International',
      mileageLimitKm: 400,
      status: 'available',
    })
    .then((r) => Vehicle.collection.findOne({ _id: r.insertedId }));

  const renter = await User.collection
    .insertOne({
      name: 'Old Renter',
      email: 'old@test.io',
      role: 'customer',
      phone: '+27 82 555 0199',
      drivingLicenceNumber: 'ZAF-111',
      passwordHash: 'x',
    })
    .then((r) => User.collection.findOne({ _id: r.insertedId }));

  await Booking.collection.insertOne({
    code: 'RC-LEGACY1',
    customer: renter._id,
    vehicle: new mongoose.Types.ObjectId(String(vehicle._id)),
    pickUpDate: new Date('2026-01-05T00:00:00.000Z'),
    returnDate: new Date('2026-01-08T00:00:00.000Z'),
    pickUpLocation: 'Cape Town International',
    returnLocation: 'Cape Town International',
    status: 'returned',
    days: 3,
    rentalTotal: 126,
    deposit: 250,
    breakdown: { dailyRate: 42, gross: 126, weeklyDiscount: 0, extras: [], extrasTotal: 0, rentalTotal: 126 },
  });

  return { vehicle, renter };
}

test('the migration stamps legacy rows and keeps their bookings', async () => {
  const { vehicle, renter } = await insertLegacyFleet();
  const counts = await globalise();

  // Geography is inferred; money is not. The old build quoted everything in USD, so re-stamping
  // a legacy price as the local currency would silently revalue every rate on file.
  const legacy = await Vehicle.findById(vehicle._id);
  assert.equal(legacy.country, 'ZA');
  assert.equal(legacy.currency, 'USD');
  assert.equal(legacy.dailyRate, 42);

  const booking = await Booking.findOne({ code: 'RC-LEGACY1' });
  assert.equal(booking.status, 'returned');
  assert.equal(booking.currency, 'USD');
  assert.equal(booking.customerAccepted, true);
  assert.equal(booking.managerApproved, true);

  const migrated = await User.findById(renter._id);
  assert.equal(migrated.phone, '+27825550199');
  assert.equal(migrated.country, 'ZA');
  assert.equal(migrated.drivingLicenceCountry, 'ZA');

  assert.ok(counts.branches > 0, 'expected the international fleet to be added');
  const countries = await Vehicle.distinct('country');
  assert.ok(countries.length > 5, `expected a multi-country fleet, got ${countries.join(',')}`);
});

test('running the migration again changes nothing', async () => {
  await insertLegacyFleet();
  await globalise();

  const before = await Promise.all([Vehicle.countDocuments(), User.countDocuments(), Booking.countDocuments()]);
  const again = await globalise();
  const after = await Promise.all([Vehicle.countDocuments(), User.countDocuments(), Booking.countDocuments()]);

  assert.deepEqual(again, { vehicles: 0, bookings: 0, users: 0, branches: 0, accounts: 0 });
  assert.deepEqual(after, before);
});

test('an empty database gets the full worldwide seed instead', async () => {
  assert.equal(await globalise(), undefined);

  const countries = await Vehicle.distinct('country');
  assert.ok(countries.length > 5);
  assert.equal(await Vehicle.countDocuments(), 26);
  assert.equal(await Booking.countDocuments(), 12);

  const pending = await Booking.find({ status: 'pending' });
  assert.ok(pending.every((b) => b.awaiting === 'manager' || b.awaiting === 'customer'));
});
