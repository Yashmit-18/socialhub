import mongoose from 'mongoose';
import {
  CANCELLABLE_DESTINATION_STATES,
  CONNECTION_STATUS,
  CONTENT_PACKAGE_STATUS,
  DESTINATION_STATES,
  MEDIA_STATUS,
  PERMISSIONS,
  PUBLISHING_API_ERRORS,
  PUBLISHING_LIMITS,
  PUBLISHING_MODES,
  PUBLISHING_STATUS,
  PUBLISH_ACTIVITY_ACTIONS,
  PUBLISH_JOB_ORDERS,
  PUBLISH_JOB_STATUS,
  QUEUE_STATUS,
  UNCERTAIN_PUBLISH_ERROR_CODES,
  deriveJobStatus,
  emptyDestinationCounts,
  hasPermission,
  publishIssues,
} from '@socialhub/shared';
import { logger } from '../../config/logger.js';
import { sha256 } from '../../lib/crypto.js';
import { runInTransaction } from '../../db/mongoose.js';
import {
  AppError,
  conflict,
  isDuplicateKeyError,
  notFound,
  validationError,
} from '../../lib/errors.js';
import {
  ContentPackage,
  MediaAsset,
  PublishDestination,
  PublishJob,
  SocialAccount,
} from '../../models/index.js';
import { getPublishQueue, publishQueueStatus } from '../../queue/publishQueue.js';
import { getStorage } from '../../storage/index.js';
import { recordActivity } from '../activity/activity.service.js';
import {
  hiddenJobIds,
  jobIsVisible,
  restrictedAccountIds,
  targetsAreVisible,
} from '../contentPackages/contentAccess.js';
import { accessibleAccountFilter } from '../socialAccounts/socialAccount.service.js';
import { enqueueDestination, syncJob } from './publishing.processor.js';
import { publishingSettings } from './publishing.settings.js';

/**
 * Publishing jobs (docs/PUBLISHING_API.md).
 *
 * Rules:
 *  - Every query is scoped to the workspace.
 *  - A job can only target accounts its author may use (accessibleAccountFilter); unknown,
 *    other-workspace and not-assigned ids all get the same answer, so ids cannot be probed.
 *  - Visibility follows the draft rule (contentPackages/contentAccess.js): a member whose
 *    account access is restricted sees a job only if they may use every account it targets.
 *    Other jobs are left out of lists and counts and answer 404, like an unknown id. A job can
 *    only be created from a draft the member may see.
 *  - Nothing is created unless the queue is reachable, and the same request sent twice
 *    (same idempotency key) returns the same job.
 *  - No access token is ever read here: only the worker does that, when it publishes.
 */

const D = DESTINATION_STATES;
const CAPTION_PREVIEW = 280;

const disabledError = () =>
  new AppError(
    503,
    PUBLISHING_API_ERRORS.PUBLISHING_DISABLED,
    'Publishing is switched off on this server.',
  );

const QUEUE_MESSAGES = {
  [QUEUE_STATUS.NOT_CONFIGURED]:
    'The publishing queue has not been set up on this server yet (REDIS_URL is not set).',
  [QUEUE_STATUS.CONNECTING]: 'The publishing queue is still connecting. Try again in a moment.',
  [QUEUE_STATUS.UNAVAILABLE]:
    'The publishing queue (Redis) cannot be reached right now. Nothing was sent. Try again in a moment.',
};

const queueError = (status) =>
  new AppError(503, PUBLISHING_API_ERRORS.QUEUE_UNAVAILABLE, QUEUE_MESSAGES[status], {
    queueStatus: status,
  });

/** Throws unless a job could be queued right now. */
function assertCanQueue() {
  if (publishingSettings().mode === PUBLISHING_MODES.DISABLED) throw disabledError();
  const status = publishQueueStatus();
  if (status !== QUEUE_STATUS.READY) throw queueError(status);
}

const idsOf = (list) => list.map(String);

