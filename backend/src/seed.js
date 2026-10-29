const bcrypt = require('bcryptjs');
const { config } = require('./config');
const { connect, disconnect } = require('./db');
const User = require('./models/User');
const Vehicle = require('./models/Vehicle');
const { Booking } = require('./models/Booking');
const { priceRental } = require('./lib/pricing');
const { toIsoDate } = require('./lib/dates');

const VEHICLES = [
  { make: 'Toyota', model: 'Corolla', year: 2023, vehicleClass: 'economy', transmission: 'automatic', fuel: 'hybrid', seats: 5, luggage: 2, dailyRate: 42, deposit: 200, location: 'Cape Town International', features: ['Bluetooth', 'Reverse camera', 'Air conditioning'], mileageLimitKm: 400 },
  { make: 'Nissan', model: 'Almera', year: 2022, vehicleClass: 'economy', transmission: 'manual', fuel: 'petrol', seats: 5, luggage: 2, dailyRate: 35, deposit: 150, location: 'Cape Town International', features: ['Air conditioning'], mileageLimitKm: 400 },
  { make: 'Volkswagen', model: 'Polo', year: 2024, vehicleClass: 'economy', transmission: 'manual', fuel: 'petrol', seats: 5, luggage: 2, dailyRate: 38, deposit: 150, location: 'Johannesburg OR Tambo', features: ['Bluetooth', 'Cruise control'], mileageLimitKm: 400 },
  { make: 'Toyota', model: 'Fortuner', year: 2023, vehicleClass: 'suv', transmission: 'automatic', fuel: 'diesel', seats: 7, luggage: 4, dailyRate: 96, deposit: 500, location: 'Cape Town International', features: ['4x4', 'Roof rack', 'Leather seats'], mileageLimitKm: 350 },
  { make: 'Ford', model: 'Ranger', year: 2022, vehicleClass: 'pickup', transmission: 'manual', fuel: 'diesel', seats: 5, luggage: 3, dailyRate: 88, deposit: 450, location: 'Durban King Shaka', features: ['4x4', 'Tow bar'], mileageLimitKm: 300 },
  { make: 'Hyundai', model: 'Tucson', year: 2024, vehicleClass: 'suv', transmission: 'automatic', fuel: 'petrol', seats: 5, luggage: 3, dailyRate: 74, deposit: 400, location: 'Johannesburg OR Tambo', features: ['Apple CarPlay', 'Lane assist'], mileageLimitKm: 400 },
  { make: 'BMW', model: '320i', year: 2023, vehicleClass: 'luxury', transmission: 'automatic', fuel: 'petrol', seats: 5, luggage: 3, dailyRate: 145, deposit: 1000, location: 'Johannesburg OR Tambo', features: ['Sunroof', 'Harman Kardon', 'Adaptive cruise'], mileageLimitKm: 250 },
  { make: 'Mercedes-Benz', model: 'C 220d', year: 2022, vehicleClass: 'luxury', transmission: 'automatic', fuel: 'diesel', seats: 5, luggage: 3, dailyRate: 160, deposit: 1200, location: 'Cape Town International', features: ['Burmester audio', 'Heated seats'], mileageLimitKm: 250 },
  { make: 'Volkswagen', model: 'Transporter', year: 2021, vehicleClass: 'van', transmission: 'manual', fuel: 'diesel', seats: 9, luggage: 8, dailyRate: 105, deposit: 600, location: 'Durban King Shaka', features: ['Twin sliding doors', 'High roof'], mileageLimitKm: 300 },
  { make: 'Nissan', model: 'Leaf', year: 2023, vehicleClass: 'sedan', transmission: 'automatic', fuel: 'electric', seats: 5, luggage: 2, dailyRate: 58, deposit: 300, location: 'Cape Town International', features: ['Fast charging', 'e-Pedal'], mileageLimitKm: 500 },
  { make: 'Mazda', model: 'MX-5', year: 2023, vehicleClass: 'sports', transmission: 'manual', fuel: 'petrol', seats: 2, luggage: 1, dailyRate: 175, deposit: 1500, location: 'Johannesburg OR Tambo', features: ['Convertible roof', 'Bose audio'], mileageLimitKm: 200 },
  { make: 'Suzuki', model: 'Swift', year: 2022, vehicleClass: 'economy', transmission: 'automatic', fuel: 'petrol', seats: 5, luggage: 2, dailyRate: 40, deposit: 150, location: 'Durban King Shaka', features: ['Bluetooth'], mileageLimitKm: 400, status: 'maintenance' },
];

const PLATES = ['CA 244-871', 'CA 118-402', 'JN 772-130', 'CA 559-207', 'DB 341-918', 'JN 685-412', 'JN 903-771', 'CA 127-655', 'DB 480-233', 'CA 774-519', 'JN 216-880', 'DB 902-147'];

