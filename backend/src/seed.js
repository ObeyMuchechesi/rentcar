const bcrypt = require('bcryptjs');
const { config } = require('./config');
const { connect, disconnect } = require('./db');
const User = require('./models/User');
const Vehicle = require('./models/Vehicle');
const { Booking } = require('./models/Booking');
const { priceRental } = require('./lib/pricing');
const { toIsoDate } = require('./lib/dates');

// Rates are what each branch actually charges in its own money — a Corolla in Tokyo is
// priced in yen, not converted from rand.
const VEHICLES = [
  { make: 'Toyota', model: 'Corolla Cross', year: 2023, vehicleClass: 'economy', transmission: 'automatic', fuel: 'hybrid', seats: 5, luggage: 2, dailyRate: 620, deposit: 3000, currency: 'ZAR', country: 'ZA', location: 'Cape Town International', plate: 'CA 244-871', features: ['Bluetooth', 'Reverse camera', 'Air conditioning'], mileageLimitKm: 400 },
  { make: 'Nissan', model: 'Almera', year: 2022, vehicleClass: 'economy', transmission: 'manual', fuel: 'petrol', seats: 5, luggage: 2, dailyRate: 490, deposit: 2500, currency: 'ZAR', country: 'ZA', location: 'Cape Town International', plate: 'CA 118-402', features: ['Air conditioning'], mileageLimitKm: 400 },
  { make: 'Volkswagen', model: 'Polo', year: 2024, vehicleClass: 'economy', transmission: 'manual', fuel: 'petrol', seats: 5, luggage: 2, dailyRate: 540, deposit: 2500, currency: 'ZAR', country: 'ZA', location: 'Johannesburg OR Tambo', plate: 'JN 772-130', features: ['Bluetooth', 'Cruise control'], mileageLimitKm: 400 },
  { make: 'Toyota', model: 'Fortuner', year: 2023, vehicleClass: 'suv', transmission: 'automatic', fuel: 'diesel', seats: 7, luggage: 4, dailyRate: 1450, deposit: 8000, currency: 'ZAR', country: 'ZA', location: 'Cape Town International', plate: 'CA 559-207', features: ['4x4', 'Roof rack', 'Leather seats'], mileageLimitKm: 350 },
  { make: 'Ford', model: 'Ranger', year: 2022, vehicleClass: 'pickup', transmission: 'manual', fuel: 'diesel', seats: 5, luggage: 3, dailyRate: 1320, deposit: 7000, currency: 'ZAR', country: 'ZA', location: 'Durban King Shaka', plate: 'DB 341-918', features: ['4x4', 'Tow bar'], mileageLimitKm: 300 },
  { make: 'Volkswagen', model: 'Golf', year: 2024, vehicleClass: 'economy', transmission: 'manual', fuel: 'petrol', seats: 5, luggage: 2, dailyRate: 34, deposit: 200, currency: 'GBP', country: 'GB', location: 'London Heathrow', plate: 'AB24 CDE', features: ['Apple CarPlay', 'Cruise control'], mileageLimitKm: 400 },
  { make: 'BMW', model: '320i', year: 2023, vehicleClass: 'luxury', transmission: 'automatic', fuel: 'petrol', seats: 5, luggage: 3, dailyRate: 68, deposit: 400, currency: 'GBP', country: 'GB', location: 'London Heathrow', plate: 'LD19 EFG', features: ['Sunroof', 'Harman Kardon', 'Adaptive cruise'], mileageLimitKm: 250 },
  { make: 'Hyundai', model: 'Tucson', year: 2024, vehicleClass: 'suv', transmission: 'automatic', fuel: 'petrol', seats: 5, luggage: 3, dailyRate: 46, deposit: 250, currency: 'GBP', country: 'GB', location: 'Manchester', plate: 'MN70 HKL', features: ['Apple CarPlay', 'Lane assist'], mileageLimitKm: 400 },
  { make: 'Toyota', model: 'Camry', year: 2024, vehicleClass: 'sedan', transmission: 'automatic', fuel: 'hybrid', seats: 5, luggage: 3, dailyRate: 52, deposit: 250, currency: 'USD', country: 'US', location: 'New York JFK', plate: '7ABC123', features: ['Blind spot assist', 'Bluetooth'], mileageLimitKm: 500 },
  { make: 'Jeep', model: 'Wrangler Unlimited', year: 2023, vehicleClass: 'suv', transmission: 'automatic', fuel: 'petrol', seats: 4, luggage: 3, dailyRate: 118, deposit: 500, currency: 'USD', country: 'US', location: 'Los Angeles International', plate: '8XYZ456', features: ['4x4', 'Removable roof'], mileageLimitKm: 400 },
  { make: 'Tesla', model: 'Model 3', year: 2024, vehicleClass: 'sedan', transmission: 'automatic', fuel: 'electric', seats: 5, luggage: 2, dailyRate: 96, deposit: 400, currency: 'USD', country: 'US', location: 'Los Angeles International', plate: '9EVL789', features: ['Autopilot', 'Supercharging'], mileageLimitKm: 600 },
  { make: 'RAM', model: 'ProMaster Passenger', year: 2022, vehicleClass: 'van', transmission: 'automatic', fuel: 'petrol', seats: 12, luggage: 10, dailyRate: 145, deposit: 600, currency: 'USD', country: 'US', location: 'New York JFK', plate: '6VAN321', features: ['Twin sliding doors', 'Rear air conditioning'], mileageLimitKm: 300 },
  { make: 'Nissan', model: 'Sunny', year: 2023, vehicleClass: 'economy', transmission: 'automatic', fuel: 'petrol', seats: 5, luggage: 2, dailyRate: 95, deposit: 500, currency: 'AED', country: 'AE', location: 'Dubai International', plate: 'A 12345', features: ['Air conditioning', 'Bluetooth'], mileageLimitKm: 400 },
  { make: 'Toyota', model: 'Land Cruiser', year: 2024, vehicleClass: 'suv', transmission: 'automatic', fuel: 'petrol', seats: 7, luggage: 5, dailyRate: 750, deposit: 3000, currency: 'AED', country: 'AE', location: 'Dubai International', plate: 'B 67890', features: ['4x4', 'Leather seats', 'Panoramic roof'], mileageLimitKm: 350 },
  { make: 'BMW', model: '530i', year: 2023, vehicleClass: 'luxury', transmission: 'automatic', fuel: 'petrol', seats: 5, luggage: 3, dailyRate: 1100, deposit: 4000, currency: 'AED', country: 'AE', location: 'Dubai International', plate: 'C 24680', features: ['Massage seats', 'Bang & Olufsen'], mileageLimitKm: 250 },
  { make: 'Volkswagen', model: 'ID.3', year: 2024, vehicleClass: 'sedan', transmission: 'automatic', fuel: 'electric', seats: 5, luggage: 3, dailyRate: 58, deposit: 300, currency: 'EUR', country: 'DE', location: 'Frankfurt Airport', plate: 'FF EV 3301', features: ['Fast charging', 'Lane assist'], mileageLimitKm: 450 },
  { make: 'Audi', model: 'A4 Avant', year: 2023, vehicleClass: 'sedan', transmission: 'automatic', fuel: 'diesel', seats: 5, luggage: 4, dailyRate: 66, deposit: 350, currency: 'EUR', country: 'DE', location: 'Frankfurt Airport', plate: 'FF A 4412', features: ['Virtual cockpit', 'Adaptive cruise'], mileageLimitKm: 400 },
  { make: 'Opel', model: 'Corsa', year: 2023, vehicleClass: 'economy', transmission: 'manual', fuel: 'petrol', seats: 5, luggage: 2, dailyRate: 32, deposit: 150, currency: 'EUR', country: 'DE', location: 'Berlin Brandenburg', plate: 'B OB 7788', features: ['Air conditioning'], mileageLimitKm: 400, status: 'maintenance' },
  { make: 'SEAT', model: 'Ibiza', year: 2023, vehicleClass: 'economy', transmission: 'manual', fuel: 'petrol', seats: 5, luggage: 2, dailyRate: 29, deposit: 150, currency: 'EUR', country: 'ES', location: 'Barcelona El Prat', plate: '4521 KLM', features: ['Bluetooth'], mileageLimitKm: 400 },
  { make: 'Volkswagen', model: 'Transporter', year: 2022, vehicleClass: 'van', transmission: 'manual', fuel: 'diesel', seats: 9, luggage: 8, dailyRate: 105, deposit: 500, currency: 'EUR', country: 'ES', location: 'Barcelona El Prat', plate: '7788 NPR', features: ['Twin sliding doors', 'High roof'], mileageLimitKm: 300 },
  { make: 'Toyota', model: 'Hilux', year: 2023, vehicleClass: 'pickup', transmission: 'automatic', fuel: 'diesel', seats: 5, luggage: 3, dailyRate: 128, deposit: 600, currency: 'AUD', country: 'AU', location: 'Sydney Kingsford Smith', plate: 'NSW XY-123', features: ['4x4', 'Tow bar'], mileageLimitKm: 300 },
  { make: 'Hyundai', model: 'i30', year: 2024, vehicleClass: 'economy', transmission: 'automatic', fuel: 'petrol', seats: 5, luggage: 2, dailyRate: 74, deposit: 350, currency: 'AUD', country: 'AU', location: 'Sydney Kingsford Smith', plate: 'NSW AB-456', features: ['Apple CarPlay'], mileageLimitKm: 400 },
  { make: 'Toyota', model: 'Yaris', year: 2024, vehicleClass: 'economy', transmission: 'automatic', fuel: 'hybrid', seats: 5, luggage: 2, dailyRate: 5800, deposit: 20000, currency: 'JPY', country: 'JP', location: 'Tokyo Narita', plate: '300-A1234', features: ['Lane assist', 'Air conditioning'], mileageLimitKm: 400 },
  { make: 'Toyota', model: 'Alphard', year: 2023, vehicleClass: 'van', transmission: 'automatic', fuel: 'petrol', seats: 7, luggage: 4, dailyRate: 24000, deposit: 60000, currency: 'JPY', country: 'JP', location: 'Tokyo Narita', plate: '300-B5678', features: ['Captain seats', 'Rear entertainment'], mileageLimitKm: 350 },
  { make: 'Ford', model: 'Explorer', year: 2023, vehicleClass: 'suv', transmission: 'automatic', fuel: 'petrol', seats: 7, luggage: 4, dailyRate: 118, deposit: 500, currency: 'CAD', country: 'CA', location: 'Toronto Pearson', plate: 'AB 12345', features: ['4x4', 'Heated seats'], mileageLimitKm: 400 },
  { make: 'Chevrolet', model: 'Onix', year: 2024, vehicleClass: 'economy', transmission: 'manual', fuel: 'petrol', seats: 5, luggage: 2, dailyRate: 165, deposit: 600, currency: 'BRL', country: 'BR', location: 'Sao Paulo Guarulhos', plate: 'ABC-1D23', features: ['Bluetooth', 'Air conditioning'], mileageLimitKm: 400 },
];

