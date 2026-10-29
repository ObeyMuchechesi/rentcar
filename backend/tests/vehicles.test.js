const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { startDb, stopDb, clear, makeUser, makeVehicle, shiftDays } = require('./helpers');

let app = null;
const get = () => app;

before(async () => {
  await startDb();
  app = require('../src/app').createApp();
});

after(async () => {
  await stopDb();
});

beforeEach(async () => {
  await clear();
});

async function managerToken() {
  const user = await makeUser({ role: 'manager', email: `mgr-${Date.now()}@test.io` });
  const res = await request(get()).post('/api/auth/login').send({ email: user.email, password: 'Password123!' });
  return res.body.token;
}

async function book(vehicleId, token, start, end) {
  return request(get())
    .post('/api/bookings')
    .set('Authorization', `Bearer ${token}`)
    .send({ vehicleId, pickUpDate: start, returnDate: end });
}

test('search filters by location, class and price', async () => {
  await makeVehicle({ make: 'Toyota', location: 'Cape Town', vehicleClass: 'suv', dailyRate: 90, licensePlate: 'CT-SUV-1' });
  await makeVehicle({ make: 'Nissan', location: 'Cape Town', vehicleClass: 'economy', dailyRate: 30, licensePlate: 'CT-ECY-1' });
  await makeVehicle({ make: 'Ford', location: 'Durban', vehicleClass: 'suv', dailyRate: 80, licensePlate: 'DB-SUV-1', transmission: 'manual', fuel: 'diesel' });

  const byLocation = await request(get()).get('/api/vehicles').query({ location: 'Cape Town' });
  assert.equal(byLocation.body.count, 2);

  const byClass = await request(get()).get('/api/vehicles').query({ location: 'Cape Town', vehicleClass: 'suv' });
  assert.equal(byClass.body.count, 1);
  assert.equal(byClass.body.vehicles[0].make, 'Toyota');

  const cheap = await request(get()).get('/api/vehicles').query({ maxDailyRate: 85 });
  assert.deepEqual(cheap.body.vehicles.map((v) => v.licensePlate).sort(), ['CT-ECY-1', 'DB-SUV-1']);

  const seats = await request(get()).get('/api/vehicles').query({ minSeats: 5, transmission: 'automatic' });
  assert.equal(seats.body.count, 2);

  const diesels = await request(get()).get('/api/vehicles').query({ fuel: 'diesel' });
  assert.deepEqual(diesels.body.vehicles.map((v) => v.licensePlate), ['DB-SUV-1']);
});

test('date search hides only vehicles already booked for that window', async () => {
  const customer = await makeUser({ email: `c-${Date.now()}@test.io` });
  const login = await request(get()).post('/api/auth/login').send({ email: customer.email, password: 'Password123!' });
  const token = login.body.token;

  const free = await makeVehicle({ licensePlate: 'FREE-1' });
  const taken = await makeVehicle({ licensePlate: 'TAKEN-1', make: 'Ford' });

  const created = await book(String(taken._id), token, shiftDays(5), shiftDays(10));
  assert.equal(created.status, 201);

  const overlapping = await request(get())
    .get('/api/vehicles')
    .query({ startDate: shiftDays(7), endDate: shiftDays(9) });
  assert.deepEqual(overlapping.body.vehicles.map((v) => v.licensePlate), ['FREE-1']);

  const afterReturn = await request(get())
    .get('/api/vehicles')
    .query({ startDate: shiftDays(10), endDate: shiftDays(12) });
  assert.deepEqual(afterReturn.body.vehicles.map((v) => v.licensePlate).sort(), ['FREE-1', 'TAKEN-1']);

  const single = await request(get())
    .get(`/api/vehicles/${taken._id}`)
    .query({ startDate: shiftDays(6), endDate: shiftDays(8) });
  assert.equal(single.body.availableFor.available, false);
});

test('a half-open interval lets a car out again on its return day', async () => {
  const customer = await makeUser({ email: `h-${Date.now()}@test.io` });
  const login = await request(get()).post('/api/auth/login').send({ email: customer.email, password: 'Password123!' });
  const vehicle = await makeVehicle({ licensePlate: 'HALF-1' });

  await book(String(vehicle._id), login.body.token, shiftDays(5), shiftDays(10));
  const res = await request(get())
    .get('/api/vehicles')
    .query({ startDate: shiftDays(10), endDate: shiftDays(11) });
  assert.equal(res.body.vehicles.length, 1);
});

test('date search requires a coherent window', async () => {
  const missing = await request(get()).get('/api/vehicles').query({ startDate: shiftDays(3) });
  assert.equal(missing.status, 400);

  const backwards = await request(get())
    .get('/api/vehicles')
    .query({ startDate: shiftDays(6), endDate: shiftDays(3) });
  assert.equal(backwards.status, 400);
});

