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

test('register creates a customer and returns a usable token', async () => {
  const res = await request(get()).post('/api/auth/register').send({
    name: 'Alex Rider',
    email: 'Alex@Example.com',
    password: 'Sup3rSecret',
    phone: '+27 82 000 0000',
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.user.email, 'alex@example.com');
  assert.equal(res.body.user.role, 'customer');
  assert.ok(!('passwordHash' in res.body.user));

  const me = await request(get()).get('/api/auth/me').set('Authorization', `Bearer ${res.body.token}`);
  assert.equal(me.status, 200);
  assert.equal(me.body.user.name, 'Alex Rider');
});

test('duplicate emails and weak passwords are rejected', async () => {
  await request(get()).post('/api/auth/register').send({ name: 'One', email: 'dup@test.io', password: 'Password123!' });

  const dup = await request(get()).post('/api/auth/register').send({ name: 'Two', email: 'dup@test.io', password: 'Password123!' });
  assert.equal(dup.status, 409);

  const weak = await request(get()).post('/api/auth/register').send({ name: 'Three', email: 'three@test.io', password: 'short' });
  assert.equal(weak.status, 400);

  const bogus = await request(get()).post('/api/auth/register').send({ name: 'Four', email: 'not-an-email', password: 'Password123!' });
  assert.equal(bogus.status, 400);
});

test('login never reveals which half of the credentials was wrong', async () => {
  const user = await makeUser({ email: 'known@test.io' });

  const badPassword = await request(get()).post('/api/auth/login').send({ email: user.email, password: 'WrongPass1' });
  const badEmail = await request(get()).post('/api/auth/login').send({ email: 'nobody@test.io', password: 'WrongPass1' });

  assert.equal(badPassword.status, 401);
  assert.equal(badEmail.status, 401);
  assert.equal(badPassword.body.error.message, badEmail.body.error.message);
});

test('a valid password for a deactivated account is refused', async () => {
  const user = await makeUser({ email: 'off@test.io' });
  await require('../src/models/User').updateOne({ _id: user._id }, { active: false });

  const res = await request(get()).post('/api/auth/login').send({ email: user.email, password: 'Password123!' });
  assert.equal(res.status, 401);
});

test('protected routes reject missing, malformed and forged tokens', async () => {
  const anon = await request(get()).get('/api/bookings/mine');
  assert.equal(anon.status, 401);

  const forged = await request(get()).get('/api/bookings/mine').set('Authorization', 'Bearer not.a.jwt');
  assert.equal(forged.status, 401);

  const otherKey = require('jsonwebtoken').sign({ sub: 'deadbeefdeadbeefdeadbeef' }, 'a-different-secret');
  const wrongSecret = await request(get()).get('/api/bookings/mine').set('Authorization', `Bearer ${otherKey}`);
  assert.equal(wrongSecret.status, 401);
});

test('customers cannot create manager accounts or read the accounts desk', async () => {
  const customer = await request(get()).post('/api/auth/register').send({
    name: 'Cust',
    email: 'cust@test.io',
    password: 'Password123!',
  });
  const token = customer.body.token;

  const escalate = await request(get()).post('/api/auth/register').set('Authorization', `Bearer ${token}`).send({
    name: 'Sneaky',
    email: 'sneaky@test.io',
    password: 'Password123!',
    role: 'manager',
  });
  assert.equal(escalate.status, 201);
  assert.equal(escalate.body.user.role, 'customer');

  const list = await request(get()).get('/api/auth/accounts').set('Authorization', `Bearer ${token}`);
  assert.equal(list.status, 403);

  const create = await request(get())
    .post('/api/auth/accounts')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: 'Walk In', email: 'walkin@test.io', password: 'Password123!' });
  assert.equal(create.status, 403);

  const selfRole = await request(get())
    .patch('/api/auth/me')
    .set('Authorization', `Bearer ${token}`)
    .send({ role: 'manager' });
  assert.equal(selfRole.status, 400);
});