function shiftDays(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return toIsoDate(date);
}

// The handshake in here mirrors the live one: `pending` needs both signatures before it turns
// `confirmed`, so each spec says who has already signed.
const BOOKINGS = [
  { vehicleIndex: 0, customerEmail: 'driver@rental.test', offset: -24, days: 5 },
  { vehicleIndex: 3, customerEmail: 'thando@rental.test', offset: -12, days: 10 },
  { vehicleIndex: 22, customerEmail: 'kenji@rental.test', offset: -6, days: 4 },
  { vehicleIndex: 9, customerEmail: 'jack@rental.test', offset: -2, days: 4, status: 'picked_up' },
  { vehicleIndex: 6, customerEmail: 'sofia@rental.test', offset: 1, days: 7, status: 'confirmed' },
  { vehicleIndex: 18, customerEmail: 'sofia@rental.test', offset: 6, days: 5, status: 'confirmed' },
  { vehicleIndex: 4, customerEmail: 'thando@rental.test', offset: 5, days: 3, status: 'pending' },
  { vehicleIndex: 8, customerEmail: 'daniel@rental.test', offset: 8, days: 6, status: 'pending', extraDriver: true },
  { vehicleIndex: 13, customerEmail: 'lihle@rental.test', offset: 15, days: 9, status: 'pending' },
  { vehicleIndex: 20, customerEmail: 'jack@rental.test', offset: 21, days: 12, status: 'pending', customerAccepted: false, managerApproved: true },
  { vehicleIndex: 16, customerEmail: 'driver@rental.test', offset: 3, days: 2, status: 'declined', declinedBy: 'manager' },
  { vehicleIndex: 1, customerEmail: 'thando@rental.test', offset: -30, days: 2, status: 'cancelled', declinedBy: 'customer' },
];

