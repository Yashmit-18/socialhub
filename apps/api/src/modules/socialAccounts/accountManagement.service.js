/**
 * Read models for social account management: search/filter/sort/paginate destinations,
 * dashboard summaries, destination and connection detail, sync history and team access.
 *
 * Every listing starts from accessibleAccountFilter(), so a member only ever sees the
 * destinations their role and account-access settings allow. Health is computed (not just
 * stored) from the current connection state by connectionHealth.accountHealth(). Responses
 * never contain token material: tokens are not selected and the JSON transforms strip them.
 */
import mongoose from 'mongoose';
import {
  ACCOUNT_ACCESS_MODES,
  CONNECTION_STATUS,
  PERMISSIONS,
  PUBLISHING_STATUS,
  SOCIAL_PLATFORMS,
  SOCIAL_PROVIDERS,
  hasFullAccountAccess,
  hasPermission,
  canManageMember,
} from '@socialhub/shared';
import { notFound } from '../../lib/errors.js';
import { instagramSettings, facebookSettings } from '../../integrations/meta/settings.js';
import {
  ActivityLog,
  Membership,
  SocialAccount,
  SocialConnection,
  SyncRun,
} from '../../models/index.js';
import {
  accountHealth,
  connectionAttention,
  connectionView,
  effectiveStatus,
  expiringSoon,
  publishingScopes,
  scopeReport,
} from '../meta/connectionHealth.js';
import { providerConfigured } from '../meta/metaConnection.service.js';
import { CONNECTION_SUMMARY_FIELDS, accessibleAccountFilter } from './socialAccount.service.js';

/** Hard ceiling on destinations evaluated per request; beyond it the response says `truncated`. */
export const MAX_ACCOUNTS_SCANNED = 5000;
const DETAIL_HISTORY_LIMIT = 10;
const DETAIL_ACTIVITY_LIMIT = 20;

const id = (v) => String(v?._id ?? v);
const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

/* --------------------------------------------------------------------------- views */

function connectionSummary(connection, now) {
  if (!connection) return null;
  return {
    id: id(connection),
    provider: connection.provider,
    displayName: connection.displayName ?? null,
    pictureUrl: connection.pictureUrl ?? null,
    status: effectiveStatus(connection, now).status,
  };
}

/**
 * API view of one destination: its record, a summary of the connection it came from, the
 * Page an Instagram account is linked to, and computed health. `accessibleIds` decides
 * whether the linked Page may be linked to (it is named either way: the name is not secret).
 */
export function accountView(account, { now = new Date(), accessibleIds, workspace } = {}) {
  const json = account.toJSON();
  const connection = account.populated('connection') ? account.connection : null;
  delete json.connection;
  delete json.linkedFacebookPage;
  const linkedPageId = account.linkedFacebookPage ? id(account.linkedFacebookPage) : null;
  const view = {
    ...json,
    // null = Meta has not returned a count (unknown), which clients must not show as 0.
    followersCount: json.followersCount ?? null,
    followersCountUpdatedAt: json.followersCountUpdatedAt ?? null,
    connection: connectionSummary(connection, now),
    linkedPage:
      account.platform === SOCIAL_PLATFORMS.INSTAGRAM_ACCOUNT &&
      account.linkedFacebookPageExternalId
        ? {
            id:
              linkedPageId && (!accessibleIds || accessibleIds.has(linkedPageId))
                ? linkedPageId
                : null,
            externalId: account.linkedFacebookPageExternalId,
            name: account.linkedFacebookPageName ?? null,
          }
        : null,
    health: accountHealth(account, connection, now),
  };
  if (workspace) view.workspace = { id: id(workspace), name: workspace.name, slug: workspace.slug };
  return view;
}

/* ------------------------------------------------------------------------ scopes */

/** The single workspace a request is about, as a scope list. */
export const workspaceScope = (workspace, membership) => [{ workspace, membership }];

/**
 * Every workspace the user belongs to (optionally only `workspaceId`), as scopes. Asking for a
 * workspace the user is not a member of is indistinguishable from asking for one that does
 * not exist (404).
 */
export async function userScopes(userId, { workspaceId } = {}) {
  const filter = { user: userId };
  if (workspaceId) filter.workspace = workspaceId;
  const memberships = await Membership.find(filter).populate('workspace', 'name slug');
  const scopes = memberships
    .filter((m) => m.workspace)
    .map((m) => ({ workspace: m.workspace, membership: m }));
  if (workspaceId && scopes.length === 0) throw notFound('Workspace not found');
  return scopes;
}

