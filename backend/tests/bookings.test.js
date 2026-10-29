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

async function session(role = 'customer') {
  const user = await makeUser({ role, email: `${role}-${Date.now()}-${Math.random()}@test.io` });
  const res = await request(get()).post('/api/auth/login').send({ email: user.email, password: 'Password123!' });
  assert.equal(res.status, 200);
  return { token: res.body.token, user };
}

test('the same vehicle cannot be booked twice for overlapping dates', async () => {
  const { token } = await session();
  const vehicle = await makeVehicle();

  const first = await request(get())
    .post('/api/bookings')
    .set('Authorization', `Bearer ${token}`)
    .send({ vehicleId: String(vehicle._id), pickUpDate: shiftDays(3), returnDate: shiftDays(8) });
  assert.equal(first.status, 201);

  const clash = await request(get())
    .post('/api/bookings')
    .set('Authorization', `Bearer ${token}`)
    .send({ vehicleId: String(vehicle._id), pickUpDate: shiftDays(5), returnDate: shiftDays(7) });
  assert.equal(clash.status, 409);
  assert.match(clash.body.error.message, /already booked/);
});

test('back-to-back rentals are allowed on the same vehicle', async () => {
  const { token } = await session();
  const vehicle = await makeVehicle();
  const id = String(vehicle._id);

  const a = await request(get())
    .post('/api/bookings')
    .set('Authorization', `Bearer ${token}`)
    .send({ vehicleId: id, pickUpDate: shiftDays(3), returnDate: shiftDays(6) });
  assert.equal(a.status, 201);

  const b = await request(get())
    .post('/api/bookings')
    .set('Authorization', `Bearer ${token}`)
    .send({ vehicleId: id, pickUpDate: shiftDays(6), returnDate: shiftDays(9) });
  assert.equal(b.status, 201, JSON.stringify(b.body));
});

test('cancelling a booking frees the dates again', async () => {
  const { token } = await session();
  const vehicle = await makeVehicle();
  const id = String(vehicle._id);

  const first = await request(get())
    .post('/api/bookings')
    .set('Authorization', `Bearer ${token}`)
    .send({ vehicleId: id, pickUpDate: shiftDays(10), returnDate: shiftDays(13) });
  const cancel = await request(get())
    .post(`/api/bookings/${first.body.booking.id}/cancel`)
    .set('Authorization', `Bearer ${token}`);
  assert.equal(cancel.status, 200);
  assert.equal(cancel.body.booking.status, 'cancelled');

  const retry = await request(get())
    .post('/api/bookings')
    .set('Authorization', `Bearer ${token}`)
    .send({ vehicleId: id, pickUpDate: shiftDays(10), returnDate: shiftDays(13) });
  assert.equal(retry.status, 201);
});

test('concurrent requests for one car yield exactly one booking', async () => {
  const { token } = await session();
  const vehicle = await makeVehicle();
  const body = { vehicleId: String(vehicle._id), pickUpDate: shiftDays(20), returnDate: shiftDays(23) };

  const results = await Promise.all([
    request(get()).post('/api/bookings').set('Authorization', `Bearer ${token}`).send(body),
    request(get()).post('/api/bookings').set('Authorization', `Bearer ${token}`).send(body),
    request(get()).post('/api/bookings').set('Authorization', `Bearer ${token}`).send(body),
  ]);

  assert.equal(results.filter((r) => r.status === 201).length, 1);
  assert.equal(results.filter((r) => r.status === 409).length, 2);
});

test('pricing: weekly discount and extras are applied once', async () => {
  const { token } = await session();
  const vehicle = await makeVehicle({ dailyRate: 100 });

  const weekly = await request(get())
    .post('/api/bookings')
    .set('Authorization', `Bearer ${token}`)
    .send({ vehicleId: String(vehicle._id), pickUpDate: shiftDays(30), returnDate: shiftDays(37) });
  assert.equal(weekly.status, 201);
  assert.equal(weekly.body.booking.days, 7);
  assert.equal(weekly.body.booking.breakdown.gross, 700);
  assert.equal(weekly.body.booking.breakdown.weeklyDiscount, -105);
  assert.equal(weekly.body.booking.rentalTotal, 595);

  const short = await request(get())
    .post('/api/bookings')
    .set('Authorization', `Bearer ${token}`)
    .send({
      vehicleId: String(vehicle._id),
      pickUpDate: shiftDays(40),
      returnDate: shiftDays(43),
      extraDriver: true,
      childSeat: true,
    });
  // Extras are a share of the daily rate (16% and 10%), so a R100 car adds R16 + R10 a day.
  assert.equal(short.body.booking.rentalTotal, 300 + 48 + 30);
});

