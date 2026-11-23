/**
 * Meta connections (OAuth identities) and the destinations they provide.
 *
 * Invariants:
 *  - One SocialConnection per (workspace, provider, identity). Authorizing a different
 *    identity creates a new connection; it never modifies another one.
 *  - A destination is registered once per workspace. If it is already connected through a
 *    *healthy* other identity it is never taken over; it is only re-linked when the
 *    original connection can no longer be used.
 *  - Tokens are encrypted at rest and never leave this service in a response.
 */
import {
  ACTIVITY_ACTIONS,
  CONNECTION_STATUS,
  DISCOVERY_STATES,
  ERROR_CODES,
  PUBLISHING_STATUS,
  SOCIAL_PLATFORMS,
  SOCIAL_PROVIDERS,
  SYNC_OUTCOMES,
  SYNC_SKIP_REASONS,
  SYNC_TRIGGERS,
} from '@socialhub/shared';
import { logger } from '../../config/logger.js';
import { runInTransaction } from '../../db/mongoose.js';
import { AppError, isDuplicateKeyError, notFound } from '../../lib/errors.js';
import * as facebook from '../../integrations/meta/facebook.js';
import { META_ERROR_KINDS, MetaApiError, classifyMetaError } from '../../integrations/meta/http.js';
import * as instagram from '../../integrations/meta/instagram.js';
import {
  AccountInsight,
  AccountStar,
  AnalyticsSyncRun,
  Invitation,
  Membership,
  PostInsight,
  SocialAccount,
  SocialConnection,
  SyncRun,
} from '../../models/index.js';
import { recordActivity } from '../activity/activity.service.js';
import {
  STATUS_REASONS,
  assessPublishing,
  connectionView,
  effectiveStatus,
  isUsable,
  reasonForStatus,
  scopeReport,
  statusFromMetaError,
} from './connectionHealth.js';

const DAY_MS = 86_400_000;
/** Actor recorded for changes Meta or the scheduler make without a person involved. */
export const SYSTEM_ACTORS = Object.freeze({
  META: { name: 'Meta' },
  SOCIALHUB: { name: 'SocialHub' },
});

export class IdentityMismatchError extends Error {}
export class NotEligibleError extends Error {}

export const reconnectRequired = (message) =>
  new AppError(
    409,
    ERROR_CODES.META_RECONNECT_REQUIRED,
    message ?? 'This connection must be reconnected before it can be used.',
  );

const metaUnavailable = (err) =>
  new AppError(
    502,
    ERROR_CODES.META_UNAVAILABLE,
    'Meta could not complete the request. Please try again shortly.',
    {
      meta: { kind: err.kind, code: err.code, fbtraceId: err.fbtraceId },
    },
  );

const keyOf = (platform, externalId) => `${platform}:${externalId}`;

/* ------------------------------------------------------------------ authorization */

/** Exchanges a Facebook Login code for a long-lived token and describes the identity. */
export async function authorizeFacebookIdentity(code) {
  const shortLived = await facebook.exchangeCode(code);
  const longLived = await facebook.exchangeForLongLivedToken(shortLived.accessToken);
  const [profile, permissions, debug] = await Promise.all([
    facebook.fetchProfile(longLived.accessToken),
    facebook.fetchPermissions(longLived.accessToken),
    facebook.debugToken(longLived.accessToken),
  ]);
  if (!debug.isValid || (debug.userId && debug.userId !== profile.id)) {
    throw new MetaApiError({
      message: 'Meta reported the new token as invalid',
      kind: META_ERROR_KINDS.TOKEN_REVOKED,
    });
  }
  return {
    provider: SOCIAL_PROVIDERS.FACEBOOK_LOGIN,
    externalUserId: profile.id,
    displayName: profile.name,
    pictureUrl: profile.pictureUrl,
    accessToken: longLived.accessToken,
    tokenExpiresAt: longLived.expiresAt ?? debug.expiresAt,
    dataAccessExpiresAt: debug.dataAccessExpiresAt,
    grantedScopes: permissions.granted,
    declinedScopes: permissions.declined,
  };
}

/** Exchanges an Instagram Login code; only professional (Business/Creator) accounts qualify. */
export async function authorizeInstagramIdentity(code, requestedScopes = []) {
  const shortLived = await instagram.exchangeInstagramCode(code);
  const longLived = await instagram.exchangeInstagramLongLivedToken(shortLived.accessToken);
  const profile = await instagram.fetchInstagramProfile(longLived.accessToken);
  if (!profile.accountId || !profile.accountType) {
    throw new NotEligibleError('Only Instagram Business and Creator accounts can be connected');
  }
  return {
    provider: SOCIAL_PROVIDERS.INSTAGRAM_LOGIN,
    externalUserId: shortLived.userId,
    displayName: profile.username ? `@${profile.username}` : profile.name,
    pictureUrl: profile.pictureUrl,
    accessToken: longLived.accessToken,
    tokenExpiresAt: longLived.expiresAt,
    dataAccessExpiresAt: null,
    grantedScopes: shortLived.permissions,
    declinedScopes: requestedScopes.filter((s) => !shortLived.permissions.includes(s)),
  };
}

/**
 * Persists an authorized identity. Re-authorizing the same identity updates its connection;
 * a different identity gets its own connection. A RECONNECT must be the same identity.
 */
