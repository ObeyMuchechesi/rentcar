const { Schema, model } = require('mongoose');

// Strips the formatting people type (+27 82 555 0111) so the stored value is E.164, which is
// the only phone form that means the same thing in every country.
function toE164(value) {
  if (value === undefined || value === null || value === '') return undefined;
  return String(value).replace(/[^+\d]/g, '');
}

const UserSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    phone: { type: String, set: toE164, maxlength: 16, match: /^\+[1-9]\d{6,14}$/ },
    country: { type: String, uppercase: true, trim: true, maxlength: 2, match: /^[A-Z]{2}$/ },
    role: { type: String, enum: ['customer', 'manager'], default: 'customer' },
    passwordHash: { type: String, required: true, select: false },
    drivingLicenceNumber: { type: String, trim: true, maxlength: 40 },
    drivingLicenceCountry: { type: String, uppercase: true, trim: true, maxlength: 2, match: /^[A-Z]{2}$/ },
    active: { type: Boolean, default: true },
  },
  { timestamps: true, versionKey: false }
);

UserSchema.set('toJSON', {
  virtuals: true,
  transform(_doc, ret) {
    delete ret._id;
    delete ret.passwordHash;
    return ret;
  },
});

module.exports = model('User', UserSchema);
