import mongoose from 'mongoose';
import { OAUTH_PURPOSES, SOCIAL_PROVIDERS } from '@socialhub/shared';

/**
 * One in-flight OAuth authorization. The `state` sent to Meta and the browser-binding
 * cookie are random secrets stored here only as SHA-256 digests. A state is single-use
 * (`consumedAt`) and short-lived (TTL index removes it after `expiresAt`).
 */
const oauthStateSchema = new mongoose.Schema(
  {
    stateHash: { type: String, required: true },
    browserBindingHash: { type: String, required: true },
    provider: { type: String, enum: Object.values(SOCIAL_PROVIDERS), required: true },
    purpose: { type: String, enum: Object.values(OAUTH_PURPOSES), required: true },
    workspace: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    /** For RECONNECT: the connection being re-authorized. */
    connection: { type: mongoose.Schema.Types.ObjectId, ref: 'SocialConnection' },
    expiresAt: { type: Date, required: true },
    consumedAt: { type: Date },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

oauthStateSchema.index({ stateHash: 1 }, { unique: true });
oauthStateSchema.index({ workspace: 1 });
// Keep expired states briefly so "already used / expired" can be reported, then purge.
oauthStateSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 3600 });

export const OAuthState =
  mongoose.models.OAuthState ?? mongoose.model('OAuthState', oauthStateSchema);
