import mongoose from 'mongoose';
import { ASSIGNABLE_ROLES, INVITATION_STATUS } from '@socialhub/shared';
import { accountAccessSchema } from './Membership.js';
import { jsonPlugin } from './plugins.js';

const invitationSchema = new mongoose.Schema(
  {
    workspace: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true },
    email: { type: String, required: true, trim: true, lowercase: true },
    role: { type: String, enum: ASSIGNABLE_ROLES, required: true },
    /** SHA-256 of the link token; the raw token is only ever shown to the inviter once. */
    tokenHash: { type: String, required: true, select: false },
    status: {
      type: String,
      enum: Object.values(INVITATION_STATUS),
      default: INVITATION_STATUS.PENDING,
    },
    invitedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    expiresAt: { type: Date, required: true },
    lastSentAt: { type: Date, default: Date.now },
    sendCount: { type: Number, default: 1 },
    acceptedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    acceptedAt: { type: Date },
    revokedAt: { type: Date },
    /** Social account access to grant on acceptance (EDITOR/VIEWER invitations only). */
    accountAccess: { type: accountAccessSchema, default: undefined },
  },
  { timestamps: true },
);

invitationSchema.index({ tokenHash: 1 }, { unique: true });
// At most one open invitation per email per workspace.
invitationSchema.index(
  { workspace: 1, email: 1 },
  {
    unique: true,
    partialFilterExpression: { status: INVITATION_STATUS.PENDING },
    name: 'one_pending_invitation_per_email',
  },
);
invitationSchema.index({ workspace: 1, status: 1, createdAt: -1 });

invitationSchema.methods.isExpired = function isExpired(now = new Date()) {
  return this.expiresAt.getTime() <= now.getTime();
};

jsonPlugin(invitationSchema, { hidden: ['tokenHash'] });

export const Invitation =
  mongoose.models.Invitation ?? mongoose.model('Invitation', invitationSchema);
