import { api, money, shortDate } from '../api';

// The rental lifecycle a manager can drive; the two signatures are handled by `decide` instead.
// 'declined' is deliberately absent — it is a signature act, not a counter adjustment.
export const NEXT = {
  pending: ['cancelled', 'no_show'],
  confirmed: ['picked_up', 'cancelled', 'no_show'],
  picked_up: ['returned'],
  returned: [],
  cancelled: [],
  no_show: [],
  declined: [],
};

export const DECIDABLE = ['pending', 'confirmed'];

export const decidable = (booking) => DECIDABLE.includes(booking.status);

export const decide = (id, action) =>
  api(`/bookings/${id}/decision`, { method: 'POST', body: { action } });

export const advance = (id, status) => api(`/bookings/${id}/status`, { method: 'PATCH', body: { status } });

// One plain sentence on where this rental stands and whose turn it is next. The wording is
// written to whoever is reading it: the same booking is "your approval" to the branch and
// "waiting for the branch" to the renter.
export function standing(booking, viewer = 'customer') {
  const who = (side) => (side === viewer ? 'you' : side === 'customer' ? 'the renter' : 'the branch');

  if (booking.status === 'pending') {
    const needsCustomer = !booking.customerAccepted;
    const needsManager = !booking.managerApproved;
    if (viewer === 'manager') {
      if (needsCustomer && needsManager) return 'Waiting on both signatures';
      if (needsCustomer) return 'Waiting on the renter to sign the quote';
      return 'Your approval is needed';
    }
    if (needsCustomer) return 'Your signature is needed';
    if (needsManager) return 'Waiting for the branch to approve';
  }
  if (booking.status === 'confirmed') return 'Confirmed — collect the car on the pick-up date';
  if (booking.status === 'picked_up') return `On rent — due back ${shortDate(booking.returnDate)}`;
  if (booking.status === 'declined') return `Declined by ${who(booking.declinedBy || 'customer')}`;
  if (booking.status === 'cancelled') return `Cancelled by ${who(booking.declinedBy || 'manager')}`;
  return '';
}

export const vehicleName = (booking) =>
  booking.vehicle ? `${booking.vehicle.year || ''} ${booking.vehicle.make} ${booking.vehicle.model}`.replace(/^ /, '') : 'Vehicle removed';

export const priceLine = (booking) =>
  `${money(booking.rentalTotal, booking.currency)} · deposit ${money(booking.deposit, booking.currency)}`;

export const windowLine = (booking) =>
  `${shortDate(booking.pickUpDate)} → ${shortDate(booking.returnDate)} · ${booking.days} day${booking.days === 1 ? '' : 's'}`;

// Money is only ever added up inside one currency, so a portfolio shows one figure per currency.
export function spendByCurrency(bookings) {
  const earned = ['confirmed', 'picked_up', 'returned'];
  const totals = new Map();
  for (const booking of bookings) {
    if (!earned.includes(booking.status)) continue;
    const key = booking.currency || 'USD';
    totals.set(key, (totals.get(key) || 0) + Number(booking.rentalTotal || 0));
  }
  return [...totals.entries()].sort(([a], [b]) => a.localeCompare(b));
}