/** Of `accountIds`: those the member may use, and those that no longer exist. */
async function accountVisibility(workspace, membership, accountIds) {
  if (accountIds.length === 0) return { accessible: new Set(), existing: new Set() };
  const [accessible, existing] = await Promise.all([
    SocialAccount.find({
      $and: [accessibleAccountFilter(membership), { _id: { $in: accountIds } }],
    }).select('_id'),
    SocialAccount.find({ workspace: workspace._id, _id: { $in: accountIds } }).select('_id'),
  ]);
  return {
    accessible: new Set(accessible.map((row) => String(row._id))),
    existing: new Set(existing.map((row) => String(row._id))),
  };
}

function destinationView(destination, job, canAct) {
  const simulated = job.mode === PUBLISHING_MODES.SIMULATED;
  const error = destination.error
    ? {
        code: destination.error.code,
        message: destination.error.message,
        retryable: Boolean(destination.error.retryable),
        uncertain: UNCERTAIN_PUBLISH_ERROR_CODES.includes(destination.error.code),
        at: destination.error.at,
      }
    : null;
  return {
    id: String(destination._id),
    socialAccountId: String(destination.socialAccount),
    platform: destination.platform,
    accountName: destination.accountName,
    accountUsername: destination.accountUsername ?? null,
    state: destination.state,
    simulated,
    attemptCount: destination.attemptCount,
    maxAttempts: destination.maxAttempts,
    scheduledAt: destination.scheduledAt ?? null,
    nextAttemptAt: destination.nextAttemptAt ?? null,
    queuedAt: destination.queuedAt ?? null,
    processingAt: destination.processingAt ?? null,
    completedAt: destination.completedAt ?? null,
    // Never present for a simulated destination: no post exists.
    externalPostId: simulated ? null : (destination.externalPostId ?? null),
    externalUrl: simulated ? null : (destination.externalUrl ?? null),
    error: destination.state === D.PUBLISHED ? null : error,
    warnings: [...(destination.warnings ?? [])],
    attempts: (destination.attempts ?? []).map((attempt) => ({
      number: attempt.number,
      startedAt: attempt.startedAt,
      finishedAt: attempt.finishedAt ?? null,
      outcome: attempt.outcome ?? null,
      errorCode: attempt.errorCode ?? null,
      errorMessage: attempt.errorMessage ?? null,
    })),
    canRetry: canAct && destination.state === D.FAILED,
    canCancel: canAct && CANCELLABLE_DESTINATION_STATES.includes(destination.state),
  };
}

function jobView(job, destinations, visibility, membership) {
  const canAct = hasPermission(membership.role, PERMISSIONS.CONTENT_PUBLISH);
  const visible = destinations.filter((d) => {
    const id = String(d.socialAccount);
    // Accounts that were removed from the workspace no longer restrict anyone.
    return visibility.accessible.has(id) || !visibility.existing.has(id);
  });
  const hidden = destinations.length - visible.length;
  const content = job.content.toObject?.() ?? job.content;
  const captions = [content.caption, ...Object.values(content.platformCaptions ?? {})].filter(
    (value) => typeof value === 'string' && value.trim(),
  );
  const creator = job.createdBy?._id
    ? { id: String(job.createdBy._id), name: job.createdBy.name }
    : null;
  return {
    id: String(job._id),
    status: job.status,
    mode: job.mode,
    simulated: job.mode === PUBLISHING_MODES.SIMULATED,
    contentPackageId: String(job.contentPackage),
    content: {
      captionPreview: [...(captions[0] ?? '').trim()].slice(0, CAPTION_PREVIEW).join(''),
      mediaCount: content.media.length,
      hasVideo: content.media.some((m) => m.kind === 'VIDEO'),
    },
    counts: { ...emptyDestinationCounts(), ...(job.counts ?? {}) },
    destinationCount: job.destinationCount,
    hiddenDestinationCount: hidden,
    scheduledAt: job.scheduledAt ?? null,
    createdBy: creator,
    createdAt: job.createdAt,
    startedAt: job.startedAt ?? null,
    completedAt: job.completedAt ?? null,
    // Cancelling the whole job needs access to every account it targets.
    canCancel:
      canAct &&
      hidden === 0 &&
      visible.some((d) => CANCELLABLE_DESTINATION_STATES.includes(d.state)),
    // Only accounts still waiting for their scheduled time can be moved to another time.
    canReschedule: canAct && hidden === 0 && visible.some((d) => d.state === D.SCHEDULED),
    destinations: visible.map((d) => destinationView(d, job, canAct)),
  };
}

