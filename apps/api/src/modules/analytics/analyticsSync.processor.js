import {
  ANALYTICS_LIMITS,
  ANALYTICS_SOURCES,
  ANALYTICS_SYNC_STATUS,
  CONNECTION_STATUS,
  DESTINATION_STATES,
  sourceForMode,
} from '@socialhub/shared';
import { logger } from '../../config/logger.js';
import { facebookSettings, providerSettings } from '../../integrations/meta/settings.js';
import { randomToken } from '../../lib/crypto.js';
import { AccountInsight } from '../../models/AccountInsight.js';
import { AnalyticsSyncRun } from '../../models/AnalyticsSyncRun.js';
import { cleanMetrics } from '../../models/insightMetrics.js';
import { PostInsight } from '../../models/PostInsight.js';
import {
  PublishDestination,
  PublishJob,
  SocialAccount,
  SocialConnection,
} from '../../models/index.js';
import { enqueueSyncRun } from '../../queue/analyticsQueue.js';
import { retryDelayMs } from '../publishing/backoff.js';
import { insightsAdapterFor } from './adapters/index.js';
import { ANALYTICS_ERROR_CODES, AnalyticsError } from './analyticsError.js';
import { analyticsSettings } from './analytics.settings.js';
import { eachDay } from './analytics.time.js';

/**
 * Runs one insights sync. Called by the analytics worker with nothing but a run id.
 *
 * The AnalyticsSyncRun document decides everything. The worker first CLAIMS it with one atomic
 * update (waiting → RUNNING, with a private lock token); only the claimant can finish it. So
 * the same queue entry delivered twice, or two workers, never run one sync twice at once.
 * Reading insights changes nothing at Meta, so an interrupted run is simply run again.
 */
const S = ANALYTICS_SYNC_STATUS;
const E = ANALYTICS_ERROR_CODES;
const DUE_TOLERANCE_MS = 5000;
const REQUEUE_AFTER_MS = 2 * 60 * 1000;
const MAX_POSTS_PER_RUN = 500;

/** Adds the queue entry for a waiting run. Returns false when Redis is unreachable. */
export async function enqueueRun(run, { now = new Date() } = {}) {
  try {
    const delay = Math.max(0, (run.dueAt?.getTime() ?? now.getTime()) - now.getTime());
    await enqueueSyncRun(run._id, run.queueSeq, delay);
    await AnalyticsSyncRun.updateOne({ _id: run._id }, { $set: { enqueuedAt: now } });
    return true;
  } catch (err) {
    // The run stays waiting in MongoDB; the recovery sweep adds the entry later.
    logger.warn(
      { reason: err.message, runId: String(run._id) },
      'Could not queue an analytics sync',
    );
    return false;
  }
}

const publicError = (error, at) => ({
  code: error.code,
  message: error.message,
  retryable: Boolean(error.retryable),
  at,
});

