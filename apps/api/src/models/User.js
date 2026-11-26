import mongoose from 'mongoose';
import { ADMIN_LIMITS, PLATFORM_ROLES } from '@socialhub/shared';
import { jsonPlugin } from './plugins.js';

// Why, when and by whom an account was suspended. Present only while status is DISABLED.
const suspensionSchema = new mongoose.Schema(
  {
    at: { type: Date, required: true },
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    /** Snapshot, so the record stays readable if that operator's name changes. */
    byName: { type: String, required: true },
    reason: { type: String, required: true, maxlength: ADMIN_LIMITS.REASON_MAX },
  },
  { _id: false },
);

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254 },
    passwordHash: { type: String, required: true, select: false },
    status: { type: String, enum: ['ACTIVE', 'DISABLED'], default: 'ACTIVE' },
    passwordChangedAt: { type: Date },
    lastLoginAt: { type: Date },
    /**
     * Access to the operator console (/admin). Set only by scripts/platform-admin.js. Not a
     * workspace role. The signed-in person receives it in their own user JSON.
     */
    platformRole: { type: String, enum: Object.values(PLATFORM_ROLES) },
    suspension: { type: suspensionSchema, select: false, default: undefined },
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
// Operator console: accounts by status, newest first; and who the platform admins are.
userSchema.index({ status: 1, _id: -1 });
userSchema.index({ platformRole: 1 }, { sparse: true });

jsonPlugin(userSchema, { hidden: ['passwordHash', 'passwordReset', 'status', 'suspension'] });

export const User = mongoose.models.User ?? mongoose.model('User', userSchema);
