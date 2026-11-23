import {
  ACTIVE_JOB_STATUSES,
  CLAIMABLE_DESTINATION_STATES,
  CONNECTION_STATUS,
  DESTINATION_STATES,
  MEDIA_STATUS,
  PERMISSIONS,
  PUBLISHING_MODES,
  PUBLISHING_STATUS,
  PUBLISH_ACTIVITY_ACTIONS,
  PUBLISH_BLOCK_REASONS,
  PUBLISH_ERROR_CODES,
  PUBLISH_JOB_STATUS,
  PUBLISH_WARNINGS,
  SOCIAL_PROVIDERS,
  composeCaption,
  deriveJobStatus,
  effectivePublishingMode,
  emptyDestinationCounts,
  hasPermission,
  mediaIssues,
  publishIssues,
} from '@socialhub/shared';
import { logger } from '../../config/logger.js';
import { randomToken } from '../../lib/crypto.js';
import { facebookSettings, instagramSettings } from '../../integrations/meta/settings.js';
import {
  MediaAsset,
  Membership,
  PublishDestination,
  PublishJob,
  SocialAccount,
  SocialConnection,
  Workspace,
} from '../../models/index.js';
import { getPublishQueue } from '../../queue/publishQueue.js';
import { getStorage } from '../../storage/index.js';
import { recordActivity } from '../activity/activity.service.js';
import { canAccessAccount } from '../socialAccounts/socialAccount.service.js';
import { adapterFor } from './adapters/index.js';
import { retryDelayMs } from './backoff.js';
import { PublishError } from './publishError.js';
import { publishingSettings } from './publishing.settings.js';

/**
 * Processes one destination of a publish job. Called by the queue worker with nothing but a
 * destination id.
 *
 * The destination document decides everything. A worker first CLAIMS it with one atomic
 * update (waiting → PROCESSING, with a private lock token); only the claimant can finish it.
 * So the same queue entry delivered twice, two workers, or a retry racing a cancel can never
 * publish one destination twice.
 */

const D = DESTINATION_STATES;
const E = PUBLISH_ERROR_CODES;
const R = PUBLISH_BLOCK_REASONS;
const J = PUBLISH_JOB_STATUS;

/** How long a claim lasts. A destination still PROCESSING after this was interrupted. */
export const CLAIM_MS = 15 * 60 * 1000;
/** Queue timers are not exact: accept an entry that arrives this much early. */
export const DUE_TOLERANCE_MS = 5000;
/** A waiting destination this far past its time has probably lost its queue entry. */
export const REQUEUE_AFTER_MS = 2 * 60 * 1000;
const ATTEMPT_HISTORY = 20;

const fail = (code, message, options) => new PublishError(code, message, options);

/**
 * Recalculates a job's `counts` and `status` from its destinations. Safe to call from many
 * workers at once: a write only succeeds if nobody else wrote since this caller read, and
 * the caller then starts over, so the last write always reflects the latest destinations.
 */
