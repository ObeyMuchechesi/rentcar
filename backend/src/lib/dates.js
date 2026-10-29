// Rental days are whole calendar days between pick-up and drop-off, both UTC midnight.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function toDateOnly(value, field) {
  if (typeof value === 'string' && ISO_DATE.test(value)) return new Date(`${value}T00:00:00.000Z`);
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  }
  throw new Error(`${field} must be a YYYY-MM-DD date`);
}

function toIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

function dayCount(start, end) {
  return Math.round((end.getTime() - start.getTime()) / 86400000);
}

module.exports = { toDateOnly, toIsoDate, dayCount, ISO_DATE };
