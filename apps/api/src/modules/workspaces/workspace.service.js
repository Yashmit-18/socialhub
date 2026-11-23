import {
  ACTIVITY_ACTIONS,
  INVITATION_STATUS,
  PERMISSIONS,
  RESERVED_SLUGS,
  ROLES,
  SOCIAL_PLATFORMS,
  hasPermission,
  permissionsForRole,
} from '@socialhub/shared';
import { logger } from '../../config/logger.js';
import { isTransactionSupported, runInTransaction } from '../../db/mongoose.js';
import { randomToken } from '../../lib/crypto.js';
import {
  badRequest,
  conflict,
  isDuplicateKeyError,
  notFound,
  validationError,
} from '../../lib/errors.js';
import {
  AccountInsight,
  AccountLabel,
  AccountPreset,
  AccountStar,
  AnalyticsSyncRun,
  FacebookGroup,
  PostInsight,
  PublishDestination,
  PublishJob,
  GroupCategory,
  GroupShare,
  ActivityLog,
  ContentPackage,
  Invitation,
  MediaAsset,
  Membership,
  OAuthState,
  SharingTask,
  SocialAccount,
  SocialConnection,
  SyncRun,
  Workspace,
} from '../../models/index.js';
import { revokeAtMetaIfUnused } from '../meta/metaConnection.service.js';
import { listActivity, recordActivity } from '../activity/activity.service.js';
import { removeWorkspaceObjects } from '../media/media.service.js';
import { assertPassword } from '../auth/auth.service.js';
import { accessibleAccountFilter } from '../socialAccounts/socialAccount.service.js';

const SLUG_TAKEN = { fields: { slug: 'This URL is already taken' } };

export function slugify(name) {
  const base = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  if (base.length < 3 || RESERVED_SLUGS.includes(base)) return `${base || 'workspace'}-${suffix()}`;
  return base;
}

const suffix = () =>
  randomToken(4)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 4)
    .padEnd(4, '0');

export function membershipView(membership) {
  return {
    id: String(membership._id),
    role: membership.role,
    permissions: permissionsForRole(membership.role),
    accountAccess: {
      mode: membership.accountAccess?.mode,
      socialAccountIds: (membership.accountAccess?.socialAccounts ?? []).map(String),
    },
    joinedAt: membership.joinedAt,
  };
}

async function insertWorkspaceWithOwner({ user, name, slug, timezone, context }) {
  return runInTransaction(async (session) => {
    const workspace = await new Workspace({ name, slug, timezone, createdBy: user._id }).save({
      session,
    });
    let membership;
    try {
      membership = await new Membership({
        workspace: workspace._id,
        user: user._id,
        role: ROLES.OWNER,
      }).save({ session });
      await recordActivity({
        workspace,
        actor: user,
        action: ACTIVITY_ACTIONS.WORKSPACE_CREATED,
        target: { type: 'workspace', id: workspace._id, label: workspace.name },
        context,
        session,
      });
    } catch (err) {
      if (!session) {
        // Non-transactional fallback: undo the partial write.
        await Promise.all([
          Workspace.deleteOne({ _id: workspace._id }),
          Membership.deleteMany({ workspace: workspace._id }),
          ActivityLog.deleteMany({ workspace: workspace._id }),
        ]);
      }
      throw err;
    }
    return { workspace, membership };
  });
}

export async function createWorkspace(user, { name, slug, timezone = 'UTC' }, context) {
  const explicitSlug = Boolean(slug);
  let candidate = slug ?? slugify(name);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (!(await Workspace.exists({ slug: candidate }))) {
      try {
        const { workspace, membership } = await insertWorkspaceWithOwner({
          user,
          name,
          slug: candidate,
          timezone,
          context,
        });
        return { workspace: workspace.toJSON(), membership: membershipView(membership) };
      } catch (err) {
        if (!isDuplicateKeyError(err)) throw err;
        // Lost a race for the slug; fall through and try another.
      }
    }
    if (explicitSlug) throw conflict('This URL is already taken', SLUG_TAKEN);
    candidate = `${slugify(name).slice(0, 40)}-${suffix()}`;
  }
  throw conflict('Could not allocate a unique workspace URL; please choose one', SLUG_TAKEN);
}

export async function listWorkspacesForUser(userId) {
  const memberships = await Membership.find({ user: userId })
    .populate('workspace')
    .sort({ joinedAt: 1 });
  return memberships
    .filter((m) => m.workspace)
    .map((m) => ({
      ...m.workspace.toJSON(),
      membership: membershipView(m),
    }));
}

export async function updateWorkspace(workspace, actor, changes, context) {
  const before = {};
  const after = {};
  for (const [key, value] of Object.entries(changes)) {
    if (workspace[key] !== value) {
      before[key] = workspace[key];
      after[key] = value;
      workspace[key] = value;
    }
  }
  if (Object.keys(after).length === 0) return workspace.toJSON();

  if (after.slug && (await Workspace.exists({ slug: after.slug, _id: { $ne: workspace._id } }))) {
    throw conflict('This URL is already taken', SLUG_TAKEN);
  }

  try {
    await runInTransaction(async (session) => {
      await workspace.save({ session });
      await recordActivity({
        workspace,
        actor,
        action: ACTIVITY_ACTIONS.WORKSPACE_UPDATED,
        target: { type: 'workspace', id: workspace._id, label: workspace.name },
        metadata: { before, after },
        context,
        session,
      });
    });
  } catch (err) {
    if (isDuplicateKeyError(err)) throw conflict('This URL is already taken', SLUG_TAKEN);
    throw err;
  }
  return workspace.toJSON();
}