export async function syncJob(jobId, { now = new Date(), onlyIfChanged = false } = {}) {
  for (let round = 0; round < 8; round += 1) {
    const job = await PublishJob.findById(jobId).select(
      'workspace status counts syncSeq startedAt completedAt destinationCount mode',
    );
    if (!job) return null;
    const rows = await PublishDestination.aggregate([
      { $match: { job: job._id } },
      { $group: { _id: '$state', n: { $sum: 1 } } },
    ]);
    const counts = emptyDestinationCounts();
    for (const row of rows) counts[row._id] = row.n;
    const status = deriveJobStatus(counts);
    // The recovery sweep only repairs jobs whose stored status lags behind.
    if (
      onlyIfChanged &&
      job.status === status &&
      Object.entries(counts).every(([state, n]) => (job.counts?.[state] ?? 0) === n)
    ) {
      return null;
    }
    const finished = !ACTIVE_JOB_STATUSES.includes(status);
    const started =
      counts[D.PROCESSING] + counts[D.RETRY_SCHEDULED] + counts[D.PUBLISHED] + counts[D.FAILED] > 0;

    const $set = { counts, status };
    const $unset = {};
    if (started && !job.startedAt) $set.startedAt = now;
    if (finished) $set.completedAt = job.completedAt ?? now;
    else {
      $unset.completedAt = 1;
      $unset.finishLoggedAt = 1;
    }
    const updated = await PublishJob.findOneAndUpdate(
      { _id: job._id, syncSeq: job.syncSeq },
      { $set, ...(Object.keys($unset).length ? { $unset } : {}), $inc: { syncSeq: 1 } },
      { returnDocument: 'after' },
    );
    if (!updated) continue;

    if (finished) {
      // Written once per completion, whichever worker gets here first.
      const first = await PublishJob.findOneAndUpdate(
        { _id: job._id, finishLoggedAt: null, status },
        { $set: { finishLoggedAt: now } },
      );
      if (first) {
        await recordActivity({
          workspace: job.workspace,
          action: PUBLISH_ACTIVITY_ACTIONS.JOB_FINISHED,
          target: { type: 'publish_job', id: job._id },
          metadata: {
            status,
            simulated: job.mode === PUBLISHING_MODES.SIMULATED,
            published: counts[D.PUBLISHED],
            failed: counts[D.FAILED],
            cancelled: counts[D.CANCELLED],
          },
        }).catch((err) => logger.warn({ err }, 'Could not record a publishing activity entry'));
      }
    }
    return updated;
  }
  logger.warn({ jobId: String(jobId) }, 'Publish job status could not be recalculated');
  return null;
}

/** Adds a queue entry for a waiting destination. Returns false when the queue is down. */
export async function enqueueDestination(destination, { now = new Date() } = {}) {
  const queue = getPublishQueue();
  if (!queue) return false;
  try {
    await queue.enqueue({
      destinationId: destination._id,
      seq: destination.queueSeq,
      delayMs: Math.max(0, (destination.dueAt?.getTime() ?? now.getTime()) - now.getTime()),
    });
    await PublishDestination.updateOne({ _id: destination._id }, { $set: { enqueuedAt: now } });
    return true;
  } catch (err) {
    // The destination stays waiting in MongoDB; the recovery sweep adds the entry later.
    logger.warn(
      { reason: err.message, destinationId: String(destination._id) },
      'Could not add a destination to the publishing queue',
    );
    return false;
  }
}

function attemptRecord(destination, now, outcome, error) {
  return {
    number: destination.attemptCount,
    startedAt: destination.processingAt ?? now,
    finishedAt: now,
    outcome,
    ...(error ? { errorCode: error.code, errorMessage: error.message } : {}),
  };
}

const pushAttempt = (record) => ({
  attempts: { $each: [record], $slice: -ATTEMPT_HISTORY },
});

/** Only the worker holding the claim may finish a destination. */
const held = (destination) => ({
  _id: destination._id,
  state: D.PROCESSING,
  lockToken: destination.lockToken,
});

async function finishPublished(destination, result, warnings, simulated, now) {
  return PublishDestination.findOneAndUpdate(
    held(destination),
    {
      $set: {
        state: D.PUBLISHED,
        completedAt: now,
        simulated,
        warnings,
        // A simulated destination never gets a post id: no post exists.
        ...(simulated || !result.externalPostId
          ? {}
          : {
              externalPostId: result.externalPostId,
              externalUrl: result.externalUrl ?? undefined,
            }),
      },
      $unset: {
        active: 1,
        lockToken: 1,
        lockedUntil: 1,
        sendingAt: 1,
        error: 1,
        nextAttemptAt: 1,
        dueAt: 1,
        providerState: 1,
      },
      $push: pushAttempt(attemptRecord(destination, now, 'PUBLISHED')),
    },
    { returnDocument: 'after' },
  );
}

async function finishFailed(destination, error, now) {
  return PublishDestination.findOneAndUpdate(
    held(destination),
    {
      $set: {
        state: D.FAILED,
        completedAt: now,
        error: {
          code: error.code,
          message: error.message,
          retryable: Boolean(error.retryable),
          at: now,
        },
      },
      $unset: {
        active: 1,
        lockToken: 1,
        lockedUntil: 1,
        sendingAt: 1,
        nextAttemptAt: 1,
        dueAt: 1,
      },
      $push: pushAttempt(attemptRecord(destination, now, 'FAILED', error)),
    },
    { returnDocument: 'after' },
  );
}