export async function saveAuthorizedConnection({
  workspace,
  user,
  identity,
  reconnectConnectionId,
  context,
}) {
  if (reconnectConnectionId) {
    const target = await SocialConnection.findOne({
      _id: reconnectConnectionId,
      workspace: workspace._id,
    });
    if (
      target &&
      (target.provider !== identity.provider || target.externalUserId !== identity.externalUserId)
    ) {
      throw new IdentityMismatchError(
        'Signed in with a different account than the one being reconnected',
      );
    }
  }

  const now = new Date();
  const apply = (connection) => {
    connection.set({
      displayName: identity.displayName ?? connection.displayName,
      pictureUrl: identity.pictureUrl ?? connection.pictureUrl,
      grantedScopes: identity.grantedScopes,
      declinedScopes: identity.declinedScopes,
      tokenExpiresAt: identity.tokenExpiresAt ?? undefined,
      dataAccessExpiresAt: identity.dataAccessExpiresAt ?? undefined,
      status: CONNECTION_STATUS.ACTIVE,
      statusReason: undefined,
      lastError: undefined,
      lastRefreshedAt: now,
      disconnectedAt: undefined,
    });
    connection.setAccessToken(identity.accessToken);
  };

  const upsert = async () => {
    const existing = await SocialConnection.findOne({
      workspace: workspace._id,
      provider: identity.provider,
      externalUserId: identity.externalUserId,
    });
    const connection =
      existing ??
      new SocialConnection({
        workspace: workspace._id,
        provider: identity.provider,
        externalUserId: identity.externalUserId,
        connectedBy: user._id,
      });
    apply(connection);
    await runInTransaction(async (session) => {
      await connection.save({ session });
      await recordActivity({
        workspace,
        actor: user,
        action: existing
          ? ACTIVITY_ACTIONS.SOCIAL_CONNECTION_RECONNECTED
          : ACTIVITY_ACTIONS.SOCIAL_CONNECTION_CONNECTED,
        target: { type: 'social_connection', id: connection._id, label: connection.displayName },
        metadata: { provider: identity.provider, grantedScopes: identity.grantedScopes },
        context,
        session,
      });
    });
    return { connection, isNew: !existing };
  };

  let result;
  try {
    result = await upsert();
  } catch (err) {
    // Two callbacks for the same identity raced; the second one updates the first's row.
    if (!isDuplicateKeyError(err)) throw err;
    result = await upsert();
  }

  if (!result.isNew) {
    // Re-authorization: give already-added destinations fresh tokens and statuses. This is a
    // synchronization in its own right, so it is recorded in the sync history.
    const startedAt = new Date();
    const run = {
      trigger: SYNC_TRIGGERS.RECONNECT,
      actor: user,
      startedAt,
      before: CONNECTION_STATUS.ACTIVE,
    };
    try {
      const accounts = await refreshConnectionAccounts(result.connection);
      result.connection.set({ lastSyncedAt: new Date() });
      await result.connection.save();
      await recordSyncRun(result.connection, { ...run, outcome: SYNC_OUTCOMES.SUCCESS, accounts });
    } catch (err) {
      logger.warn(
        { err: err?.toLog?.() ?? err, connectionId: String(result.connection._id) },
        'Post-reconnect account refresh failed',
      );
      const outcome =
        err instanceof MetaApiError
          ? (OUTCOME_FOR_KIND[err.kind] ?? SYNC_OUTCOMES.FAILED)
          : SYNC_OUTCOMES.FAILED;
      await recordSyncRun(result.connection, {
        ...run,
        outcome,
        error: err instanceof MetaApiError ? err : undefined,
      });
    }
  }
  return result;
}

/* ---------------------------------------------------------------------- discovery */

async function loadConnection(workspaceId, connectionId, { withToken = true } = {}) {
  const query = SocialConnection.findOne({ _id: connectionId, workspace: workspaceId });
  if (withToken) query.select('+accessToken');
  const connection = await query;
  if (!connection) throw notFound('Connection not found');
  return connection;
}

function requireUsable(connection) {
  requireProviderConfigured(connection);
  const { status, reason } = effectiveStatus(connection);
  if (status !== CONNECTION_STATUS.ACTIVE || !connection.hasAccessToken()) {
    throw reconnectRequired(reason ?? STATUS_REASONS.DISCONNECTED);
  }
}

/* -------------------------------------------------------------- follower counts */

const FOLLOWER_READ_CONCURRENCY = 4;
/** Follower reads run inside a sync (lock: SYNC_LOCK_MS); whatever is left keeps its old value. */
const FOLLOWER_READ_BUDGET_MS = 30_000;

/** Which permissions a follower read needs, per destination kind (see the Meta clients). */
function canReadFollowers(connection, candidate) {
  if (connection.provider === SOCIAL_PROVIDERS.INSTAGRAM_LOGIN) return true; // required scope
  const granted = new Set(connection.grantedScopes ?? []);
  if (!granted.has('pages_read_engagement')) return false;
  return candidate.platform === SOCIAL_PLATFORMS.FACEBOOK_PAGE || granted.has('instagram_basic');
}

function readFollowers(connection, candidate) {
  return connection.provider === SOCIAL_PROVIDERS.INSTAGRAM_LOGIN
    ? instagram.fetchInstagramFollowersCount(candidate.accessToken)
    : facebook.fetchFollowersCount(candidate.externalId, candidate.accessToken);
}

/**
 * Best effort: sets `followersCount` on each candidate to the number Meta returned, or null
 * when Meta answered without one. A candidate whose read was skipped (permission not granted,
 * time budget used up, rate limited) or failed keeps `followersCount` undefined, which leaves
 * the stored value untouched. A refused follower read never fails discovery or a sync.
 */
async function withFollowerCounts(connection, candidates) {
  const queue = candidates.filter((c) => c.accessToken && canReadFollowers(connection, c));
  const deadline = Date.now() + FOLLOWER_READ_BUDGET_MS;
  let stop = false;
  const worker = async () => {
    while (!stop && queue.length > 0 && Date.now() < deadline) {
      const candidate = queue.shift();
      try {
        candidate.followersCount = await readFollowers(connection, candidate);
      } catch (err) {
        if (!(err instanceof MetaApiError)) throw err;
        if (err.kind === META_ERROR_KINDS.RATE_LIMITED) stop = true;
        logger.warn(
          {
            err: err.toLog?.() ?? err.message,
            connectionId: String(connection._id),
            platform: candidate.platform,
            externalId: candidate.externalId,
          },
          'Follower count not available from Meta',
        );
      }
    }
  };
  await Promise.all(Array.from({ length: FOLLOWER_READ_CONCURRENCY }, worker));
  return candidates;
}

/**
 * Live list of destinations the identity can reach, including their tokens.
 * Internal only — callers must never return these objects to a client.
 * `followers: true` also reads follower counts (adding and syncing do; discovery does not).
 */
async function fetchCandidates(connection, { followers = false } = {}) {
  const candidates = await fetchDestinations(connection);
  return followers ? withFollowerCounts(connection, candidates) : candidates;
}