async function present(workspace, membership, jobs) {
  if (jobs.length === 0) return [];
  const destinations = await PublishDestination.find({
    workspace: workspace._id,
    job: { $in: jobs.map((job) => job._id) },
  }).sort({ platform: 1, accountName: 1, _id: 1 });
  const visibility = await accountVisibility(workspace, membership, [
    ...new Set(destinations.map((d) => String(d.socialAccount))),
  ]);
  const byJob = new Map();
  for (const destination of destinations) {
    const key = String(destination.job);
    if (!byJob.has(key)) byJob.set(key, []);
    byJob.get(key).push(destination);
  }
  return jobs.map((job) => jobView(job, byJob.get(String(job._id)) ?? [], visibility, membership));
}

const withCreator = (query) => query.populate('createdBy', 'name');

/** A job the member may see. Unknown, other-workspace and hidden jobs all look the same. */
async function loadJob(workspace, membership, jobId) {
  const job = mongoose.isValidObjectId(jobId)
    ? await withCreator(PublishJob.findOne({ _id: jobId, workspace: workspace._id }))
    : null;
  if (!job || !(await jobIsVisible(workspace, membership, job._id))) {
    throw notFound('Publishing job not found');
  }
  return job;
}

async function presentOne(workspace, membership, jobId) {
  const [publishJob] = await present(workspace, membership, [
    await loadJob(workspace, membership, jobId),
  ]);
  return publishJob;
}

/* ------------------------------------------------------------------ status */

/**
 * What a member needs to know about publishing on this server. Deliberately NOT included:
 * server-wide queue counts and worker numbers (they would reveal other workspaces' activity)
 * or the storage driver. Those are for the operator, on /api/v1/health/details. A workspace's
 * own figures are on GET /publish-jobs/summary, limited to the jobs the member may see.
 */
export async function getStatus() {
  const settings = publishingSettings();
  const queue = getPublishQueue();
  const queueStatus = publishQueueStatus();
  let workerCount = null;
  if (queue && queueStatus === QUEUE_STATUS.READY) {
    workerCount = await queue.workerCount().catch(() => null);
  }
  const disabled = settings.mode === PUBLISHING_MODES.DISABLED;
  const reason = disabled
    ? PUBLISHING_API_ERRORS.PUBLISHING_DISABLED
    : queueStatus !== QUEUE_STATUS.READY
      ? PUBLISHING_API_ERRORS.QUEUE_UNAVAILABLE
      : null;
  const storage = getStorage();
  return {
    mode: settings.mode,
    canPublish: reason === null,
    reason,
    message: disabled
      ? 'Publishing is switched off on this server.'
      : (QUEUE_MESSAGES[queueStatus] ?? null),
    queue: { status: queueStatus },
    // Whether posts would be picked up now, not how many workers exist.
    worker: {
      status: workerCount === null ? 'UNKNOWN' : workerCount > 0 ? 'RUNNING' : 'NOT_RUNNING',
    },
    // Whether Meta could fetch stored media. Local storage cannot be reached by Meta.
    storage: { publicUrls: Boolean(storage?.publicUrls) },
  };
}

/* ------------------------------------------------------------------ create */

/** Why `scheduledAt` cannot be used, or null when it can. */
function scheduleProblem(scheduledAt, now) {
  const latest = now.getTime() + PUBLISHING_LIMITS.SCHEDULE_MAX_DAYS * 24 * 60 * 60 * 1000;
  if (!Number.isFinite(scheduledAt.getTime())) return 'Choose a valid date and time';
  if (scheduledAt.getTime() <= now.getTime()) return 'Choose a time in the future';
  if (scheduledAt.getTime() > latest) {
    return `Posts can be scheduled at most ${PUBLISHING_LIMITS.SCHEDULE_MAX_DAYS} days ahead`;
  }
  return null;
}

function fingerprint(input, accountIds) {
  return sha256(
    JSON.stringify({
      p: input.contentPackageId.toLowerCase(),
      a: [...accountIds].sort(),
      s: input.scheduledAt ? new Date(input.scheduledAt).toISOString() : null,
      r: Boolean(input.republish),
    }),
  );
}