async function scheduleRetry(destination, error, now, random) {
  const settings = publishingSettings();
  const delay = Math.max(
    retryDelayMs(destination.attemptCount, {
      baseMs: settings.retryBaseMs,
      maxMs: settings.retryMaxMs,
      random,
    }),
    error.retryAfterMs ?? 0,
  );
  const at = new Date(now.getTime() + delay);
  const updated = await PublishDestination.findOneAndUpdate(
    held(destination),
    {
      $set: {
        state: D.RETRY_SCHEDULED,
        nextAttemptAt: at,
        dueAt: at,
        error: { code: error.code, message: error.message, retryable: true, at: now },
      },
      $unset: { lockToken: 1, lockedUntil: 1, sendingAt: 1 },
      $inc: { queueSeq: 1 },
      $push: pushAttempt(attemptRecord(destination, now, 'RETRY', error)),
    },
    { returnDocument: 'after' },
  );
  if (updated) await enqueueDestination(updated, { now });
  return updated;
}

/**
 * A destination found PROCESSING after its claim ran out: its worker stopped mid-way.
 * Returns 'restarted', 'interrupted' or null (someone else dealt with it).
 *
 *  - Never handed to the platform (no `sendingAt`): nothing was sent, so it is queued again,
 *    or fails plainly once its automatic attempts are used up.
 *  - Handed over: the post may already exist, so it is marked INTERRUPTED ("may have been
 *    published") and only a person can retry it. Never automatically.
 *
 * Both are single updates guarded on the state, the expired claim and `sendingAt`. A worker
 * marking the send concurrently is guarded by its lock token, which the winning update clears,
 * so a send can never start behind a restart.
 */
async function markInterrupted(destination, now) {
  const stale = { _id: destination._id, state: D.PROCESSING, lockedUntil: { $lt: now } };
  const attempt = (outcome, code, message) =>
    pushAttempt({
      number: destination.attemptCount,
      startedAt: destination.processingAt ?? now,
      finishedAt: now,
      outcome,
      errorCode: code,
      errorMessage: message,
    });

  if (!destination.sendingAt) {
    const again = destination.attemptCount < destination.maxAttempts;
    const restarted = await PublishDestination.findOneAndUpdate(
      { ...stale, sendingAt: null },
      again
        ? {
            $set: {
              state: D.RETRY_SCHEDULED,
              nextAttemptAt: now,
              dueAt: now,
              error: {
                code: E.INTERNAL_ERROR,
                message: 'Publishing stopped before anything was sent. Trying again.',
                retryable: true,
                at: now,
              },
            },
            $unset: { lockToken: 1, lockedUntil: 1 },
            $inc: { queueSeq: 1 },
            $push: attempt('RETRY', E.INTERNAL_ERROR, 'Stopped before sending'),
          }
        : {
            $set: {
              state: D.FAILED,
              completedAt: now,
              error: {
                code: E.INTERNAL_ERROR,
                message:
                  'Publishing stopped before anything was sent, too many times. Nothing was posted; you can retry it.',
                retryable: false,
                at: now,
              },
            },
            $unset: { active: 1, lockToken: 1, lockedUntil: 1, nextAttemptAt: 1, dueAt: 1 },
            $push: attempt('FAILED', E.INTERNAL_ERROR, 'Stopped before sending'),
          },
      { returnDocument: 'after' },
    );
    if (restarted) {
      if (again) await enqueueDestination(restarted, { now });
      await syncJob(restarted.job, { now }).catch((err) => logJobSyncError(err, restarted));
      return 'restarted';
    }
  }

  const updated = await PublishDestination.findOneAndUpdate(
    stale,
    {
      $set: {
        state: D.FAILED,
        completedAt: now,
        error: {
          code: E.INTERRUPTED,
          // It is unknown how far the attempt got, so it is not repeated automatically.
          message:
            'Publishing was interrupted before it finished. The post may or may not have been published. Check the account before retrying.',
          retryable: false,
          at: now,
        },
      },
      $unset: {
        active: 1,
        lockToken: 1,
        lockedUntil: 1,
        sendingAt: 1,
        nextAttemptAt: 1,
        dueAt: 1,
      },
      $push: attempt('FAILED', E.INTERRUPTED, 'Interrupted'),
    },
    { returnDocument: 'after' },
  );
  if (!updated) return null;
  await syncJob(updated.job, { now }).catch((err) => logJobSyncError(err, updated));
  return 'interrupted';
}

