import mongoose from 'mongoose';
import { ACCOUNT_ACCESS_MODES, SOCIAL_PLATFORMS, hasFullAccountAccess } from '@socialhub/shared';
import { SocialAccount, SocialConnection } from '../../models/index.js';
import { accountHealth, connectionView } from '../meta/connectionHealth.js';

/**
 * Mongo filter selecting the destinations a member may see/use in their workspace.
 * This is the single enforcement point for workspace-specific account access; the account
 * management screens, the composer and the publishing engine must build their queries from it.
 *
 * OWNER/ADMIN see everything. Everyone else sees every account only with an explicit
 * mode ALL; any other value (including a missing setting) means "only the listed accounts".
 *
 * NOTE: when combining with another `_id` condition use `$and`, never object spread, or the
 * `_id: { $in: … }` restriction would be overwritten.
 */
export function accessibleAccountFilter(membership) {
  const filter = { workspace: membership.workspace._id ?? membership.workspace };
  if (hasFullAccountAccess(membership.role)) return filter;
  if (membership.accountAccess?.mode === ACCOUNT_ACCESS_MODES.ALL) return filter;
  return { ...filter, _id: { $in: membership.accountAccess?.socialAccounts ?? [] } };
}

export async function canAccessAccount(membership, socialAccountId) {
  if (!mongoose.isValidObjectId(socialAccountId)) return false;
  return Boolean(
    await SocialAccount.exists({
      $and: [accessibleAccountFilter(membership), { _id: socialAccountId }],
    }),
  );
}

export async function listAccessibleAccounts(membership, { platform } = {}) {
  const filter = accessibleAccountFilter(membership);
  if (platform) filter.platform = platform;
  const accounts = await SocialAccount.find(filter)
    .sort({ platform: 1, name: 1 })
    .populate('connection', 'provider displayName status tokenExpiresAt dataAccessExpiresAt');
  return accounts.map((a) => a.toJSON());
}

/** Fields of the parent connection that account views and health rules need (no tokens). */
export const CONNECTION_SUMMARY_FIELDS =
  'workspace provider displayName pictureUrl status statusReason grantedScopes tokenExpiresAt dataAccessExpiresAt lastSyncedAt lastSyncAttemptAt lastSyncOutcome';

/**
 * OAuth identities with health, permission coverage and how many destinations each provides
 * (and how many of those need attention). Tokens are never selected.
 */
export async function listConnections(workspaceId, { now = new Date() } = {}) {
  const [connections, accounts] = await Promise.all([
    SocialConnection.find({ workspace: workspaceId })
      .sort({ createdAt: 1 })
      .populate('connectedBy', 'name'),
    SocialAccount.find({ workspace: workspaceId }).select(
      'connection platform connectionStatus tasks',
    ),
  ]);
  const byId = new Map(connections.map((c) => [String(c._id), c]));
  const counts = new Map();
  for (const account of accounts) {
    const key = String(account.connection);
    const entry = counts.get(key) ?? { facebookPages: 0, instagramAccounts: 0, needsAttention: 0 };
    if (account.platform === SOCIAL_PLATFORMS.FACEBOOK_PAGE) entry.facebookPages += 1;
    else entry.instagramAccounts += 1;
    if (accountHealth(account, byId.get(key), now).needsAttention) entry.needsAttention += 1;
    counts.set(key, entry);
  }
  return connections.map((c) => {
    const accountCounts = counts.get(String(c._id)) ?? {
      facebookPages: 0,
      instagramAccounts: 0,
      needsAttention: 0,
    };
    return connectionView(c, {
      accountCount: accountCounts.facebookPages + accountCounts.instagramAccounts,
      accountCounts,
      now,
    });
  });
}

/** Ensures every id belongs to the workspace; returns the de-duplicated ObjectIds. */
export async function resolveWorkspaceAccountIds(workspaceId, ids) {
  const unique = [...new Set(ids.map(String))];
  if (unique.length === 0) return [];
  const found = await SocialAccount.countDocuments({
    workspace: workspaceId,
    _id: { $in: unique },
  });
  if (found !== unique.length) return null;
  return unique.map((id) => new mongoose.Types.ObjectId(id));
}

export async function workspaceAccountIds(workspaceId, session = null) {
  return SocialAccount.find({ workspace: workspaceId }).session(session).distinct('_id');
}

/**
 * Applies an incremental change to a member's account access.
 *  - SELECTED: add/remove ids in the list.
 *  - ALL + add: nothing to do (already has every account).
 *  - ALL + remove: becomes SELECTED with every current workspace account except the removed
 *    ones, so revoking one account never silently revokes the others.
 * Returns `{ mode, socialAccounts: ObjectId[], changed }`.
 */
export function applyAccessChange(
  accountAccess,
  { add = [], remove = [] },
  allWorkspaceAccountIds,
) {
  const removeSet = new Set(remove.map(String));
  if (accountAccess?.mode === ACCOUNT_ACCESS_MODES.ALL) {
    if (removeSet.size === 0) {
      return { mode: ACCOUNT_ACCESS_MODES.ALL, socialAccounts: [], changed: false };
    }
    const kept = allWorkspaceAccountIds.filter((id) => !removeSet.has(String(id)));
    return {
      mode: ACCOUNT_ACCESS_MODES.SELECTED,
      socialAccounts: kept.map((id) => new mongoose.Types.ObjectId(String(id))),
      changed: true,
    };
  }
  const before = new Set((accountAccess?.socialAccounts ?? []).map(String));
  const after = new Set(before);
  for (const id of add) after.add(String(id));
  for (const id of removeSet) after.delete(id);
  const changed = after.size !== before.size || [...after].some((id) => !before.has(id));
  return {
    mode: ACCOUNT_ACCESS_MODES.SELECTED,
    socialAccounts: [...after].map((id) => new mongoose.Types.ObjectId(id)),
    changed,
  };
}