const CUSTOMERS = [
  { name: 'Naledi Mokoena', email: 'driver@rental.test', phone: '+27 82 555 0111', country: 'ZA', drivingLicenceNumber: 'ZAF-4471902', drivingLicenceCountry: 'ZA' },
  { name: 'Thando Dlamini', email: 'thando@rental.test', phone: '+27 83 555 0122', country: 'ZA', drivingLicenceNumber: 'ZAF-8890114', drivingLicenceCountry: 'ZA' },
  { name: 'Lihle Nkosi', email: 'lihle@rental.test', phone: '+27 84 555 0133', country: 'ZA', drivingLicenceNumber: 'ZAF-2205678', drivingLicenceCountry: 'ZA' },
  { name: 'Jack Whitfield', email: 'jack@rental.test', phone: '+44 7700 900123', country: 'GB', drivingLicenceNumber: 'WHITF-780114-J', drivingLicenceCountry: 'GB' },
  { name: 'Sofia Herrera', email: 'sofia@rental.test', phone: '+34 612 345 678', country: 'ES', drivingLicenceNumber: 'ES-48901234', drivingLicenceCountry: 'ES' },
  { name: 'Kenji Tanaka', email: 'kenji@rental.test', phone: '+81 90 1234 567', country: 'JP', drivingLicenceNumber: 'JP-90335512', drivingLicenceCountry: 'JP' },
  { name: 'Daniel Kim', email: 'daniel@rental.test', phone: '+1 416 555 0144', country: 'CA', drivingLicenceNumber: 'CA-KIM-229981', drivingLicenceCountry: 'CA' },
];