/**
 * The member this send relies on (the job's creator, or whoever retried or rescheduled it)
 * must still be allowed to make it: a scheduled post can wait for weeks, during which that
 * person may leave, lose the publish permission or lose access to the account. Checked with
 * the same rules as the API (roles.js, accessibleAccountFilter). Throws AUTHOR_NOT_AUTHORIZED;
 * nothing has been sent at this point.
 */
async function assertStillAuthorized(destination, job) {
  const userId = destination.authorizedBy ?? job.createdBy;
  const blocked = (reason, message) => {
    const error = fail(E.AUTHOR_NOT_AUTHORIZED, message);
    error.blockReason = reason;
    return error;
  };
  const [workspaceExists, membership] = await Promise.all([
    Workspace.exists({ _id: destination.workspace }),
    Membership.findOne({ workspace: destination.workspace, user: userId })
      .select('workspace role accountAccess')
      .lean(),
  ]);
  if (!workspaceExists) {
    throw blocked(R.WORKSPACE_DELETED, 'The workspace no longer exists.');
  }
  if (!membership) {
    throw blocked(
      R.NOT_A_MEMBER,
      'The person who scheduled this post is no longer a member of the workspace, so it was not sent.',
    );
  }
  if (!hasPermission(membership.role, PERMISSIONS.CONTENT_PUBLISH)) {
    throw blocked(
      R.NO_PUBLISH_PERMISSION,
      'The person who scheduled this post may no longer publish, so it was not sent.',
    );
  }
  if (!(await canAccessAccount(membership, destination.socialAccount))) {
    throw blocked(
      R.NO_ACCOUNT_ACCESS,
      'The person who scheduled this post may no longer use this account, so it was not sent.',
    );
  }
}