async function fetchDestinations(connection) {
  const token = connection.getAccessToken();
  if (connection.provider === SOCIAL_PROVIDERS.INSTAGRAM_LOGIN) {
    const profile = await instagram.fetchInstagramProfile(token);
    if (!profile.accountId) return [];
    return [
      {
        platform: SOCIAL_PLATFORMS.INSTAGRAM_ACCOUNT,
        externalId: profile.accountId,
        name: profile.name || profile.username || 'Instagram account',
        username: profile.username,
        pictureUrl: profile.pictureUrl,
        instagramAccountType: profile.accountType,
        tasks: null,
        accessToken: token,
      },
    ];
  }

  const pages = await facebook.fetchManagedPages(token);
  const seen = new Set();
  const candidates = [];
  const push = (candidate) => {
    const key = keyOf(candidate.platform, candidate.externalId);
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push(candidate);
  };
  for (const page of pages) {
    push({
      platform: SOCIAL_PLATFORMS.FACEBOOK_PAGE,
      externalId: page.id,
      name: page.name,
      category: page.category,
      pictureUrl: page.pictureUrl,
      tasks: page.tasks,
      accessToken: page.accessToken,
    });
    if (page.instagram) {
      push({
        platform: SOCIAL_PLATFORMS.INSTAGRAM_ACCOUNT,
        externalId: page.instagram.id,
        name: page.instagram.name || page.instagram.username || 'Instagram account',
        username: page.instagram.username,
        pictureUrl: page.instagram.pictureUrl,
        // Meta does not expose Business vs Creator for Page-linked accounts.
        instagramAccountType: null,
        tasks: page.tasks,
        // Page-linked Instagram accounts are managed with the Page's token.
        accessToken: page.accessToken,
        linkedPage: { externalId: page.id, name: page.name },
      });
    }
  }
  return candidates;
}

/**
 * Whether the stored login is still the one a Meta call was made for: it exists, is not
 * disconnected, still holds a token and, when `expectedToken` is given, still holds that
 * token. Returns 'current', 'removed', 'disconnected' or 'replaced'. A manager's disconnect,
 * a removal or a reconnect that happens while Meta is answering must never be undone by
 * results computed with the old state.
 */
async function storedLoginState(connection, { expectedToken, session } = {}) {
  const current = await SocialConnection.findById(connection._id)
    .select('+accessToken status')
    .session(session ?? null);
  if (!current) return 'removed';
  if (current.status === CONNECTION_STATUS.DISCONNECTED || !current.hasAccessToken()) {
    return 'disconnected';
  }
  if (expectedToken !== undefined && current.getAccessToken() !== expectedToken) {
    return 'replaced';
  }
  return 'current';
}

const SUPERSEDED_MESSAGES = {
  removed: 'This login was removed while it was being synchronized. Nothing was changed.',
  disconnected: 'This login was disconnected while it was being synchronized. Nothing was changed.',
  replaced:
    'This login was reconnected while it was being synchronized. The newer authorization was kept.',
};

/** Error for a sync whose login changed meanwhile; nothing was written (bulk: SUPERSEDED). */
function supersededError(state) {
  return new AppError(409, ERROR_CODES.CONFLICT, SUPERSEDED_MESSAGES[state], {
    superseded: state,
  });
}

/**
 * Marks a connection (and its destinations) unusable after Meta rejected its token.
 * Returns false, writing nothing, when the stored login was meanwhile disconnected, removed
 * or (with `expectedToken`) reauthorized: Meta's answer then concerns a token that is no
 * longer in use.
 */
export async function markConnectionUnhealthy(
  connection,
  err,
  { actor = SYSTEM_ACTORS.SOCIALHUB, context, reason, status: statusOverride, expectedToken } = {},
) {
  const previous = effectiveStatus(connection).status;
  const status = statusOverride ?? statusFromMetaError(err);
  const statusReason = reason ?? reasonForStatus(status);
  logger.warn(
    { connectionId: String(connection._id), meta: err.toLog?.() },
    'Meta rejected a connection token',
  );

  let marked = false;
  await runInTransaction(async (session) => {
    marked = false;
    if ((await storedLoginState(connection, { expectedToken, session })) !== 'current') return;
    marked = true;
    connection.set({
      status,
      statusReason,
      lastError: { code: err.kind ?? 'UNKNOWN', message: err.message, at: new Date() },
    });
    await connection.save({ session });
    await SocialAccount.updateMany(
      { connection: connection._id },
      {
        connectionStatus: status,
        connectionStatusReason: statusReason,
        publishingStatus: PUBLISHING_STATUS.UNAVAILABLE,
        publishingStatusReason: statusReason,
      },
      { session },
    );
    if (previous !== status) {
      await recordActivity({
        workspace: connection.workspace,
        actor,
        action: ACTIVITY_ACTIONS.SOCIAL_CONNECTION_STATUS_CHANGED,
        target: { type: 'social_connection', id: connection._id, label: connection.displayName },
        metadata: { from: previous, to: status, metaError: err.kind },
        context,
        session,
      });
    }
  });
  return marked;
}

/** Runs a Meta call for a connection, translating Meta failures into API errors. */
async function callMeta(connection, fn, options) {
  try {
    return await fn();
  } catch (err) {
    if (!(err instanceof MetaApiError)) throw err;
    if (err.isTokenError) {
      await markConnectionUnhealthy(connection, err, options);
      throw reconnectRequired(reasonForStatus(statusFromMetaError(err)));
    }
    connection.lastError = { code: err.kind, message: err.message, at: new Date() };
    await connection.save();
    if (err.kind === META_ERROR_KINDS.PERMISSION_DENIED) {
      throw reconnectRequired(
        'Meta denied access because a permission is missing. Reconnect and grant the requested permissions.',
      );
    }
    throw metaUnavailable(err);
  }
}

function isHealthyRegistration(account) {
  const owner = account.connection;
  return Boolean(
    owner &&
    typeof owner === 'object' &&
    isUsable(owner) &&
    account.connectionStatus === CONNECTION_STATUS.ACTIVE,
  );
}

function candidateView(candidate, connection, existing) {
  let state = DISCOVERY_STATES.NEW;
  if (existing) {
    if (String(existing.connection?._id ?? existing.connection) === String(connection._id)) {
      state = DISCOVERY_STATES.CONNECTED_HERE;
    } else {
      state = isHealthyRegistration(existing)
        ? DISCOVERY_STATES.CONNECTED_VIA_OTHER
        : DISCOVERY_STATES.RECLAIMABLE;
    }
  }
  return {
    platform: candidate.platform,
    externalId: candidate.externalId,
    name: candidate.name,
    username: candidate.username ?? null,
    category: candidate.category ?? null,
    pictureUrl: candidate.pictureUrl ?? null,
    instagramAccountType: candidate.instagramAccountType ?? null,
    linkedPage: candidate.linkedPage ?? null,
    tasks: candidate.tasks ?? null,
    hasAccessToken: Boolean(candidate.accessToken),
    publishing: assessPublishing({
      provider: connection.provider,
      platform: candidate.platform,
      tasks: candidate.tasks,
      grantedScopes: connection.grantedScopes,
    }),
    state,
    existingAccountId: existing ? String(existing._id) : null,
    connectedVia:
      existing && state === DISCOVERY_STATES.CONNECTED_VIA_OTHER
        ? { id: String(existing.connection._id), displayName: existing.connection.displayName }
        : null,
  };
}