test('managers create accounts and can hand out the manager role', async () => {
  const manager = await makeUser({ role: 'manager', email: 'boss@test.io' });
  const login = await request(get()).post('/api/auth/login').send({ email: manager.email, password: 'Password123!' });
  const token = login.body.token;

  const created = await request(get())
    .post('/api/auth/accounts')
    .set('Authorization', `Bearer ${token}`)
    .send({
      name: 'Walk In',
      email: 'walkin@test.io',
      password: 'Password123!',
      phone: '+1 415 555 0100',
      country: 'us',
      drivingLicenceNumber: 'US-88900',
      drivingLicenceCountry: 'US',
    });
  assert.equal(created.status, 201);
  assert.equal(created.body.user.role, 'customer');
  assert.equal(created.body.user.phone, '+14155550100');
  assert.equal(created.body.user.country, 'US');

  const deputy = await request(get())
    .post('/api/auth/accounts')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: 'Deputy', email: 'deputy@test.io', password: 'Password123!', role: 'manager' });
  assert.equal(deputy.body.user.role, 'manager');

  const customers = await request(get()).get('/api/auth/accounts').query({ role: 'customer' }).set('Authorization', `Bearer ${token}`);
  assert.equal(customers.body.accounts.length, 1);
  assert.equal(customers.body.accounts[0].email, 'walkin@test.io');

  const search = await request(get()).get('/api/auth/accounts').query({ search: 'DEPU' }).set('Authorization', `Bearer ${token}`);
  assert.deepEqual(search.body.accounts.map((a) => a.email), ['deputy@test.io']);

  const badPhone = await request(get())
    .post('/api/auth/accounts')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: 'Local Only', email: 'local@test.io', password: 'Password123!', phone: '082 555 0111' });
  assert.equal(badPhone.status, 400);
});

test('accounts carry their own booking and spend figures, split by currency', async () => {
  const manager = await makeUser({ role: 'manager', email: 'boss2@test.io' });
  const login = await request(get()).post('/api/auth/login').send({ email: manager.email, password: 'Password123!' });
  const token = login.body.token;

  const customer = await makeUser({ email: 'payer@test.io' });
  const customerLogin = await request(get()).post('/api/auth/login').send({ email: customer.email, password: 'Password123!' });
  const vehicle = await makeVehicle({ licensePlate: 'SPEND-1' });
  const created = await request(get())
    .post('/api/bookings')
    .set('Authorization', `Bearer ${customerLogin.body.token}`)
    .send({ vehicleId: String(vehicle._id), pickUpDate: shiftDays(2), returnDate: shiftDays(6) });
  assert.equal(created.status, 201);

  const list = await request(get()).get('/api/auth/accounts').query({ role: 'customer' }).set('Authorization', `Bearer ${token}`);
  const row = list.body.accounts.find((a) => a.email === 'payer@test.io');
  assert.equal(row.stats.bookings, 1);
  assert.equal(row.stats.active, 1);
  // Nothing is confirmed yet, so the spend is recorded but zero.
  assert.deepEqual(row.stats.spend, [{ currency: 'ZAR', amount: 0 }]);
});

