import mongoose from 'mongoose';
import {
  ACTIVE_JOB_STATUSES,
  ADMIN_CONFLICT_REASONS,
  ADMIN_LIMITS,
  CONNECTION_STATUS,
  INVITATION_STATUS,
  MEDIA_STATUS,
  PLATFORM_ROLES,
  PUBLISHING_MODES,
  PUBLISH_JOB_STATUS,
  ROLES,
  ROLE_RANK,
  SHARING_TASK_STATUS,
  SOCIAL_PLATFORMS,
  USER_STATUS,
  WORKSPACE_PUBLISHING_MODES,
} from '@socialhub/shared';
import { notFound } from '../../lib/errors.js';
import {
  ActivityLog,
  ContentPackage,
  FacebookGroup,
  Invitation,
  MediaAsset,
  Membership,
  PublishJob,
  SharingTask,
  SocialAccount,
  SocialConnection,
  User,
  Workspace,
} from '../../models/index.js';
import {
  adminMemberView,
  adminMembershipView,
  adminUserListView,
  adminWorkspaceListView,
  adminWorkspaceView,
} from './admin.views.js';
import { loadUserView, suspendConflict, suspensionImpact } from './suspension.service.js';
import { attentionItems, systemStatus } from './systemStatus.js';

/**
 * Read side of the operator console (docs/ADMIN_PANEL.md): platform numbers, people and
 * workspaces. Account details, names, counts and states only: never workspace content, never
 * the names or pictures of connected Pages and Instagram accounts, never a token, IP address
 * or browser. Every find ends in a select of the fields its view names; every aggregation ends
 * in $group, $count or an allow-list $project, so no raw document leaves a pipeline.
 */

const DAY_MS = 86_400_000;
const J = PUBLISH_JOB_STATUS;
const FINISHED = [J.PUBLISHED, J.PARTIALLY_PUBLISHED, J.FAILED];
const PUBLISHED = new Set([J.PUBLISHED, J.PARTIALLY_PUBLISHED]);
const MAX_ROWS = ADMIN_LIMITS.DETAIL_ROWS_MAX;

const idAt = (date) => mongoose.Types.ObjectId.createFromTime(Math.floor(date.getTime() / 1000));
const utcDay = (date) => date.toISOString().slice(0, 10);
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const asObjectId = (text) =>
  /^[a-f\d]{24}$/i.test(text) ? new mongoose.Types.ObjectId(text) : null;
const objectId = (value) => new mongoose.Types.ObjectId(value);
const key = (value) => String(value);

/** "Contains" on the given fields, matched literally and without case; an id matches itself. */
function searchFilter(q, fields) {
  const rx = new RegExp(escapeRegex(q), 'i');
  const id = asObjectId(q);
  return [...fields.map((field) => ({ [field]: rx })), ...(id ? [{ _id: id }] : [])];
}

const paged = ({ page, limit }) => ({ skip: (page - 1) * limit, limit });
const pageInfo = ({ page, limit }, total) => ({
  total,
  page,
  limit,
  pages: Math.max(1, Math.ceil(total / limit)),
});

/** `{ facebookPages, instagramAccounts }` from rows grouped by platform. */
function accountCounts(rows) {
  const n = (platform) => rows.find((row) => row.platform === platform)?.n ?? 0;
  return {
    facebookPages: n(SOCIAL_PLATFORMS.FACEBOOK_PAGE),
    instagramAccounts: n(SOCIAL_PLATFORMS.INSTAGRAM_ACCOUNT),
  };
}

/** Every key of `values` present, with the count of the matching group or 0. */
const countsByKey = (values, rows) =>
  Object.fromEntries(values.map((value) => [value, rows.find((row) => row._id === value)?.n ?? 0]));

/** Creations per UTC day, read from the time inside the id (nothing else is read). */
const createdPerDay = (Model, start) =>
  Model.aggregate([
    { $match: { _id: { $gte: idAt(start) } } },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: { $toDate: '$_id' } } },
        n: { $sum: 1 },
      },
    },
  ]);