export async function transferOwnership(
  workspace,
  actorMembership,
  actor,
  { memberId, password },
  context,
) {
  await assertPassword(actor._id, password);

  const target = await Membership.findOne({ _id: memberId, workspace: workspace._id }).populate(
    'user',
    'name email',
  );
  if (!target) throw notFound('Member not found');
  if (String(target._id) === String(actorMembership._id)) {
    throw badRequest('You already own this workspace');
  }
  const previousRole = target.role;

  await runInTransaction(async (session) => {
    // Order matters: the partial unique index allows only one OWNER at any instant.
    const demoted = await Membership.updateOne(
      { _id: actorMembership._id, role: ROLES.OWNER },
      { role: ROLES.ADMIN },
      { session },
    );
    if (demoted.modifiedCount !== 1)
      throw conflict('Ownership changed concurrently; refresh and retry');
    try {
      await Membership.updateOne({ _id: target._id }, { role: ROLES.OWNER }, { session });
    } catch (err) {
      if (!session) await Membership.updateOne({ _id: actorMembership._id }, { role: ROLES.OWNER });
      throw err;
    }
    await recordActivity({
      workspace,
      actor,
      action: ACTIVITY_ACTIONS.WORKSPACE_OWNERSHIP_TRANSFERRED,
      target: { type: 'member', id: target._id, label: target.user?.name },
      metadata: { previousRoleOfNewOwner: previousRole, previousOwnerNewRole: ROLES.ADMIN },
      context,
      session,
    });
  });
}

/** Collections that hold workspace-scoped data and must be removed with the workspace. */
const WORKSPACE_SCOPED_MODELS = [
  Membership,
  Invitation,
  ActivityLog,
  SocialAccount,
  SocialConnection,
  OAuthState,
  SyncRun,
  ContentPackage,
  AccountPreset,
  MediaAsset,
  AccountLabel,
  AccountStar,
  FacebookGroup,
  GroupCategory,
  GroupShare,
  SharingTask,
  // Publishing records (Phase 5) and analytics (docs/ANALYTICS.md) belong to the workspace too.
  PublishJob,
  PublishDestination,
  AccountInsight,
  PostInsight,
  AnalyticsSyncRun,
];

export async function deleteWorkspace(workspace, actor, { confirmation, password }) {
  if (confirmation.trim() !== workspace.name) {
    throw validationError({
      fields: { confirmation: 'Type the workspace name exactly to confirm' },
    });
  }
  await assertPassword(actor._id, password);

  // Capture tokens before deletion so Meta authorizations no other workspace uses can be released.
  const connections = await SocialConnection.find({ workspace: workspace._id }).select(
    '+accessToken',
  );
  const tokens = connections.map((c) => (c.hasAccessToken() ? c.getAccessToken() : null));

  // Stored media files are removed while their records still say where they are.
  await removeWorkspaceObjects(workspace._id);

  await runInTransaction(async (session) => {
    // Remove the workspace document first so it is immediately inaccessible even if the
    // non-transactional fallback is interrupted while clearing child collections.
    await Workspace.deleteOne({ _id: workspace._id }, { session });
    for (const Model of WORKSPACE_SCOPED_MODELS) {
      await Model.deleteMany({ workspace: workspace._id }, { session });
    }
  });
  for (const [i, connection] of connections.entries()) {
    await revokeAtMetaIfUnused(connection, tokens[i]);
  }
  logger.info(
    {
      workspaceId: String(workspace._id),
      actorId: String(actor._id),
      transactional: isTransactionSupported(),
    },
    'Workspace deleted',
  );
}

export async function workspaceOverview(workspace, membership) {
  const role = membership.role;
  const accountFilter = accessibleAccountFilter(membership);

  const [members, pendingInvitations, connections, accountsByPlatform, recent] = await Promise.all([
    Membership.countDocuments({ workspace: workspace._id }),
    hasPermission(role, PERMISSIONS.MEMBERS_INVITE)
      ? Invitation.countDocuments({
          workspace: workspace._id,
          status: INVITATION_STATUS.PENDING,
          expiresAt: { $gt: new Date() },
        })
      : null,
    hasPermission(role, PERMISSIONS.SOCIAL_CONNECTIONS_MANAGE)
      ? SocialConnection.countDocuments({ workspace: workspace._id })
      : null,
    SocialAccount.aggregate([
      { $match: accountFilter },
      { $group: { _id: '$platform', count: { $sum: 1 } } },
    ]),
    hasPermission(role, PERMISSIONS.ACTIVITY_READ)
      ? listActivity(workspace._id, { limit: 6 })
      : null,
  ]);

  const countFor = (platform) => accountsByPlatform.find((r) => r._id === platform)?.count ?? 0;

  return {
    workspace: workspace.toJSON(),
    membership: membershipView(membership),
    stats: {
      members,
      pendingInvitations,
      socialConnections: connections,
      facebookPages: countFor(SOCIAL_PLATFORMS.FACEBOOK_PAGE),
      instagramAccounts: countFor(SOCIAL_PLATFORMS.INSTAGRAM_ACCOUNT),
    },
    recentActivity: recent?.items ?? null,
  };
}