async function seed() {
  await Promise.all([User.deleteMany({}), Vehicle.deleteMany({}), Booking.deleteMany({})]);

  const managerPassword = process.env.SEED_MANAGER_PASSWORD || 'Manager123!';
  const customerPassword = process.env.SEED_CUSTOMER_PASSWORD || 'Driver123!';
  const managerHash = await bcrypt.hash(managerPassword, 10);
  const customerHash = await bcrypt.hash(customerPassword, 10);

  const managers = await User.create([
    { name: 'Fleet Manager', email: (process.env.SEED_MANAGER_EMAIL || 'manager@rental.test').toLowerCase(), role: 'manager', phone: '+27 21 555 0100', country: 'ZA', passwordHash: managerHash },
    { name: 'Renata Silva', email: 'ops@rental.test', role: 'manager', phone: '+55 11 5555 0100', country: 'BR', passwordHash: managerHash },
  ]);

  const customers = await User.create(
    CUSTOMERS.map((customer) => ({ ...customer, role: 'customer', passwordHash: customerHash }))
  );

  const vehicles = await Vehicle.create(
    VEHICLES.map((vehicle) => {
      const { plate, ...rest } = vehicle;
      return { ...rest, licensePlate: plate, imageUrl: `https://picsum.photos/seed/${vehicle.make}-${vehicle.model}/640/400` };
    })
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
      currency: vehicle.currency,
      pickUpDate,
      returnDate,
      extraDriver: Boolean(spec.extraDriver),
    });
    const status = spec.status || 'returned';
    const decided = new Date();
    const customerAccepted = status === 'pending' ? spec.customerAccepted !== false : true;
    const managerApproved = status === 'pending' ? Boolean(spec.managerApproved) : true;

    await Booking.create({
      code: `RC-SEED${String(index + 1).padStart(3, '0')}`,
      customer: customer._id,
      vehicle: vehicle._id,
      pickUpDate: new Date(`${pickUpDate}T00:00:00.000Z`),
      returnDate: new Date(`${returnDate}T00:00:00.000Z`),
      pickUpLocation: vehicle.location,
      returnLocation: vehicle.location,
      status,
      days: priced.days,
      rentalTotal: priced.breakdown.rentalTotal,
      deposit: vehicle.deposit,
      currency: priced.currency,
      breakdown: priced.breakdown,
      extras: { extraDriver: Boolean(spec.extraDriver), childSeat: false },
      customerAccepted,
      managerApproved,
      declinedBy: spec.declinedBy,
      declinedAt: spec.declinedBy ? decided : undefined,
      cancelledAt: status === 'cancelled' ? decided : undefined,
    });
    created += 1;
  }

  console.log('Seed complete.');
  console.log(`  ${vehicles.length} vehicles, ${customers.length + managers.length} accounts, ${created} bookings`);
  console.log(`  manager : ${managers[0].email} / ${managerPassword}`);
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

module.exports = { seed, seedIfEmpty, VEHICLES, CUSTOMERS };