/** GET /admin/overview. Every number is a MongoDB count; a day without activity is zeros. */
export async function getOverview({ now = new Date() } = {}) {
  const since7 = new Date(now.getTime() - 7 * DAY_MS);
  const since30 = new Date(now.getTime() - 30 * DAY_MS);
  const dayAgo = new Date(now.getTime() - DAY_MS);
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const start = new Date(today - (ADMIN_LIMITS.ACTIVITY_DAYS - 1) * DAY_MS);

  const [
    usersTotal,
    suspended,
    platformAdmins,
    usersNew7,
    usersNew30,
    signupRows,
    workspacesTotal,
    livePublishing,
    workspacesNew7,
    workspacesNew30,
    workspaceRows,
    accountRows,
    postsInProgress,
    postRows,
    failedLast24h,
    system,
  ] = await Promise.all([
    User.countDocuments({}),
    User.countDocuments({ status: USER_STATUS.DISABLED }),
    User.countDocuments({ platformRole: PLATFORM_ROLES.PLATFORM_ADMIN }),
    User.countDocuments({ _id: { $gte: idAt(since7) } }),
    User.countDocuments({ _id: { $gte: idAt(since30) } }),
    createdPerDay(User, start),
    Workspace.countDocuments({}),
    Workspace.countDocuments({ publishingMode: WORKSPACE_PUBLISHING_MODES.LIVE }),
    Workspace.countDocuments({ _id: { $gte: idAt(since7) } }),
    Workspace.countDocuments({ _id: { $gte: idAt(since30) } }),
    createdPerDay(Workspace, start),
    SocialAccount.aggregate([
      { $group: { _id: '$platform', n: { $sum: 1 } } },
      { $project: { _id: 0, platform: '$_id', n: 1 } },
    ]),
    PublishJob.countDocuments({ status: { $in: [...ACTIVE_JOB_STATUSES] } }),
    // updatedAt is never earlier than completedAt, so its bound (the index) loses nothing.
    PublishJob.aggregate([
      {
        $match: {
          status: { $in: FINISHED },
          updatedAt: { $gte: start },
          completedAt: { $gte: start },
        },
      },
      {
        $group: {
          _id: {
            day: { $dateToString: { format: '%Y-%m-%d', date: '$completedAt' } },
            status: '$status',
            mode: '$mode',
          },
          n: { $sum: 1 },
        },
      },
    ]),
    PublishJob.countDocuments({
      status: J.FAILED,
      updatedAt: { $gte: dayAgo },
      completedAt: { $gte: dayAgo },
    }),
    systemStatus({ now }),
  ]);

  const days = Array.from({ length: ADMIN_LIMITS.ACTIVITY_DAYS }, (_, i) => ({
    day: utcDay(new Date(start.getTime() + i * DAY_MS)),
    signups: 0,
    workspaces: 0,
    realPosts: 0,
    simulatedPosts: 0,
    failedPosts: 0,
  }));
  const byDay = new Map(days.map((day) => [day.day, day]));
  for (const row of signupRows) if (byDay.has(row._id)) byDay.get(row._id).signups = row.n;
  for (const row of workspaceRows) if (byDay.has(row._id)) byDay.get(row._id).workspaces = row.n;
  for (const { _id, n } of postRows) {
    const day = byDay.get(_id.day);
    if (!day) continue;
    if (_id.status === J.FAILED) day.failedPosts += n;
    else if (PUBLISHED.has(_id.status) && _id.mode === PUBLISHING_MODES.LIVE) day.realPosts += n;
    else if (PUBLISHED.has(_id.status) && _id.mode === PUBLISHING_MODES.SIMULATED) {
      day.simulatedPosts += n;
    }
  }
  const lastWeek = days.slice(-7);
  const sum = (field) => lastWeek.reduce((total, day) => total + day[field], 0);

  return {
    generatedAt: now,
    users: {
      total: usersTotal,
      active: usersTotal - suspended,
      suspended,
      platformAdmins,
      newLast7Days: usersNew7,
      newLast30Days: usersNew30,
    },
    workspaces: {
      total: workspacesTotal,
      livePublishing,
      newLast7Days: workspacesNew7,
      newLast30Days: workspacesNew30,
    },
    accounts: accountCounts(accountRows),
    publishing: {
      postsInProgress,
      last7Days: {
        realPosts: sum('realPosts'),
        simulatedPosts: sum('simulatedPosts'),
        failedPosts: sum('failedPosts'),
      },
    },
    activity: { timezone: 'UTC', days },
    attention: attentionItems(system, { suspended, failedLast24h }),
  };
}

