import mongoose from 'mongoose';
import { PLATFORM_AUDIT_ACTIONS } from '@socialhub/shared';
import { jsonPlugin } from './plugins.js';

/**
 * Append-only record of what platform admins did (docs/ADMIN_PANEL.md). It belongs to no
 * workspace and is not removed when one is deleted. `ip` and `userAgent` are kept for security
 * investigations; they are not selected by default and no endpoint returns them.
 */
const platformAuditLogSchema = new mongoose.Schema(
  {
    /** The platform admin who acted. Absent for the command line. */
    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    /** Snapshot of the actor's name; "Command line" for scripts/platform-admin.js. */
    actorName: { type: String, required: true },
    action: { type: String, enum: Object.values(PLATFORM_AUDIT_ACTIONS), required: true },
    target: {
      type: new mongoose.Schema(
        {
          type: { type: String, required: true },
          id: { type: mongoose.Schema.Types.ObjectId },
          label: { type: String },
        },
        { _id: false },
      ),
      required: true,
    },
    metadata: { type: mongoose.Schema.Types.Mixed, default: undefined },
    ip: { type: String, maxlength: 64, select: false },
    userAgent: { type: String, maxlength: 512, select: false },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

// The default _id index serves the newest-first feed.
platformAuditLogSchema.index({ 'target.id': 1, _id: -1 });
platformAuditLogSchema.index({ action: 1, _id: -1 });

jsonPlugin(platformAuditLogSchema, { hidden: ['ip', 'userAgent'] });

export const PlatformAuditLog =
  mongoose.models.PlatformAuditLog ?? mongoose.model('PlatformAuditLog', platformAuditLogSchema);