export async function createJob(
  workspace,
  membership,
  actor,
  input,
  context,
  { now = new Date() } = {},
) {
  const idempotent = {
    workspace: workspace._id,
    createdBy: actor._id,
    idempotencyKey: input.idempotencyKey,
  };
  const replay = async (existing) => {
    const requested = input.socialAccountIds
      ? idsOf(input.socialAccountIds).map((id) => id.toLowerCase())
      : null;
    // A key always stands for one request. `null` accounts = "the draft's own accounts".
    const same =
      String(existing.contentPackage) === input.contentPackageId.toLowerCase() &&
      (requested === null || existing.requestHash === fingerprint(input, requested));
    if (!same) {
      throw conflict('This request was already used for a different post. Start again.', {
        reason: 'IDEMPOTENCY_KEY_REUSED',
      });
    }
    return { publishJob: await presentOne(workspace, membership, existing._id), created: false };
  };

  // A repeated request gets its job back even if publishing has since become unavailable.
  const existing = await PublishJob.findOne(idempotent);
  if (existing) return replay(existing);

  assertCanQueue();
  const settings = publishingSettings();

  const pkg = mongoose.isValidObjectId(input.contentPackageId)
    ? await ContentPackage.findOne({
        _id: input.contentPackageId,
        workspace: workspace._id,
        status: CONTENT_PACKAGE_STATUS.DRAFT,
      })
    : null;
  // A draft the member may not see cannot be published by them either, whichever accounts
  // they ask for: the same 404 as an unknown draft.
  if (!pkg || !targetsAreVisible(await restrictedAccountIds(membership), pkg.targetAccounts)) {
    throw notFound('Draft not found');
  }

  const fields = {};
  // Without an explicit list: the draft's accounts that still exist. One removed from the
  // workspace since is left out, as the draft view leaves it out, instead of failing the request.
  const requested =
    input.socialAccountIds ??
    (await SocialAccount.distinct('_id', {
      workspace: workspace._id,
      _id: { $in: pkg.targetAccounts },
    }));
  const accountIds = [...new Set(requested.map((id) => String(id).toLowerCase()))];
  if (accountIds.length === 0) {
    throw validationError({ fields: { socialAccountIds: 'Select at least one account' } });
  }
  if (accountIds.length > PUBLISHING_LIMITS.DESTINATIONS_MAX) {
    throw validationError({
      fields: {
        socialAccountIds: `Publish to at most ${PUBLISHING_LIMITS.DESTINATIONS_MAX} accounts at once`,
      },
    });
  }
  // The single enforcement point for account access. Accounts outside it are never loaded.
  const accounts = await SocialAccount.find({
    $and: [accessibleAccountFilter(membership), { _id: { $in: accountIds } }],
  }).select('platform name username connectionStatus publishingStatus');
  if (accounts.length !== accountIds.length) {
    throw validationError({
      fields: {
        socialAccountIds:
          'One or more selected accounts are not available to you in this workspace',
      },
    });
  }
  const notReady = accounts.filter(
    (a) =>
      a.connectionStatus !== CONNECTION_STATUS.ACTIVE ||
      a.publishingStatus !== PUBLISHING_STATUS.READY,
  );
  if (notReady.length) {
    fields.socialAccountIds = `These accounts cannot receive posts right now: ${notReady.map((a) => a.name).join(', ')}`;
  }

  const assets = pkg.media.length
    ? await MediaAsset.find({
        _id: { $in: pkg.media.map((m) => m.media) },
        workspace: workspace._id,
        status: MEDIA_STATUS.READY,
      }).select('kind storageKey storageDriver')
    : [];
  const assetById = new Map(assets.map((asset) => [String(asset._id), asset]));
  const media = pkg.media.map((entry) => ({
    media: entry.media,
    kind: assetById.get(String(entry.media))?.kind,
    altText: entry.altText,
  }));
  const content = {
    caption: pkg.caption,
    platformCaptions: pkg.platformCaptions?.toObject?.() ?? {},
    hashtags: [...pkg.hashtags],
    hashtagPlacement: pkg.hashtagPlacement,
    firstComment: pkg.firstComment,
    media,
  };
  if (media.some((m) => !m.kind)) {
    fields.content =
      'One or more files of this draft are missing or were not uploaded successfully';
  } else {
    const issues = [...new Set(accounts.map((a) => a.platform))].flatMap((platform) =>
      publishIssues(content, platform),
    );
    if (issues.length) fields.content = [...new Set(issues)].join(' ');
  }
  // Real publishing: Meta must be able to download every file over public HTTPS.
  if (!fields.content && settings.mode === PUBLISHING_MODES.LIVE && media.length) {
    const storage = getStorage();
    const reachable =
      storage?.publicUrls &&
      assets.every(
        (asset) =>
          asset.storageDriver === storage.name &&
          storage.publicUrl(asset.storageKey).startsWith('https://'),
      );
    if (!reachable) {
      fields.content =
        'The files of this post are stored on this server only, so Facebook and Instagram cannot fetch them. Public HTTPS media storage is needed to publish.';
    }
  }

  let scheduledAt = null;
  if (input.scheduledAt) {
    scheduledAt = new Date(input.scheduledAt);
    const problem = scheduleProblem(scheduledAt, now);
    if (problem) fields.scheduledAt = problem;
  }
  if (Object.keys(fields).length) throw validationError({ fields });

  // Duplicate prevention across jobs (the unique index below is the final guard).
  const names = (rows) => {
    const byId = new Map(accounts.map((a) => [String(a._id), a.name]));
    return [...new Set(rows.map((row) => byId.get(String(row.socialAccount))))];
  };
  const inProgress = await PublishDestination.find({
    contentPackage: pkg._id,
    socialAccount: { $in: accountIds },
    active: true,
  }).select('socialAccount');
  if (inProgress.length) {
    throw conflict('This post is already on its way to one or more of these accounts.', {
      reason: 'IN_PROGRESS',
      accounts: names(inProgress),
    });
  }
  if (!input.republish) {
    const published = await PublishDestination.find({
      contentPackage: pkg._id,
      socialAccount: { $in: accountIds },
      state: D.PUBLISHED,
    }).select('socialAccount');
    if (published.length) {
      throw conflict('This post was already published to one or more of these accounts.', {
        reason: 'ALREADY_PUBLISHED',
        accounts: names(published),
      });
    }
  }

  const state = scheduledAt ? D.SCHEDULED : D.QUEUED;
  const counts = { ...emptyDestinationCounts(), [state]: accounts.length };
  const jobId = new mongoose.Types.ObjectId();
  const destinationDocs = accounts.map((account) => ({
    workspace: workspace._id,
    job: jobId,
    contentPackage: pkg._id,
    socialAccount: account._id,
    platform: account.platform,
    accountName: account.name,
    accountUsername: account.username,
    state,
    active: true,
    simulated: settings.mode === PUBLISHING_MODES.SIMULATED,
    maxAttempts: settings.maxAttempts,
    queueSeq: 1,
    scheduledAt: scheduledAt ?? undefined,
    dueAt: scheduledAt ?? now,
    queuedAt: now,
    // Checked again just before sending (publishing.processor.js, assertStillAuthorized).
    authorizedBy: actor._id,
  }));

  let destinations;
  try {
    destinations = await runInTransaction(async (session) => {
      await PublishJob.create(
        [
          {
            _id: jobId,
            workspace: workspace._id,
            contentPackage: pkg._id,
            contentVersion: pkg.version,
            content,
            // Who the job is hidden from follows the draft it came from (contentAccess.js).
            draftTargetAccounts: pkg.targetAccounts,
            mode: settings.mode,
            status: deriveJobStatus(counts),
            counts,
            destinationCount: accounts.length,
            idempotencyKey: input.idempotencyKey,
            requestHash: fingerprint(input, accountIds),
            scheduledAt: scheduledAt ?? undefined,
            createdBy: actor._id,
          },
        ],
        { session },
      );
      const created = await PublishDestination.create(destinationDocs, { session, ordered: true });
      await recordActivity({
        workspace,
        actor,
        action: PUBLISH_ACTIVITY_ACTIONS.JOB_CREATED,
        target: { type: 'publish_job', id: jobId },
        metadata: {
          accountCount: accounts.length,
          simulated: settings.mode === PUBLISHING_MODES.SIMULATED,
          scheduled: Boolean(scheduledAt),
        },
        context,
        session,
      });
      return created;
    });
  } catch (err) {
    // Without transactions a half-written job must not stay behind.
    await PublishDestination.deleteMany({ job: jobId }).catch(() => {});
    await PublishJob.deleteOne({ _id: jobId }).catch(() => {});
    if (!isDuplicateKeyError(err)) throw err;
    // Two identical requests raced: the other one created the job.
    const winner = await PublishJob.findOne(idempotent);
    if (winner) return replay(winner);
    throw conflict('This post is already on its way to one or more of these accounts.', {
      reason: 'IN_PROGRESS',
    });
  }

  // The job is recorded. If Redis drops right now, the recovery sweep queues it later.
  for (const destination of destinations) await enqueueDestination(destination, { now });
  return { publishJob: await presentOne(workspace, membership, jobId), created: true };
}