/** GET /admin/users: search, status filter, creation order, numbered pages. */
export async function listUsers(query) {
  const filter = {};
  if (query.status === USER_STATUS.DISABLED) filter.status = USER_STATUS.DISABLED;
  // A document without a stored status is active, as Mongoose hydrates it.
  else if (query.status === USER_STATUS.ACTIVE) filter.status = { $ne: USER_STATUS.DISABLED };
  if (query.q) filter.$or = searchFilter(query.q, ['name', 'email']);

  const { skip, limit } = paged(query);
  const [users, total, all, disabled] = await Promise.all([
    User.find(filter)
      .sort({ _id: query.sort === 'createdAt' ? 1 : -1 })
      .skip(skip)
      .limit(limit)
      .select('name email status platformRole createdAt lastLoginAt +suspension')
      .lean(),
    User.countDocuments(filter),
    User.countDocuments({}),
    User.countDocuments({ status: USER_STATUS.DISABLED }),
  ]);
  const memberships = users.length
    ? await Membership.aggregate([
        { $match: { user: { $in: users.map((u) => u._id) } } },
        { $group: { _id: '$user', n: { $sum: 1 } } },
      ])
    : [];
  const workspaceCount = new Map(memberships.map((row) => [key(row._id), row.n]));

  return {
    items: users.map((user) =>
      adminUserListView(user, { workspaceCount: workspaceCount.get(key(user._id)) ?? 0 }),
    ),
    ...pageInfo(query, total),
    facets: {
      status: { [USER_STATUS.ACTIVE]: all - disabled, [USER_STATUS.DISABLED]: disabled },
    },
  };
}

/** Rows of `memberships` with their workspace and its member and admin counts. */
async function membershipRows(memberships) {
  const workspaceIds = memberships.map((m) => m.workspace);
  if (!workspaceIds.length) return [];
  const [workspaces, roleCounts] = await Promise.all([
    Workspace.find({ _id: { $in: workspaceIds } })
      .select('name slug')
      .lean(),
    Membership.aggregate([
      { $match: { workspace: { $in: workspaceIds } } },
      {
        $group: {
          _id: { workspace: '$workspace', role: '$role' },
          n: { $sum: 1 },
        },
      },
    ]),
  ]);
  const byId = new Map(workspaces.map((w) => [key(w._id), w]));
  const counts = new Map();
  for (const { _id, n } of roleCounts) {
    const entry = counts.get(key(_id.workspace)) ?? { memberCount: 0, adminCount: 0 };
    entry.memberCount += n;
    if (_id.role === ROLES.ADMIN) entry.adminCount += n;
    counts.set(key(_id.workspace), entry);
  }
  // A membership whose workspace no longer exists is skipped.
  return memberships
    .filter((m) => byId.has(key(m.workspace)))
    .map((m) =>
      adminMembershipView(
        m,
        byId.get(key(m.workspace)),
        counts.get(key(m.workspace)) ?? { memberCount: 0, adminCount: 0 },
      ),
    );
}

/**
 * GET /admin/users/:userId: the person, their workspaces (owned first, then newest
 * membership first) and what suspending them would do, all read now.
 */
