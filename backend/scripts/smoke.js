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

  const stats = await call('/api/stats/overview', { token: manager.body?.token });
  check('manager dashboard stats load', stats.status === 200 && stats.body?.stats?.vehiclesTotal > 0, stats.text);

  const allBookings = await call('/api/bookings/all?status=all&limit=5', { token: manager.body?.token });
  check('manager booking ledger loads', allBookings.status === 200 && Array.isArray(allBookings.body?.bookings), allBookings.text);

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