/* ------------------------------------------------------------------ read */

const badCursor = () => validationError({ fields: { cursor: 'This page link is not valid' } });

function encodeScheduleCursor(job) {
  return Buffer.from(`${job.scheduledAt.getTime()}.${job._id}`).toString('base64url');
}

function decodeScheduleCursor(cursor) {
  const [time, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('.');
  const at = new Date(Number(time));
  if (!Number.isFinite(at.getTime()) || !/^[0-9a-f]{24}$/i.test(id ?? '')) throw badCursor();
  return { at, id: new mongoose.Types.ObjectId(id) };
}

export async function listJobs(workspace, membership, { status, order, cursor, limit }) {
  const filter = { workspace: workspace._id };
  if (status) filter.status = status;
  const idFilter = {};
  const hidden = await hiddenJobIds(workspace, membership);
  if (hidden.length) idFilter.$nin = hidden;

  const bySchedule = order === PUBLISH_JOB_ORDERS.SCHEDULED;
  if (bySchedule) {
    filter.scheduledAt = { $ne: null };
    if (cursor) {
      const { at, id } = decodeScheduleCursor(cursor);
      filter.$or = [{ scheduledAt: { $gt: at } }, { scheduledAt: at, _id: { $gt: id } }];
    }
  } else if (cursor) {
    if (!/^[0-9a-f]{24}$/i.test(cursor)) throw badCursor();
    idFilter.$lt = new mongoose.Types.ObjectId(cursor);
  }
  if (Object.keys(idFilter).length) filter._id = idFilter;

  const rows = await withCreator(
    PublishJob.find(filter)
      .sort(bySchedule ? { scheduledAt: 1, _id: 1 } : { _id: -1 })
      .limit(limit + 1),
  );
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    items: await present(workspace, membership, page),
    nextCursor:
      rows.length > limit ? (bySchedule ? encodeScheduleCursor(last) : String(last._id)) : null,
  };
}

