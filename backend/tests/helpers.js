process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-key';

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { MongoMemoryServer } = require('mongodb-memory-server');

let mongod = null;

async function startDb() {
  if (mongoose.connection.readyState === 1) return;
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri('car-rental-test'));
}

async function stopDb() {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
}

async function clear() {
  const User = require('../src/models/User');
  const { Booking } = require('../src/models/Booking');
  const Vehicle = require('../src/models/Vehicle');
  await Promise.all([User.deleteMany({}), Vehicle.deleteMany({}), Booking.deleteMany({})]);
}

async function makeUser({ role = 'customer', email = `user-${Date.now()}@test.io`, password = 'Password123!', name = 'Test User', phone = '+27825550000' } = {}) {
  const User = require('../src/models/User');
  return User.create({ name, email, role, phone, passwordHash: await bcrypt.hash(password, 4) });
}

async function makeVehicle(overrides = {}) {
  const Vehicle = require('../src/models/Vehicle');
  return Vehicle.create({
    make: 'Toyota',
    model: 'Corolla',
    year: 2023,
    licensePlate: `T${Math.floor(Math.random() * 1e6)}-TEST`,
    vehicleClass: 'economy',
    transmission: 'automatic',
    fuel: 'petrol',
    seats: 5,
    luggage: 2,
    dailyRate: 50,
    deposit: 100,
    currency: 'ZAR',
    location: 'Test Depot',
    country: 'ZA',
    mileageLimitKm: 400,
    ...overrides,
  });
}

function iso(date) {
  return date.toISOString().slice(0, 10);
}

function shiftDays(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return iso(date);
}

module.exports = { startDb, stopDb, clear, makeUser, makeVehicle, shiftDays, iso };
