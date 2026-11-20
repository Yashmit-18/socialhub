import {
  ACCOUNT_ACCESS_MODES,
  ACTIVITY_ACTIONS,
  INVITATION_STATUS,
  ROLE_LABELS,
  canAssignRole,
  hasFullAccountAccess,
} from '@socialhub/shared';
import { config } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { runInTransaction } from '../../db/mongoose.js';
import { randomToken, sha256 } from '../../lib/crypto.js';
import {
  conflict,
  forbidden,
  isDuplicateKeyError,
  notFound,
  validationError,
} from '../../lib/errors.js';
import { sendInvitationEmail } from '../../lib/mailer.js';
import { Invitation, Membership, SocialAccount, User, Workspace } from '../../models/index.js';
import { recordActivity } from '../activity/activity.service.js';
import { resolveWorkspaceAccountIds } from '../socialAccounts/socialAccount.service.js';
import { membershipView } from '../workspaces/workspace.service.js';

const DAY_MS = 86_400_000;

const inviteUrlFor = (token) => `${config.appUrl}/invite/${encodeURIComponent(token)}`;

function invitationView(inv) {
  const expired = inv.status === INVITATION_STATUS.PENDING && inv.isExpired();
  return {
    id: String(inv._id),
    email: inv.email,
    role: inv.role,
    status: expired ? INVITATION_STATUS.EXPIRED : inv.status,
    invitedBy: inv.invitedBy?.name
      ? { id: String(inv.invitedBy._id), name: inv.invitedBy.name }
      : null,
    expiresAt: inv.expiresAt,
    lastSentAt: inv.lastSentAt,
    sendCount: inv.sendCount,
    accountAccess: inv.accountAccess?.mode
      ? {
          mode: inv.accountAccess.mode,
          socialAccountIds: (inv.accountAccess.socialAccounts ?? []).map(String),
        }
      : null,
    createdAt: inv.createdAt,
  };
}

/**
 * Account access an invitation grants. Owners/admins always see everything, so nothing is
 * stored for ADMIN invitations; SELECTED lists must only reference this workspace's accounts.
 */
async function invitationAccountAccess(workspace, role, accountAccess) {
  if (!accountAccess || hasFullAccountAccess(role)) return undefined;
  if (accountAccess.mode === ACCOUNT_ACCESS_MODES.ALL) {
    return { mode: ACCOUNT_ACCESS_MODES.ALL, socialAccounts: [] };
  }
  const ids = await resolveWorkspaceAccountIds(workspace._id, accountAccess.socialAccountIds ?? []);
  if (ids === null) {
    throw validationError({
      fields: { accountAccess: 'One or more accounts do not belong to this workspace' },
    });
  }
  return { mode: ACCOUNT_ACCESS_MODES.SELECTED, socialAccounts: ids };
}

async function deliver(invitation, { workspace, inviter, token }) {
  const url = inviteUrlFor(token);
  try {
    const { delivered } = await sendInvitationEmail({
      to: invitation.email,
      workspaceName: workspace.name,
      inviterName: inviter.name,
      roleLabel: ROLE_LABELS[invitation.role],
      url,
      expiresAt: invitation.expiresAt,
    });
    return { inviteUrl: url, emailDelivered: delivered };
  } catch (err) {
    logger.error({ err, invitationId: String(invitation._id) }, 'Failed to send invitation email');
    return { inviteUrl: url, emailDelivered: false };
  }
}

export async function listInvitations(workspaceId) {
  const invitations = await Invitation.find({
    workspace: workspaceId,
    status: INVITATION_STATUS.PENDING,
  })
    .populate('invitedBy', 'name')
    .sort({ createdAt: -1 });
  return invitations.map(invitationView);
}

export async function createInvitation(
  workspace,
  actorMembership,
  actor,
  { email, role, accountAccess },
  context,
) {
  if (!canAssignRole(actorMembership.role, role)) {
    throw forbidden('You cannot invite members with this role');
  }
  const grantedAccess = await invitationAccountAccess(workspace, role, accountAccess);

  const existingUser = await User.findOne({ email }).select('_id');
  if (
    existingUser &&
    (await Membership.exists({ workspace: workspace._id, user: existingUser._id }))
  ) {
    throw conflict('This person is already a member of the workspace', {
      fields: { email: 'This person is already a member' },
    });
  }

  const pending = await Invitation.findOne({
    workspace: workspace._id,
    email,
    status: INVITATION_STATUS.PENDING,
  });
  if (pending) {
    if (!pending.isExpired()) {
      throw conflict('An invitation is already pending for this email', {
        fields: { email: 'An invitation is already pending — resend it instead' },
      });
    }
    pending.status = INVITATION_STATUS.EXPIRED;
    await pending.save();
  }

  const token = randomToken(32);
  let invitation;
  try {
    invitation = await runInTransaction(async (session) => {
      const inv = await new Invitation({
        workspace: workspace._id,
        email,
        role,
        tokenHash: sha256(token),
        invitedBy: actor._id,
        expiresAt: new Date(Date.now() + config.invitationTtlDays * DAY_MS),
        accountAccess: grantedAccess,
      }).save({ session });
      await recordActivity({
        workspace,
        actor,
        action: ACTIVITY_ACTIONS.INVITATION_CREATED,
        target: { type: 'invitation', id: inv._id, label: email },
        metadata: {
          role,
          ...(grantedAccess && {
            accountAccess: grantedAccess.mode,
            accountCount: grantedAccess.socialAccounts.length,
          }),
        },
        context,
        session,
      });
      return inv;
    });
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      throw conflict('An invitation is already pending for this email', {
        fields: { email: 'An invitation is already pending — resend it instead' },
      });
    }
    throw err;
  }

  invitation.invitedBy = actor;
  const delivery = await deliver(invitation, { workspace, inviter: actor, token });
  return { invitation: invitationView(invitation), ...delivery };
}