/** Loads every destination visible in the scopes, with its connection, as views. */
async function loadViews(scopes, now, { crossWorkspace = false } = {}) {
  if (scopes.length === 0) return { views: [], truncated: false };
  const accounts = await SocialAccount.find({
    $or: scopes.map((s) => accessibleAccountFilter(s.membership)),
  })
    .sort({ _id: 1 })
    .limit(MAX_ACCOUNTS_SCANNED + 1)
    .populate('connection', CONNECTION_SUMMARY_FIELDS);
  const truncated = accounts.length > MAX_ACCOUNTS_SCANNED;
  const visible = truncated ? accounts.slice(0, MAX_ACCOUNTS_SCANNED) : accounts;
  const accessibleIds = new Set(visible.map((a) => id(a)));
  const workspaceById = crossWorkspace
    ? new Map(scopes.map((s) => [id(s.workspace), s.workspace]))
    : null;
  const views = visible.map((account) =>
    accountView(account, {
      now,
      accessibleIds,
      workspace: workspaceById?.get(id(account.workspace)),
    }),
  );
  if (workspaceById) {
    const canManage = new Map(
      scopes.map((s) => [
        id(s.workspace),
        hasPermission(s.membership.role, PERMISSIONS.SOCIAL_CONNECTIONS_MANAGE),
      ]),
    );
    for (const view of views) view.canManage = canManage.get(view.workspace.id) ?? false;
  }
  return { views, truncated };
}

/* ------------------------------------------------------------------ list / search */

const SEVERITY = {
  [PUBLISHING_STATUS.UNAVAILABLE]: 0,
  [PUBLISHING_STATUS.RESTRICTED]: 1,
  [PUBLISHING_STATUS.READY]: 2,
};

function compareBy(sort) {
  const byName = (a, b) => collator.compare(a.name ?? '', b.name ?? '') || a.id.localeCompare(b.id);
  const byDate = (field, direction) => (a, b) => {
    const av = a[field] ? new Date(a[field]).getTime() : null;
    const bv = b[field] ? new Date(b[field]).getTime() : null;
    if (av === bv) return byName(a, b);
    if (av === null) return 1; // never-synced last, whichever the direction
    if (bv === null) return -1;
    return direction * (av - bv);
  };
  switch (sort) {
    case '-name':
      return (a, b) => -byName(a, b);
    case 'attention':
      return (a, b) =>
        Number(b.health.needsAttention) - Number(a.health.needsAttention) ||
        SEVERITY[a.health.readiness] - SEVERITY[b.health.readiness] ||
        byName(a, b);
    case '-lastSyncedAt':
      return byDate('lastSyncedAt', -1);
    case 'lastSyncedAt':
      return byDate('lastSyncedAt', 1);
    case '-createdAt':
      return byDate('createdAt', -1);
    case 'createdAt':
      return byDate('createdAt', 1);
    default:
      return byName;
  }
}

function matchesQuery(view, q) {
  if (!q) return true;
  const needle = q.toLowerCase();
  return [
    view.name,
    view.username,
    view.externalId,
    view.category,
    view.connection?.displayName,
    view.linkedPage?.name,
    view.workspace?.name,
  ].some((value) => typeof value === 'string' && value.toLowerCase().includes(needle));
}

