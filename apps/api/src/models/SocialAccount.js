import mongoose from 'mongoose';
import {
  CONNECTION_STATUS,
  INSTAGRAM_ACCOUNT_TYPES,
  PUBLISHING_STATUS,
  SOCIAL_PLATFORMS,
} from '@socialhub/shared';
import { encryptedAccessTokenPlugin } from './encryptedSecret.js';
import { jsonPlugin } from './plugins.js';

/**
 * A single publishing destination — one Facebook Page or one Instagram professional account.
 * Each destination belongs to exactly one workspace and records the SocialConnection
 * (OAuth identity) it was obtained through. Connection health and publishing readiness are
 * tracked independently: a Page can have a healthy token yet lack publish permission.
 *
 * Destinations are created when a manager selects them from a connection's live discovery
 * results (modules/meta). Removing a destination never affects the connection or others.
 */
const socialAccountSchema = new mongoose.Schema(
  {
    workspace: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true },
    connection: { type: mongoose.Schema.Types.ObjectId, ref: 'SocialConnection', required: true },
    platform: { type: String, enum: Object.values(SOCIAL_PLATFORMS), required: true },
    /** Page id or Instagram professional account id. */
    externalId: { type: String, required: true },
    name: { type: String, required: true, trim: true },
    username: { type: String, trim: true },
    pictureUrl: { type: String },
    category: { type: String },
    instagramAccountType: { type: String, enum: Object.values(INSTAGRAM_ACCOUNT_TYPES) },
    /** For Instagram accounts reached via Facebook Login: the Page they are linked to. */
    linkedFacebookPage: { type: mongoose.Schema.Types.ObjectId, ref: 'SocialAccount' },
    /** Meta id and name of that Page (kept even when the Page itself is not added to the workspace). */
    linkedFacebookPageExternalId: { type: String },
    linkedFacebookPageName: { type: String },
    /** The connected identity's Page roles, e.g. CREATE_CONTENT, MANAGE (Facebook Pages). */
    tasks: { type: [String], default: undefined },
    connectionStatus: {
      type: String,
      enum: Object.values(CONNECTION_STATUS),
      default: CONNECTION_STATUS.ACTIVE,
    },
    connectionStatusReason: { type: String },
    publishingStatus: {
      type: String,
      enum: Object.values(PUBLISHING_STATUS),
      default: PUBLISHING_STATUS.READY,
    },
    publishingStatusReason: { type: String },
    connectedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    lastSyncedAt: { type: Date },
    /**
     * followers_count exactly as Meta last returned it, refreshed when the destination is
     * added or synced. Absent when Meta has never returned one (unknown, which is not 0).
     */
    followersCount: { type: Number, min: 0 },
    /** When followersCount was read from Meta. */
    followersCountUpdatedAt: { type: Date },
  },
  { timestamps: true },
);

// Page / IG access tokens are per-destination and encrypted at rest.
encryptedAccessTokenPlugin(socialAccountSchema);

// A destination is registered once per workspace even if several identities can reach it.
socialAccountSchema.index(
  { workspace: 1, platform: 1, externalId: 1 },
  { unique: true, name: 'one_destination_per_workspace' },
);
socialAccountSchema.index({ workspace: 1, connection: 1 });
socialAccountSchema.index({ workspace: 1, platform: 1, name: 1 });

jsonPlugin(socialAccountSchema, { hidden: ['accessToken'] });

export const SocialAccount =
  mongoose.models.SocialAccount ?? mongoose.model('SocialAccount', socialAccountSchema);