test('booking validation rejects bad dates and unknown vehicles', async () => {
  const { token } = await session();
  const vehicle = await makeVehicle();

  const past = await request(get())
    .post('/api/bookings')
    .set('Authorization', `Bearer ${token}`)
    .send({ vehicleId: String(vehicle._id), pickUpDate: shiftDays(-2), returnDate: shiftDays(2) });
  assert.equal(past.status, 400);
  assert.match(past.body.error.message, /past/);

  const backwards = await request(get())
    .post('/api/bookings')
    .set('Authorization', `Bearer ${token}`)
    .send({ vehicleId: String(vehicle._id), pickUpDate: shiftDays(4), returnDate: shiftDays(4) });
  assert.equal(backwards.status, 400);

  const missing = await request(get())
    .post('/api/bookings')
    .set('Authorization', `Bearer ${token}`)
    .send({ vehicleId: '507f1f77bcf86cd799439011', pickUpDate: shiftDays(4), returnDate: shiftDays(6) });
  assert.equal(missing.status, 404);
});

test('vehicles under maintenance cannot be booked', async () => {
  const { token } = await session();
  const vehicle = await makeVehicle({ status: 'maintenance' });
  const res = await request(get())
    .post('/api/bookings')
    .set('Authorization', `Bearer ${token}`)
    .send({ vehicleId: String(vehicle._id), pickUpDate: shiftDays(2), returnDate: shiftDays(4) });
  assert.equal(res.status, 409);
  assert.match(res.body.error.message, /maintenance/);
});

test('customers cannot read or cancel another customer booking', async () => {
  const owner = await session('customer');
  const intruder = await session('customer');
  const vehicle = await makeVehicle();

  const created = await request(get())
    .post('/api/bookings')
    .set('Authorization', `Bearer ${owner.token}`)
    .send({ vehicleId: String(vehicle._id), pickUpDate: shiftDays(5), returnDate: shiftDays(7) });
  const id = created.body.booking.id;

  const read = await request(get()).get(`/api/bookings/${id}`).set('Authorization', `Bearer ${intruder.token}`);
  assert.equal(read.status, 403);

  const cancel = await request(get()).post(`/api/bookings/${id}/cancel`).set('Authorization', `Bearer ${intruder.token}`);
  assert.equal(cancel.status, 403);

  const mine = await request(get()).get('/api/bookings/mine').set('Authorization', `Bearer ${intruder.token}`);
  assert.equal(mine.body.bookings.length, 0);
});

test('only managers can move a booking through the rental lifecycle', async () => {
  const customer = await session('customer');
  const manager = await session('manager');
  const vehicle = await makeVehicle();

  const created = await request(get())
    .post('/api/bookings')
    .set('Authorization', `Bearer ${customer.token}`)
    .send({ vehicleId: String(vehicle._id), pickUpDate: shiftDays(5), returnDate: shiftDays(7) });
  const id = created.body.booking.id;

  const forbidden = await request(get())
    .patch(`/api/bookings/${id}/status`)
    .set('Authorization', `Bearer ${customer.token}`)
    .send({ status: 'confirmed' });
  assert.equal(forbidden.status, 403);

  const skip = await request(get())
    .patch(`/api/bookings/${id}/status`)
    .set('Authorization', `Bearer ${manager.token}`)
    .send({ status: 'returned' });
  assert.equal(skip.status, 409);

  const confirm = await request(get())
    .patch(`/api/bookings/${id}/status`)
    .set('Authorization', `Bearer ${manager.token}`)
    .send({ status: 'confirmed' });
  assert.equal(confirm.status, 200);
  assert.equal(confirm.body.booking.status, 'confirmed');
});