export async function getJob(workspace, membership, jobId) {
  return { publishJob: await presentOne(workspace, membership, jobId) };
}

export async function getSummary(workspace, membership) {
  const hidden = await hiddenJobIds(workspace, membership);
  const rows = await PublishJob.aggregate([
    { $match: { workspace: workspace._id, ...(hidden.length ? { _id: { $nin: hidden } } : {}) } },
    { $group: { _id: '$status', n: { $sum: 1 } } },
  ]);
  const counts = Object.fromEntries(Object.values(PUBLISH_JOB_STATUS).map((s) => [s, 0]));
  for (const row of rows) counts[row._id] = row.n;
  return { counts, total: Object.values(counts).reduce((a, b) => a + b, 0) };
}

/* ------------------------------------------------------------------ cancel / retry */

async function cancelDestinations(job, destinations, actor, now) {
  const cancelled = [];
  for (const destination of destinations) {
    // The state is part of the filter: a destination a worker has just claimed is left alone.
    const updated = await PublishDestination.findOneAndUpdate(
      { _id: destination._id, state: { $in: CANCELLABLE_DESTINATION_STATES } },
      {
        $set: { state: D.CANCELLED, completedAt: now, cancelledBy: actor._id },
        $unset: { active: 1, nextAttemptAt: 1, dueAt: 1, lockToken: 1, lockedUntil: 1 },
      },
      { returnDocument: 'after' },
    );
    if (!updated) continue;
    cancelled.push(updated);
    await getPublishQueue()
      ?.remove({ destinationId: updated._id, seq: updated.queueSeq })
      .catch(() => {});
  }
  if (cancelled.length) await syncJob(job._id, { now });
  return cancelled;
}

