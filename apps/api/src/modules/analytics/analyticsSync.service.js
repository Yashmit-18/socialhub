import {
  ANALYTICS_ACTIVITY_ACTIONS,
  ANALYTICS_API_ERRORS,
  ANALYTICS_LIMITS,
  ANALYTICS_MODES,
  ANALYTICS_SOURCES,
  ANALYTICS_SYNC_STATUS,
  CONNECTION_STATUS,
  QUEUE_STATUS,
  sourceForMode,
} from '@socialhub/shared';
import { logger } from '../../config/logger.js';
import { AppError, isDuplicateKeyError, notFound } from '../../lib/errors.js';
import { AnalyticsSyncRun } from '../../models/AnalyticsSyncRun.js';
import { SocialAccount } from '../../models/index.js';
import { analyticsQueueStatus } from '../../queue/analyticsQueue.js';
import { recordActivity } from '../activity/activity.service.js';
import { accessibleAccountFilter } from '../socialAccounts/socialAccount.service.js';
import { enqueueRun } from './analyticsSync.processor.js';
import { analyticsSettings, queueMessage } from './analytics.settings.js';
import { addDays, dayIn } from './analytics.time.js';

/**
 * Asking for an insights sync (POST /analytics/sync). Only accounts the member may use can be
 * synced; one sync per account and source can be active at a time (a database index enforces
 * it); nothing is created while analytics are off or the queue is unreachable.
 */

/** Meta can revise the latest days (data may lag up to 48 hours), so each sync re-reads them. */
const OVERLAP_DAYS = 2;
const FIRST_SYNC_DAYS = 30;

function assertCanSync() {
  const { mode } = analyticsSettings();
  if (mode === ANALYTICS_MODES.DISABLED) {
    throw new AppError(
      503,
      ANALYTICS_API_ERRORS.ANALYTICS_DISABLED,
      'Insights are not read from Meta on this server yet, so there is nothing to sync.',
    );
  }
  const status = analyticsQueueStatus();
  if (status !== QUEUE_STATUS.READY) {
    throw new AppError(503, ANALYTICS_API_ERRORS.QUEUE_UNAVAILABLE, queueMessage(status), {
      queueStatus: status,
    });
  }
}

/** The days to read for an account: from the last successful sync (minus the overlap) to today. */
async function rangeFor(account, source, today) {
  const last = await AnalyticsSyncRun.findOne({
    socialAccount: account._id,
    source,
    status: { $in: [ANALYTICS_SYNC_STATUS.SUCCEEDED, ANALYTICS_SYNC_STATUS.PARTIAL] },
  })
    .sort({ finishedAt: -1 })
    .select('until');
  const oldest = addDays(today, -(ANALYTICS_LIMITS.SYNC_MAX_DAYS - 1));
  const wanted = last ? addDays(last.until, -OVERLAP_DAYS) : addDays(today, -(FIRST_SYNC_DAYS - 1));
  return { since: wanted < oldest ? oldest : wanted, until: today };
}

const runView = (run) => ({
  id: String(run._id),
  accountId: String(run.socialAccount),
  accountName: run.accountName,
  platform: run.platform,
  source: run.source,
  status: run.status,
  since: run.since,
  until: run.until,
  createdAt: run.createdAt,
});

export async function requestSync(
  workspace,
  membership,
  actor,
  { accountIds },
  context,
  { now = new Date() } = {},
) {
  assertCanSync();
  const settings = analyticsSettings();
  const source = sourceForMode(settings.mode);
  const filter = { $and: [accessibleAccountFilter(membership)] };
  if (accountIds?.length) filter.$and.push({ _id: { $in: accountIds } });
  const accounts = await SocialAccount.find(filter).select('platform name connectionStatus');
  // Unknown, other-workspace and not-assigned ids all get the same answer.
  if (
    accountIds?.length &&
    accounts.length !== new Set(accountIds.map((id) => id.toLowerCase())).size
  ) {
    throw notFound('One or more accounts were not found');
  }

  const today = dayIn(now, workspace.timezone ?? 'UTC');
  const queued = [];
  const alreadyRunning = [];
  const skipped = [];
  for (const account of accounts) {
    if (account.connectionStatus !== CONNECTION_STATUS.ACTIVE) {
      skipped.push({
        accountId: String(account._id),
        accountName: account.name,
        reason: 'NEEDS_RECONNECT',
      });
      continue;
    }
    const { since, until } = await rangeFor(account, source, today);
    let run;
    try {
      run = await AnalyticsSyncRun.create({
        workspace: workspace._id,
        socialAccount: account._id,
        platform: account.platform,
        accountName: account.name,
        source,
        status: ANALYTICS_SYNC_STATUS.QUEUED,
        active: true,
        since,
        until,
        requestedBy: actor._id,
        maxAttempts: settings.maxAttempts,
        queueSeq: 1,
        dueAt: now,
      });
    } catch (err) {
      if (!isDuplicateKeyError(err)) throw err;
      // One sync per account and source at a time: report the one already on its way.
      const existing = await AnalyticsSyncRun.findOne({
        socialAccount: account._id,
        source,
        active: true,
      });
      if (existing) alreadyRunning.push(runView(existing));
      continue;
    }
    // If Redis drops right now, the recovery sweep queues the run later.
    await enqueueRun(run, { now });
    queued.push(runView(run));
  }

  if (queued.length) {
    await recordActivity({
      workspace,
      actor,
      action: ANALYTICS_ACTIVITY_ACTIONS.SYNC_REQUESTED,
      target: { type: 'analytics' },
      metadata: {
        accountCount: queued.length,
        simulated: source === ANALYTICS_SOURCES.SIMULATED,
      },
      context,
    }).catch((err) => logger.warn({ err }, 'Could not record an analytics activity entry'));
  }
  return {
    source,
    simulated: source === ANALYTICS_SOURCES.SIMULATED,
    queued,
    alreadyRunning,
    skipped,
  };
}