async function existingByKey(workspaceId, candidates) {
  if (candidates.length === 0) return new Map();
  const existing = await SocialAccount.find({
    workspace: workspaceId,
    $or: candidates.map((c) => ({ platform: c.platform, externalId: c.externalId })),
  }).populate('connection');
  return new Map(existing.map((a) => [keyOf(a.platform, a.externalId), a]));
}

function discoveryWarnings(connection, candidates) {
  const report = scopeReport(connection);
  const warnings = [];
  if (report.required.length > 0) {
    warnings.push(
      `Required permission not granted: ${report.required.join(', ')}. Reconnect and allow it.`,
    );
  }
  if (candidates.length === 0) {
    warnings.push(
      connection.provider === SOCIAL_PROVIDERS.FACEBOOK_LOGIN
        ? 'No Pages were found. The login needs a role on at least one Page, and the Pages must be selected during authorization.'
        : 'No eligible Instagram professional account was found for this login.',
    );
  }
  return warnings;
}

/** Live discovery for the selection screen. Response contains no tokens. */
export async function discoverAccounts(workspace, connectionId, options = {}) {
  const connection = await loadConnection(workspace._id, connectionId);
  requireUsable(connection);
  const candidates = await callMeta(connection, () => fetchCandidates(connection), options);
  const existing = await existingByKey(workspace._id, candidates);
  return {
    connection: connectionView(connection),
    candidates: candidates.map((c) =>
      candidateView(c, connection, existing.get(keyOf(c.platform, c.externalId))),
    ),
    warnings: discoveryWarnings(connection, candidates),
  };
}

/* ---------------------------------------------------------------------- selection */

function applyCandidate(account, candidate, connection, now) {
  const publishing = assessPublishing({
    provider: connection.provider,
    platform: candidate.platform,
    tasks: candidate.tasks,
    grantedScopes: connection.grantedScopes,
  });
  account.set({
    connection: connection._id,
    name: candidate.name,
    username: candidate.username ?? undefined,
    pictureUrl: candidate.pictureUrl ?? undefined,
    category: candidate.category ?? undefined,
    instagramAccountType:
      candidate.instagramAccountType ?? account.instagramAccountType ?? undefined,
    linkedFacebookPageExternalId: candidate.linkedPage?.externalId ?? undefined,
    linkedFacebookPageName: candidate.linkedPage?.name ?? undefined,
    tasks: candidate.tasks ?? undefined,
    connectionStatus: CONNECTION_STATUS.ACTIVE,
    connectionStatusReason: undefined,
    publishingStatus: publishing.status,
    publishingStatusReason: publishing.reason ?? undefined,
    lastSyncedAt: now,
  });
  // undefined: not read this time, keep what is stored; null: Meta returned no count.
  if (candidate.followersCount !== undefined) {
    account.set({
      followersCount: candidate.followersCount ?? undefined,
      followersCountUpdatedAt: candidate.followersCount === null ? undefined : now,
    });
  }
  account.setAccessToken(candidate.accessToken);
}

/** Links Page-backed Instagram accounts to their Page's destination when both are present. */
async function linkInstagramToPages(workspaceId, session = null) {
  const igAccounts = await SocialAccount.find({
    workspace: workspaceId,
    platform: SOCIAL_PLATFORMS.INSTAGRAM_ACCOUNT,
    linkedFacebookPageExternalId: { $exists: true },
  })
    .select('linkedFacebookPageExternalId linkedFacebookPage')
    .session(session);
  if (igAccounts.length === 0) return;
  const pages = await SocialAccount.find({
    workspace: workspaceId,
    platform: SOCIAL_PLATFORMS.FACEBOOK_PAGE,
    externalId: { $in: igAccounts.map((a) => a.linkedFacebookPageExternalId) },
  })
    .select('externalId')
    .session(session);
  const pageIdByExternal = new Map(pages.map((p) => [p.externalId, p._id]));
  for (const account of igAccounts) {
    const pageId = pageIdByExternal.get(account.linkedFacebookPageExternalId);
    if (String(pageId ?? '') !== String(account.linkedFacebookPage ?? '')) {
      await SocialAccount.updateOne(
        { _id: account._id },
        pageId ? { linkedFacebookPage: pageId } : { $unset: { linkedFacebookPage: 1 } },
        { session },
      );
    }
  }
}

/**
 * Adds the selected destinations to the workspace. The selection is checked against a fresh
 * discovery, so a client can only add accounts the identity really manages.
 */
export async function connectAccounts(workspace, actor, connectionId, requested, context) {
  const connection = await loadConnection(workspace._id, connectionId);
  requireUsable(connection);
  const candidates = await callMeta(
    connection,
    () => fetchCandidates(connection, { followers: true }),
    { context },
  );
  const byKey = new Map(candidates.map((c) => [keyOf(c.platform, c.externalId), c]));
  const now = new Date();
  const result = { added: [], updated: [], relinked: [], skipped: [] };
  const seen = new Set();

  for (const { platform, externalId } of requested) {
    const key = keyOf(platform, externalId);
    if (seen.has(key)) continue;
    seen.add(key);

    const candidate = byKey.get(key);
    if (!candidate) {
      result.skipped.push({
        platform,
        externalId,
        reason: 'NOT_AVAILABLE',
        message: 'This account is not available to the connected login.',
      });
      continue;
    }
    if (!candidate.accessToken) {
      result.skipped.push({
        platform,
        externalId,
        reason: 'NO_ACCESS',
        message: 'Meta did not provide access to this account for the connected login.',
      });
      continue;
    }

    const existing = await SocialAccount.findOne({
      workspace: workspace._id,
      platform,
      externalId,
    }).populate('connection');
    const label = candidate.name;

    if (
      existing &&
      String(existing.connection?._id ?? existing.connection) !== String(connection._id)
    ) {
      if (isHealthyRegistration(existing)) {
        result.skipped.push({
          platform,
          externalId,
          reason: 'CONNECTED_VIA_OTHER',
          message: `Already connected through ${existing.connection.displayName ?? 'another login'}.`,
        });
        continue;
      }
      const previousConnectionId = existing.connection?._id ?? existing.connection;
      applyCandidate(existing, candidate, connection, now);
      await runInTransaction(async (session) => {
        await existing.save({ session });
        await recordActivity({
          workspace,
          actor,
          action: ACTIVITY_ACTIONS.SOCIAL_ACCOUNT_RELINKED,
          target: { type: 'social_account', id: existing._id, label },
          metadata: {
            platform,
            via: connection.displayName,
            previousConnectionId: String(previousConnectionId),
          },
          context,
          session,
        });
      });
      result.relinked.push(existing.toJSON());
      continue;
    }

    if (existing) {
      applyCandidate(existing, candidate, connection, now);
      await existing.save();
      result.updated.push(existing.toJSON());
      continue;
    }

    const account = new SocialAccount({
      workspace: workspace._id,
      platform,
      externalId,
      name: candidate.name,
      connectedBy: actor._id,
    });
    applyCandidate(account, candidate, connection, now);
    try {
      await runInTransaction(async (session) => {
        await account.save({ session });
        await recordActivity({
          workspace,
          actor,
          action: ACTIVITY_ACTIONS.SOCIAL_ACCOUNT_ADDED,
          target: { type: 'social_account', id: account._id, label },
          metadata: { platform, via: connection.displayName },
          context,
          session,
        });
      });
      result.added.push(account.toJSON());
    } catch (err) {
      if (!isDuplicateKeyError(err)) throw err;
      result.skipped.push({
        platform,
        externalId,
        reason: 'CONNECTED_CONCURRENTLY',
        message: 'Someone else added this account at the same time.',
      });
    }
  }

  await linkInstagramToPages(workspace._id);
  connection.lastSyncedAt = now;
  await connection.save();
  return result;
}

