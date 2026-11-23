import { ACCOUNT_ACCESS_MODES, hasFullAccountAccess } from '@socialhub/shared';
import {
  ContentPackage,
  PublishDestination,
  PublishJob,
  SocialAccount,
} from '../../models/index.js';

/**
 * Who may see a piece of content (a draft, or a publishing job made from one).
 *
 * Policy (docs/ARCHITECTURE.md, "Draft visibility"):
 *  - Owners and admins, and members whose account access is "all accounts", see everything.
 *  - Everyone else sees an item only if they may use EVERY account it targets. Content that
 *    targets even one account they cannot use is not shown at all: not its caption, not its
 *    media, not that it exists. The answer is the same as for an id that does not exist.
 *  - Content with no accounts follows the workspace content permissions alone.
 *  - Accounts that were removed from the workspace no longer restrict anyone.
 *
 * Enforced here, on the server, for lists (inside the database query, so pages stay full and
 * counts stay true), details, updates, deletes and publishing. The web app's hiding of
 * controls is a convenience on top, never the protection.
 */

/** True when the member may use every account of the workspace. */
export function hasUnrestrictedAccess(membership) {
  return (
    hasFullAccountAccess(membership.role) ||
    membership.accountAccess?.mode === ACCOUNT_ACCESS_MODES.ALL
  );
}

/**
 * Ids of the workspace accounts the member may NOT use, or null when they may use all of them.
 * Content targeting any of these ids is hidden from the member.
 */
export async function restrictedAccountIds(membership) {
  if (hasUnrestrictedAccess(membership)) return null;
  const workspace = membership.workspace._id ?? membership.workspace;
  const granted = membership.accountAccess?.socialAccounts ?? [];
  const rows = await SocialAccount.find({ workspace, _id: { $nin: granted } })
    .select('_id')
    .lean();
  return rows.map((row) => row._id);
}

/** Whether content targeting `accountIds` is visible, given `restricted` from above. */
export function targetsAreVisible(restricted, accountIds) {
  if (!restricted || restricted.length === 0) return true;
  const blocked = new Set(restricted.map(String));
  return !accountIds.some((id) => blocked.has(String(id)));
}

/*
 * Publishing jobs show their draft's caption and files, so they follow the same rule: a job is
 * hidden when it was sent to an account the member cannot use, OR when its draft targeted one
 * (job.draftTargetAccounts, recorded when the job was made). Jobs made before that field
 * existed use their draft's current accounts instead. One rule for lists, details, cancel,
 * retry, reschedule and analytics, all of which answer 404 for a hidden job.
 */

/** Ids of the workspace's jobs the member may not see (empty when they see every job). */
export async function hiddenJobIds(workspace, membership) {
  const restricted = await restrictedAccountIds(membership);
  if (!restricted?.length) return [];
  const workspaceId = workspace._id ?? workspace;
  const [bySend, byDraft, hiddenDrafts] = await Promise.all([
    PublishDestination.distinct('job', {
      workspace: workspaceId,
      socialAccount: { $in: restricted },
    }),
    PublishJob.distinct('_id', {
      workspace: workspaceId,
      draftTargetAccounts: { $in: restricted },
    }),
    ContentPackage.distinct('_id', { workspace: workspaceId, targetAccounts: { $in: restricted } }),
  ]);
  const older = hiddenDrafts.length
    ? await PublishJob.distinct('_id', {
        workspace: workspaceId,
        draftTargetAccounts: { $exists: false },
        contentPackage: { $in: hiddenDrafts },
      })
    : [];
  const ids = new Map();
  for (const id of [...bySend, ...byDraft, ...older]) ids.set(String(id), id);
  return [...ids.values()];
}

/** Whether the member may see one job (same rule as hiddenJobIds). */
export async function jobIsVisible(workspace, membership, jobId) {
  const restricted = await restrictedAccountIds(membership);
  if (!restricted?.length) return true;
  const workspaceId = workspace._id ?? workspace;
  const job = await PublishJob.findOne({ _id: jobId, workspace: workspaceId })
    .select('draftTargetAccounts contentPackage')
    .lean();
  if (!job) return false;
  const sentToRestricted = await PublishDestination.exists({
    workspace: workspaceId,
    job: job._id,
    socialAccount: { $in: restricted },
  });
  if (sentToRestricted) return false;
  const draftTargets =
    job.draftTargetAccounts ??
    (
      await ContentPackage.findOne({ _id: job.contentPackage, workspace: workspaceId })
        .select('targetAccounts')
        .lean()
    )?.targetAccounts ??
    [];
  return targetsAreVisible(restricted, draftTargets);
}
