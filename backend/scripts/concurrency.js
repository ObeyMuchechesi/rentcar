// Proves the double-booking guard holds across processes. It starts two separate API instances
// pointed at the same database and races identical bookings between them, which is what a
// serverless deployment does when two cold starts land on the same car.
//
//   node scripts/concurrency.js          # needs a replica-set URI (Atlas) in MONGODB_URI
//
// An in-memory or standalone mongod cannot run transactions, so the script refuses to run
// against one rather than reporting a false pass.
const { spawn } = require('child_process');
const path = require('path');
const bcrypt = require('bcryptjs');
const { config } = require('../src/config');
const { connect, disconnect } = require('../src/db');
const { supportsTransactions } = require('../src/lib/transaction');
const { signToken } = require('../src/middleware/auth');
const User = require('../src/models/User');
const Vehicle = require('../src/models/Vehicle');
const { Booking } = require('../src/models/Booking');

const PORTS = [4111, 4112];
const ROUNDS = 3;
const PER_ROUND = 8;
const START_DAYS = 400;

const children = [];

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHealth(baseUrl, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(`${baseUrl}/api/health`);
      if (res.ok) return res.json();
    } catch {
      // Not listening yet.
    }
    if (Date.now() > deadline) throw new Error(`${baseUrl} never became healthy`);
    await wait(400);
  }
}

function startInstance(port) {
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(port), SEED_ON_START: 'false' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => process.stdout.write(`[:${port}] ${chunk}`));
  child.stderr.on('data', (chunk) => process.stderr.write(`[:${port}!] ${chunk}`));
  children.push(child);
  return child;
}

function shift(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function race(baseUrl, token, body) {
  const started = Date.now();
  let res;
  try {
    res = await fetch(`${baseUrl}/api/bookings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  } catch (err) {
    return { status: 0, message: err.message, ms: Date.now() - started };
  }
  const text = await res.text();
  let message = text.slice(0, 160);
  try {
    const parsed = JSON.parse(text);
    message = parsed.error?.message ?? (res.ok ? '' : message);
  } catch {
    /* keep raw text */
  }
  return { status: res.status, message, ms: Date.now() - started };
}

async function main() {
  if (!config.mongoUri || config.mongoUri === 'memory') {
    throw new Error('MONGODB_URI must point at a real replica set (Atlas) — transactions cannot be tested on the in-memory server');
  }

  await connect();
  if (!(await supportsTransactions())) {
    throw new Error(`Connected server is standalone, so it cannot run transactions: ${config.mongoUri.split('@')[1]}`);
  }

  const baseDates = { pickUpDate: shift(START_DAYS), returnDate: shift(START_DAYS + 5) };
  const plate = `RACE-${Date.now()}`.slice(-12);
  const customer = await User.create({
    name: 'Race Tester',
    email: `race-${Date.now()}@test.local`,
    role: 'customer',
    passwordHash: await bcrypt.hash('Password123!', 4),
  });
  const vehicle = await Vehicle.create({
    make: 'Race',
    model: 'Test Car',
    year: new Date().getFullYear(),
    licensePlate: plate,
    vehicleClass: 'economy',
    transmission: 'automatic',
    fuel: 'petrol',
    seats: 5,
    luggage: 2,
    dailyRate: 60,
    deposit: 100,
    location: 'Concurrency Yard',
    mileageLimitKm: 400,
  });
  const token = signToken(customer);
  console.log(`Vehicle ${plate} booked ${baseDates.pickUpDate} → ${baseDates.returnDate} by one customer, ${PER_ROUND} simultaneous requests across ${PORTS.length} instances`);

  const urls = PORTS.map((p) => `http://127.0.0.1:${p}`);
  for (const port of PORTS) startInstance(port);
  const health = await Promise.all(urls.map((u) => waitForHealth(u)));
  console.log(`Instances up — transactions reported: ${health.map((h) => h.bookingTransactions).join(', ')}`);
  if (health.some((h) => h.bookingTransactions !== true)) {
    throw new Error('An instance reports no transaction support; the guard would be process-local only');
  }

  let failures = 0;
  for (let round = 1; round <= ROUNDS; round += 1) {
    await Booking.deleteMany({ vehicle: vehicle._id });
    const results = await Promise.all(
      Array.from({ length: PER_ROUND }, (_unused, i) =>
        race(urls[i % urls.length], token, {
          vehicleId: String(vehicle._id),
          ...baseDates,
          pickUpLocation: 'Concurrency Yard',
          notes: `round ${round} #${i}`,
        })
      )
    );

    const created = results.filter((r) => r.status === 201);
    const rejected = results.filter((r) => r.status === 409);
    const other = results.filter((r) => r.status !== 201 && r.status !== 409);
    const stored = await Booking.countDocuments({ vehicle: vehicle._id });

    console.log(`\nRound ${round}: ${results.map((r) => `${r.status} (${r.ms}ms)`).join(' | ')}`);
    results.forEach((r) => r.message && console.log(`   ${r.status}: ${r.message}`));
    console.log(`   bookings in database: ${stored}`);

    if (created.length !== 1 || rejected.length !== PER_ROUND - 1 || other.length || stored !== 1) {
      failures += 1;
      console.log(`   FAIL — expected 1 created, ${PER_ROUND - 1} conflicts, 1 row`);
    } else {
      console.log('   PASS — exactly one booking survived');
    }
  }

  const epoch = await Vehicle.findById(vehicle._id).then((v) => v.bookingEpoch);
  console.log(`\nbookingEpoch after the races: ${epoch}`);

  if (failures) {
    console.log(`\n${failures} of ${ROUNDS} rounds double-booked.`);
    process.exitCode = 1;
  } else {
    console.log('\nAll rounds held across instances.');
  }

  await Booking.deleteMany({ vehicle: vehicle._id });
  await Vehicle.deleteOne({ _id: vehicle._id });
  await User.deleteOne({ _id: customer._id });
}

async function cleanup() {
  for (const child of children) child.kill();
  try {
    await disconnect();
  } catch {
    /* already down */
  }
}

main()
  .catch((err) => {
    console.error(err.message || err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup();
    process.exit(process.exitCode || 0);
  });
