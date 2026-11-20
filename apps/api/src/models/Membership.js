import mongoose from 'mongoose';
import { ACCOUNT_ACCESS_MODES, ROLES, ROLE_LIST } from '@socialhub/shared';
import { jsonPlugin } from './plugins.js';

/**
 * ALL: every current and future account in the workspace. SELECTED: only `socialAccounts`.
 * New memberships start least-privilege (SELECTED, none): editors and viewers see only the
 * accounts an admin assigns them, or that their invitation granted. OWNER/ADMIN ignore it.
 */
export const accountAccessSchema = new mongoose.Schema(
  {
    mode: {
      type: String,
      enum: Object.values(ACCOUNT_ACCESS_MODES),
      default: ACCOUNT_ACCESS_MODES.SELECTED,
    },
    socialAccounts: [{ type: mongoose.Schema.Types.ObjectId, ref: 'SocialAccount' }],
  },
  { _id: false },
);

const membershipSchema = new mongoose.Schema(
  {
    workspace: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, enum: ROLE_LIST, required: true },
    /** Per-member destination scoping. Ignored for OWNER/ADMIN, who always see everything. */
    accountAccess: { type: accountAccessSchema, default: () => ({}) },
    invitedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    joinedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

membershipSchema.index({ workspace: 1, user: 1 }, { unique: true });
membershipSchema.index({ user: 1 });
// Database-level guarantee: at most one OWNER per workspace.
membershipSchema.index(
  { workspace: 1 },
  { unique: true, partialFilterExpression: { role: ROLES.OWNER }, name: 'one_owner_per_workspace' },
);

jsonPlugin(membershipSchema);

export const Membership =
  mongoose.models.Membership ?? mongoose.model('Membership', membershipSchema);