/* --------------------------------------------------------------------------- sync */

/**
 * Updates already-added destinations from a fresh discovery; marks unreachable ones.
 * Pass `candidates` when the caller already fetched them (sync always does, so that every
 * sync exercises the token against Meta even when no destination has been added yet).
 */
async function refreshConnectionAccounts(connection, candidates, session = null) {
  const accounts = await SocialAccount.find({ connection: connection._id }).session(session);
  if (accounts.length === 0) return { refreshed: 0, lost: 0 };
  candidates ??= await fetchCandidates(connection, { followers: true });
  const byKey = new Map(candidates.map((c) => [keyOf(c.platform, c.externalId), c]));
  const now = new Date();
  let refreshed = 0;
  let lost = 0;
  for (const account of accounts) {
    const candidate = byKey.get(keyOf(account.platform, account.externalId));
    if (candidate?.accessToken) {
      applyCandidate(account, candidate, connection, now);
      refreshed += 1;
    } else {
      account.set({
        connectionStatus: CONNECTION_STATUS.ERROR,
        connectionStatusReason: STATUS_REASONS.ACCOUNT_LOST,
        publishingStatus: PUBLISHING_STATUS.UNAVAILABLE,
        publishingStatusReason: STATUS_REASONS.ACCOUNT_LOST,
        lastSyncedAt: now,
      });
      lost += 1;
    }
    await account.save({ session });
  }
  await linkInstagramToPages(connection.workspace, session);
  return { refreshed, lost };
}

const INSTAGRAM_REFRESH_MIN_AGE_MS = DAY_MS; // Meta rule: token must be >= 24h old.
const INSTAGRAM_REFRESH_WINDOW_MS = 30 * DAY_MS;

function shouldRefreshInstagramToken(connection, now) {
  const issued = connection.lastRefreshedAt ?? connection.createdAt;
  if (!issued || now - issued < INSTAGRAM_REFRESH_MIN_AGE_MS) return false;
  return (
    !connection.tokenExpiresAt || connection.tokenExpiresAt - now < INSTAGRAM_REFRESH_WINDOW_MS
  );
}

async function validateFacebookToken(connection) {
  const token = connection.getAccessToken();
  const debug = await facebook.debugToken(token);
  if (!debug.isValid) {
    const code = debug.error?.code ?? 190;
    const subcode = debug.error?.subcode;
    const expired = debug.expiresAt && debug.expiresAt <= new Date();
    throw new MetaApiError({
      message: debug.error?.message ?? 'Meta reports the token is no longer valid',
      code,
      subcode,
      kind: expired ? META_ERROR_KINDS.TOKEN_EXPIRED : classifyMetaError({ code, subcode }),
    });
  }
  const permissions = await facebook.fetchPermissions(token);
  connection.set({
    grantedScopes: permissions.granted,
    declinedScopes: permissions.declined,
    tokenExpiresAt: debug.expiresAt ?? undefined,
    dataAccessExpiresAt: debug.dataAccessExpiresAt ?? undefined,
  });
}

const SYNC_LOCK_MS = 2 * 60_000;

const OUTCOME_FOR_KIND = {
  [META_ERROR_KINDS.TOKEN_EXPIRED]: SYNC_OUTCOMES.TOKEN_EXPIRED,
  [META_ERROR_KINDS.TOKEN_REVOKED]: SYNC_OUTCOMES.TOKEN_REVOKED,
  [META_ERROR_KINDS.PERMISSION_DENIED]: SYNC_OUTCOMES.PERMISSION_DENIED,
  [META_ERROR_KINDS.RATE_LIMITED]: SYNC_OUTCOMES.RATE_LIMITED,
  [META_ERROR_KINDS.TRANSIENT]: SYNC_OUTCOMES.TRANSIENT_FAILURE,
  [META_ERROR_KINDS.INVALID_REQUEST]: SYNC_OUTCOMES.FAILED,
};

const PERMISSION_LOST_REASON =
  'Meta denied access because a required permission was removed. Reconnect and grant the requested permissions.';

const isPersonActor = (actor) => Boolean(actor?._id);

/** Appends one attempt to the connection's sync history and stamps the connection. */
async function recordSyncRun(
  connection,
  { trigger, actor, startedAt, outcome, before, accounts, error },
) {
  const finishedAt = new Date();
  const statusAfter = effectiveStatus(connection, finishedAt).status;
  try {
    await SyncRun.create({
      workspace: connection.workspace,
      connection: connection._id,
      trigger,
      actor: isPersonActor(actor) ? actor._id : undefined,
      actorName: actor?.name,
      startedAt,
      finishedAt,
      durationMs: finishedAt - startedAt,
      outcome,
      statusBefore: before,
      statusAfter,
      accounts: accounts ?? { refreshed: 0, lost: 0 },
      error: error?.toLog
        ? {
            kind: error.kind,
            code: error.code,
            subcode: error.subcode,
            message: error.message,
            fbtraceId: error.fbtraceId,
          }
        : undefined,
    });
    // Targeted update: never clobber fields another writer changed meanwhile.
    await SocialConnection.updateOne(
      { _id: connection._id },
      { lastSyncAttemptAt: finishedAt, lastSyncOutcome: outcome },
    );
    connection.set({ lastSyncAttemptAt: finishedAt, lastSyncOutcome: outcome });
  } catch (err) {
    logger.warn({ err, connectionId: String(connection._id) }, 'Could not record sync history');
  }
}

