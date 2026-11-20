import {
  ACCOUNT_ACCESS_MODES,
  ACTIVITY_ACTIONS,
  ROLES,
  canAssignRole,
  canManageMember,
  hasFullAccountAccess,
} from '@socialhub/shared';
import { runInTransaction } from '../../db/mongoose.js';
import { badRequest, conflict, forbidden, notFound, validationError } from '../../lib/errors.js';
import { Membership } from '../../models/index.js';
import { recordActivity } from '../activity/activity.service.js';
import {
  applyAccessChange,
  resolveWorkspaceAccountIds,
  workspaceAccountIds,
} from '../socialAccounts/socialAccount.service.js';
import { membershipView } from '../workspaces/workspace.service.js';

function memberView(m) {
  return {
    ...membershipView(m),
    user: m.user ? { id: String(m.user._id), name: m.user.name, email: m.user.email } : null,
    invitedBy: m.invitedBy ? { id: String(m.invitedBy._id), name: m.invitedBy.name } : null,
  };
}

export async function listMembers(workspaceId) {
  const members = await Membership.find({ workspace: workspaceId })
    .populate('user', 'name email')
    .populate('invitedBy', 'name')
    .sort({ joinedAt: 1 });
  return members.map(memberView);
}

async function loadManageableTarget(workspace, actorMembership, memberId) {
  const target = await Membership.findOne({ _id: memberId, workspace: workspace._id }).populate(
    'user',
    'name email',
  );
  if (!target) throw notFound('Member not found');
  if (String(target._id) === String(actorMembership._id)) {
    throw badRequest('You cannot change your own membership here');
  }
  if (!canManageMember(actorMembership.role, target.role)) {
    throw forbidden('You can only manage members with a lower role than yours');
  }
  return target;
}

export async function changeMemberRole(
  workspace,
  actorMembership,
  actor,
  memberId,
  { role },
  context,
) {
  const target = await loadManageableTarget(workspace, actorMembership, memberId);
  if (!canAssignRole(actorMembership.role, role)) {
    throw forbidden('You cannot assign this role');
  }
  const previousRole = target.role;
  if (previousRole === role) return memberView(target);

  await runInTransaction(async (session) => {
    // Conditional on the role we authorised against, to avoid acting on a stale read.
    const res = await Membership.updateOne(
      { _id: target._id, role: previousRole },
      { role },
      { session },
    );
    if (res.modifiedCount !== 1) {
      throw conflict('This member was changed by someone else; refresh and retry');
    }
    await recordActivity({
      workspace,
      actor,
      action: ACTIVITY_ACTIONS.MEMBER_ROLE_CHANGED,
      target: { type: 'member', id: target._id, label: target.user?.name },
      metadata: { from: previousRole, to: role },
      context,
      session,
    });
  });
  target.role = role;
  return memberView(target);
}

export async function updateAccountAccess(
  workspace,
  actorMembership,
  actor,
  memberId,
  { mode, socialAccountIds },
  context,
) {
  const target = await loadManageableTarget(workspace, actorMembership, memberId);
  if (hasFullAccountAccess(target.role)) {
    throw badRequest('Owners and admins always have access to every account');
  }

  let accounts = [];
  if (mode === ACCOUNT_ACCESS_MODES.SELECTED) {
    accounts = await resolveWorkspaceAccountIds(workspace._id, socialAccountIds);
    if (accounts === null) {
      throw validationError({
        fields: { socialAccountIds: 'One or more accounts do not belong to this workspace' },
      });
    }
  }

  await runInTransaction(async (session) => {
    await Membership.updateOne(
      { _id: target._id },
      { accountAccess: { mode, socialAccounts: accounts } },
      { session },
    );
    await recordActivity({
      workspace,
      actor,
      action: ACTIVITY_ACTIONS.MEMBER_ACCOUNT_ACCESS_UPDATED,
      target: { type: 'member', id: target._id, label: target.user?.name },
      metadata: { mode, accountCount: accounts.length },
      context,
      session,
    });
  });
  target.accountAccess = { mode, socialAccounts: accounts };
  return memberView(target);
}

/** Optimistic concurrency: the update only applies if nobody changed the member meanwhile. */
async function writeAccess(target, next, session) {
  const res = await Membership.updateOne(
    { _id: target._id, updatedAt: target.updatedAt },
    { accountAccess: { mode: next.mode, socialAccounts: next.socialAccounts } },
    { session },
  );
  if (res.modifiedCount !== 1) {
    throw conflict('This member’s access was changed by someone else; refresh and retry');
  }
}

