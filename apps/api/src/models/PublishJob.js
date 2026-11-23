import mongoose from 'mongoose';
import {
  HASHTAG_PLACEMENTS,
  PUBLISHING_MODES,
  PUBLISH_JOB_STATUS,
  SOCIAL_PLATFORMS,
  emptyDestinationCounts,
} from '@socialhub/shared';
import { jsonPlugin } from './plugins.js';

/**
 * One prepared post sent to one or more destinations. The job owns a frozen copy of the
 * content (`content`), so editing or deleting the draft afterwards never changes what is
 * published. Each destination has its own PublishDestination record and state.
 *
 * `status` and `counts` are derived from the destinations (modules/publishing, syncJob) and
 * are never written by hand. No credential of any kind is stored here.
 */
const contentSchema = new mongoose.Schema(
  {
    caption: { type: String, default: '' },
    platformCaptions: {
      type: new mongoose.Schema(
        {
          [SOCIAL_PLATFORMS.FACEBOOK_PAGE]: { type: String },
          [SOCIAL_PLATFORMS.INSTAGRAM_ACCOUNT]: { type: String },
        },
        { _id: false },
      ),
      default: () => ({}),
    },
    hashtags: { type: [String], default: [] },
    hashtagPlacement: { type: String, enum: Object.values(HASHTAG_PLACEMENTS) },
    firstComment: { type: String, default: '' },
    /** Ordered. `kind` is copied so platform rules can be checked without loading the files. */
    media: {
      type: [
        new mongoose.Schema(
          {
            media: { type: mongoose.Schema.Types.ObjectId, ref: 'MediaAsset', required: true },
            kind: { type: String, required: true },
            altText: { type: String, default: '' },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
  },
  { _id: false },
);

const publishJobSchema = new mongoose.Schema(
  {
    workspace: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true },
    contentPackage: { type: mongoose.Schema.Types.ObjectId, ref: 'ContentPackage', required: true },
    /** Version of the draft that was copied into `content`. */
    contentVersion: { type: Number, required: true },
    content: { type: contentSchema, required: true },
    /**
     * The draft's accounts when this job was made. The job shows the draft's content, so it is
     * hidden from whoever the draft was hidden from (contentAccess.js), even when it was sent
     * to fewer accounts than the draft had.
     */
    draftTargetAccounts: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'SocialAccount' }],
      default: undefined,
    },
    /** How this job is carried out. SIMULATED jobs never reach Meta. */
    mode: {
      type: String,
      enum: [PUBLISHING_MODES.SIMULATED, PUBLISHING_MODES.LIVE],
      required: true,
    },
    status: {
      type: String,
      enum: Object.values(PUBLISH_JOB_STATUS),
      default: PUBLISH_JOB_STATUS.QUEUED,
    },
    counts: { type: mongoose.Schema.Types.Mixed, default: emptyDestinationCounts },
    destinationCount: { type: Number, required: true, min: 1 },
    /** Guards concurrent recalculations of `status` and `counts`. */
    syncSeq: { type: Number, default: 0 },
    /** Chosen by the client once per publish action; the same key returns the same job. */
    idempotencyKey: { type: String, required: true },
    /** Fingerprint of the request the key was first used with. */
    requestHash: { type: String, required: true },
    scheduledAt: { type: Date },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    startedAt: { type: Date },
    completedAt: { type: Date },
    /** Set once the "finished" activity entry has been written. */
    finishLoggedAt: { type: Date },
  },
  { timestamps: true },
);

// Lists: newest first, optionally by status.
publishJobSchema.index({ workspace: 1, _id: -1 });
publishJobSchema.index({ workspace: 1, status: 1, _id: -1 });
// Scheduled posts, soonest first (order=scheduled).
publishJobSchema.index({ workspace: 1, status: 1, scheduledAt: 1, _id: 1 });
// Idempotency: one job per (workspace, person, key), enforced by the database.
publishJobSchema.index(
  { workspace: 1, createdBy: 1, idempotencyKey: 1 },
  { unique: true, name: 'one_job_per_idempotency_key' },
);
publishJobSchema.index({ contentPackage: 1 });
// Jobs hidden from a member because their draft targeted an account the member cannot use.
publishJobSchema.index({ workspace: 1, draftTargetAccounts: 1 });
// Recovery sweep: jobs whose derived status may lag behind their destinations.
publishJobSchema.index({ status: 1, updatedAt: 1 });
// "Is this file still needed by a job that has not finished?" (media deletion and clean-up).
publishJobSchema.index({ 'content.media.media': 1, status: 1 });

jsonPlugin(publishJobSchema, { hidden: ['requestHash', 'syncSeq', 'idempotencyKey'] });

export const PublishJob =
  mongoose.models.PublishJob ?? mongoose.model('PublishJob', publishJobSchema);