export function providerConfigured(provider) {
  return provider === SOCIAL_PROVIDERS.FACEBOOK_LOGIN
    ? facebook.isFacebookConfigured()
    : instagram.isInstagramConfigured();
}

/** Meta operations on a connection need its provider's app credentials on this server. */
export function requireProviderConfigured(connection) {
  if (providerConfigured(connection.provider)) return;
  const name = connection.provider === SOCIAL_PROVIDERS.FACEBOOK_LOGIN ? 'Facebook' : 'Instagram';
  throw new AppError(
    409,
    ERROR_CODES.META_NOT_CONFIGURED,
    `${name} Login is not configured on this server, so SocialHub cannot contact Meta for this login. Add the Meta app credentials (see META_SETUP_GUIDE.md) to enable synchronization.`,
  );
}

/** Atomically claims the connection for one synchronization; returns false if one is running. */
async function acquireSyncLock(connection, now) {
  const claimed = await SocialConnection.findOneAndUpdate(
    {
      _id: connection._id,
      $or: [
        { syncLockedUntil: { $exists: false } },
        { syncLockedUntil: null },
        { syncLockedUntil: { $lte: now } },
      ],
    },
    { $set: { syncLockedUntil: new Date(now.getTime() + SYNC_LOCK_MS) } },
    { projection: { _id: 1 } },
  );
  return Boolean(claimed);
}

async function releaseSyncLock(connection) {
  await SocialConnection.updateOne({ _id: connection._id }, { $unset: { syncLockedUntil: 1 } });
  connection.set('syncLockedUntil', undefined);
}

/**
 * Re-validates a connection with Meta and refreshes its destinations. Every attempt that
 * reaches Meta is recorded in the sync history. Never runs without the provider's app
 * credentials (409 META_NOT_CONFIGURED) and never overlaps another sync of the same
 * connection (409 SYNC_IN_PROGRESS).
 *
 * Outcomes: SUCCESS; TOKEN_EXPIRED / TOKEN_REVOKED and PERMISSION_DENIED mark the connection
 * and its destinations unusable and return normally; RATE_LIMITED / TRANSIENT_FAILURE /
 * FAILED leave the data untouched and throw 502 META_UNAVAILABLE.
 * `manual` syncs are always audited; scheduled ones only when the status changes.
 *
 * Meta is called first and nothing is written until it has answered. The results are then
 * written in one transaction that first re-reads the stored login: if it was disconnected,
 * removed or reauthorized in the meantime, nothing is written and 409 CONFLICT
 * (`details.superseded`) is returned. A newer change always wins over the sync.
 */
export async function syncConnection(
  connection,
  { actor = SYSTEM_ACTORS.SOCIALHUB, manual = false, trigger, context } = {},
) {
  requireProviderConfigured(connection);
  if (connection.status === CONNECTION_STATUS.DISCONNECTED || !connection.hasAccessToken()) {
    throw reconnectRequired(effectiveStatus(connection).reason ?? STATUS_REASONS.DISCONNECTED);
  }
  const runTrigger = trigger ?? (manual ? SYNC_TRIGGERS.MANUAL : SYNC_TRIGGERS.SCHEDULED);
  const startedAt = new Date();
  if (!(await acquireSyncLock(connection, startedAt))) {
    throw new AppError(
      409,
      ERROR_CODES.SYNC_IN_PROGRESS,
      'A synchronization of this login is already running. Try again in a moment.',
    );
  }

  const before = effectiveStatus(connection, startedAt).status;
  const run = { trigger: runTrigger, actor, startedAt, before };
  // The token as stored when the sync started (an Instagram refresh below replaces the
  // in-memory copy); used to detect a reauthorization that happened meanwhile.
  const storedToken = connection.getAccessToken();
  try {
    let candidates;
    try {
      if (connection.provider === SOCIAL_PROVIDERS.FACEBOOK_LOGIN) {
        await validateFacebookToken(connection);
      } else if (shouldRefreshInstagramToken(connection, startedAt)) {
        const refreshed = await instagram.refreshInstagramToken(storedToken);
        connection.setAccessToken(refreshed.accessToken);
        connection.set({
          tokenExpiresAt: refreshed.expiresAt ?? undefined,
          lastRefreshedAt: startedAt,
        });
      }
      // Always hit Meta with the token: this is the health check for Instagram Login and
      // confirms Page access for Facebook Login.
      candidates = await fetchCandidates(connection, { followers: true });
    } catch (err) {
      if (!(err instanceof MetaApiError)) throw err;
      const outcome = OUTCOME_FOR_KIND[err.kind] ?? SYNC_OUTCOMES.FAILED;
      if (err.isTokenError || err.kind === META_ERROR_KINDS.PERMISSION_DENIED) {
        const permission = err.kind === META_ERROR_KINDS.PERMISSION_DENIED;
        // Keep the permissions Meta just reported (validateFacebookToken may have refreshed them).
        const marked = await markConnectionUnhealthy(connection, err, {
          actor,
          context,
          expectedToken: storedToken,
          ...(permission && { status: CONNECTION_STATUS.ERROR, reason: PERMISSION_LOST_REASON }),
        });
        if (!marked)
          throw supersededError(await storedLoginState(connection, { expectedToken: storedToken }));
        await recordSyncRun(connection, { ...run, outcome, error: err });
        return {
          connection: connectionView(connection),
          accounts: { refreshed: 0, lost: 0 },
          outcome,
          statusChanged: before !== effectiveStatus(connection).status,
        };
      }
      // Temporary or unexpected Meta failure: the stored data stays as it was.
      const state = await storedLoginState(connection, { expectedToken: storedToken });
      if (state !== 'current') throw supersededError(state);
      const lastError = { code: err.kind, message: err.message, at: new Date() };
      await SocialConnection.updateOne({ _id: connection._id }, { lastError });
      connection.lastError = lastError;
      await recordSyncRun(connection, { ...run, outcome, error: err });
      throw metaUnavailable(err);
    }

    const finishedAt = new Date();
    let after = before;
    const counts = await runInTransaction(async (session) => {
      const state = await storedLoginState(connection, { expectedToken: storedToken, session });
      if (state !== 'current') throw supersededError(state);
      const refreshedCounts = await refreshConnectionAccounts(connection, candidates, session);
      connection.set({
        status: CONNECTION_STATUS.ACTIVE,
        statusReason: undefined,
        lastError: undefined,
        lastSyncedAt: finishedAt,
      });
      await connection.save({ session });
      after = effectiveStatus(connection, finishedAt).status;
      if (manual || before !== after) {
        await recordActivity({
          workspace: connection.workspace,
          actor,
          action: manual
            ? ACTIVITY_ACTIONS.SOCIAL_CONNECTION_SYNCED
            : ACTIVITY_ACTIONS.SOCIAL_CONNECTION_STATUS_CHANGED,
          target: { type: 'social_connection', id: connection._id, label: connection.displayName },
          metadata: { ...refreshedCounts, from: before, to: after },
          context,
          session,
        });
      }
      return refreshedCounts;
    });
    await recordSyncRun(connection, { ...run, outcome: SYNC_OUTCOMES.SUCCESS, accounts: counts });
    return {
      connection: connectionView(connection),
      accounts: counts,
      outcome: SYNC_OUTCOMES.SUCCESS,
      statusChanged: before !== after,
    };
  } finally {
    await releaseSyncLock(connection);
  }
}