test('a booking waits for the branch after the customer signs the quote', async () => {
  const customer = await session('customer');
  const manager = await session('manager');
  const vehicle = await makeVehicle();

  const created = await request(get())
    .post('/api/bookings')
    .set('Authorization', `Bearer ${customer.token}`)
    .send({ vehicleId: String(vehicle._id), pickUpDate: shiftDays(5), returnDate: shiftDays(7) });
  assert.equal(created.status, 201);
  assert.equal(created.body.booking.status, 'pending');
  assert.equal(created.body.booking.customerAccepted, true);
  assert.equal(created.body.booking.managerApproved, false);
  assert.equal(created.body.booking.awaiting, 'manager');

  const mine = await request(get())
    .get('/api/bookings/all')
    .query({ awaiting: 'manager' })
    .set('Authorization', `Bearer ${manager.token}`);
  assert.deepEqual(mine.body.bookings.map((b) => b.id), [created.body.booking.id]);

  const accepted = await request(get())
    .post(`/api/bookings/${created.body.booking.id}/decision`)
    .set('Authorization', `Bearer ${manager.token}`)
    .send({ action: 'accept' });
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.booking.status, 'confirmed');
  assert.equal(accepted.body.booking.awaiting, null);
});

test('either side can stop a booking before the car is handed over', async () => {
  const customer = await session('customer');
  const manager = await session('manager');
  const vehicle = await makeVehicle({ licensePlate: 'DECLINE-1' });

  const first = await request(get())
    .post('/api/bookings')
    .set('Authorization', `Bearer ${customer.token}`)
    .send({ vehicleId: String(vehicle._id), pickUpDate: shiftDays(30), returnDate: shiftDays(33) });

  const declined = await request(get())
    .post(`/api/bookings/${first.body.booking.id}/decision`)
    .set('Authorization', `Bearer ${manager.token}`)
    .send({ action: 'decline' });
  assert.equal(declined.status, 200);
  assert.equal(declined.body.booking.status, 'declined');
  assert.equal(declined.body.booking.declinedBy, 'manager');

  // A declined car is free again, and the customer gets their own way out too.
  const second = await request(get())
    .post('/api/bookings')
    .set('Authorization', `Bearer ${customer.token}`)
    .send({ vehicleId: String(vehicle._id), pickUpDate: shiftDays(30), returnDate: shiftDays(33) });
  assert.equal(second.status, 201);

  const cancelled = await request(get())
    .post(`/api/bookings/${second.body.booking.id}/decision`)
    .set('Authorization', `Bearer ${customer.token}`)
    .send({ action: 'decline' });
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.body.booking.status, 'cancelled');
  assert.equal(cancelled.body.booking.declinedBy, 'customer');

  const tooLate = await request(get())
    .post(`/api/bookings/${second.body.booking.id}/decision`)
    .set('Authorization', `Bearer ${manager.token}`)
    .send({ action: 'accept' });
  assert.equal(tooLate.status, 409);
});

test('a declined booking is not silently reopened by a later accept', async () => {
  const customer = await session('customer');
  const manager = await session('manager');
  const vehicle = await makeVehicle({ licensePlate: 'DEAD-1' });

  const created = await request(get())
    .post('/api/bookings')
    .set('Authorization', `Bearer ${customer.token}`)
    .send({ vehicleId: String(vehicle._id), pickUpDate: shiftDays(12), returnDate: shiftDays(14) });
  const id = created.body.booking.id;

  await request(get()).post(`/api/bookings/${id}/decision`).set('Authorization', `Bearer ${manager.token}`).send({ action: 'decline' });
  const reopen = await request(get())
    .post(`/api/bookings/${id}/decision`)
    .set('Authorization', `Bearer ${customer.token}`)
    .send({ action: 'accept' });
  assert.equal(reopen.status, 409);

  const badAction = await request(get())
    .post(`/api/bookings/${id}/decision`)
    .set('Authorization', `Bearer ${customer.token}`)
    .send({ action: 'maybe' });
  assert.equal(badAction.status, 400);
});

test('a manager cannot sign for the customer', async () => {
  const customer = await session('customer');
  const manager = await session('manager');
  const vehicle = await makeVehicle({ licensePlate: 'OTHERS-1' });

  const created = await request(get())
    .post('/api/bookings')
    .set('Authorization', `Bearer ${customer.token}`)
    .send({ vehicleId: String(vehicle._id), pickUpDate: shiftDays(40), returnDate: shiftDays(42) });

  const foreign = await request(get())
    .post(`/api/bookings/${created.body.booking.id}/decision`)
    .set('Authorization', `Bearer ${(await session('customer')).token}`)
    .send({ action: 'accept' });
  assert.equal(foreign.status, 403);

  const own = await request(get())
    .post(`/api/bookings/${created.body.booking.id}/decision`)
    .set('Authorization', `Bearer ${manager.token}`)
    .send({ action: 'accept' });
  assert.equal(own.status, 200);
});
