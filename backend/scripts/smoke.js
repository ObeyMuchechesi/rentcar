// End-to-end check against a running server: node scripts/smoke.js (http://localhost:4000 by default).
const BASE = process.env.SMOKE_BASE_URL || 'http://localhost:4000';

let failures = 0;

function check(label, condition, detail) {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

async function call(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, body: json, text };
}

const iso = (days) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

async function main() {
  console.log(`Smoke testing ${BASE}\n`);

  const health = await call('/api/health');
  check('GET /api/health reports ok with a connected database', health.body?.status === 'ok' && health.body?.database === 'connected', health.text);

  const fleet = await call(`/api/vehicles?startDate=${iso(2)}&endDate=${iso(5)}`);
  check('date-filtered search returns a fleet', Array.isArray(fleet.body?.vehicles) && fleet.body.vehicles.length > 0, fleet.text);

  const [car] = fleet.body.vehicles;
  const quote = await call(`/api/vehicles/${car.id}/quote?startDate=${iso(2)}&endDate=${iso(5)}`);
  check('quote prices the window', quote.body?.available === true && quote.body.breakdown.rentalTotal > 0, quote.text);

  const driver = await call('/api/auth/login', {
    method: 'POST',
    body: { email: 'driver@rental.test', password: 'Driver123!' },
  });
  check('seeded customer can sign in', driver.status === 200 && Boolean(driver.body?.token), driver.text);
  const token = driver.body?.token;

  const booked = await call('/api/bookings', {
    method: 'POST',
    token,
    body: { vehicleId: car.id, pickUpDate: iso(2), returnDate: iso(5) },
  });
  check('booking is created at the quoted price', booked.status === 201 && booked.body?.booking.rentalTotal === quote.body.breakdown.rentalTotal, booked.text);
  const bookingId = booked.body?.booking?.id;

  const clash = await call('/api/bookings', {
    method: 'POST',
    token,
    body: { vehicleId: car.id, pickUpDate: iso(3), returnDate: iso(4) },
  });
  check('overlapping booking is rejected with 409', clash.status === 409, clash.text);

  const hidden = await call(`/api/vehicles?startDate=${iso(2)}&endDate=${iso(5)}`);
  check(
    'the rented car drops out of that date window',
    hidden.body?.vehicles.every((v) => v.id !== car.id),
    JSON.stringify(hidden.body?.vehicles.map((v) => v.licensePlate))
  );

  const mine = await call('/api/bookings/mine', { token });
  check('customer sees their own booking', mine.body?.bookings.some((b) => b.id === bookingId), mine.text);

  const cancelled = await call(`/api/bookings/${bookingId}/cancel`, { method: 'POST', token });
  check('customer can cancel a pending booking', cancelled.status === 200 && cancelled.body?.booking.status === 'cancelled', cancelled.text);

  const back = await call(`/api/vehicles/${car.id}/quote?startDate=${iso(2)}&endDate=${iso(5)}`);
  check('cancelling frees the dates', back.body?.available === true, back.text);

  const forbidden = await call('/api/stats/overview');
  check('stats are closed to anonymous callers', forbidden.status === 401, forbidden.text);

  const manager = await call('/api/auth/login', {
    method: 'POST',
    body: { email: 'manager@rental.test', password: 'Manager123!' },
  });
  check('seeded manager can sign in', manager.status === 200, manager.text);
  const managerToken = manager.body?.token;

  const stats = await call('/api/stats/overview', { token: managerToken });
  check('manager dashboard stats load', stats.status === 200 && stats.body?.stats?.vehiclesTotal > 0, stats.text);

  const allBookings = await call('/api/bookings/all?status=all&limit=5', { token: managerToken });
  check('manager booking ledger loads', allBookings.status === 200 && Array.isArray(allBookings.body?.bookings), allBookings.text);

  // --- two signatures: the renter signs by booking, the branch signs by approving ---
  const [nextCar] = hidden.body.vehicles.filter((v) => v.status === 'available');
  const unsigned = await call('/api/bookings', {
    method: 'POST',
    token,
    body: { vehicleId: nextCar.id, pickUpDate: iso(10), returnDate: iso(13) },
  });
  const unsignedId = unsigned.body?.booking?.id;
  check('a fresh booking waits on the branch', unsigned.body?.booking?.awaiting === 'manager', unsigned.text);

  const queue = await call('/api/bookings/all?awaiting=manager&limit=100', { token: managerToken });
  check(
    'the branch queue finds it',
    queue.body?.bookings.some((b) => b.id === unsignedId),
    queue.text
  );

  const approved = await call(`/api/bookings/${unsignedId}/decision`, {
    method: 'POST',
    token: managerToken,
    body: { action: 'accept' },
  });
  check('approval confirms the rental', approved.body?.booking?.status === 'confirmed', approved.text);

  const withdrawn = await call(`/api/bookings/${unsignedId}/decision`, {
    method: 'POST',
    token,
    body: { action: 'decline' },
  });
  check(
    'the renter can still withdraw a confirmed booking',
    withdrawn.body?.booking?.status === 'cancelled',
    withdrawn.text
  );

  const freedAgain = await call(`/api/vehicles/${nextCar.id}/quote?startDate=${iso(10)}&endDate=${iso(13)}`);
  check('withdrawing frees the dates', freedAgain.body?.available === true, freedAgain.text);

  // --- worldwide catalogue ---
  const locations = await call('/api/vehicles/locations');
  check(
    'every branch reports a country and a currency',
    locations.body?.locations.every((l) => /^[A-Z]{2}$/.test(l.country) && /^[A-Z]{3}$/.test(l.currency)),
    locations.text
  );

  const abroad = await call('/api/vehicles?country=GB');
  check(
    'the catalogue narrows to one country',
    abroad.status === 200 && abroad.body.vehicles.length > 0 && abroad.body.vehicles.every((v) => v.country === 'GB'),
    abroad.text
  );

  if (abroad.body?.vehicles.length) {
    const [gb] = abroad.body.vehicles;
    const gbQuote = await call(`/api/vehicles/${gb.id}/quote?startDate=${iso(4)}&endDate=${iso(6)}`);
    check(
      'a foreign branch quotes in its own money',
      gbQuote.body?.currency === gb.currency,
      gbQuote.text
    );
  }

  // --- the accounts desk ---
  const stamp = Date.now();
  const scratchEmail = `smoke-${stamp}@test.local`;
  const made = await call('/api/auth/accounts', {
    method: 'POST',
    token: managerToken,
    body: {
      name: 'Smoke Tester',
      email: scratchEmail,
      password: 'Smoke1234!',
      phone: '+1 415 555 0100',
      country: 'US',
      role: 'customer',
    },
  });
  const scratchId = made.body?.user?.id;
  check('the desk opens a renter account', made.status === 201 && made.body?.user?.active === true, made.text);
  check('phones are stored as E.164', made.body?.user?.phone === '+14155550100', made.text);

  const rentersAtDesk = await call('/api/auth/accounts', { token });
  check('renters cannot reach the accounts desk', rentersAtDesk.status === 403, rentersAtDesk.text);

  const self = await call('/api/auth/me', { token: managerToken });
  const selfDelete = await call(`/api/auth/accounts/${self.body?.user?.id}`, { method: 'DELETE', token: managerToken });
  check('a manager cannot delete the account they are signed in with', selfDelete.status === 409, selfDelete.text);

  const signedIn = await call('/api/auth/login', { method: 'POST', body: { email: scratchEmail, password: 'Smoke1234!' } });
  check('the new account can sign in', signedIn.status === 200 && Boolean(signedIn.body?.token), signedIn.text);

  const movedEmail = `smoke-${stamp}-2@test.local`;
  const careless = await call('/api/auth/me', {
    method: 'PATCH',
    token: signedIn.body?.token,
    body: { email: movedEmail },
  });
  check('changing your email costs a password', careless.status === 400, careless.text);

  const careful = await call('/api/auth/me', {
    method: 'PATCH',
    token: signedIn.body?.token,
    body: { email: movedEmail, currentPassword: 'Smoke1234!' },
  });
  check('the account can move off the test email', careful.status === 200 && careful.body?.user?.email === movedEmail, careful.text);

  const suspended = await call(`/api/auth/accounts/${scratchId}`, {
    method: 'PATCH',
    token: managerToken,
    body: { active: false },
  });
  check('the desk can suspend an account', suspended.status === 200 && suspended.body?.user?.active === false, suspended.text);

  const lockedOut = await call('/api/auth/login', { method: 'POST', body: { email: movedEmail, password: 'Smoke1234!' } });
  check('a suspended account is refused', lockedOut.status === 401, lockedOut.text);

  const removed = await call(`/api/auth/accounts/${scratchId}`, { method: 'DELETE', token: managerToken });
  check('an account with no history can be deleted', removed.status === 200, removed.text);

  const unauthorizedCreate = await call('/api/vehicles', {
    method: 'POST',
    token,
    body: { make: 'Evil', model: 'Subaru', year: 2024, licensePlate: 'EVIL-1', vehicleClass: 'suv', transmission: 'manual', fuel: 'petrol', seats: 5, luggage: 2, dailyRate: 10, location: 'Nowhere' },
  });
  check('customers cannot add fleet', unauthorizedCreate.status === 403, unauthorizedCreate.text);

  const spa = await fetch(BASE);
  const spaHtml = await spa.text();
  check('single-page app is served from the API host', spa.status === 200 && spaHtml.includes('<div id="root">'), spaHtml.slice(0, 120));

  console.log(`\n${failures === 0 ? 'All smoke checks passed.' : `${failures} smoke check(s) failed.`}`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error(`Smoke run aborted: ${err.message}`);
  process.exitCode = 1;
});