function countBy(views, pick) {
  const out = {};
  for (const view of views) {
    const key = pick(view);
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

/**
 * Search/filter/sort/paginate the destinations visible in `scopes`. Facets show stable totals
 * for filter controls: `platform` counts everything visible; `status`, `readiness` and
 * `attention` count the platform/login scope being viewed, before the remaining filters.
 */
export async function queryAccounts(
  scopes,
  query,
  { now = new Date(), crossWorkspace = false } = {},
) {
  const { views, truncated } = await loadViews(scopes, now, { crossWorkspace });
  const scoped = views.filter(
    (v) =>
      (!query.platform || v.platform === query.platform) &&
      (!query.connectionId || v.connection?.id === String(query.connectionId)),
  );
  const facets = {
    platform: countBy(views, (v) => v.platform),
    status: countBy(scoped, (v) => v.health.connectionStatus),
    readiness: countBy(scoped, (v) => v.health.readiness),
    attention: scoped.filter((v) => v.health.needsAttention).length,
  };
  const filtered = scoped.filter(
    (v) =>
      (!query.status || v.health.connectionStatus === query.status) &&
      (!query.readiness || v.health.readiness === query.readiness) &&
      (query.attention === undefined || v.health.needsAttention === query.attention) &&
      matchesQuery(v, query.q),
  );
  filtered.sort(compareBy(query.sort));
  const { page, limit } = query;
  const start = (page - 1) * limit;
  return {
    items: filtered.slice(start, start + limit),
    total: filtered.length,
    page,
    limit,
    pages: Math.max(1, Math.ceil(filtered.length / limit)),
    facets,
    truncated,
  };
}

/* ------------------------------------------------------------------------ summary */

/**
 * Combined followers of the visible destinations, from the counts Meta last returned.
 * Sums only known counts: destinations without one are reported in `missing`, never added
 * as 0, and a total is null when no destination in it has a count. A destination visible in
 * several workspaces is counted once (its most recently read count). It is a sum per
 * destination, so a person following several of them is counted once for each.
 */
export function combinedFollowers(views) {
  const unique = new Map();
  for (const view of views) {
    const key = `${view.platform}:${view.externalId}`;
    const seen = unique.get(key);
    if (!seen || followersReadAt(view) > followersReadAt(seen)) unique.set(key, view);
  }
  const out = {
    total: null,
    facebook: null,
    instagram: null,
    counted: 0,
    missing: 0,
    facebookMissing: 0,
    instagramMissing: 0,
    asOf: null,
  };
  for (const view of unique.values()) {
    const side = view.platform === SOCIAL_PLATFORMS.FACEBOOK_PAGE ? 'facebook' : 'instagram';
    if (view.followersCount === null) {
      out.missing += 1;
      out[`${side}Missing`] += 1;
      continue;
    }
    out.counted += 1;
    out.total = (out.total ?? 0) + view.followersCount;
    out[side] = (out[side] ?? 0) + view.followersCount;
    // The oldest read among the counted figures: the whole total is at least this fresh.
    const at = followersReadAt(view);
    if (at > 0 && (out.asOf === null || at < out.asOf)) out.asOf = at;
  }
  return { ...out, asOf: out.asOf === null ? null : new Date(out.asOf).toISOString() };
}

/** Epoch ms of a view's follower read; -1 without a count so any counted copy wins. */
function followersReadAt(view) {
  if (view.followersCount === null) return -1;
  return view.followersCountUpdatedAt ? new Date(view.followersCountUpdatedAt).getTime() : 0;
}

/**
 * Dashboard figures for the scopes. Connection figures need social_connections:manage and
 * only cover workspaces where the user has it; otherwise `connections` is null.
 */
export async function summarizeAccounts(scopes, { now = new Date() } = {}) {
  const { views, truncated } = await loadViews(scopes, now);
  const accounts = {
    total: views.length,
    facebookPages: views.filter((v) => v.platform === SOCIAL_PLATFORMS.FACEBOOK_PAGE).length,
    instagramAccounts: views.filter((v) => v.platform === SOCIAL_PLATFORMS.INSTAGRAM_ACCOUNT)
      .length,
    connected: views.filter((v) => v.health.connectionStatus === CONNECTION_STATUS.ACTIVE).length,
    needsAttention: views.filter((v) => v.health.needsAttention).length,
    ready: views.filter((v) => v.health.readiness === PUBLISHING_STATUS.READY).length,
    restricted: views.filter((v) => v.health.readiness === PUBLISHING_STATUS.RESTRICTED).length,
    unavailable: views.filter((v) => v.health.readiness === PUBLISHING_STATUS.UNAVAILABLE).length,
  };

  const manageable = scopes.filter((s) =>
    hasPermission(s.membership.role, PERMISSIONS.SOCIAL_CONNECTIONS_MANAGE),
  );
  let connections = null;
  if (manageable.length > 0) {
    const docs = await SocialConnection.find({
      workspace: { $in: manageable.map((s) => s.workspace._id ?? s.workspace) },
    });
    const statuses = docs.map((c) => effectiveStatus(c, now).status);
    const count = (status) => statuses.filter((s) => s === status).length;
    connections = {
      total: docs.length,
      facebook: docs.filter((c) => c.provider === SOCIAL_PROVIDERS.FACEBOOK_LOGIN).length,
      instagram: docs.filter((c) => c.provider === SOCIAL_PROVIDERS.INSTAGRAM_LOGIN).length,
      active: count(CONNECTION_STATUS.ACTIVE),
      expired: count(CONNECTION_STATUS.EXPIRED),
      revoked: count(CONNECTION_STATUS.REVOKED),
      disconnected: count(CONNECTION_STATUS.DISCONNECTED),
      error: count(CONNECTION_STATUS.ERROR),
      expiringSoon: docs.filter((c) => expiringSoon(c, now)).length,
      needsAttention: docs.filter((c) => connectionAttention(c, now).length > 0).length,
    };
  }

  return {
    accounts,
    followers: combinedFollowers(views),
    connections,
    meta: {
      facebookConfigured: Boolean(facebookSettings()),
      instagramConfigured: Boolean(instagramSettings()),
    },
    truncated,
  };
}

/* ------------------------------------------------------------------- team access */

function memberHasAccess(membership, accountId) {
  if (hasFullAccountAccess(membership.role)) return true;
  if (membership.accountAccess?.mode === ACCOUNT_ACCESS_MODES.ALL) return true;
  return (membership.accountAccess?.socialAccounts ?? []).some((a) => id(a) === id(accountId));
}

/** Who can use one destination, and whether the actor may change it for each member. */
export async function accountAccessList(workspace, actorMembership, account) {
  const members = await Membership.find({ workspace: workspace._id })
    .populate('user', 'name email')
    .sort({ joinedAt: 1 });
  return members.map((m) => {
    const fullAccess = hasFullAccountAccess(m.role);
    return {
      memberId: id(m),
      user: m.user ? { id: id(m.user), name: m.user.name, email: m.user.email } : null,
      role: m.role,
      mode: fullAccess
        ? ACCOUNT_ACCESS_MODES.ALL
        : (m.accountAccess?.mode ?? ACCOUNT_ACCESS_MODES.SELECTED),
      hasAccess: memberHasAccess(m, account._id),
      fullAccess,
      manageable:
        !fullAccess &&
        id(m) !== id(actorMembership) &&
        canManageMember(actorMembership.role, m.role),
    };
  });
}

/* ------------------------------------------------------------------------ detail */

const activityView = (entry) => entry.toJSON();

async function recentActivity(workspaceId, targetIds, limit) {
  const entries = await ActivityLog.find({
    workspace: workspaceId,
    'target.id': { $in: targetIds },
  })
    .sort({ _id: -1 })
    .limit(limit)
    .select('-ip -userAgent');
  return entries.map(activityView);
}

async function recentSyncRuns(connectionId, limit) {
  const runs = await SyncRun.find({ connection: connectionId }).sort({ _id: -1 }).limit(limit);
  return runs.map((r) => r.toJSON());
}

function requestedScopes(provider) {
  if (provider === SOCIAL_PROVIDERS.INSTAGRAM_LOGIN) return instagramSettings()?.scopes ?? null;
  const fb = facebookSettings();
  if (!fb) return null;
  return fb.loginConfigId ? null : fb.scopes;
}

/**
 * Everything the destination detail page shows. Sections the member may not see are null:
 * sync history needs social_connections:manage, activity needs activity:read, team access
 * needs members:manage. The account itself was already authorized by loadSocialAccount.
 */
export async function accountDetail(workspace, membership, account, { now = new Date() } = {}) {
  const role = membership.role;
  const canManageConnections = hasPermission(role, PERMISSIONS.SOCIAL_CONNECTIONS_MANAGE);
  const canViewActivity = hasPermission(role, PERMISSIONS.ACTIVITY_READ);
  const canManageAccess = hasPermission(role, PERMISSIONS.MEMBERS_MANAGE);
  const visible = accessibleAccountFilter(membership);

  await account.populate([
    {
      path: 'connection',
      select: `${CONNECTION_SUMMARY_FIELDS} declinedScopes connectedBy lastError createdAt updatedAt lastRefreshedAt syncLockedUntil disconnectedAt`,
    },
  ]);
  const connection = account.populated('connection') ? account.connection : null;
  if (connection && canManageConnections) await connection.populate('connectedBy', 'name');

  const [linkedPageDoc, linkedInstagramDocs] = await Promise.all([
    account.platform === SOCIAL_PLATFORMS.INSTAGRAM_ACCOUNT && account.linkedFacebookPage
      ? SocialAccount.findOne({ $and: [visible, { _id: account.linkedFacebookPage }] }).populate(
          'connection',
          CONNECTION_SUMMARY_FIELDS,
        )
      : null,
    account.platform === SOCIAL_PLATFORMS.FACEBOOK_PAGE
      ? SocialAccount.find({
          $and: [
            visible,
            { platform: SOCIAL_PLATFORMS.INSTAGRAM_ACCOUNT, linkedFacebookPage: account._id },
          ],
        }).populate('connection', CONNECTION_SUMMARY_FIELDS)
      : [],
  ]);
  const accessibleIds = new Set([id(account), ...(linkedPageDoc ? [id(linkedPageDoc)] : [])]);
  const view = accountView(account, { now, accessibleIds });
  const health = view.health;

  return {
    account: view,
    connection: connection
      ? canManageConnections
        ? connectionView(connection, { now })
        : connectionSummary(connection, now)
      : null,
    linkedPage: linkedPageDoc ? accountView(linkedPageDoc, { now }) : null,
    linkedInstagram: linkedInstagramDocs.map((doc) => accountView(doc, { now })),
    permissions: connection
      ? {
          granted: connection.grantedScopes ?? [],
          declined: canManageConnections ? (connection.declinedScopes ?? []) : undefined,
          requiredForPublishing: publishingScopes(connection.provider, account.platform),
          missing: health.eligibility.missingPermissions,
          tasks: account.tasks ?? null,
          createContent: health.eligibility.createContent,
        }
      : null,
    syncHistory:
      canManageConnections && connection
        ? await recentSyncRuns(connection._id, DETAIL_HISTORY_LIMIT)
        : null,
    activity: canViewActivity
      ? await recentActivity(
          workspace._id,
          [account._id, ...(connection ? [connection._id] : [])],
          DETAIL_ACTIVITY_LIMIT,
        )
      : null,
    access: canManageAccess ? await accountAccessList(workspace, membership, account) : null,
    capabilities: {
      canManageConnections,
      canManageAccess,
      canViewActivity,
      providerConfigured: connection ? providerConfigured(connection.provider) : false,
    },
  };
}

/** Everything the connection (login) detail page shows. social_connections:manage only. */
export async function connectionDetail(workspace, connectionId, { now = new Date() } = {}) {
  const connection = await SocialConnection.findOne({
    _id: connectionId,
    workspace: workspace._id,
  }).populate('connectedBy', 'name');
  if (!connection) throw notFound('Connection not found');
  const accounts = await SocialAccount.find({
    workspace: workspace._id,
    connection: connection._id,
  })
    .sort({ platform: 1, name: 1 })
    .populate('connection', CONNECTION_SUMMARY_FIELDS);
  const accessibleIds = new Set(
    (await SocialAccount.find({ workspace: workspace._id }).select('_id')).map((a) => id(a)),
  );
  const views = accounts.map((a) => accountView(a, { now, accessibleIds }));
  const accountCounts = {
    facebookPages: views.filter((v) => v.platform === SOCIAL_PLATFORMS.FACEBOOK_PAGE).length,
    instagramAccounts: views.filter((v) => v.platform === SOCIAL_PLATFORMS.INSTAGRAM_ACCOUNT)
      .length,
    needsAttention: views.filter((v) => v.health.needsAttention).length,
  };
  return {
    connection: connectionView(connection, { accountCount: views.length, accountCounts, now }),
    accounts: views,
    permissions: {
      granted: connection.grantedScopes ?? [],
      declined: connection.declinedScopes ?? [],
      requested: requestedScopes(connection.provider),
      missing: scopeReport(connection),
    },
    syncHistory: await recentSyncRuns(connection._id, DETAIL_HISTORY_LIMIT * 2),
    activity: await recentActivity(
      workspace._id,
      [connection._id, ...accounts.map((a) => a._id)],
      DETAIL_ACTIVITY_LIMIT * 2,
    ),
    capabilities: { providerConfigured: providerConfigured(connection.provider) },
  };
}

/** Paginated sync history of one connection (newest first). */
export async function listSyncRuns(workspace, connectionId, { cursor, limit }) {
  if (!(await SocialConnection.exists({ _id: connectionId, workspace: workspace._id }))) {
    throw notFound('Connection not found');
  }
  const filter = { connection: new mongoose.Types.ObjectId(String(connectionId)) };
  if (cursor) filter._id = { $lt: cursor };
  const rows = await SyncRun.find(filter)
    .sort({ _id: -1 })
    .limit(limit + 1);
  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit).map((r) => r.toJSON());
  return { items, nextCursor: hasMore ? items.at(-1).id : null };
}
