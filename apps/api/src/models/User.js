import mongoose from 'mongoose';
import { jsonPlugin } from './plugins.js';

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254 },
    passwordHash: { type: String, required: true, select: false },
    status: { type: String, enum: ['ACTIVE', 'DISABLED'], default: 'ACTIVE' },
    passwordChangedAt: { type: Date },
    lastLoginAt: { type: Date },
    passwordReset: {
      type: new mongoose.Schema(
        { tokenHash: { type: String, required: true }, expiresAt: { type: Date, required: true } },
        { _id: false },
      ),
      select: false,
      default: undefined,
    },
  },
  { timestamps: true },
);

userSchema.index({ email: 1 }, { unique: true });
userSchema.index({ 'passwordReset.tokenHash': 1 }, { sparse: true });

jsonPlugin(userSchema, { hidden: ['passwordHash', 'passwordReset', 'status'] });

export const User = mongoose.models.User ?? mongoose.model('User', userSchema);