async function syncOnce(run) {
  const adapter = insightsAdapterFor(run.source);
  // A run keeps the source it was created with; if the server no longer produces that source,
  // the run must not quietly switch (simulated data must never turn into "Meta" data).
  if (!adapter || sourceForMode(analyticsSettings().mode) !== run.source) {
    throw new AnalyticsError(
      E.LIVE_ANALYTICS_DISABLED,
      'Analytics on this server changed since this sync was asked for. Start a new sync.',
    );
  }
  const account = await SocialAccount.findOne({
    _id: run.socialAccount,
    workspace: run.workspace,
  }).select(adapter.simulated ? undefined : '+accessToken');
  if (!account)
    throw new AnalyticsError(E.ACCOUNT_REMOVED, 'This account was removed from the workspace.');
  const connection = await SocialConnection.findOne({
    _id: account.connection,
    workspace: run.workspace,
  }).select('provider status grantedScopes');
  if (
    account.connectionStatus !== CONNECTION_STATUS.ACTIVE ||
    (connection && connection.status !== CONNECTION_STATUS.ACTIVE)
  ) {
    throw new AnalyticsError(
      E.NEEDS_RECONNECT,
      'The login for this account is no longer valid. Reconnect it, then sync again.',
    );
  }

  // The token is read here, at the last moment, only for Meta, and only in this process.
  let accessToken = null;
  if (!adapter.simulated) {
    const configured = connection?.provider
      ? providerSettings(connection.provider)
      : facebookSettings();
    if (!configured) {
      throw new AnalyticsError(
        E.LIVE_ANALYTICS_DISABLED,
        'The Meta app is not configured on this server.',
      );
    }
    accessToken = account.getAccessToken();
    if (!accessToken) {
      throw new AnalyticsError(E.NEEDS_RECONNECT, 'The login for this account is no longer valid.');
    }
  }

  const days = eachDay(run.since, run.until);
  const accountResult = await adapter.fetchAccountInsights({
    account,
    connection,
    accessToken,
    days,
    today: run.until,
    attempt: run.attemptCount,
  });
  const fetchedAt = new Date();
  const dayOps = (accountResult.days ?? [])
    .filter(({ day }) => day >= run.since && day <= run.until)
    .map(({ day, metrics }) => ({
      updateOne: {
        filter: { socialAccount: account._id, source: run.source, day },
        update: {
          $set: {
            workspace: run.workspace,
            platform: account.platform,
            metrics: cleanMetrics(metrics),
            fetchedAt,
            syncRun: run._id,
          },
        },
        upsert: true,
      },
    }));
  // Account results are saved before posts are read: a post failure never loses them.
  if (dayOps.length) await AccountInsight.bulkWrite(dayOps, { ordered: false });

  // Posts SocialHub published to this account recently. Demo metrics only for simulated posts,
  // Meta metrics only for real posts that have Meta's post id.
  const recent = new Date(fetchedAt.getTime() - ANALYTICS_LIMITS.SYNC_MAX_DAYS * 86_400_000);
  const destinations = await PublishDestination.find({
    workspace: run.workspace,
    socialAccount: account._id,
    state: DESTINATION_STATES.PUBLISHED,
    completedAt: { $gte: recent },
    ...(run.source === ANALYTICS_SOURCES.SIMULATED
      ? { simulated: true }
      : { simulated: { $ne: true }, externalPostId: { $exists: true } }),
  })
    .select('platform job externalPostId')
    .sort({ completedAt: -1 })
    .limit(MAX_POSTS_PER_RUN)
    .lean();
  const jobs = destinations.length
    ? await PublishJob.find({ _id: { $in: destinations.map((d) => d.job) } })
        .select('content.media.kind')
        .lean()
    : [];
  const hasVideo = new Map(
    jobs.map((job) => [
      String(job._id),
      (job.content?.media ?? []).some((m) => m.kind === 'VIDEO'),
    ]),
  );
  const posts = destinations.map((d) => ({
    _id: d._id,
    platform: d.platform,
    externalPostId: d.externalPostId,
    hasVideo: hasVideo.get(String(d.job)) ?? false,
  }));
  const postResult = posts.length
    ? await adapter.fetchPostInsights({ account, connection, accessToken, posts })
    : { items: [], failed: 0 };
  const byId = new Map(posts.map((p) => [String(p._id), p]));
  const postOps = (postResult.items ?? [])
    .filter((item) => byId.has(String(item.postId)))
    .map((item) => {
      const post = byId.get(String(item.postId));
      return {
        updateOne: {
          filter: { publishDestination: post._id, source: run.source },
          update: {
            $set: {
              workspace: run.workspace,
              socialAccount: account._id,
              platform: post.platform,
              ...(run.source === ANALYTICS_SOURCES.META
                ? { externalPostId: post.externalPostId }
                : {}),
              metrics: cleanMetrics(item.metrics),
              fetchedAt,
              syncRun: run._id,
            },
          },
          upsert: true,
        },
      };
    });
  if (postOps.length) await PostInsight.bulkWrite(postOps, { ordered: false });

  return {
    partial: (postResult.failed ?? 0) > 0,
    result: {
      days: dayOps.length,
      posts: postOps.length,
      unavailable: accountResult.unavailable ?? [],
    },
  };
}

/**
 * Runs one sync. Returns 'succeeded' | 'partial' | 'retry' | 'failed' | 'skipped' (not waiting,
 * not due, or another worker has it).
 */
