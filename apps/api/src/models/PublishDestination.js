import mongoose from 'mongoose';
import { DESTINATION_STATES, SOCIAL_PLATFORMS } from '@socialhub/shared';
import { jsonPlugin } from './plugins.js';

/**
 * One destination of a publish job: one Facebook Page or one Instagram account. It moves
 * through its own lifecycle independently of the job's other destinations.
 *
 * This document is the source of truth. The queue only carries this document's id; access
 * tokens are read from the SocialAccount at the moment a worker processes it and are never
 * copied here or into a queue payload.
 */
const errorSchema = new mongoose.Schema(
  {
    code: { type: String, required: true },
    /** Safe to show to people: never contains tokens, URLs with tokens or raw provider dumps. */
    message: { type: String, required: true },
    retryable: { type: Boolean, default: false },
    at: { type: Date, required: true },
  },
  { _id: false },
);

const attemptSchema = new mongoose.Schema(
  {
    number: { type: Number, required: true },
    startedAt: { type: Date, required: true },
    finishedAt: { type: Date },
    /** PUBLISHED | RETRY | FAILED */
    outcome: { type: String },
    errorCode: { type: String },
    errorMessage: { type: String },
  },
  { _id: false },
);

const publishDestinationSchema = new mongoose.Schema(
  {
    workspace: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true },
    job: { type: mongoose.Schema.Types.ObjectId, ref: 'PublishJob', required: true },
    contentPackage: { type: mongoose.Schema.Types.ObjectId, ref: 'ContentPackage', required: true },
    socialAccount: { type: mongoose.Schema.Types.ObjectId, ref: 'SocialAccount', required: true },
    platform: { type: String, enum: Object.values(SOCIAL_PLATFORMS), required: true },
    /** Snapshots, so history stays readable after an account is renamed or removed. */
    accountName: { type: String, required: true },
    accountUsername: { type: String },
    state: { type: String, enum: Object.values(DESTINATION_STATES), required: true },
    /**
     * true while the destination is waiting or running; removed when it finishes. A partial
     * unique index on it makes "the same post to the same account twice at once" impossible.
     */
    active: { type: Boolean },
    simulated: { type: Boolean, default: false },
    /** Attempts started so far (automatic and manual). */
    attemptCount: { type: Number, default: 0 },
    /** Attempts allowed before the destination fails; raised by a manual retry. */
    maxAttempts: { type: Number, required: true },
    /** Increases with every enqueue, so each queue entry has its own id. */
    queueSeq: { type: Number, default: 0 },
    scheduledAt: { type: Date },
    nextAttemptAt: { type: Date },
    /** While waiting: the moment from which a worker may pick it up. */
    dueAt: { type: Date },
    /** When the current queue entry was added (the recovery sweep re-adds lost ones). */
    enqueuedAt: { type: Date },
    queuedAt: { type: Date },
    processingAt: { type: Date },
    completedAt: { type: Date },
    /** Claim of the worker that is processing this destination. */
    lockToken: { type: String },
    lockedUntil: { type: Date },
    /**
     * Set just before the post is handed to the platform, and cleared when the attempt ends.
     * A destination whose worker stopped without it was never sent and is queued again; one
     * with it may exist on the platform and is only retried by a person.
     */
    sendingAt: { type: Date },
    /**
     * The member whose permission this send relies on: the job's creator, or whoever retried
     * or rescheduled it since. Checked again just before sending (publishing.processor.js).
     */
    authorizedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    /** Post id returned by Meta. Always absent for simulated destinations. */
    externalPostId: { type: String },
    externalUrl: { type: String },
    /** Intermediate provider ids (e.g. an Instagram container), so a retry can resume. */
    providerState: { type: mongoose.Schema.Types.Mixed },
    error: { type: errorSchema, default: undefined },
    warnings: { type: [String], default: [] },
    attempts: { type: [attemptSchema], default: [] },
    cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

publishDestinationSchema.index(
  { job: 1, socialAccount: 1 },
  { unique: true, name: 'one_destination_per_account_per_job' },
);
// Duplicate prevention across jobs: one draft can be on its way to an account only once.
publishDestinationSchema.index(
  { contentPackage: 1, socialAccount: 1 },
  {
    unique: true,
    partialFilterExpression: { active: true },
    name: 'one_active_destination_per_post_and_account',
  },
);
publishDestinationSchema.index({ workspace: 1, state: 1 });
// Recovery sweeps: stale claims, and waiting destinations whose time has come.
publishDestinationSchema.index({ state: 1, lockedUntil: 1 });
publishDestinationSchema.index({ state: 1, dueAt: 1 });
publishDestinationSchema.index({ contentPackage: 1, socialAccount: 1, state: 1 });

jsonPlugin(publishDestinationSchema, { hidden: ['lockToken', 'lockedUntil', 'providerState'] });

export const PublishDestination =
  mongoose.models.PublishDestination ??
  mongoose.model('PublishDestination', publishDestinationSchema);