export async function cancelJob(
  workspace,
  membership,
  actor,
  jobId,
  context,
  { now = new Date() } = {},
) {
  // Only a job the member may see in full can be cancelled as a whole (loadJob checks it).
  const job = await loadJob(workspace, membership, jobId);
  const destinations = await PublishDestination.find({ job: job._id, workspace: workspace._id });
  const cancelled = await cancelDestinations(job, destinations, actor, now);
  if (cancelled.length === 0) {
    throw conflict('Nothing in this job can be cancelled any more.', { reason: 'NOT_CANCELLABLE' });
  }
  await recordActivity({
    workspace,
    actor,
    action: PUBLISH_ACTIVITY_ACTIONS.JOB_CANCELLED,
    target: { type: 'publish_job', id: job._id },
    metadata: { accountCount: cancelled.length },
    context,
  });
  return getJob(workspace, membership, job._id);
}

/** A destination the member may act on; anything else is "not found". */
async function loadDestination(workspace, membership, job, destinationId) {
  const destination = mongoose.isValidObjectId(destinationId)
    ? await PublishDestination.findOne({
        _id: destinationId,
        job: job._id,
        workspace: workspace._id,
      })
    : null;
  const missing = () => notFound('Publishing destination not found');
  if (!destination) throw missing();
  const id = String(destination.socialAccount);
  const visibility = await accountVisibility(workspace, membership, [id]);
  if (visibility.existing.has(id) && !visibility.accessible.has(id)) throw missing();
  return { destination, accountExists: visibility.existing.has(id) };
}

export async function cancelDestination(
  workspace,
  membership,
  actor,
  jobId,
  destinationId,
  context,
  { now = new Date() } = {},
) {
  const job = await loadJob(workspace, membership, jobId);
  const { destination } = await loadDestination(workspace, membership, job, destinationId);
  const cancelled = await cancelDestinations(job, [destination], actor, now);
  if (cancelled.length === 0) {
    throw conflict('This destination can no longer be cancelled.', { reason: 'NOT_CANCELLABLE' });
  }
  await recordActivity({
    workspace,
    actor,
    action: PUBLISH_ACTIVITY_ACTIONS.DESTINATION_CANCELLED,
    target: { type: 'publish_job', id: job._id, label: destination.accountName },
    metadata: { platform: destination.platform },
    context,
  });
  return getJob(workspace, membership, job._id);
}

export async function retryDestination(
  workspace,
  membership,
  actor,
  jobId,
  destinationId,
  { acknowledgeDuplicateRisk },
  context,
  { now = new Date() } = {},
) {
  const job = await loadJob(workspace, membership, jobId);
  const { destination, accountExists } = await loadDestination(
    workspace,
    membership,
    job,
    destinationId,
  );
  if (destination.state !== D.FAILED) {
    throw conflict('Only a failed destination can be retried.', { reason: 'NOT_FAILED' });
  }
  if (!accountExists) {
    throw conflict('This account was removed from the workspace, so it cannot be retried.', {
      reason: 'ACCOUNT_REMOVED',
    });
  }
  if (
    UNCERTAIN_PUBLISH_ERROR_CODES.includes(destination.error?.code) &&
    !acknowledgeDuplicateRisk
  ) {
    throw conflict(
      'The earlier attempt may already have published this post. Retrying could post it twice.',
      { reason: 'DUPLICATE_RISK' },
    );
  }
  assertCanQueue();
  if (publishingSettings().mode !== job.mode) {
    throw conflict('This job was created in a different publishing mode and cannot be retried.', {
      reason: 'MODE_CHANGED',
    });
  }

  let retried;
  try {
    retried = await PublishDestination.findOneAndUpdate(
      { _id: destination._id, state: D.FAILED },
      {
        $set: {
          state: D.QUEUED,
          active: true,
          queuedAt: now,
          dueAt: now,
          // A manual retry gets a fresh set of automatic attempts.
          maxAttempts: destination.attemptCount + publishingSettings().maxAttempts,
          // The send now relies on the permission of whoever retried it.
          authorizedBy: actor._id,
        },
        $unset: { completedAt: 1, nextAttemptAt: 1, lockToken: 1, lockedUntil: 1, sendingAt: 1 },
        $inc: { queueSeq: 1 },
      },
      { returnDocument: 'after' },
    );
  } catch (err) {
    if (!isDuplicateKeyError(err)) throw err;
    throw conflict('This post is already on its way to this account in another job.', {
      reason: 'IN_PROGRESS',
    });
  }
  // Someone else retried it a moment ago: one retry is enough.
  if (!retried)
    throw conflict('Only a failed destination can be retried.', { reason: 'NOT_FAILED' });

  await syncJob(job._id, { now });
  await enqueueDestination(retried, { now });
  await recordActivity({
    workspace,
    actor,
    action: PUBLISH_ACTIVITY_ACTIONS.DESTINATION_RETRIED,
    target: { type: 'publish_job', id: job._id, label: destination.accountName },
    metadata: { platform: destination.platform, attempt: destination.attemptCount + 1 },
    context,
  }).catch((err) => logger.warn({ err }, 'Could not record a publishing activity entry'));
  return getJob(workspace, membership, job._id);
}