/** Everything a destination needs, checked at the moment of publishing. Throws PublishError. */
async function prepare(destination, job) {
  const settings = publishingSettings();
  if (settings.mode === PUBLISHING_MODES.DISABLED) {
    throw fail(E.LIVE_PUBLISHING_DISABLED, 'Publishing is switched off on this server.');
  }
  // A LIVE job is sent for real only while BOTH switches are still on: the server's and the
  // workspace's. Otherwise it is refused (nothing sent), never quietly simulated instead.
  // A SIMULATED job always stays a simulation.
  if (job.mode === PUBLISHING_MODES.LIVE) {
    const workspace = await Workspace.findById(destination.workspace).select('publishingMode');
    // A deleted workspace is reported by assertStillAuthorized below.
    if (
      workspace &&
      effectivePublishingMode(settings.mode, workspace.publishingMode) !== PUBLISHING_MODES.LIVE
    ) {
      throw fail(
        E.LIVE_PUBLISHING_DISABLED,
        settings.mode === PUBLISHING_MODES.LIVE
          ? 'Real publishing was switched off for this workspace, so this post was not sent.'
          : 'Real publishing was switched off on this server, so this post was not sent.',
      );
    }
  }
  const adapter = adapterFor(job.mode, destination.platform);
  if (!adapter) throw fail(E.LIVE_PUBLISHING_DISABLED, 'This platform cannot be published to.');

  // The token is read here, at the last moment, and only in this process.
  const account = await SocialAccount.findOne({
    _id: destination.socialAccount,
    workspace: destination.workspace,
  }).select('+accessToken');
  if (!account) {
    throw fail(E.ACCOUNT_REMOVED, 'This account was removed from the workspace.');
  }
  await assertStillAuthorized(destination, job);
  const connection = await SocialConnection.findOne({
    _id: account.connection,
    workspace: destination.workspace,
  }).select('provider status tokenExpiresAt');
  if (
    account.connectionStatus !== CONNECTION_STATUS.ACTIVE ||
    (connection && connection.status !== CONNECTION_STATUS.ACTIVE)
  ) {
    throw fail(
      E.ACCOUNT_NEEDS_RECONNECT,
      'The login for this account is no longer valid. Reconnect the account, then retry.',
    );
  }
  if (account.publishingStatus !== PUBLISHING_STATUS.READY) {
    throw fail(
      E.ACCOUNT_NOT_READY,
      'This account cannot receive posts right now. Open it under Social accounts to see why.',
    );
  }

  const content = job.content.toObject();
  const issues = publishIssues(content, destination.platform);
  if (issues.length) throw fail(E.CONTENT_NOT_PUBLISHABLE, issues.join(' '));

  const storage = getStorage();
  const assets = content.media.length
    ? await MediaAsset.find({
        _id: { $in: content.media.map((m) => m.media) },
        workspace: destination.workspace,
        status: MEDIA_STATUS.READY,
      })
    : [];
  const byId = new Map(assets.map((asset) => [String(asset._id), asset]));
  const media = content.media.map((entry) => {
    const asset = byId.get(String(entry.media));
    if (!asset || !storage || storage.name !== asset.storageDriver) {
      throw fail(E.MEDIA_UNAVAILABLE, 'A file of this post is no longer available.');
    }
    return {
      kind: asset.kind,
      mimeType: asset.mimeType,
      sizeBytes: asset.sizeBytes,
      width: asset.width,
      height: asset.height,
      durationSec: asset.durationSec,
      altText: entry.altText,
      url: storage.publicUrl(asset.storageKey),
    };
  });

  let accessToken = null;
  if (!adapter.simulated) {
    const provider = connection?.provider;
    const configured =
      provider === SOCIAL_PROVIDERS.INSTAGRAM_LOGIN ? instagramSettings() : facebookSettings();
    if (!configured) {
      throw fail(E.LIVE_PUBLISHING_DISABLED, 'The Meta app is not configured on this server.');
    }
    // Instagram Login tokens expire (about 60 days). Page tokens obtained through Facebook
    // Login do not, so for those Meta's answer decides (an expired grant fails as reconnect).
    if (
      provider === SOCIAL_PROVIDERS.INSTAGRAM_LOGIN &&
      connection?.tokenExpiresAt &&
      connection.tokenExpiresAt.getTime() <= Date.now()
    ) {
      throw fail(
        E.ACCOUNT_NEEDS_RECONNECT,
        'The Instagram login for this account has expired. Reconnect the account, then retry.',
      );
    }
    // The files must still meet the platform's requirements (checked at creation too).
    const fileIssues = mediaIssues(media, destination.platform);
    if (fileIssues.length) throw fail(E.CONTENT_NOT_PUBLISHABLE, fileIssues.join(' '));
    // Meta downloads media itself, so files on this computer or behind http cannot be sent.
    if (media.length && (!storage.publicUrls || media.some((m) => !m.url.startsWith('https://')))) {
      throw fail(
        E.MEDIA_NOT_PUBLIC,
        'The files of this post are stored on this server only, so Facebook and Instagram cannot fetch them. Public HTTPS media storage is needed to publish.',
      );
    }
    accessToken = account.getAccessToken();
    if (!accessToken) {
      throw fail(
        E.ACCOUNT_NEEDS_RECONNECT,
        'The login for this account is no longer valid. Reconnect the account, then retry.',
      );
    }
  }

  const warnings = [];
  if (content.firstComment?.trim()) warnings.push(PUBLISH_WARNINGS.FIRST_COMMENT_NOT_SENT);
  if (content.hashtagPlacement === 'FIRST_COMMENT' && content.hashtags.length) {
    warnings.push(PUBLISH_WARNINGS.HASHTAGS_NOT_SENT);
  }
  return {
    adapter,
    warnings,
    context: {
      account,
      connection,
      accessToken,
      // Which attempt this is (1 = first), for adapters that behave differently on a retry.
      attempt: destination.attemptCount,
      caption: composeCaption(content, destination.platform),
      media,
      providerState: destination.providerState ?? null,
      saveProviderState: async (state) => {
        await PublishDestination.updateOne(
          held(destination),
          state ? { $set: { providerState: state } } : { $unset: { providerState: 1 } },
        );
      },
    },
  };
}

/**
 * Processes one destination. Returns what happened:
 * 'published' | 'retry' | 'failed' | 'skipped' (nothing to do: not waiting, not due, or
 * another worker has it) | 'interrupted'.
 */