export async function syncWorkspaceConnection(workspace, actor, connectionId, context) {
  const connection = await loadConnection(workspace._id, connectionId);
  return syncConnection(connection, {
    actor,
    manual: true,
    trigger: SYNC_TRIGGERS.MANUAL,
    context,
  });
}

/** Status to report after a failed sync: re-read when the login changed during the sync. */
async function currentStatus(connection, err) {
  if (!err?.details?.superseded) return effectiveStatus(connection).status;
  const fresh = await SocialConnection.findById(connection._id);
  return fresh ? effectiveStatus(fresh).status : null;
}

const SKIP_FOR_ERROR = {
  [ERROR_CODES.META_NOT_CONFIGURED]: SYNC_SKIP_REASONS.CONFIG_REQUIRED,
  [ERROR_CODES.SYNC_IN_PROGRESS]: SYNC_SKIP_REASONS.IN_PROGRESS,
  [ERROR_CODES.META_RECONNECT_REQUIRED]: SYNC_SKIP_REASONS.NEEDS_RECONNECT,
};

/**
 * Synchronizes several (by default all) connections of a workspace, one after another so
 * Meta's rate limits are respected. One failure never stops the others; every connection gets
 * an entry: `outcome` when Meta was contacted, `skipReason` when it was not.
 */
export async function syncWorkspaceConnections(
  workspace,
  actor,
  { connectionIds, trigger = SYNC_TRIGGERS.BULK } = {},
  context,
) {
  const filter = { workspace: workspace._id };
  if (connectionIds) filter._id = { $in: connectionIds };
  const connections = await SocialConnection.find(filter)
    .select('+accessToken')
    .sort({ createdAt: 1 });
  if (connectionIds && connections.length !== new Set(connectionIds.map(String)).size) {
    throw notFound('Connection not found');
  }

  const results = [];
  for (const connection of connections) {
    const base = {
      connectionId: String(connection._id),
      displayName: connection.displayName ?? null,
      provider: connection.provider,
    };
    try {
      const result = await syncConnection(connection, { actor, manual: true, trigger, context });
      results.push({
        ...base,
        outcome: result.outcome,
        status: result.connection.status,
        accounts: result.accounts,
        message: result.outcome === SYNC_OUTCOMES.SUCCESS ? null : result.connection.statusReason,
      });
    } catch (err) {
      const skipReason = err?.details?.superseded
        ? SYNC_SKIP_REASONS.SUPERSEDED
        : SKIP_FOR_ERROR[err?.code];
      const metaKind = err?.details?.meta?.kind;
      const known = err instanceof AppError;
      if (!known) {
        logger.error(
          { err, connectionId: base.connectionId },
          'Unexpected error while syncing a connection',
        );
      }
      results.push({
        ...base,
        ...(skipReason
          ? { skipReason }
          : { outcome: OUTCOME_FOR_KIND[metaKind] ?? SYNC_OUTCOMES.FAILED }),
        status: await currentStatus(connection, err),
        accounts: { refreshed: 0, lost: 0 },
        message: known ? err.message : 'Synchronization failed unexpectedly.',
      });
    }
  }

  const summary = {
    total: results.length,
    succeeded: results.filter((r) => r.outcome === SYNC_OUTCOMES.SUCCESS).length,
    failed: results.filter((r) => r.outcome && r.outcome !== SYNC_OUTCOMES.SUCCESS).length,
    skipped: results.filter((r) => r.skipReason).length,
  };
  return { results, summary };
}

/**
 * Refreshes destinations by synchronizing each distinct parent connection once (Meta has no
 * per-Page refresh that also reports Page roles). Results are reported per account.
 */
export async function refreshAccounts(workspace, actor, accountIds, context) {
  const unique = [...new Set(accountIds.map(String))];
  const accounts = await SocialAccount.find({
    _id: { $in: unique },
    workspace: workspace._id,
  }).select('_id name connection');
  if (accounts.length !== unique.length) throw notFound('Social account not found');
  const connectionIds = [...new Set(accounts.map((a) => String(a.connection)))];
  const existing = await SocialConnection.find({
    _id: { $in: connectionIds },
    workspace: workspace._id,
  }).select('_id');
  const existingIds = new Set(existing.map((c) => String(c._id)));
  const sync = await syncWorkspaceConnections(
    workspace,
    actor,
    { connectionIds: [...existingIds], trigger: SYNC_TRIGGERS.BULK },
    context,
  );
  const byConnection = new Map(sync.results.map((r) => [r.connectionId, r]));
  const results = accounts.map((a) => {
    const r = byConnection.get(String(a.connection));
    return {
      accountId: String(a._id),
      name: a.name,
      connectionId: String(a.connection),
      ...(r
        ? { outcome: r.outcome, skipReason: r.skipReason, message: r.message }
        : { skipReason: SYNC_SKIP_REASONS.NEEDS_RECONNECT, message: STATUS_REASONS.ACCOUNT_LOST }),
    };
  });
  return { results, connections: sync.results, summary: sync.summary };
}

/* ------------------------------------------------------------ disconnect / remove */

/**
 * Revokes SocialHub's authorization at Meta, but only when no other workspace still relies
 * on the same identity — revoking is global to the person, not per workspace.
 */
export async function revokeAtMetaIfUnused(connection, token) {
  if (
    !token ||
    connection.provider !== SOCIAL_PROVIDERS.FACEBOOK_LOGIN ||
    !facebook.isFacebookConfigured()
  ) {
    return false;
  }
  const stillUsed = await SocialConnection.exists({
    _id: { $ne: connection._id },
    provider: connection.provider,
    externalUserId: connection.externalUserId,
    status: { $nin: [CONNECTION_STATUS.DISCONNECTED, CONNECTION_STATUS.REVOKED] },
  });
  if (stillUsed) return false;
  try {
    await facebook.revokeAppAuthorization(token);
    return true;
  } catch (err) {
    logger.warn(
      { connectionId: String(connection._id), meta: err?.toLog?.() },
      'Could not revoke app authorization at Meta',
    );
    return false;
  }
}

