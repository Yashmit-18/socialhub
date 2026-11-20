import mongoose from 'mongoose';
import { jsonPlugin } from './plugins.js';

/** Append-only audit trail of actions taken inside a workspace. */
const activityLogSchema = new mongoose.Schema(
  {
    workspace: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true },
    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    /** Snapshot so the log stays readable after the actor leaves or is deleted. */
    actorName: { type: String },
    action: { type: String, required: true },
    target: {
      type: new mongoose.Schema(
        {
          type: { type: String, required: true },
          id: { type: mongoose.Schema.Types.ObjectId },
          label: { type: String },
        },
        { _id: false },
      ),
      default: undefined,
    },
    metadata: { type: mongoose.Schema.Types.Mixed, default: undefined },
    ip: { type: String, maxlength: 64 },
    userAgent: { type: String, maxlength: 512 },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

activityLogSchema.index({ workspace: 1, _id: -1 });
// History of one connection / destination on its detail page.
activityLogSchema.index({ workspace: 1, 'target.id': 1, _id: -1 });

jsonPlugin(activityLogSchema);

export const ActivityLog =
  mongoose.models.ActivityLog ?? mongoose.model('ActivityLog', activityLogSchema);