test('people change their own email or password, but only with their current password', async () => {
  const registered = await request(get())
    .post('/api/auth/register')
    .send({ name: 'Nia', email: 'nia@test.io', password: 'Password123!' });
  const token = registered.body.token;

  const noProof = await request(get()).patch('/api/auth/me').set('Authorization', `Bearer ${token}`).send({ email: 'nia@work.io' });
  assert.equal(noProof.status, 400);

  const wrongProof = await request(get())
    .patch('/api/auth/me')
    .set('Authorization', `Bearer ${token}`)
    .send({ email: 'nia@work.io', currentPassword: 'NotIt123' });
  assert.equal(wrongProof.status, 401);

  await request(get())
    .post('/api/auth/register')
    .send({ name: 'Other', email: 'other@test.io', password: 'Password123!' });
  const clash = await request(get())
    .patch('/api/auth/me')
    .set('Authorization', `Bearer ${token}`)
    .send({ email: 'other@test.io', currentPassword: 'Password123!' });
  assert.equal(clash.status, 409);

  const changed = await request(get())
    .patch('/api/auth/me')
    .set('Authorization', `Bearer ${token}`)
    .send({ email: 'nia@work.io', currentPassword: 'Password123!' });
  assert.equal(changed.status, 200);
  assert.equal(changed.body.user.email, 'nia@work.io');

  const relogin = await request(get()).post('/api/auth/login').send({ email: 'nia@work.io', password: 'Password123!' });
  assert.equal(relogin.status, 200);

  const passwordless = await request(get())
    .patch('/api/auth/me')
    .set('Authorization', `Bearer ${token}`)
    .send({ password: 'BrandNew123' });
  assert.equal(passwordless.status, 400);

  const rotated = await request(get())
    .patch('/api/auth/me')
    .set('Authorization', `Bearer ${token}`)
    .send({ password: 'BrandNew123', currentPassword: 'Password123!' });
  assert.equal(rotated.status, 200);
  assert.equal((await request(get()).post('/api/auth/login').send({ email: 'nia@work.io', password: 'BrandNew123' })).status, 200);
  assert.equal((await request(get()).post('/api/auth/login').send({ email: 'nia@work.io', password: 'Password123!' })).status, 401);
});

