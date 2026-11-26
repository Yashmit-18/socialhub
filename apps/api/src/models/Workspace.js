import mongoose from 'mongoose';
import { WORKSPACE_PUBLISHING_MODES } from '@socialhub/shared';
import { jsonPlugin } from './plugins.js';

/**
 * The tenant boundary. Every workspace-scoped collection (memberships, invitations,
 * activity, social connections/accounts and — in later phases — content packages, posts,
 * publishing jobs and group-sharing data) carries a `workspace` reference.
 * Ownership lives on Membership (role OWNER), not here, so there is one source of truth.
 */
const workspaceSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 60 },
    slug: { type: String, required: true, trim: true, lowercase: true, maxlength: 48 },
    timezone: { type: String, required: true, default: 'UTC' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    /**
     * This workspace's publishing choice. SIMULATED (the default, also for workspaces created
     * before this field existed) or LIVE, set only by an owner or admin with their password, and
     * effective only while the server allows real publishing (PUBLISHING_MODE=live).
     */
    publishingMode: {
      type: String,
      enum: Object.values(WORKSPACE_PUBLISHING_MODES),
      default: WORKSPACE_PUBLISHING_MODES.SIMULATED,
    },
    publishingModeChangedAt: { type: Date },
    publishingModeChangedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

workspaceSchema.index({ slug: 1 }, { unique: true });
// Operator console: workspaces by publishing mode, newest first.
workspaceSchema.index({ publishingMode: 1, _id: -1 });

jsonPlugin(workspaceSchema);

export const Workspace = mongoose.models.Workspace ?? mongoose.model('Workspace', workspaceSchema);
