const { Schema, model } = require('mongoose');

const UserSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    phone: { type: String, trim: true, maxlength: 24 },
    role: { type: String, enum: ['customer', 'manager'], default: 'customer' },
    passwordHash: { type: String, required: true, select: false },
    drivingLicenceNumber: { type: String, trim: true, maxlength: 40 },
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
