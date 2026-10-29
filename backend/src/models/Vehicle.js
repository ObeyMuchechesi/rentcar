const { Schema, model } = require('mongoose');

const VehicleSchema = new Schema(
  {
    make: { type: String, required: true, trim: true, maxlength: 40 },
    model: { type: String, required: true, trim: true, maxlength: 60 },
    year: { type: Number, required: true, min: 1990, max: new Date().getFullYear() + 2 },
    licensePlate: { type: String, required: true, unique: true, uppercase: true, trim: true },
    vehicleClass: {
      type: String,
      required: true,
      enum: ['economy', 'sedan', 'suv', 'van', 'pickup', 'luxury', 'sports'],
    },
    transmission: { type: String, required: true, enum: ['automatic', 'manual'] },
    fuel: { type: String, required: true, enum: ['petrol', 'diesel', 'hybrid', 'electric'] },
    seats: { type: Number, required: true, min: 2, max: 12 },
    luggage: { type: Number, required: true, min: 0, max: 12 },
    dailyRate: { type: Number, required: true, min: 1 },
    deposit: { type: Number, required: true, min: 0, default: 0 },
    currency: { type: String, required: true, uppercase: true, trim: true, default: 'USD', match: /^[A-Z]{3}$/ },
    location: { type: String, required: true, trim: true, maxlength: 60 },
    country: { type: String, required: true, uppercase: true, trim: true, maxlength: 2, match: /^[A-Z]{2}$/ },
    mileageLimitKm: { type: Number, required: true, min: 0, default: 400 },
    status: { type: String, enum: ['available', 'maintenance', 'retired'], default: 'available' },
    // Bumped inside every booking transaction so two concurrent bookings write the same
    // document and MongoDB aborts the loser instead of double-booking the car.
    bookingEpoch: { type: Number, default: 0 },
    features: { type: [String], default: [] },
    imageUrl: { type: String, trim: true },
  },
  { timestamps: true, versionKey: false }
);

VehicleSchema.virtual('displayName').get(function get() {
  return `${this.year} ${this.make} ${this.model}`;
});

VehicleSchema.index({ location: 1, vehicleClass: 1, dailyRate: 1 });
VehicleSchema.index({ country: 1, location: 1 });
VehicleSchema.set('toJSON', {
  virtuals: true,
  transform(_doc, ret) {
    delete ret._id;
    delete ret.bookingEpoch;
    return ret;
  },
});

module.exports = model('Vehicle', VehicleSchema);