export async function getUserDetail(actor, userId, { now = new Date() } = {}) {
  const user = await loadUserView(userId);
  const id = objectId(userId);
  const owned = await Membership.find({ user: id, role: ROLES.OWNER })
    .sort({ _id: -1 })
    .limit(MAX_ROWS)
    .select('workspace role joinedAt')
    .lean();
  // limit(0) would mean "no limit", so the second query is skipped when the first is full.
  const others =
    owned.length < MAX_ROWS
      ? await Membership.find({ user: id, role: { $ne: ROLES.OWNER } })
          .sort({ _id: -1 })
          .limit(MAX_ROWS - owned.length)
          .select('workspace role joinedAt')
          .lean()
      : [];
  const [memberships, impact] = await Promise.all([
    membershipRows([...owned, ...others]),
    suspensionImpact(id, { now }),
  ]);

  // Why suspending is not offered: the caller's own account, or a platform admin.
  const blocked = suspendConflict(actor, {
    _id: user.id,
    platformRole: user.platformRole,
    status: user.status,
  });
  const blockedBy =
    blocked && blocked.reason !== ADMIN_CONFLICT_REASONS.ALREADY_SUSPENDED ? blocked.reason : null;

  return {
    user,
    memberships,
    membershipsTruncated: impact.workspaces.total > MAX_ROWS,
    impact,
    actions: {
      canSuspend: user.status === USER_STATUS.ACTIVE && blockedBy === null,
      canReactivate: user.status === USER_STATUS.DISABLED,
      blockedBy,
    },
  };
}

/** GET /admin/workspaces: search, publishing-mode filter, creation order, numbered pages. */
export async function listWorkspaces(query) {
  const LIVE = WORKSPACE_PUBLISHING_MODES.LIVE;
  const filter = {};
  if (query.publishingMode === LIVE) filter.publishingMode = LIVE;
  // A workspace without a stored mode is simulated (Workspace.js default).
  else if (query.publishingMode) filter.publishingMode = { $ne: LIVE };
  if (query.q) filter.$or = searchFilter(query.q, ['name', 'slug']);

  const { skip, limit } = paged(query);
  const [workspaces, total, all, live] = await Promise.all([
    Workspace.find(filter)
      .sort({ _id: query.sort === 'createdAt' ? 1 : -1 })
      .skip(skip)
      .limit(limit)
      .select('name slug createdAt publishingMode')
      .lean(),
    Workspace.countDocuments(filter),
    Workspace.countDocuments({}),
    Workspace.countDocuments({ publishingMode: LIVE }),
  ]);

  const ids = workspaces.map((w) => w._id);
  const [memberRows, ownerRows, accountRows] = ids.length
    ? await Promise.all([
        Membership.aggregate([
          { $match: { workspace: { $in: ids } } },
          { $group: { _id: '$workspace', n: { $sum: 1 } } },
        ]),
        Membership.find({ workspace: { $in: ids }, role: ROLES.OWNER })
          .select('workspace user')
          .lean(),
        SocialAccount.aggregate([
          { $match: { workspace: { $in: ids } } },
          { $group: { _id: { workspace: '$workspace', platform: '$platform' }, n: { $sum: 1 } } },
          { $project: { _id: 0, workspace: '$_id.workspace', platform: '$_id.platform', n: 1 } },
        ]),
      ])
    : [[], [], []];
  const owners = ownerRows.length
    ? await User.find({ _id: { $in: ownerRows.map((m) => m.user) } })
        .select('name email status')
        .lean()
    : [];
  const userById = new Map(owners.map((u) => [key(u._id), u]));
  const ownerOf = new Map(ownerRows.map((m) => [key(m.workspace), userById.get(key(m.user))]));
  const memberCount = new Map(memberRows.map((row) => [key(row._id), row.n]));

  return {
    items: workspaces.map((workspace) =>
      adminWorkspaceListView(workspace, {
        owner: ownerOf.get(key(workspace._id)) ?? null,
        memberCount: memberCount.get(key(workspace._id)) ?? 0,
        accounts: accountCounts(
          accountRows.filter((row) => key(row.workspace) === key(workspace._id)),
        ),
      }),
    ),
    ...pageInfo(query, total),
    facets: {
      publishingMode: {
        [WORKSPACE_PUBLISHING_MODES.SIMULATED]: all - live,
        [LIVE]: live,
      },
    },
  };
}