/* ------------------------------------------------------------------ reschedule */

/**
 * Moves the accounts of a job that are still waiting for their scheduled time to a new time.
 * Accounts already being sent, sent, failed or cancelled are not touched. Each move is one
 * atomic update guarded by the state, so a destination a worker has just claimed is left
 * alone; its old queue entry is removed (best effort) and a new one is added. An old entry
 * that survives finds the destination not yet due and does nothing, so the post can never be
 * sent at the old time, nor twice.
 */
export async function rescheduleJob(
  workspace,
  membership,
  actor,
  jobId,
  { scheduledAt: value },
  context,
  { now = new Date() } = {},
) {
  const job = await loadJob(workspace, membership, jobId);
  const scheduledAt = new Date(value);
  const problem = scheduleProblem(scheduledAt, now);
  if (problem) throw validationError({ fields: { scheduledAt: problem } });

  const notReschedulable = () =>
    conflict('This post is no longer waiting for its scheduled time, so its time cannot change.', {
      reason: 'NOT_RESCHEDULABLE',
    });
  const waiting = await PublishDestination.find({
    job: job._id,
    workspace: workspace._id,
    state: D.SCHEDULED,
  });
  if (waiting.length === 0) throw notReschedulable();
  assertCanQueue();
  if (publishingSettings().mode !== job.mode) {
    throw conflict('This job was created in a different publishing mode and cannot be changed.', {
      reason: 'MODE_CHANGED',
    });
  }

  const previous = job.scheduledAt ?? null;
  let moved = 0;
  for (const destination of waiting) {
    const updated = await PublishDestination.findOneAndUpdate(
      { _id: destination._id, state: D.SCHEDULED, queueSeq: destination.queueSeq },
      // The send now relies on the permission of whoever chose the new time.
      { $set: { scheduledAt, dueAt: scheduledAt, authorizedBy: actor._id }, $inc: { queueSeq: 1 } },
      { returnDocument: 'after' },
    );
    if (!updated) continue;
    moved += 1;
    await getPublishQueue()
      ?.remove({ destinationId: destination._id, seq: destination.queueSeq })
      .catch(() => {});
    // If Redis is unreachable right now, the recovery sweep adds the entry once it is due.
    await enqueueDestination(updated, { now });
  }
  if (moved === 0) throw notReschedulable();
  await PublishJob.updateOne({ _id: job._id }, { $set: { scheduledAt } });

  await recordActivity({
    workspace,
    actor,
    action: PUBLISH_ACTIVITY_ACTIONS.JOB_RESCHEDULED,
    target: { type: 'publish_job', id: job._id },
    metadata: {
      accountCount: moved,
      simulated: job.mode === PUBLISHING_MODES.SIMULATED,
      from: previous,
      to: scheduledAt,
    },
    context,
  }).catch((err) => logger.warn({ err }, 'Could not record a publishing activity entry'));
  return getJob(workspace, membership, job._id);
}
