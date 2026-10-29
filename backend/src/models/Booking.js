const { Schema, model } = require('mongoose');

const ACTIVE_STATUSES = ['pending', 'confirmed', 'picked_up'];
const STATUSES = [...ACTIVE_STATUSES, 'returned', 'cancelled', 'no_show'];
const TRANSITIONS = {
  pending: ['confirmed', 'cancelled', 'no_show'],
  confirmed: ['picked_up', 'cancelled', 'no_show'],
  picked_up: ['returned'],
  returned: [],
  cancelled: [],
  no_show: [],
};

const BookingSchema = new Schema(
  {
    code: { type: String, required: true, unique: true },
    customer: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    vehicle: { type: Schema.Types.ObjectId, ref: 'Vehicle', required: true },
    pickUpDate: { type: Date, required: true },
    returnDate: { type: Date, required: true },
    pickUpLocation: { type: String, required: true, trim: true },
    returnLocation: { type: String, required: true, trim: true },
    status: { type: String, enum: STATUSES, default: 'pending' },
    days: { type: Number, required: true, min: 1 },
    rentalTotal: { type: Number, required: true, min: 0 },
    deposit: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'USD' },
    breakdown: { type: Object, required: true },
    extras: {
      extraDriver: { type: Boolean, default: false },
      childSeat: { type: Boolean, default: false },
    },
    notes: { type: String, trim: true, maxlength: 500 },
    cancelledAt: { type: Date },
  },
  { timestamps: true, versionKey: false }
);

BookingSchema.index({ vehicle: 1, status: 1, pickUpDate: 1, returnDate: 1 });
BookingSchema.index({ customer: 1, createdAt: -1 });

BookingSchema.statics.ACTIVE_STATUSES = ACTIVE_STATUSES;
BookingSchema.statics.TRANSITIONS = TRANSITIONS;

// Half-open interval [pickUpDate, returnDate): a return day is free for the next pick-up.
BookingSchema.statics.overlappingQuery = function overlappingQuery(vehicleId, pickUpDate, returnDate, excludeId) {
  const match = {
    vehicle: vehicleId,
    status: { $in: ACTIVE_STATUSES },
    pickUpDate: { $lt: returnDate },
    returnDate: { $gt: pickUpDate },
  };
  if (excludeId) match._id = { $ne: excludeId };
  return match;
};

BookingSchema.set('toJSON', {
  virtuals: true,
  transform(_doc, ret) {
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

module.exports = { Booking: model('Booking', BookingSchema), ACTIVE_STATUSES, STATUSES, TRANSITIONS };