export async function processDestination(
  destinationId,
  { now = new Date(), random, saveRetryDelaysMs = [1000, 3000] } = {},
) {
  const lockToken = randomToken(12);
  const destination = await PublishDestination.findOneAndUpdate(
    {
      _id: destinationId,
      state: { $in: CLAIMABLE_DESTINATION_STATES },
      $or: [{ dueAt: null }, { dueAt: { $lte: new Date(now.getTime() + DUE_TOLERANCE_MS) } }],
    },
    {
      $set: {
        state: D.PROCESSING,
        lockToken,
        lockedUntil: new Date(now.getTime() + (publishingSettings().claimMs ?? CLAIM_MS)),
        processingAt: now,
      },
      $unset: { nextAttemptAt: 1, dueAt: 1 },
      $inc: { attemptCount: 1 },
    },
    { returnDocument: 'after' },
  ).catch(() => null);

  if (!destination) {
    const current = await PublishDestination.findById(destinationId).catch(() => null);
    if (current?.state === D.PROCESSING && current.lockedUntil && current.lockedUntil < now) {
      return (await markInterrupted(current, now)) ?? 'skipped';
    }
    return 'skipped';
  }

  // The job's status follows its destinations. Failing to update it must not strand this
  // destination in PROCESSING (it would later look "maybe published" although nothing was sent).
  await syncJob(destination.job, { now }).catch((err) => logJobSyncError(err, destination));
  let outcome;
  let sent = null;
  try {
    const job = await PublishJob.findById(destination.job);
    if (!job) throw fail(E.INTERNAL_ERROR, 'The publishing job no longer exists.');
    const { adapter, context, warnings } = await prepare(destination, job);
    // Marks the hand-over to the platform. If this worker stops before this point the post was
    // never sent and the recovery sweep queues it again; after it, only a person retries it.
    const marked = await PublishDestination.updateOne(held(destination), {
      $set: { sendingAt: new Date(Math.max(Date.now(), now.getTime())) },
    });
    if (marked.matchedCount === 0) {
      // The claim was taken back meanwhile (it ran out): someone else handles it now.
      throw fail(E.INTERNAL_ERROR, 'This attempt lost its claim before sending.', {
        retryable: true,
      });
    }
    const result = await adapter.publish(context);
    // From here on the platform has the post: whatever fails next, it is never sent again
    // automatically. The adapter may add warnings of its own (parts Meta could not apply).
    const allWarnings = [...new Set([...warnings, ...(result?.warnings ?? [])])];
    sent = { result, warnings: allWarnings, simulated: adapter.simulated };
    const done = new Date(Math.max(Date.now(), now.getTime()));
    outcome = (await finishPublished(destination, result, allWarnings, adapter.simulated, done))
      ? 'published'
      : 'skipped';
  } catch (caught) {
    if (sent) {
      outcome = await savePublishedResult(destination, sent, now, caught, saveRetryDelaysMs);
      await syncJob(destination.job).catch((err) => logJobSyncError(err, destination));
      return outcome;
    }
    const error =
      caught instanceof PublishError
        ? caught
        : fail(E.INTERNAL_ERROR, 'Something went wrong while publishing.', {
            retryable: true,
            cause: caught,
          });
    if (!(caught instanceof PublishError)) {
      logger.error(
        { err: caught, destinationId: String(destination._id) },
        'Publishing failed unexpectedly',
      );
    }
    const done = new Date(Math.max(Date.now(), now.getTime()));
    if (error.retryable && destination.attemptCount < destination.maxAttempts) {
      outcome = (await scheduleRetry(destination, error, done, random)) ? 'retry' : 'skipped';
    } else {
      outcome = (await finishFailed(destination, error, done)) ? 'failed' : 'skipped';
      if (outcome === 'failed' && error.code === E.AUTHOR_NOT_AUTHORIZED) {
        await recordBlocked(destination, error);
      }
    }
  }
  await syncJob(destination.job).catch((err) => logJobSyncError(err, destination));
  return outcome;
}