async function wipeConnection(connection, { status, reason, actor, action, context, metadata }) {
  await runInTransaction(async (session) => {
    connection.set({
      status,
      statusReason: reason,
      disconnectedAt: new Date(),
      accessToken: undefined,
    });
    await connection.save({ session });
    await SocialAccount.updateMany(
      { connection: connection._id },
      {
        $set: {
          connectionStatus: status,
          connectionStatusReason: reason,
          publishingStatus: PUBLISHING_STATUS.UNAVAILABLE,
          publishingStatusReason: reason,
        },
        $unset: { accessToken: 1 },
      },
      { session },
    );
    await recordActivity({
      workspace: connection.workspace,
      actor,
      action,
      target: { type: 'social_connection', id: connection._id, label: connection.displayName },
      metadata,
      context,
      session,
    });
  });
}

/** Stops using a connection: tokens are erased, destinations kept (marked disconnected). */
export async function disconnectConnection(workspace, actor, connectionId, context) {
  const connection = await loadConnection(workspace._id, connectionId);
  if (connection.status === CONNECTION_STATUS.DISCONNECTED) {
    return { connection: connectionView(connection), revokedAtMeta: false };
  }
  const token = connection.hasAccessToken() ? connection.getAccessToken() : null;
  await wipeConnection(connection, {
    status: CONNECTION_STATUS.DISCONNECTED,
    reason: STATUS_REASONS.DISCONNECTED,
    actor,
    action: ACTIVITY_ACTIONS.SOCIAL_CONNECTION_DISCONNECTED,
    context,
    metadata: { provider: connection.provider },
  });
  const revokedAtMeta = await revokeAtMetaIfUnused(connection, token);
  return { connection: connectionView(connection), revokedAtMeta };
}

/** Marks every connection of an identity revoked (Meta deauthorize callback). */
export async function revokeConnectionByMeta(connection) {
  await wipeConnection(connection, {
    status: CONNECTION_STATUS.REVOKED,
    reason: STATUS_REASONS.REMOVED_BY_PERSON,
    actor: SYSTEM_ACTORS.META,
    action: ACTIVITY_ACTIONS.SOCIAL_CONNECTION_REVOKED,
    metadata: { provider: connection.provider },
  });
}

async function detachAccounts(workspaceId, accountIds, session) {
  if (accountIds.length === 0) return;
  await SocialAccount.updateMany(
    { workspace: workspaceId, linkedFacebookPage: { $in: accountIds } },
    { $unset: { linkedFacebookPage: 1 } },
    { session },
  );
  await Membership.updateMany(
    { workspace: workspaceId, 'accountAccess.socialAccounts': { $in: accountIds } },
    { $pull: { 'accountAccess.socialAccounts': { $in: accountIds } } },
    { session },
  );
  // Pending invitations must not grant access to accounts that no longer exist.
  await Invitation.updateMany(
    { workspace: workspaceId, 'accountAccess.socialAccounts': { $in: accountIds } },
    { $pull: { 'accountAccess.socialAccounts': { $in: accountIds } } },
    { session },
  );
  // Stars point at the removed records; a destination added again gets a new id.
  await AccountStar.deleteMany(
    { workspace: workspaceId, socialAccount: { $in: accountIds } },
    { session },
  );
  // Insights read for these accounts, and their sync history, go with them (this also runs
  // for Meta's data-deletion callback). Publishing history keeps its own name snapshots.
  for (const Model of [AccountInsight, PostInsight, AnalyticsSyncRun]) {
    await Model.deleteMany(
      { workspace: workspaceId, socialAccount: { $in: accountIds } },
      { session },
    );
  }
}

/** Deletes a connection and every destination obtained through it (and its sync history). */
export async function deleteConnectionAndAccounts(connection, { actor, context, reason }) {
  const accounts = await SocialAccount.find({ connection: connection._id }).select('_id');
  const ids = accounts.map((a) => a._id);
  await runInTransaction(async (session) => {
    await SocialAccount.deleteMany({ connection: connection._id }, { session });
    await detachAccounts(connection.workspace, ids, session);
    await SyncRun.deleteMany({ connection: connection._id }, { session });
    await SocialConnection.deleteOne({ _id: connection._id }, { session });
    await recordActivity({
      workspace: connection.workspace,
      actor,
      action: ACTIVITY_ACTIONS.SOCIAL_CONNECTION_REMOVED,
      target: { type: 'social_connection', id: connection._id, label: connection.displayName },
      metadata: { provider: connection.provider, accountsRemoved: ids.length, reason },
      context,
      session,
    });
  });
  return ids.length;
}

export async function removeConnection(workspace, actor, connectionId, context) {
  const connection = await loadConnection(workspace._id, connectionId);
  const token = connection.hasAccessToken() ? connection.getAccessToken() : null;
  const accountsRemoved = await deleteConnectionAndAccounts(connection, { actor, context });
  const revokedAtMeta = await revokeAtMetaIfUnused(connection, token);
  return { accountsRemoved, revokedAtMeta };
}

/** Removes one destination from the workspace; the connection and other destinations are untouched. */
export async function removeAccount(workspace, actor, accountId, context) {
  const account = await SocialAccount.findOne({ _id: accountId, workspace: workspace._id });
  if (!account) throw notFound('Social account not found');
  await runInTransaction(async (session) => {
    await SocialAccount.deleteOne({ _id: account._id }, { session });
    await detachAccounts(workspace._id, [account._id], session);
    await recordActivity({
      workspace,
      actor,
      action: ACTIVITY_ACTIONS.SOCIAL_ACCOUNT_REMOVED,
      target: { type: 'social_account', id: account._id, label: account.name },
      metadata: { platform: account.platform },
      context,
      session,
    });
  });
}

/**
 * Removes several destinations from the workspace (bulk "disconnect Page"). Every id must
 * belong to the workspace; one that disappears meanwhile (removed by someone else) is skipped.
 */
export async function removeAccounts(workspace, actor, accountIds, context) {
  const unique = [...new Set(accountIds.map(String))];
  const found = await SocialAccount.countDocuments({
    _id: { $in: unique },
    workspace: workspace._id,
  });
  if (found !== unique.length) throw notFound('Social account not found');
  let removed = 0;
  for (const accountId of unique) {
    try {
      await removeAccount(workspace, actor, accountId, context);
      removed += 1;
    } catch (err) {
      if (err?.status !== 404) throw err;
    }
  }
  return { removed };
}