test('fleet writes need a manager and are validated', async () => {
  const customer = await makeUser({ email: `w-${Date.now()}@test.io` });
  const login = await request(get()).post('/api/auth/login').send({ email: customer.email, password: 'Password123!' });

  const forbidden = await request(get())
    .post('/api/vehicles')
    .set('Authorization', `Bearer ${login.body.token}`)
    .send({ make: 'Honda', model: 'Civic', year: 2024, licensePlate: 'X-1', vehicleClass: 'sedan', transmission: 'manual', fuel: 'petrol', seats: 5, luggage: 2, dailyRate: 50, location: 'L' });
  assert.equal(forbidden.status, 403);

  const token = await managerToken();
  const bad = await request(get())
    .post('/api/vehicles')
    .set('Authorization', `Bearer ${token}`)
    .send({ make: 'Honda', year: 1900 });
  assert.equal(bad.status, 400);

  const ok = await request(get())
    .post('/api/vehicles')
    .set('Authorization', `Bearer ${token}`)
    .send({
      make: 'Honda', model: 'Civic', year: new Date().getFullYear(), licensePlate: 'NEW-001',
      vehicleClass: 'sedan', transmission: 'manual', fuel: 'petrol', seats: 5, luggage: 2, dailyRate: 55, location: 'Pretoria',
    });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.vehicle.licensePlate, 'NEW-001');

  const dupe = await request(get())
    .post('/api/vehicles')
    .set('Authorization', `Bearer ${token}`)
    .send({
      make: 'Honda', model: 'Civic', year: new Date().getFullYear(), licensePlate: 'NEW-001',
      vehicleClass: 'sedan', transmission: 'manual', fuel: 'petrol', seats: 5, luggage: 2, dailyRate: 55, location: 'Pretoria',
    });
  assert.equal(dupe.status, 400);
});

test('rates are locked while a vehicle is on rent and deletion is blocked', async () => {
  const token = await managerToken();
  const customer = await makeUser({ email: `r-${Date.now()}@test.io` });
  const login = await request(get()).post('/api/auth/login').send({ email: customer.email, password: 'Password123!' });
  const vehicle = await makeVehicle({ licensePlate: 'LOCK-1' });
  await book(String(vehicle._id), login.body.token, shiftDays(2), shiftDays(5));

  const rateChange = await request(get())
    .patch(`/api/vehicles/${vehicle._id}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ dailyRate: 999 });
  assert.equal(rateChange.status, 409);

  const featureChange = await request(get())
    .patch(`/api/vehicles/${vehicle._id}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ features: ['Tow bar'] });
  assert.equal(featureChange.status, 200);

  const remove = await request(get()).delete(`/api/vehicles/${vehicle._id}`).set('Authorization', `Bearer ${token}`);
  assert.equal(remove.status, 409);
});

test('the quote endpoint is the single source of pricing truth', async () => {
  const vehicle = await makeVehicle({ dailyRate: 100, deposit: 250, licensePlate: 'QUOTE-1' });
  const q = await request(get())
    .get(`/api/vehicles/${vehicle._id}/quote`)
    .query({ startDate: shiftDays(2), endDate: shiftDays(9), extraDriver: 'true' });
  assert.equal(q.status, 200);
  assert.equal(q.body.days, 7);
  assert.equal(q.body.available, true);
  assert.equal(q.body.breakdown.rentalTotal, 595 + 56);
  assert.equal(q.body.vehicle.deposit, 250);

  // Booking the same window must charge exactly what the quote promised.
  const customer = await makeUser({ email: `q-${Date.now()}@test.io` });
  const login = await request(get()).post('/api/auth/login').send({ email: customer.email, password: 'Password123!' });
  const created = await request(get())
    .post('/api/bookings')
    .set('Authorization', `Bearer ${login.body.token}`)
    .send({ vehicleId: String(vehicle._id), pickUpDate: shiftDays(2), returnDate: shiftDays(9), extraDriver: true });
  assert.equal(created.status, 201);
  assert.equal(created.body.booking.rentalTotal, q.body.breakdown.rentalTotal);
});

test('retired vehicles stay out of the public catalogue but not out of the manager view', async () => {
  await makeVehicle({ licensePlate: 'LIVE-1' });
  await makeVehicle({ licensePlate: 'OLD-1', status: 'retired' });

  const anon = await request(get()).get('/api/vehicles');
  assert.deepEqual(anon.body.vehicles.map((v) => v.licensePlate), ['LIVE-1']);

  const customer = await makeUser({ email: `p-${Date.now()}@test.io` });
  const custLogin = await request(get()).post('/api/auth/login').send({ email: customer.email, password: 'Password123!' });
  const asCustomer = await request(get())
    .get('/api/vehicles')
    .query({ status: 'all' })
    .set('Authorization', `Bearer ${custLogin.body.token}`);
  assert.deepEqual(asCustomer.body.vehicles.map((v) => v.licensePlate), ['LIVE-1']);

  const token = await managerToken();
  const asManager = await request(get())
    .get('/api/vehicles')
    .query({ status: 'all' })
    .set('Authorization', `Bearer ${token}`);
  assert.deepEqual(asManager.body.vehicles.map((v) => v.licensePlate).sort(), ['LIVE-1', 'OLD-1']);
});

test('manager stats count fleet, bookings and revenue', async () => {
  const token = await managerToken();
  const customer = await makeUser({ email: `s-${Date.now()}@test.io` });
  const login = await request(get()).post('/api/auth/login').send({ email: customer.email, password: 'Password123!' });
  const vehicle = await makeVehicle({ dailyRate: 100, licensePlate: 'STAT-1' });
  await book(String(vehicle._id), login.body.token, shiftDays(2), shiftDays(9));

  const anon = await request(get()).get('/api/stats/overview');
  assert.equal(anon.status, 401);

  const overview = await request(get()).get('/api/stats/overview').set('Authorization', `Bearer ${token}`);
  assert.equal(overview.status, 200);
  assert.equal(overview.body.stats.vehiclesTotal, 1);
  assert.equal(overview.body.stats.activeBookings, 1);
  assert.equal(overview.body.stats.customers, 1);
  assert.equal(overview.body.stats.revenueAllTime, 595);

  const revenue = await request(get()).get('/api/stats/revenue').set('Authorization', `Bearer ${token}`);
  assert.equal(revenue.body.months.reduce((s, m) => s + m.revenue, 0), 595);
});