/**
 * Incremental change to one member's account access (e.g. "grant these Pages" from a
 * bulk selection). Revoking from a member with access to ALL accounts converts them to
 * SELECTED with every other current account, so nothing else is silently revoked.
 */
export async function patchAccountAccess(
  workspace,
  actorMembership,
  actor,
  memberId,
  { add, remove },
  context,
) {
  const target = await loadManageableTarget(workspace, actorMembership, memberId);
  if (hasFullAccountAccess(target.role)) {
    throw badRequest('Owners and admins always have access to every account');
  }
  if ((await resolveWorkspaceAccountIds(workspace._id, [...add, ...remove])) === null) {
    throw validationError({
      fields: { accounts: 'One or more accounts do not belong to this workspace' },
    });
  }
  const next = applyAccessChange(
    target.accountAccess,
    { add, remove },
    await workspaceAccountIds(workspace._id),
  );
  if (next.changed) {
    await runInTransaction(async (session) => {
      await writeAccess(target, next, session);
      await recordActivity({
        workspace,
        actor,
        action: ACTIVITY_ACTIONS.MEMBER_ACCOUNT_ACCESS_UPDATED,
        target: { type: 'member', id: target._id, label: target.user?.name },
        metadata: {
          mode: next.mode,
          accountCount: next.socialAccounts.length,
          added: add.length,
          removed: remove.length,
        },
        context,
        session,
      });
    });
    target.accountAccess = { mode: next.mode, socialAccounts: next.socialAccounts };
  }
  return memberView(target);
}

/**
 * Grants or revokes ONE destination for several members (the destination's "Team access"
 * panel). Every target must be an editor/viewer the actor outranks; owners and admins always
 * have access and cannot be restricted.
 */
export async function updateAccountMembers(
  workspace,
  actorMembership,
  actor,
  account,
  { grant, revoke },
  context,
) {
  const ids = [...new Set([...grant, ...revoke].map(String))];
  const targets = await Membership.find({ _id: { $in: ids }, workspace: workspace._id }).populate(
    'user',
    'name email',
  );
  if (targets.length !== ids.length) throw notFound('Member not found');
  // Same order as PATCH /members/:id/account-access: yourself (400), then the role
  // hierarchy (403), then owners/admins, who always have every account (400).
  for (const target of targets) {
    if (String(target._id) === String(actorMembership._id)) {
      throw badRequest('You cannot change your own access here');
    }
    if (!canManageMember(actorMembership.role, target.role)) {
      throw forbidden('You can only manage members with a lower role than yours');
    }
    if (hasFullAccountAccess(target.role)) {
      throw badRequest(
        `${target.user?.name ?? 'This member'} is an owner or admin and always has access to every account`,
      );
    }
  }
  const allAccounts = await workspaceAccountIds(workspace._id);
  const granted = new Set(grant.map(String));
  await runInTransaction(async (session) => {
    for (const target of targets) {
      const isGrant = granted.has(String(target._id));
      const next = applyAccessChange(
        target.accountAccess,
        isGrant ? { add: [account._id] } : { remove: [account._id] },
        allAccounts,
      );
      if (!next.changed) continue;
      await writeAccess(target, next, session);
      await recordActivity({
        workspace,
        actor,
        action: ACTIVITY_ACTIONS.MEMBER_ACCOUNT_ACCESS_UPDATED,
        target: { type: 'member', id: target._id, label: target.user?.name },
        metadata: {
          mode: next.mode,
          accountCount: next.socialAccounts.length,
          change: isGrant ? 'grant' : 'revoke',
          account: account.name,
        },
        context,
        session,
      });
    }
  });
}

export async function removeMember(workspace, actorMembership, actor, memberId, context) {
  const target = await loadManageableTarget(workspace, actorMembership, memberId);
  await runInTransaction(async (session) => {
    await Membership.deleteOne({ _id: target._id }, { session });
    await recordActivity({
      workspace,
      actor,
      action: ACTIVITY_ACTIONS.MEMBER_REMOVED,
      target: { type: 'member', id: target._id, label: target.user?.name },
      metadata: { role: target.role, email: target.user?.email },
      context,
      session,
    });
  });
}

export async function leaveWorkspace(workspace, membership, actor, context) {
  if (membership.role === ROLES.OWNER) {
    throw badRequest('Transfer ownership to another member before leaving this workspace');
  }
  await runInTransaction(async (session) => {
    await Membership.deleteOne({ _id: membership._id }, { session });
    await recordActivity({
      workspace,
      actor,
      action: ACTIVITY_ACTIONS.MEMBER_LEFT,
      target: { type: 'member', id: membership._id, label: actor.name },
      metadata: { role: membership.role },
      context,
      session,
    });
  });
}
