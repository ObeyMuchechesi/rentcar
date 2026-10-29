const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { startDb, stopDb, clear, makeUser } = require('./helpers');

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

test('customers cannot create manager accounts or list the customer book', async () => {
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

  const list = await request(get()).get('/api/auth/customers').set('Authorization', `Bearer ${token}`);
  assert.equal(list.status, 403);
});

test('managers can create customer accounts', async () => {
  const manager = await makeUser({ role: 'manager', email: 'boss@test.io' });
  const login = await request(get()).post('/api/auth/login').send({ email: manager.email, password: 'Password123!' });

  const created = await request(get())
    .post('/api/auth/customers')
    .set('Authorization', `Bearer ${login.body.token}`)
    .send({ name: 'Walk In', email: 'walkin@test.io', password: 'Password123!' });
  assert.equal(created.status, 201);

  const list = await request(get()).get('/api/auth/customers').set('Authorization', `Bearer ${login.body.token}`);
  assert.equal(list.body.customers.length, 1);
});
