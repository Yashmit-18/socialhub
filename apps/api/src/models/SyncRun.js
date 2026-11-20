import mongoose from 'mongoose';
import { CONNECTION_STATUS, SYNC_OUTCOMES, SYNC_TRIGGERS } from '@socialhub/shared';
import { jsonPlugin } from './plugins.js';

/**
 * One synchronization attempt of a SocialConnection that actually reached Meta: when it ran,
 * what started it, how it ended and what changed. Operational history (kept 90 days), separate
 * from the audit trail in ActivityLog. Never contains tokens; error messages come from Meta.
 */
const syncRunSchema = new mongoose.Schema(
  {
    workspace: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true },
    connection: { type: mongoose.Schema.Types.ObjectId, ref: 'SocialConnection', required: true },
    trigger: { type: String, enum: Object.values(SYNC_TRIGGERS), required: true },
    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    actorName: { type: String },
    startedAt: { type: Date, required: true },
    finishedAt: { type: Date, required: true },
    durationMs: { type: Number, required: true },
    outcome: { type: String, enum: Object.values(SYNC_OUTCOMES), required: true },
    statusBefore: { type: String, enum: Object.values(CONNECTION_STATUS) },
    statusAfter: { type: String, enum: Object.values(CONNECTION_STATUS) },
    accounts: {
      type: new mongoose.Schema(
        { refreshed: { type: Number, default: 0 }, lost: { type: Number, default: 0 } },
        { _id: false },
      ),
      default: () => ({}),
    },
    error: {
      type: new mongoose.Schema(
        { kind: String, code: Number, subcode: Number, message: String, fbtraceId: String },
        { _id: false },
      ),
      default: undefined,
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

syncRunSchema.index({ connection: 1, _id: -1 });
syncRunSchema.index({ workspace: 1, _id: -1 });
export const SYNC_HISTORY_RETENTION_SECONDS = 90 * 86_400;
syncRunSchema.index({ createdAt: 1 }, { expireAfterSeconds: SYNC_HISTORY_RETENTION_SECONDS });

jsonPlugin(syncRunSchema);

export const SyncRun = mongoose.models.SyncRun ?? mongoose.model('SyncRun', syncRunSchema);
