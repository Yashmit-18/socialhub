import mongoose from 'mongoose';
import { ANALYTICS_SOURCES, ANALYTICS_SYNC_STATUS, SOCIAL_PLATFORMS } from '@socialhub/shared';
import { jsonPlugin } from './plugins.js';

/**
 * One insights synchronization of one account (a Page or an Instagram account), from one
 * source, over a range of days. MongoDB is the source of truth; the queue entry only carries
 * this document's id. No token is ever stored here.
 */
const syncErrorSchema = new mongoose.Schema(
  {
    code: { type: String, required: true },
    /** Safe to show: never contains tokens or raw provider responses. */
    message: { type: String, required: true },
    retryable: { type: Boolean, default: false },
    at: { type: Date, required: true },
  },
  { _id: false },
);

const analyticsSyncRunSchema = new mongoose.Schema(
  {
    workspace: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true },
    socialAccount: { type: mongoose.Schema.Types.ObjectId, ref: 'SocialAccount', required: true },
    platform: { type: String, enum: Object.values(SOCIAL_PLATFORMS), required: true },
    accountName: { type: String, required: true },
    source: { type: String, enum: Object.values(ANALYTICS_SOURCES), required: true },
    status: { type: String, enum: Object.values(ANALYTICS_SYNC_STATUS), required: true },
    /**
     * true while queued, running or waiting for a retry; removed when finished. A partial
     * unique index on it allows one active sync per account and source.
     */
    active: { type: Boolean },
    /** Days read (YYYY-MM-DD, inclusive). */
    since: { type: String, required: true },
    until: { type: String, required: true },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    attemptCount: { type: Number, default: 0 },
    maxAttempts: { type: Number, required: true },
    queueSeq: { type: Number, default: 0 },
    dueAt: { type: Date },
    enqueuedAt: { type: Date },
    lockToken: { type: String },
    lockedUntil: { type: Date },
    startedAt: { type: Date },
    finishedAt: { type: Date },
    result: {
      days: { type: Number },
      posts: { type: Number },
      /** Metrics the platform did not report for this account (shown as unavailable). */
      unavailable: { type: [String], default: undefined },
    },
    error: { type: syncErrorSchema, default: undefined },
  },
  { timestamps: true },
);

analyticsSyncRunSchema.index(
  { socialAccount: 1, source: 1 },
  {
    unique: true,
    partialFilterExpression: { active: true },
    name: 'one_active_sync_per_account_and_source',
  },
);
analyticsSyncRunSchema.index({ workspace: 1, socialAccount: 1, createdAt: -1 });
// The latest successful run of an account, which sets where the next sync starts.
analyticsSyncRunSchema.index({ socialAccount: 1, source: 1, status: 1, finishedAt: -1 });
// Recovery sweep: stale claims, and waiting runs whose time has come.
analyticsSyncRunSchema.index({ status: 1, lockedUntil: 1 });
analyticsSyncRunSchema.index({ status: 1, dueAt: 1 });

jsonPlugin(analyticsSyncRunSchema, { hidden: ['lockToken', 'lockedUntil'] });

export const AnalyticsSyncRun =
  mongoose.models.AnalyticsSyncRun ?? mongoose.model('AnalyticsSyncRun', analyticsSyncRunSchema);
