import mongoose from 'mongoose';
import { CONNECTION_STATUS, SOCIAL_PROVIDERS, SYNC_OUTCOMES } from '@socialhub/shared';
import { encryptedAccessTokenPlugin } from './encryptedSecret.js';
import { jsonPlugin } from './plugins.js';

/**
 * An OAuth identity that authorised SocialHub inside a workspace — e.g. one person's
 * Facebook login. A workspace can hold many connections (several Facebook identities,
 * several Instagram logins), and one connection usually yields many SocialAccounts.
 *
 * Connections are created only by the official Meta OAuth flow (modules/meta). The stored
 * token is the identity's long-lived user token, encrypted at rest.
 */
const socialConnectionSchema = new mongoose.Schema(
  {
    workspace: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true },
    provider: { type: String, enum: Object.values(SOCIAL_PROVIDERS), required: true },
    /**
     * The identity that authorized SocialHub: the person's app-scoped user id (Facebook), the
     * Instagram-scoped user id (Instagram Login) or, for Instagram Unified Login, the client's
     * business portfolio id (client_business_id) that owns the system-user token.
     */
    externalUserId: { type: String, required: true },
    /** Unified Login: the business integration system user the token belongs to (`/me` id). */
    metaSystemUserId: { type: String },
    /** Unified Login: the login configuration (config_id) the authorization used. Not secret. */
    loginConfigId: { type: String },
    displayName: { type: String, trim: true },
    pictureUrl: { type: String },
    grantedScopes: { type: [String], default: [] },
    declinedScopes: { type: [String], default: [] },
    /** null = no expiry reported by Meta. */
    tokenExpiresAt: { type: Date },
    /** Facebook: after this date data access lapses and the person must reauthorize. */
    dataAccessExpiresAt: { type: Date },
    status: {
      type: String,
      enum: Object.values(CONNECTION_STATUS),
      default: CONNECTION_STATUS.ACTIVE,
    },
    statusReason: { type: String },
    /** When the current token was obtained or last refreshed. */
    lastRefreshedAt: { type: Date },
    /** Last SUCCESSFUL synchronization with Meta. */
    lastSyncedAt: { type: Date },
    /** Last synchronization attempt, successful or not, and its outcome (SYNC_OUTCOMES). */
    lastSyncAttemptAt: { type: Date },
    lastSyncOutcome: { type: String, enum: Object.values(SYNC_OUTCOMES) },
    /** Short-lived lock so two synchronizations of one connection never overlap. */
    syncLockedUntil: { type: Date },
    lastError: {
      type: new mongoose.Schema({ code: String, message: String, at: Date }, { _id: false }),
      default: undefined,
    },
    connectedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    disconnectedAt: { type: Date },
  },
  { timestamps: true },
);

encryptedAccessTokenPlugin(socialConnectionSchema);

// The same identity can be connected once per workspace; different identities are independent.
socialConnectionSchema.index(
  { workspace: 1, provider: 1, externalUserId: 1 },
  { unique: true, name: 'one_connection_per_identity_per_workspace' },
);
socialConnectionSchema.index({ workspace: 1, status: 1 });
// Cross-workspace lookups by identity (Meta callbacks, revocation safety checks).
socialConnectionSchema.index({ provider: 1, externalUserId: 1 });

jsonPlugin(socialConnectionSchema, { hidden: ['accessToken'] });

export const SocialConnection =
  mongoose.models.SocialConnection ?? mongoose.model('SocialConnection', socialConnectionSchema);
