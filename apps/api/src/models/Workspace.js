import mongoose from 'mongoose';
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
  },
  { timestamps: true },
);

workspaceSchema.index({ slug: 1 }, { unique: true });

jsonPlugin(workspaceSchema);

export const Workspace = mongoose.models.Workspace ?? mongoose.model('Workspace', workspaceSchema);
