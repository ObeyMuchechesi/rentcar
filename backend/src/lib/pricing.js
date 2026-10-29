const { toDateOnly, dayCount } = require('./dates');

// Extras are a share of the daily rate rather than a flat amount: R8/day is generous in
// Johannesburg and worthless in Tokyo, so the same number cannot work worldwide.
const EXTRA_DRIVER_PCT = 0.16;
const CHILD_SEAT_PCT = 0.1;
const WEEKLY_DISCOUNT = 0.15;
const MIN_DAYS = 1;
const MAX_DAYS = 90;

const round = (value) => +value.toFixed(2);

// A weekly discount replaces the pro-rated days beyond the 7th, it never stacks with itself.
// Amounts are in the vehicle's own currency; nothing is converted, because a quote has to be
// payable in the money the branch actually takes.
function priceRental({ dailyRate, currency = 'USD', pickUpDate, returnDate, extraDriver = false, childSeat = false }) {
  const start = toDateOnly(pickUpDate, 'pickUpDate');
  const end = toDateOnly(returnDate, 'returnDate');
  const days = dayCount(start, end);

  if (!/^[A-Z]{3}$/.test(currency)) throw new Error(`Unsupported currency ${currency}`);
  if (days < MIN_DAYS) throw new Error('Return date must be after the pick-up date');
  if (days > MAX_DAYS) throw new Error(`Rentals are limited to ${MAX_DAYS} days`);

  const gross = dailyRate * days;
  const discount = days >= 7 ? round(gross * WEEKLY_DISCOUNT) : 0;
  const extras = [];
  if (extraDriver) extras.push({ key: 'extraDriver', label: 'Additional driver', amount: round(dailyRate * EXTRA_DRIVER_PCT * days) });
  if (childSeat) extras.push({ key: 'childSeat', label: 'Child seat', amount: round(dailyRate * CHILD_SEAT_PCT * days) });

  const extrasTotal = round(extras.reduce((sum, e) => sum + e.amount, 0));
  const rentalTotal = round(gross - discount + extrasTotal);

  return {
    days,
    currency,
    breakdown: {
      dailyRate,
      gross: round(gross),
      weeklyDiscount: discount ? -discount : 0,
      extras,
      extrasTotal,
      rentalTotal,
    },
  };
}

module.exports = { priceRental, EXTRA_DRIVER_PCT, CHILD_SEAT_PCT, WEEKLY_DISCOUNT, MIN_DAYS, MAX_DAYS };
