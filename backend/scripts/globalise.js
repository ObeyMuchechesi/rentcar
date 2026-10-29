// Brings an existing South-Africa-only database up to the worldwide schema without wiping the
// bookings already on it, then tops the fleet up with the international branches.
//
//   node scripts/globalise.js          # MONGODB_URI from backend/.env or the environment
//
// Safe to run twice: every step only touches documents that still lack the new fields, and the
// fleet top-up matches on number plate (or email) before inserting anything.
const bcrypt = require('bcryptjs');
const { connect, disconnect } = require('../src/db');
const User = require('../src/models/User');
const Vehicle = require('../src/models/Vehicle');
const { Booking } = require('../src/models/Booking');
const { seedIfEmpty, VEHICLES, CUSTOMERS } = require('../src/seed');

// Everything in a pre-worldwide database came off the Cape Town / Johannesburg / Durban fleet.
const LEGACY = { currency: 'ZAR', country: 'ZA', drivingLicenceCountry: 'ZA' };
const SETTLED = ['confirmed', 'picked_up', 'returned', 'cancelled', 'no_show'];

async function backfillVehicles() {
  const result = await Vehicle.updateMany(
    { $or: [{ country: { $exists: false } }, { currency: { $exists: false } }] },
    { $set: { country: LEGACY.country, currency: LEGACY.currency } }
  );
  return result.modifiedCount;
}

async function backfillBookings() {
  const settled = await Booking.updateMany(
    { status: { $in: SETTLED }, $or: [{ customerAccepted: { $ne: true } }, { managerApproved: { $ne: true } }] },
    { $set: { customerAccepted: true, managerApproved: true } }
  );
  // A request that was already waiting for the branch keeps waiting; the customer's signature
  // is implied by the fact that they placed it.
  const waiting = await Booking.updateMany(
    { status: 'pending', customerAccepted: { $ne: true } },
    { $set: { customerAccepted: true, managerApproved: false } }
  );
  const priced = await Booking.updateMany({ currency: { $exists: false } }, { $set: { currency: LEGACY.currency } });
  return settled.modifiedCount + waiting.modifiedCount + priced.modifiedCount;
}

// Phones were stored exactly as typed (+27 82 555 0111); E.164 is the only form that travels.
async function backfillUsers() {
  let touched = 0;
  for (const user of await User.find({}).lean()) {
    const patch = {};
    if (user.phone) {
      const digits = String(user.phone).replace(/[^+\d]/g, '');
      if (digits !== user.phone && /^\+[1-9]\d{6,14}$/.test(digits)) patch.phone = digits;
    }
    if (user.drivingLicenceNumber && !user.drivingLicenceCountry) patch.drivingLicenceCountry = LEGACY.drivingLicenceCountry;
    if (!user.country) patch.country = LEGACY.country;
    if (!Object.keys(patch).length) continue;
    await User.updateOne({ _id: user._id }, { $set: patch });
    touched += 1;
  }
  return touched;
}

async function topUpFleet() {
  const plates = new Set((await Vehicle.find({}, { licensePlate: 1 }).lean()).map((v) => v.licensePlate.toUpperCase()));
  const missing = VEHICLES.filter((vehicle) => !plates.has(vehicle.plate.toUpperCase()));
  if (!missing.length) return 0;

  await Vehicle.create(
    missing.map(({ plate, ...rest }) => ({
      ...rest,
      licensePlate: plate,
      imageUrl: `https://picsum.photos/seed/${rest.make}-${rest.model}/640/400`,
    }))
  );
  return missing.length;
}

// Demo renters are useful on a development database and noise on a live one, so they are opt-in there.
const DEMO_ACCOUNTS = process.env.NODE_ENV !== 'production' || process.env.SEED_DEMO_ACCOUNTS === 'true';

async function topUpAccounts() {
  if (!DEMO_ACCOUNTS) return 0;
  const emails = new Set((await User.find({}, { email: 1 }).lean()).map((u) => u.email));
  const missing = CUSTOMERS.filter((customer) => !emails.has(customer.email));
  if (!missing.length) return 0;

  const passwordHash = await bcrypt.hash(process.env.SEED_CUSTOMER_PASSWORD || 'Driver123!', 10);
  await User.create(missing.map((customer) => ({ ...customer, role: 'customer', passwordHash })));
  return missing.length;
}

async function globalise() {
  if (await seedIfEmpty()) {
    console.log('Database was empty — ran the full worldwide seed instead.');
    return;
  }

  const counts = {
    vehicles: await backfillVehicles(),
    bookings: await backfillBookings(),
    users: await backfillUsers(),
    branches: await topUpFleet(),
    accounts: await topUpAccounts(),
  };

  console.log('Worldwide migration complete.');
  console.log(`  ${counts.vehicles} vehicles stamped with country + currency`);
  console.log(`  ${counts.bookings} booking fields brought up to the two-signature model`);
  console.log(`  ${counts.users} accounts normalised to international phones and countries`);
  console.log(`  ${counts.branches} vehicles added at the new international branches`);
  console.log(`  ${counts.accounts} customer accounts added`);
  if (!DEMO_ACCOUNTS) console.log('  demo renter accounts skipped — set SEED_DEMO_ACCOUNTS=true to add them');
  return counts;
}

if (require.main === module) {
  connect()
    .then(() => globalise())
    .then(() => disconnect())
    .catch((err) => {
      console.error('Migration failed:', err.message);
      process.exitCode = 1;
    });
}

module.exports = { globalise };