/** Members of a workspace: the owner first, then by role rank, then oldest membership first. */
async function workspaceMembers(ws) {
  const owner = await Membership.find({ workspace: ws, role: ROLES.OWNER })
    .select('user role joinedAt')
    .lean();
  const others = await Membership.find({ workspace: ws, role: { $ne: ROLES.OWNER } })
    .sort({ _id: 1 })
    .limit(Math.max(MAX_ROWS - owner.length, 0))
    .select('user role joinedAt')
    .lean();
  // Array#sort is stable, so equal roles keep the oldest-first order of the query.
  const rows = [...owner, ...others.sort((a, b) => ROLE_RANK[b.role] - ROLE_RANK[a.role])];
  if (!rows.length) return [];
  const users = await User.find({ _id: { $in: rows.map((m) => m.user) } })
    .select('name email status')
    .lean();
  const byId = new Map(users.map((u) => [key(u._id), u]));
  return rows
    .filter((m) => byId.has(key(m.user)))
    .map((m) => adminMemberView(m, byId.get(key(m.user))));
}

/**
 * GET /admin/workspaces/:workspaceId: names, people and counts. Never the workspace's drafts,
 * posts, media, notes, groups, invitation emails or the names of its connected accounts.
 */
export async function getWorkspaceDetail(workspaceId, { now = new Date() } = {}) {
  const ws = objectId(workspaceId);
  const workspace = await Workspace.findById(ws)
    .select('name slug timezone createdAt publishingMode publishingModeChangedAt')
    .lean();
  if (!workspace) throw notFound('Workspace not found');

  const [
    lastActivity,
    members,
    memberTotal,
    pendingInvitations,
    connectionRows,
    accountRows,
    drafts,
    [media],
    postRows,
    facebookGroups,
    openSharingTasks,
  ] = await Promise.all([
    ActivityLog.findOne({ workspace: ws }).sort({ _id: -1 }).select('createdAt').lean(),
    workspaceMembers(ws),
    Membership.countDocuments({ workspace: ws }),
    Invitation.countDocuments({
      workspace: ws,
      status: INVITATION_STATUS.PENDING,
      expiresAt: { $gt: now },
    }),
    SocialConnection.aggregate([
      { $match: { workspace: ws } },
      { $group: { _id: '$status', n: { $sum: 1 } } },
    ]),
    SocialAccount.aggregate([
      { $match: { workspace: ws } },
      { $group: { _id: '$platform', n: { $sum: 1 } } },
      { $project: { _id: 0, platform: '$_id', n: 1 } },
    ]),
    ContentPackage.countDocuments({ workspace: ws }),
    MediaAsset.aggregate([
      { $match: { workspace: ws, status: MEDIA_STATUS.READY } },
      { $group: { _id: null, n: { $sum: 1 }, bytes: { $sum: '$sizeBytes' } } },
      { $project: { _id: 0, n: 1, bytes: 1 } },
    ]),
    PublishJob.aggregate([
      { $match: { workspace: ws } },
      { $group: { _id: '$status', n: { $sum: 1 } } },
    ]),
    FacebookGroup.countDocuments({ workspace: ws }),
    SharingTask.countDocuments({ workspace: ws, status: SHARING_TASK_STATUS.OPEN }),
  ]);

  return {
    workspace: adminWorkspaceView(workspace, { lastActivityAt: lastActivity?.createdAt ?? null }),
    members,
    membersTruncated: memberTotal > MAX_ROWS,
    counts: {
      members: memberTotal,
      pendingInvitations,
      connections: countsByKey(Object.values(CONNECTION_STATUS), connectionRows),
      accounts: accountCounts(accountRows),
      drafts,
      mediaFiles: media?.n ?? 0,
      mediaBytes: media?.bytes ?? 0,
      posts: countsByKey(Object.values(PUBLISH_JOB_STATUS), postRows),
      facebookGroups,
      openSharingTasks,
    },
  };
}
