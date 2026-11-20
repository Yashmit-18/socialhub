import mongoose from 'mongoose';

/**
 * One document per signed-in device (a refresh-token "family").
 * Only SHA-256 digests of refresh tokens are stored. Each refresh rotates the token;
 * presenting an already-rotated token outside the grace window is treated as theft
 * and revokes the whole session.
 */
const sessionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    tokenHash: { type: String, required: true },
    /** Most recent rotated-out digests (bounded) for reuse detection. */
    previousTokenHashes: { type: [String], default: [] },
    rotatedAt: { type: Date },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date },
    revokedReason: { type: String },
    userAgent: { type: String, maxlength: 512 },
    ip: { type: String, maxlength: 64 },
    lastUsedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

sessionSchema.index({ tokenHash: 1 }, { unique: true });
sessionSchema.index({ previousTokenHashes: 1 });
sessionSchema.index({ user: 1, revokedAt: 1 });
// MongoDB removes expired sessions automatically.
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const PREVIOUS_TOKEN_HISTORY = 5;

export const Session = mongoose.models.Session ?? mongoose.model('Session', sessionSchema);