function shiftDays(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return toIsoDate(date);
}

const BOOKINGS = [
  { vehicleIndex: 0, customerEmail: 'driver@rental.test', offset: -21, days: 5 },
  { vehicleIndex: 3, customerEmail: 'thando@rental.test', offset: -9, days: 10 },
  { vehicleIndex: 9, customerEmail: 'driver@rental.test', offset: -2, days: 4, status: 'picked_up' },
  { vehicleIndex: 5, customerEmail: 'lihle@rental.test', offset: 1, days: 7, status: 'confirmed' },
  { vehicleIndex: 4, customerEmail: 'thando@rental.test', offset: 4, days: 3 },
  { vehicleIndex: 6, customerEmail: 'lihle@rental.test', offset: 8, days: 6, status: 'confirmed', extraDriver: true },
  { vehicleIndex: 8, customerEmail: 'driver@rental.test', offset: 14, days: 12 },
  { vehicleIndex: 1, customerEmail: 'thando@rental.test', offset: -30, days: 2, status: 'cancelled' },
];

async function seed() {
  await Promise.all([User.deleteMany({}), Vehicle.deleteMany({}), Booking.deleteMany({})]);

  const managerPassword = process.env.SEED_MANAGER_PASSWORD || 'Manager123!';
  const customerPassword = process.env.SEED_CUSTOMER_PASSWORD || 'Driver123!';
  const managerHash = await bcrypt.hash(managerPassword, 10);
  const customerHash = await bcrypt.hash(customerPassword, 10);

  const manager = await User.create({
    name: 'Fleet Manager',
    email: (process.env.SEED_MANAGER_EMAIL || 'manager@rental.test').toLowerCase(),
    role: 'manager',
    phone: '+27 21 555 0100',
    passwordHash: managerHash,
  });

  const customers = await User.create([
    { name: 'Naledi Mokoena', email: 'driver@rental.test', role: 'customer', phone: '+27 82 555 0111', drivingLicenceNumber: 'ZA-4471902', passwordHash: customerHash },
    { name: 'Thando Dlamini', email: 'thando@rental.test', role: 'customer', phone: '+27 83 555 0122', drivingLicenceNumber: 'ZA-8890114', passwordHash: customerHash },
    { name: 'Lihle Nkosi', email: 'lihle@rental.test', role: 'customer', phone: '+27 84 555 0133', drivingLicenceNumber: 'ZA-2205678', passwordHash: customerHash },
  ]);

  const vehicles = await Vehicle.create(
    VEHICLES.map((v, i) => ({ ...v, licensePlate: PLATES[i], imageUrl: `https://picsum.photos/seed/${v.make}-${v.model}/640/400` }))
  );

  let created = 0;
  for (const [index, spec] of BOOKINGS.entries()) {
    const vehicle = vehicles[spec.vehicleIndex];
    if (!vehicle) continue;
    const customer = customers.find((c) => c.email === spec.customerEmail);
    const pickUpDate = shiftDays(spec.offset);
    const returnDate = shiftDays(spec.offset + spec.days);
    const priced = priceRental({
      dailyRate: vehicle.dailyRate,
      pickUpDate,
      returnDate,
      extraDriver: Boolean(spec.extraDriver),
    });
    await Booking.create({
      code: `RC-SEED${String(index + 1).padStart(3, '0')}`,
      customer: customer._id,
      vehicle: vehicle._id,
      pickUpDate: new Date(`${pickUpDate}T00:00:00.000Z`),
      returnDate: new Date(`${returnDate}T00:00:00.000Z`),
      pickUpLocation: vehicle.location,
      returnLocation: vehicle.location,
      status: spec.status || 'returned',
      days: priced.days,
      rentalTotal: priced.breakdown.rentalTotal,
      deposit: vehicle.deposit,
      breakdown: priced.breakdown,
      extras: { extraDriver: Boolean(spec.extraDriver), childSeat: false },
    });
    created += 1;
  }

  console.log('Seed complete.');
  console.log(`  ${vehicles.length} vehicles, ${customers.length} customers, ${created} bookings`);
  console.log(`  manager : ${manager.email} / ${managerPassword}`);
  console.log(`  customer: driver@rental.test / ${customerPassword}`);
  console.log(`  uri     : ${config.mongoUri.replace(/\/\/[^@/]+@/, '//***@')}`);
}

async function seedIfEmpty() {
  if ((await Vehicle.countDocuments()) > 0) return false;
  await seed();
  return true;
}

if (require.main === module) {
  connect()
    .then(() => seed())
    .then(() => disconnect())
    .catch((err) => {
      console.error('Seed failed:', err.message);
      process.exitCode = 1;
    });
}

module.exports = { seed, seedIfEmpty };