test('managers deactivate accounts but never delete rental history', async () => {
  const manager = await makeUser({ role: 'manager', email: 'boss3@test.io' });
  const login = await request(get()).post('/api/auth/login').send({ email: manager.email, password: 'Password123!' });
  const token = login.body.token;

  const quiet = await makeUser({ email: 'quiet@test.io' });
  const deactivated = await request(get())
    .patch(`/api/auth/accounts/${quiet._id}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ active: false });
  assert.equal(deactivated.status, 200);
  assert.equal(deactivated.body.user.active, false);
  assert.equal((await request(get()).post('/api/auth/login').send({ email: quiet.email, password: 'Password123!' })).status, 401);

  const reactivated = await request(get())
    .patch(`/api/auth/accounts/${quiet._id}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ active: true });
  assert.equal(reactivated.body.user.active, true);

  const reset = await request(get())
    .patch(`/api/auth/accounts/${quiet._id}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ password: 'FreshPass1' });
  assert.equal(reset.status, 200);
  assert.equal((await request(get()).post('/api/auth/login').send({ email: quiet.email, password: 'FreshPass1' })).status, 200);

  const selfDelete = await request(get())
    .delete(`/api/auth/accounts/${manager._id}`)
    .set('Authorization', `Bearer ${token}`);
  assert.equal(selfDelete.status, 409);

  const clean = await makeUser({ email: 'clean@test.io' });
  const deleted = await request(get()).delete(`/api/auth/accounts/${clean._id}`).set('Authorization', `Bearer ${token}`);
  assert.equal(deleted.status, 200);
  assert.equal(await require('../src/models/User').exists({ _id: clean._id }), null);
});

test('an account with bookings is deactivated rather than deleted, and the last manager cannot be removed', async () => {
  const manager = await makeUser({ role: 'manager', email: 'boss4@test.io' });
  const login = await request(get()).post('/api/auth/login').send({ email: manager.email, password: 'Password123!' });
  const token = login.body.token;

  const customer = await makeUser({ email: 'history@test.io' });
  const customerLogin = await request(get()).post('/api/auth/login').send({ email: customer.email, password: 'Password123!' });
  const vehicle = await makeVehicle({ licensePlate: 'HIST-1' });
  assert.equal(
    (await request(get())
      .post('/api/bookings')
      .set('Authorization', `Bearer ${customerLogin.body.token}`)
      .send({ vehicleId: String(vehicle._id), pickUpDate: shiftDays(2), returnDate: shiftDays(4) })).status,
    201
  );

  const blocked = await request(get()).delete(`/api/auth/accounts/${customer._id}`).set('Authorization', `Bearer ${token}`);
  assert.equal(blocked.status, 409);
  assert.match(blocked.body.error.message, /deactivate/);

  const demote = await request(get())
    .patch(`/api/auth/accounts/${manager._id}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ role: 'customer' });
  assert.equal(demote.status, 409);
  assert.match(demote.body.error.message, /another manager/);

  const removeLast = await request(get())
    .delete(`/api/auth/accounts/${manager._id}`)
    .set('Authorization', `Bearer ${token}`);
  assert.equal(removeLast.status, 409);

  // With a second manager in place, the first one can demote and delete the other.
  const deputy = await makeUser({ role: 'manager', email: 'deputy4@test.io' });
  const demoted = await request(get())
    .patch(`/api/auth/accounts/${deputy._id}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ role: 'customer' });
  assert.equal(demoted.status, 200);
  assert.equal(demoted.body.user.role, 'customer');
  assert.equal((await request(get()).delete(`/api/auth/accounts/${deputy._id}`).set('Authorization', `Bearer ${token}`)).status, 200);
});

test('managers book for walk-in customers and the customer still has to accept', async () => {
  const manager = await makeUser({ role: 'manager', email: 'boss5@test.io' });
  const login = await request(get()).post('/api/auth/login').send({ email: manager.email, password: 'Password123!' });

  const walkIn = await makeUser({ email: 'walkin5@test.io' });
  const vehicle = await makeVehicle({ licensePlate: 'WALK-1' });
  const created = await request(get())
    .post('/api/bookings')
    .set('Authorization', `Bearer ${login.body.token}`)
    .send({ vehicleId: String(vehicle._id), pickUpDate: shiftDays(3), returnDate: shiftDays(6), customerId: String(walkIn._id) });
  assert.equal(created.status, 201);
  assert.equal(created.body.booking.status, 'pending');
  assert.equal(created.body.booking.customerAccepted, false);
  assert.equal(created.body.booking.awaiting, 'customer');

  const queued = await request(get()).get('/api/bookings/all').query({ awaiting: 'customer' }).set('Authorization', `Bearer ${login.body.token}`);
  assert.equal(queued.body.bookings.length, 1);

  const notYours = await request(get())
    .post(`/api/bookings/${created.body.booking.id}/decision`)
    .set('Authorization', `Bearer ${login.body.token}`)
    .send({ action: 'accept' });
  assert.equal(notYours.status, 200);
  assert.equal(notYours.body.booking.status, 'pending');

  const walkInLogin = await request(get()).post('/api/auth/login').send({ email: walkIn.email, password: 'Password123!' });
  const signed = await request(get())
    .post(`/api/bookings/${created.body.booking.id}/decision`)
    .set('Authorization', `Bearer ${walkInLogin.body.token}`)
    .send({ action: 'accept' });
  assert.equal(signed.status, 200);
  assert.equal(signed.body.booking.status, 'confirmed');
});

test('a customer cannot book on behalf of somebody else', async () => {
  const me = await makeUser({ email: 'booker7@test.io' });
  const victim = await makeUser({ email: 'victim7@test.io' });
  const token = (await request(get()).post('/api/auth/login').send({ email: me.email, password: 'Password123!' })).body.token;
  const vehicle = await makeVehicle({ licensePlate: 'STEAL-1' });

  const res = await request(get())
    .post('/api/bookings')
    .set('Authorization', `Bearer ${token}`)
    .send({
      vehicleId: String(vehicle._id),
      pickUpDate: shiftDays(3),
      returnDate: shiftDays(5),
      customerId: String(victim._id),
    });
  assert.equal(res.status, 403);
});