/** Activity entry for a destination stopped because its author may no longer publish it. */
async function recordBlocked(destination, error) {
  // A deleted workspace has no activity log any more.
  if (error.blockReason === R.WORKSPACE_DELETED) return;
  await recordActivity({
    workspace: destination.workspace,
    action: PUBLISH_ACTIVITY_ACTIONS.DESTINATION_BLOCKED,
    target: { type: 'publish_job', id: destination.job, label: destination.accountName },
    metadata: {
      reason: error.blockReason,
      platform: destination.platform,
      simulated: Boolean(destination.simulated),
    },
  }).catch((err) => logger.warn({ err }, 'Could not record a publishing activity entry'));
}

function logJobSyncError(err, destination) {
  logger.error(
    { err, jobId: String(destination.job), destinationId: String(destination._id) },
    'Could not update the publishing job status',
  );
}

/**
 * The platform accepted the post, but recording that failed (for example MongoDB was briefly
 * unavailable). Publishing again could post twice, so this never schedules a retry: it tries to
 * save the result a few more times and otherwise leaves the destination claimed. The recovery
 * sweep then marks it INTERRUPTED ("may have been published") for a person to check.
 */
async function savePublishedResult(destination, sent, now, firstError, delaysMs) {
  const destinationId = String(destination._id);
  logger.error(
    { err: firstError, destinationId },
    'Published, but saving the result failed; trying again',
  );
  for (const delay of delaysMs) {
    await new Promise((resolve) => setTimeout(resolve, delay));
    try {
      const done = new Date(Math.max(Date.now(), now.getTime()));
      return (await finishPublished(destination, sent.result, sent.warnings, sent.simulated, done))
        ? 'published'
        : 'skipped';
    } catch (err) {
      logger.error({ err, destinationId }, 'Saving the publishing result failed again');
    }
  }
  logger.error(
    { destinationId, externalPostId: sent.result?.externalPostId ?? null },
    'Published, but the result could not be saved: it will be marked interrupted, not retried',
  );
  return 'interrupted';
}

/**
 * Recovery sweep, run when a worker starts and then every minute:
 *  - destinations left PROCESSING by a worker that stopped: queued again when they were never
 *    sent, otherwise marked INTERRUPTED for a person to check (markInterrupted);
 *  - waiting destinations whose queue entry is missing (Redis was down when they were
 *    created, or Redis lost its data) get a new entry;
 *  - jobs whose stored status lags behind their destinations (a status update failed) are
 *    recalculated.
 */
export async function recoverPublishing({ now = new Date(), limit = 200 } = {}) {
  const result = { interrupted: 0, restarted: 0, requeued: 0, resynced: 0 };
  const stale = await PublishDestination.find({
    state: D.PROCESSING,
    lockedUntil: { $lt: now },
  }).limit(limit);
  for (const destination of stale) {
    const outcome = await markInterrupted(destination, now);
    if (outcome) result[outcome] += 1;
  }

  const cutoff = new Date(
    now.getTime() - (publishingSettings().requeueAfterMs ?? REQUEUE_AFTER_MS),
  );
  const waiting = await PublishDestination.find({
    state: { $in: CLAIMABLE_DESTINATION_STATES },
    $and: [
      { $or: [{ dueAt: null }, { dueAt: { $lte: cutoff } }] },
      { $or: [{ enqueuedAt: null }, { enqueuedAt: { $lte: cutoff } }] },
    ],
  })
    .sort({ dueAt: 1 })
    .limit(limit);
  for (const destination of waiting) {
    const bumped = await PublishDestination.findOneAndUpdate(
      { _id: destination._id, state: destination.state, queueSeq: destination.queueSeq },
      { $inc: { queueSeq: 1 } },
      { returnDocument: 'after' },
    );
    if (bumped && (await enqueueDestination(bumped, { now }))) result.requeued += 1;
  }

  // Scheduled jobs are only looked at once their time has passed.
  const lagging = await PublishJob.find({
    $or: [
      { status: { $in: [J.QUEUED, J.PROCESSING] }, updatedAt: { $lte: cutoff } },
      { status: J.SCHEDULED, updatedAt: { $lte: cutoff }, scheduledAt: { $lte: cutoff } },
    ],
  })
    .select('_id')
    .limit(limit)
    .lean();
  for (const job of lagging) {
    if (await syncJob(job._id, { now, onlyIfChanged: true })) result.resynced += 1;
  }
  return result;
}