export async function processSyncRun(runId, { now = new Date(), random } = {}) {
  const settings = analyticsSettings();
  const lockToken = randomToken(12);
  const run = await AnalyticsSyncRun.findOneAndUpdate(
    {
      _id: runId,
      status: { $in: [S.QUEUED, S.RETRY_SCHEDULED] },
      $or: [{ dueAt: null }, { dueAt: { $lte: new Date(now.getTime() + DUE_TOLERANCE_MS) } }],
    },
    {
      $set: {
        status: S.RUNNING,
        lockToken,
        lockedUntil: new Date(now.getTime() + settings.claimMs),
        startedAt: now,
      },
      $unset: { dueAt: 1 },
      $inc: { attemptCount: 1 },
    },
    { returnDocument: 'after' },
  ).catch(() => null);
  if (!run) return 'skipped';
  const guard = { _id: run._id, lockToken };

  try {
    const { partial, result } = await syncOnce(run);
    const status = partial ? S.PARTIAL : S.SUCCEEDED;
    const done = await AnalyticsSyncRun.findOneAndUpdate(guard, {
      $set: { status, finishedAt: new Date(), result },
      $unset: { active: 1, lockToken: 1, lockedUntil: 1, error: 1 },
    });
    return done ? status.toLowerCase() : 'skipped';
  } catch (caught) {
    const error =
      caught instanceof AnalyticsError
        ? caught
        : new AnalyticsError(E.INTERNAL_ERROR, 'Something went wrong while reading insights.', {
            retryable: true,
            cause: caught,
          });
    if (!(caught instanceof AnalyticsError)) {
      logger.error({ err: caught, runId: String(run._id) }, 'Analytics sync failed unexpectedly');
    }
    const at = new Date(Math.max(Date.now(), now.getTime()));
    if (error.retryable && run.attemptCount < run.maxAttempts) {
      const wait = Math.max(
        error.retryAfterMs ?? 0,
        retryDelayMs(run.attemptCount, {
          baseMs: settings.retryBaseMs,
          maxMs: settings.retryMaxMs,
          random,
        }),
      );
      const retried = await AnalyticsSyncRun.findOneAndUpdate(
        guard,
        {
          $set: {
            status: S.RETRY_SCHEDULED,
            dueAt: new Date(at.getTime() + wait),
            error: publicError(error, at),
          },
          $unset: { lockToken: 1, lockedUntil: 1 },
          $inc: { queueSeq: 1 },
        },
        { returnDocument: 'after' },
      );
      if (!retried) return 'skipped';
      await enqueueRun(retried, { now: at });
      return 'retry';
    }
    const failed = await AnalyticsSyncRun.findOneAndUpdate(guard, {
      $set: { status: S.FAILED, finishedAt: at, error: publicError(error, at) },
      $unset: { active: 1, lockToken: 1, lockedUntil: 1 },
    });
    return failed ? 'failed' : 'skipped';
  }
}

/**
 * Recovery sweep, run when the worker starts and then every minute:
 *  - a run left RUNNING by a worker that stopped is queued again (reading is safe to repeat),
 *    or fails once its attempts are used up;
 *  - a waiting run whose queue entry is missing (Redis was down, or lost its data) is queued
 *    again.
 */
export async function recoverAnalyticsSync({ now = new Date(), limit = 200 } = {}) {
  const result = { requeued: 0, interrupted: 0 };
  const stale = await AnalyticsSyncRun.find({ status: S.RUNNING, lockedUntil: { $lt: now } }).limit(
    limit,
  );
  for (const run of stale) {
    if (run.attemptCount < run.maxAttempts) {
      const again = await AnalyticsSyncRun.findOneAndUpdate(
        { _id: run._id, status: S.RUNNING, lockToken: run.lockToken },
        {
          $set: { status: S.QUEUED, dueAt: now },
          $unset: { lockToken: 1, lockedUntil: 1 },
          $inc: { queueSeq: 1 },
        },
        { returnDocument: 'after' },
      );
      if (again && (await enqueueRun(again, { now }))) result.requeued += 1;
    } else {
      const failed = await AnalyticsSyncRun.findOneAndUpdate(
        { _id: run._id, status: S.RUNNING, lockToken: run.lockToken },
        {
          $set: {
            status: S.FAILED,
            finishedAt: now,
            error: publicError(
              new AnalyticsError(E.INTERRUPTED, 'The sync was interrupted too many times.'),
              now,
            ),
          },
          $unset: { active: 1, lockToken: 1, lockedUntil: 1 },
        },
      );
      if (failed) result.interrupted += 1;
    }
  }
  const cutoff = new Date(now.getTime() - REQUEUE_AFTER_MS);
  const waiting = await AnalyticsSyncRun.find({
    status: { $in: [S.QUEUED, S.RETRY_SCHEDULED] },
    $and: [
      { $or: [{ dueAt: null }, { dueAt: { $lte: cutoff } }] },
      { $or: [{ enqueuedAt: null }, { enqueuedAt: { $lte: cutoff } }] },
    ],
  })
    .sort({ dueAt: 1 })
    .limit(limit);
  for (const run of waiting) {
    const bumped = await AnalyticsSyncRun.findOneAndUpdate(
      { _id: run._id, status: run.status, queueSeq: run.queueSeq },
      { $inc: { queueSeq: 1 } },
      { returnDocument: 'after' },
    );
    if (bumped && (await enqueueRun(bumped, { now }))) result.requeued += 1;
  }
  return result;
}