async function loadPendingForActor(workspace, actorMembership, invitationId) {
  const invitation = await Invitation.findOne({
    _id: invitationId,
    workspace: workspace._id,
    status: INVITATION_STATUS.PENDING,
  }).populate('invitedBy', 'name');
  if (!invitation) throw notFound('Invitation not found');
  if (!canAssignRole(actorMembership.role, invitation.role)) {
    throw forbidden('You cannot manage invitations for this role');
  }
  return invitation;
}

/** Issues a fresh link (the old one stops working) and extends the expiry. */
export async function resendInvitation(workspace, actorMembership, actor, invitationId, context) {
  const invitation = await loadPendingForActor(workspace, actorMembership, invitationId);
  const token = randomToken(32);

  await runInTransaction(async (session) => {
    invitation.tokenHash = sha256(token);
    invitation.expiresAt = new Date(Date.now() + config.invitationTtlDays * DAY_MS);
    invitation.lastSentAt = new Date();
    invitation.sendCount += 1;
    await invitation.save({ session });
    await recordActivity({
      workspace,
      actor,
      action: ACTIVITY_ACTIONS.INVITATION_RESENT,
      target: { type: 'invitation', id: invitation._id, label: invitation.email },
      metadata: { role: invitation.role, sendCount: invitation.sendCount },
      context,
      session,
    });
  });

  const delivery = await deliver(invitation, { workspace, inviter: actor, token });
  return { invitation: invitationView(invitation), ...delivery };
}

export async function revokeInvitation(workspace, actorMembership, actor, invitationId, context) {
  const invitation = await loadPendingForActor(workspace, actorMembership, invitationId);
  await runInTransaction(async (session) => {
    invitation.status = INVITATION_STATUS.REVOKED;
    invitation.revokedAt = new Date();
    await invitation.save({ session });
    await recordActivity({
      workspace,
      actor,
      action: ACTIVITY_ACTIONS.INVITATION_REVOKED,
      target: { type: 'invitation', id: invitation._id, label: invitation.email },
      metadata: { role: invitation.role },
      context,
      session,
    });
  });
}

async function findByToken(token) {
  return Invitation.findOne({ tokenHash: sha256(token) })
    .populate('workspace', 'name slug')
    .populate('invitedBy', 'name');
}

/** Public preview shown on the invitation landing page. */
export async function previewInvitation(token) {
  const invitation = await findByToken(token);
  if (!invitation || !invitation.workspace) throw notFound('This invitation link is invalid');
  return {
    ...invitationView(invitation),
    workspace: { name: invitation.workspace.name },
  };
}

/** The invitation's account grant, keeping only accounts that still exist in the workspace. */
async function acceptedAccountAccess(workspace, invitation) {
  const access = invitation.accountAccess;
  if (!access?.mode || hasFullAccountAccess(invitation.role)) return {};
  if (access.mode === ACCOUNT_ACCESS_MODES.ALL) {
    return { accountAccess: { mode: ACCOUNT_ACCESS_MODES.ALL, socialAccounts: [] } };
  }
  const existing = await SocialAccount.find({
    workspace: workspace._id,
    _id: { $in: access.socialAccounts ?? [] },
  }).distinct('_id');
  return { accountAccess: { mode: ACCOUNT_ACCESS_MODES.SELECTED, socialAccounts: existing } };
}

export async function acceptInvitation(token, user, context) {
  const invitation = await findByToken(token);
  if (!invitation || !invitation.workspace) throw notFound('This invitation link is invalid');
  if (invitation.status !== INVITATION_STATUS.PENDING) {
    throw conflict(`This invitation is no longer valid (${invitation.status.toLowerCase()})`);
  }
  if (invitation.isExpired()) throw conflict('This invitation has expired. Ask for a new one.');
  if (invitation.email !== user.email) {
    throw forbidden(
      `This invitation was sent to ${invitation.email}. Sign in with that email to accept it.`,
    );
  }

  const workspace = await Workspace.findById(invitation.workspace._id);
  if (!workspace) throw notFound('This invitation link is invalid');

  const membership = await runInTransaction(async (session) => {
    // Atomic PENDING -> ACCEPTED flip makes acceptance single-use under concurrency.
    const claimed = await Invitation.findOneAndUpdate(
      { _id: invitation._id, status: INVITATION_STATUS.PENDING },
      { status: INVITATION_STATUS.ACCEPTED, acceptedBy: user._id, acceptedAt: new Date() },
      { session, returnDocument: 'after' },
    );
    if (!claimed) throw conflict('This invitation has already been used');

    let member = await Membership.findOne({ workspace: workspace._id, user: user._id }).session(
      session,
    );
    if (member) return member; // Already joined by another path: accepting is idempotent.

    try {
      member = await new Membership({
        workspace: workspace._id,
        user: user._id,
        role: invitation.role,
        invitedBy: invitation.invitedBy?._id,
        ...(await acceptedAccountAccess(workspace, invitation)),
      }).save({ session });
    } catch (err) {
      if (!session) {
        await Invitation.updateOne(
          { _id: invitation._id },
          { status: INVITATION_STATUS.PENDING, $unset: { acceptedBy: 1, acceptedAt: 1 } },
        );
      }
      throw err;
    }
    await recordActivity({
      workspace,
      actor: user,
      action: ACTIVITY_ACTIONS.INVITATION_ACCEPTED,
      target: { type: 'member', id: member._id, label: user.name },
      metadata: { role: invitation.role, invitedBy: invitation.invitedBy?.name },
      context,
      session,
    });
    return member;
  });

  return { workspace: workspace.toJSON(), membership: membershipView(membership) };
}
