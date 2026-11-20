import mongoose from 'mongoose';
import { SOCIAL_PROVIDERS } from '@socialhub/shared';

/**
 * Record of a Meta data-deletion callback, so the person can check its status with the
 * confirmation code Meta shows them. Contains no tokens or profile data.
 */
const metaDataDeletionRequestSchema = new mongoose.Schema(
  {
    confirmationCode: { type: String, required: true },
    provider: { type: String, enum: Object.values(SOCIAL_PROVIDERS), required: true },
    /** SHA-256 of the app-scoped user id, so the record itself is not personal data. */
    providerUserHash: { type: String, required: true },
    status: { type: String, enum: ['COMPLETED'], default: 'COMPLETED' },
    connectionsRemoved: { type: Number, default: 0 },
    accountsRemoved: { type: Number, default: 0 },
    completedAt: { type: Date, default: Date.now },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

metaDataDeletionRequestSchema.index({ confirmationCode: 1 }, { unique: true });

export const MetaDataDeletionRequest =
  mongoose.models.MetaDataDeletionRequest ??
  mongoose.model('MetaDataDeletionRequest', metaDataDeletionRequestSchema);
