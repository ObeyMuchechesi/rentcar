const { toDateOnly, dayCount } = require('./dates');

const EXTRA_DRIVER_RATE = 8;
const CHILD_SEAT_RATE = 5;
const WEEKLY_DISCOUNT = 0.15;
const MIN_DAYS = 1;
const MAX_DAYS = 90;

// A weekly discount replaces the pro-rated days beyond the 7th, it never stacks with itself.
function priceRental({ dailyRate, pickUpDate, returnDate, extraDriver = false, childSeat = false }) {
  const start = toDateOnly(pickUpDate, 'pickUpDate');
  const end = toDateOnly(returnDate, 'returnDate');
  const days = dayCount(start, end);

  if (days < MIN_DAYS) throw new Error('Return date must be after the pick-up date');
  if (days > MAX_DAYS) throw new Error(`Rentals are limited to ${MAX_DAYS} days`);

  const gross = dailyRate * days;
  const discount = days >= 7 ? +(gross * WEEKLY_DISCOUNT).toFixed(2) : 0;
  const extras = [];
  if (extraDriver) extras.push({ key: 'extraDriver', label: 'Additional driver', amount: +(EXTRA_DRIVER_RATE * days).toFixed(2) });
  if (childSeat) extras.push({ key: 'childSeat', label: 'Child seat', amount: +(CHILD_SEAT_RATE * days).toFixed(2) });

  const extrasTotal = +extras.reduce((sum, e) => sum + e.amount, 0).toFixed(2);
  const rentalTotal = +(gross - discount + extrasTotal).toFixed(2);

  return {
    days,
    currency: 'USD',
    breakdown: {
      dailyRate,
      gross: +gross.toFixed(2),
      weeklyDiscount: discount ? -discount : 0,
      extras,
      extrasTotal,
      rentalTotal,
    },
  };
}

module.exports = { priceRental, EXTRA_DRIVER_RATE, CHILD_SEAT_RATE, WEEKLY_DISCOUNT, MIN_DAYS, MAX_DAYS };
