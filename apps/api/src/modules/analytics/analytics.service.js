import mongoose from 'mongoose';
import {
  ACTIVE_SYNC_STATUSES,
  ANALYTICS_METRICS,
  ANALYTICS_SOURCES,
  ANALYTICS_SYNC_STATUS,
  DESTINATION_STATES,
  METRIC_KEYS,
  PUBLISHING_MODES,
  PUBLISH_JOB_STATUS,
  composeCaption,
  engagementRate,
  followerGrowth,
  publishingSuccessRate,
} from '@socialhub/shared';
import { notFound } from '../../lib/errors.js';
import { AccountInsight } from '../../models/AccountInsight.js';
import { AnalyticsSyncRun } from '../../models/AnalyticsSyncRun.js';
import { MediaAsset, PublishDestination, PublishJob, SocialAccount } from '../../models/index.js';
// Same visibility rule as the Publishing screen: a hidden job's posts are left out here too.
import { hiddenJobIds } from '../contentPackages/contentAccess.js';
import { mediaView } from '../media/media.service.js';
import { accessibleAccountFilter } from '../socialAccounts/socialAccount.service.js';
import { analyticsStatus } from './analytics.settings.js';
import { resolveRange } from './analytics.time.js';

/**
 * Analytics reads (docs/ANALYTICS.md). Every query is limited to the accounts the member may
 * use in this workspace (accessibleAccountFilter), and publishing data follows the job
 * visibility rule of the Publishing screen: a job that touches an account the member may not
 * use is left out entirely.
 *
 * Honesty rules:
 *  - SocialHub publishing numbers come from SocialHub's own records and are complete, so a 0
 *    there is a real 0. They are split by publishing mode: SIMULATED and LIVE never add up.
 *  - Insights come from one source per request (META by default). A metric no row reported
 *    is null ("unavailable"), never 0, and every total says how many accounts reported it.
 */

const D = DESTINATION_STATES;
const CAPTION_PREVIEW = 160;
const MODE_FOR = (simulated) => (simulated ? PUBLISHING_MODES.SIMULATED : PUBLISHING_MODES.LIVE);

/* ------------------------------------------------------------------ scope */

/**
 * The accounts a request covers: those the member may use, narrowed by `platform` and
 * `accountId`. An account the member may not use answers 404, like one that does not exist.
 */
async function scope(workspace, membership, { platform, accountId }) {
  const filter = { $and: [accessibleAccountFilter(membership)] };
  if (platform) filter.$and.push({ platform });
  if (accountId) filter.$and.push({ _id: accountId });
  const accounts = await SocialAccount.find(filter)
    .select('platform name username pictureUrl connectionStatus externalId')
    .sort({ platform: 1, name: 1 })
    .lean();
  if (accountId && accounts.length === 0) throw notFound('Social account not found');
  return accounts;
}

/** The accounts, hidden jobs, range and source a request covers (also used by the exports). */
export async function analyticsScope(workspace, membership, query, now = new Date()) {
  return context(workspace, membership, query, now);
}

async function context(workspace, membership, query, now) {
  const [accounts, hidden] = await Promise.all([
    scope(workspace, membership, query),
    hiddenJobIds(workspace, membership),
  ]);
  return {
    accounts,
    accountIds: accounts.map((a) => a._id),
    hidden,
    range: resolveRange(query, workspace.timezone, now),
    source: query.source ?? ANALYTICS_SOURCES.META,
  };
}

const destinationMatch = (workspace, ctx, extra = {}) => ({
  workspace: workspace._id,
  socialAccount: { $in: ctx.accountIds },
  ...(ctx.hidden.length ? { job: { $nin: ctx.hidden } } : {}),
  ...extra,
});

const rangeOut = (ctx) => ({
  startDate: ctx.range.startDay,
  endDate: ctx.range.endDay,
  timeZone: ctx.range.timeZone,
});

/* ------------------------------------------------------------------ publishing */

const emptyStates = () => Object.fromEntries(Object.values(D).map((s) => [s, 0]));
const emptyJobStatuses = () =>
  Object.fromEntries(Object.values(PUBLISH_JOB_STATUS).map((s) => [s, 0]));

/**
 * Publishing performance from SocialHub's records, per publishing mode. Destinations and jobs
 * are attributed to the day the job was created.
 */
async function publishingStats(workspace, ctx) {
  const match = destinationMatch(workspace, ctx, {
    createdAt: { $gte: ctx.range.from, $lt: ctx.range.to },
  });
  const [rows, jobRows] = await Promise.all([
    PublishDestination.aggregate([
      { $match: match },
      {
        $group: {
          _id: { simulated: '$simulated', state: '$state' },
          n: { $sum: 1 },
          retried: { $sum: { $cond: [{ $gt: ['$attemptCount', 1] }, 1, 0] } },
          extraAttempts: { $sum: { $max: [{ $subtract: ['$attemptCount', 1] }, 0] } },
          // Publishing duration: first recorded attempt start → final result (PUBLISHED only).
          durationMs: {
            $sum: {
              $cond: [
                { $eq: ['$state', D.PUBLISHED] },
                {
                  $max: [
                    {
                      $subtract: ['$completedAt', { $arrayElemAt: ['$attempts.startedAt', 0] }],
                    },
                    0,
                  ],
                },
                0,
              ],
            },
          },
        },
      },
    ]),
    PublishDestination.aggregate([
      { $match: match },
      { $group: { _id: '$job' } },
      { $lookup: { from: 'publishjobs', localField: '_id', foreignField: '_id', as: 'job' } },
      { $unwind: '$job' },
      { $group: { _id: { mode: '$job.mode', status: '$job.status' }, n: { $sum: 1 } } },
    ]),
  ]);

  const modes = new Map();
  const modeEntry = (mode) => {
    if (!modes.has(mode)) {
      modes.set(mode, {
        mode,
        simulated: mode === PUBLISHING_MODES.SIMULATED,
        jobs: { total: 0, byStatus: emptyJobStatuses() },
        destinations: { total: 0, byState: emptyStates() },
        retries: { destinationsRetried: 0, extraAttempts: 0 },
        durationMs: 0,
      });
    }
    return modes.get(mode);
  };
  for (const row of rows) {
    const entry = modeEntry(MODE_FOR(row._id.simulated));
    entry.destinations.total += row.n;
    entry.destinations.byState[row._id.state] =
      (entry.destinations.byState[row._id.state] ?? 0) + row.n;
    entry.retries.destinationsRetried += row.retried;
    entry.retries.extraAttempts += row.extraAttempts;
    entry.durationMs += row.durationMs;
  }
  for (const row of jobRows) {
    const entry = modeEntry(
      row._id.mode === PUBLISHING_MODES.LIVE ? PUBLISHING_MODES.LIVE : PUBLISHING_MODES.SIMULATED,
    );
    entry.jobs.total += row.n;
    entry.jobs.byStatus[row._id.status] = (entry.jobs.byStatus[row._id.status] ?? 0) + row.n;
  }
  return [...modes.values()]
    .sort((a, b) => a.mode.localeCompare(b.mode))
    .map(({ durationMs, ...entry }) => {
      const published = entry.destinations.byState[D.PUBLISHED];
      return {
        ...entry,
        successRate: publishingSuccessRate({
          published,
          failed: entry.destinations.byState[D.FAILED],
        }),
        averageDurationSec: published ? Math.round(durationMs / published / 100) / 10 : null,
      };
    });
}

/** Per day (workspace time zone) and mode: destinations created, published and failed. */
async function publishingActivity(workspace, ctx) {
  const tz = ctx.range.timeZone;
  const byDay = (field) => ({ $dateToString: { format: '%Y-%m-%d', date: field, timezone: tz } });
  const [created, finished] = await Promise.all([
    PublishDestination.aggregate([
      {
        $match: destinationMatch(workspace, ctx, {
          createdAt: { $gte: ctx.range.from, $lt: ctx.range.to },
        }),
      },
      { $group: { _id: { day: byDay('$createdAt'), simulated: '$simulated' }, n: { $sum: 1 } } },
    ]),
    PublishDestination.aggregate([
      {
        $match: destinationMatch(workspace, ctx, {
          state: { $in: [D.PUBLISHED, D.FAILED] },
          completedAt: { $gte: ctx.range.from, $lt: ctx.range.to },
        }),
      },
      {
        $group: {
          _id: { day: byDay('$completedAt'), simulated: '$simulated', state: '$state' },
          n: { $sum: 1 },
        },
      },
    ]),
  ]);
  const modes = new Set([...created, ...finished].map((r) => MODE_FOR(r._id.simulated)));
  return [...modes].sort().map((mode) => {
    const series = new Map(
      ctx.range.days.map((day) => [day, { day, created: 0, published: 0, failed: 0 }]),
    );
    for (const r of created) {
      if (MODE_FOR(r._id.simulated) === mode) {
        const point = series.get(r._id.day);
        if (point) point.created += r.n;
      }
    }
    for (const r of finished) {
      if (MODE_FOR(r._id.simulated) === mode) {
        const point = series.get(r._id.day);
        if (point) point[r._id.state === D.PUBLISHED ? 'published' : 'failed'] += r.n;
      }
    }
    return { mode, simulated: mode === PUBLISHING_MODES.SIMULATED, series: [...series.values()] };
  });
}

/* ------------------------------------------------------------------ insights */

async function insightRows(workspace, ctx) {
  if (ctx.accountIds.length === 0) return [];
  return AccountInsight.find({
    workspace: workspace._id,
    source: ctx.source,
    socialAccount: { $in: ctx.accountIds },
    day: { $gte: ctx.range.startDay, $lte: ctx.range.endDay },
  })
    .select('socialAccount day metrics')
    .sort({ day: 1 })
    .lean();
}

/**
 * Totals of every metric over the rows given, per the metric's aggregate rule, with how many
 * accounts reported it. `null` value = no account reported it (unavailable).
 */
function totals(rows, accountCount) {
  const byAccount = new Map();
  for (const row of rows) {
    const key = String(row.socialAccount);
    if (!byAccount.has(key)) byAccount.set(key, []);
    byAccount.get(key).push(row);
  }
  const metrics = {};
  for (const key of METRIC_KEYS) {
    const rule = ANALYTICS_METRICS[key].aggregate;
    if (rule === 'none') continue;
    let value = null;
    let reporting = 0;
    for (const accountRows of byAccount.values()) {
      const values = accountRows.map((r) => r.metrics?.[key]).filter((v) => typeof v === 'number');
      if (values.length === 0) continue;
      reporting += 1;
      const contribution = rule === 'last' ? values.at(-1) : values.reduce((a, b) => a + b, 0);
      value = (value ?? 0) + contribution;
    }
    metrics[key] = { value, accountsReporting: reporting, accountsInScope: accountCount };
  }
  // Follower growth: last minus first reported value, per account, then added up.
  let growth = null;
  let growthAccounts = 0;
  for (const accountRows of byAccount.values()) {
    const values = accountRows
      .map((r) => r.metrics?.followers)
      .filter((v) => typeof v === 'number');
    if (values.length < 2) continue;
    growthAccounts += 1;
    growth = (growth ?? 0) + followerGrowth(values[0], values.at(-1));
  }
  metrics.followerGrowth = {
    value: growth,
    accountsReporting: growthAccounts,
    accountsInScope: accountCount,
  };
  return metrics;
}

function trendSeries(rows, days) {
  const series = days.map((day) => ({ day, accountsReporting: 0, metrics: {} }));
  const index = new Map(series.map((point) => [point.day, point]));
  for (const row of rows) {
    const point = index.get(row.day);
    if (!point) continue;
    point.accountsReporting += 1;
    for (const key of METRIC_KEYS) {
      const value = row.metrics?.[key];
      if (typeof value === 'number' && ANALYTICS_METRICS[key].aggregate !== 'none') {
        point.metrics[key] = (point.metrics[key] ?? 0) + value;
      }
    }
  }
  // Unreported metrics stay absent (null), never 0.
  for (const point of series) {
    for (const key of METRIC_KEYS) {
      if (ANALYTICS_METRICS[key].aggregate !== 'none') point.metrics[key] ??= null;
    }
  }
  return series;
}

const accountView = (a) => ({
  id: String(a._id),
  platform: a.platform,
  name: a.name,
  username: a.username ?? null,
  pictureUrl: a.pictureUrl ?? null,
});

/* ------------------------------------------------------------------ endpoints */

export async function getOverview(workspace, membership, query, { now = new Date() } = {}) {
  const ctx = await context(workspace, membership, query, now);
  const [publishing, rows, status] = await Promise.all([
    publishingStats(workspace, ctx),
    insightRows(workspace, ctx),
    analyticsStatus(),
  ]);
  return {
    range: rangeOut(ctx),
    accountCount: ctx.accounts.length,
    publishing,
    insights: {
      source: ctx.source,
      simulated: ctx.source === ANALYTICS_SOURCES.SIMULATED,
      hasData: rows.length > 0,
      metrics: totals(rows, ctx.accounts.length),
    },
    analytics: status,
  };
}

export async function getTrends(workspace, membership, query, { now = new Date() } = {}) {
  const ctx = await context(workspace, membership, query, now);
  const [activity, rows] = await Promise.all([
    publishingActivity(workspace, ctx),
    insightRows(workspace, ctx),
  ]);
  return {
    range: rangeOut(ctx),
    publishing: activity,
    insights: {
      source: ctx.source,
      simulated: ctx.source === ANALYTICS_SOURCES.SIMULATED,
      hasData: rows.length > 0,
      series: trendSeries(rows, ctx.range.days),
    },
  };
}

export async function getAccounts(workspace, membership, query, { now = new Date() } = {}) {
  const ctx = await context(workspace, membership, query, now);
  const [rows, states, runs] = await Promise.all([
    insightRows(workspace, ctx),
    PublishDestination.aggregate([
      {
        $match: destinationMatch(workspace, ctx, {
          createdAt: { $gte: ctx.range.from, $lt: ctx.range.to },
        }),
      },
      {
        $group: {
          _id: { account: '$socialAccount', simulated: '$simulated', state: '$state' },
          n: { $sum: 1 },
        },
      },
    ]),
    latestRuns(workspace, ctx.accountIds),
  ]);
  const items = ctx.accounts.map((account) => {
    const id = String(account._id);
    const own = rows.filter((r) => String(r.socialAccount) === id);
    const publishing = {};
    for (const r of states.filter((s) => String(s._id.account) === id)) {
      const mode = MODE_FOR(r._id.simulated);
      publishing[mode] ??= {
        mode,
        simulated: r._id.simulated === true,
        byState: emptyStates(),
        total: 0,
      };
      publishing[mode].byState[r._id.state] += r.n;
      publishing[mode].total += r.n;
    }
    // Same order as the overview (LIVE before SIMULATED), whatever order the rows came in.
    const modes = Object.values(publishing)
      .sort((a, b) => a.mode.localeCompare(b.mode))
      .map((p) => ({
        ...p,
        successRate: publishingSuccessRate({
          published: p.byState[D.PUBLISHED],
          failed: p.byState[D.FAILED],
        }),
      }));
    return {
      account: accountView(account),
      connectionStatus: account.connectionStatus,
      publishing: modes,
      insights: { daysReported: own.length, metrics: totals(own, 1) },
      sync: runs.get(id) ?? null,
    };
  });
  return {
    range: rangeOut(ctx),
    source: ctx.source,
    simulated: ctx.source === ANALYTICS_SOURCES.SIMULATED,
    items,
  };
}

/* ------------------------------------------------------------------ posts */

const SORT_FIELDS = {
  publishedAt: '$completedAt',
  engagementRate: '$engagementRate',
};

function postsPipeline(workspace, ctx, { postId, sortBy, sortOrder, onlyWithMetric }) {
  const match = destinationMatch(workspace, ctx, {
    state: D.PUBLISHED,
    completedAt: { $gte: ctx.range.from, $lt: ctx.range.to },
    ...(postId ? { _id: new mongoose.Types.ObjectId(postId) } : {}),
  });
  const metricPath = SORT_FIELDS[sortBy] ?? `$metrics.${sortBy}`;
  const direction = sortOrder === 'asc' ? 1 : -1;
  const pipeline = [
    { $match: match },
    {
      $lookup: {
        from: 'postinsights',
        let: { destination: '$_id' },
        pipeline: [
          {
            $match: {
              $expr: { $eq: ['$publishDestination', '$$destination'] },
              source: ctx.source,
            },
          },
          { $project: { metrics: 1, fetchedAt: 1 } },
        ],
        as: 'insight',
      },
    },
    {
      $addFields: {
        metrics: { $ifNull: [{ $arrayElemAt: ['$insight.metrics', 0] }, {}] },
        metricsFetchedAt: { $arrayElemAt: ['$insight.fetchedAt', 0] },
      },
    },
    {
      $addFields: {
        // Engagement ÷ reach × 100, only when both exist and reach > 0 (see shared engagementRate).
        engagementRate: {
          $cond: [
            {
              $and: [
                { $isNumber: '$metrics.engagement' },
                { $isNumber: '$metrics.reach' },
                { $gt: ['$metrics.reach', 0] },
              ],
            },
            { $multiply: [{ $divide: ['$metrics.engagement', '$metrics.reach'] }, 100] },
            null,
          ],
        },
      },
    },
    // Posts without the sort metric go last whichever way the list is sorted.
    {
      $addFields: {
        hasSortValue: {
          $cond: [{ $isNumber: metricPath === '$completedAt' ? 0 : metricPath }, 1, 0],
        },
        sortValue: metricPath,
      },
    },
  ];
  if (onlyWithMetric) pipeline.push({ $match: { hasSortValue: 1 } });
  pipeline.push({
    $sort:
      sortBy === 'publishedAt'
        ? { completedAt: direction, _id: direction }
        : { hasSortValue: -1, sortValue: direction, completedAt: -1, _id: -1 },
  });
  return pipeline;
}

async function presentPosts(destinations, source) {
  if (destinations.length === 0) return [];
  const jobs = await PublishJob.find({ _id: { $in: destinations.map((d) => d.job) } })
    .select('content mode')
    .lean();
  const jobById = new Map(jobs.map((job) => [String(job._id), job]));
  const firstMedia = jobs.map((job) => job.content?.media?.[0]?.media).filter(Boolean);
  const assets = firstMedia.length ? await MediaAsset.find({ _id: { $in: firstMedia } }) : [];
  const assetById = new Map(assets.map((asset) => [String(asset._id), asset]));
  return destinations.map((d) => {
    const job = jobById.get(String(d.job));
    const content = job?.content ?? {};
    const caption = composeCaption(content, d.platform).trim();
    const media = content.media?.[0];
    const asset = media ? assetById.get(String(media.media)) : null;
    const view = asset ? mediaView(asset) : null;
    const metrics = Object.fromEntries(METRIC_KEYS.map((k) => [k, d.metrics?.[k] ?? null]));
    return {
      id: String(d._id),
      jobId: String(d.job),
      account: { id: String(d.socialAccount), name: d.accountName, platform: d.platform },
      platform: d.platform,
      simulated: Boolean(d.simulated),
      publishedAt: d.completedAt,
      captionPreview: [...caption].slice(0, CAPTION_PREVIEW).join(''),
      mediaCount: content.media?.length ?? 0,
      thumbnailUrl: view?.thumbnailUrl ?? null,
      // Only a real post has a link, and only the one Meta gave us.
      url: d.simulated ? null : (d.externalUrl ?? null),
      metricsSource: d.metricsFetchedAt ? source : null,
      metricsFetchedAt: d.metricsFetchedAt ?? null,
      metrics,
      engagementRate: engagementRate(metrics),
    };
  });
}

export async function getPosts(workspace, membership, query, { now = new Date() } = {}) {
  const ctx = await context(workspace, membership, query, now);
  const { page, limit, sortBy, sortOrder, postId } = query;
  const [result] = await PublishDestination.aggregate([
    ...postsPipeline(workspace, ctx, { postId, sortBy, sortOrder }),
    {
      $facet: {
        items: [{ $skip: (page - 1) * limit }, { $limit: limit }],
        total: [{ $count: 'n' }],
      },
    },
  ]);
  const total = result?.total?.[0]?.n ?? 0;
  return {
    range: rangeOut(ctx),
    source: ctx.source,
    simulated: ctx.source === ANALYTICS_SOURCES.SIMULATED,
    items: await presentPosts(result?.items ?? [], ctx.source),
    page,
    limit,
    total,
    pages: Math.max(1, Math.ceil(total / limit)),
  };
}

export async function getTopPosts(workspace, membership, query, { now = new Date() } = {}) {
  const ctx = await context(workspace, membership, query, now);
  const destinations = await PublishDestination.aggregate([
    ...postsPipeline(workspace, ctx, {
      sortBy: query.metric,
      sortOrder: 'desc',
      onlyWithMetric: true,
    }),
    { $limit: query.limit },
  ]);
  return {
    range: rangeOut(ctx),
    source: ctx.source,
    simulated: ctx.source === ANALYTICS_SOURCES.SIMULATED,
    metric: query.metric,
    items: await presentPosts(destinations, ctx.source),
  };
}

export async function getPublishingPerformance(
  workspace,
  membership,
  query,
  { now = new Date() } = {},
) {
  const ctx = await context(workspace, membership, query, now);
  const [publishing, activity] = await Promise.all([
    publishingStats(workspace, ctx),
    publishingActivity(workspace, ctx),
  ]);
  return { range: rangeOut(ctx), modes: publishing, activity };
}

/* ------------------------------------------------------------------ sync status */

const runView = (run) =>
  run
    ? {
        id: String(run._id),
        source: run.source,
        status: run.status,
        since: run.since,
        until: run.until,
        attemptCount: run.attemptCount,
        createdAt: run.createdAt,
        startedAt: run.startedAt ?? null,
        finishedAt: run.finishedAt ?? null,
        result: run.result ?? null,
        error: run.error ? { code: run.error.code, message: run.error.message } : null,
      }
    : null;

/** Latest run and latest successful run per account: Map<accountId, { last, lastSuccess, active }>. */
const SUCCESSFUL_RUNS = [ANALYTICS_SYNC_STATUS.SUCCEEDED, ANALYTICS_SYNC_STATUS.PARTIAL];

/**
 * The last run and the last successful run of each account. Two indexed lookups per account
 * (each reads one index entry), so the cost does not grow with the sync history, which is
 * kept. A few accounts at a time, to keep the number of parallel queries small.
 */
async function latestRuns(workspace, accountIds) {
  const runs = new Map();
  for (let i = 0; i < accountIds.length; i += 20) {
    const rows = await Promise.all(
      accountIds.slice(i, i + 20).map((accountId) =>
        Promise.all([
          AnalyticsSyncRun.findOne({ workspace: workspace._id, socialAccount: accountId })
            .sort({ createdAt: -1 })
            .lean(),
          AnalyticsSyncRun.findOne({
            socialAccount: accountId,
            source: { $in: Object.values(ANALYTICS_SOURCES) },
            status: { $in: SUCCESSFUL_RUNS },
            workspace: workspace._id,
          })
            .sort({ finishedAt: -1 })
            .lean(),
        ]),
      ),
    );
    for (const [last, lastSuccess] of rows) {
      if (!last) continue;
      runs.set(String(last.socialAccount), {
        last: runView(last),
        lastSuccess: runView(lastSuccess),
        active: ACTIVE_SYNC_STATUSES.includes(last.status),
      });
    }
  }
  return runs;
}

export async function getSyncStatus(workspace, membership, query) {
  const accounts = await scope(workspace, membership, query);
  const [runs, status] = await Promise.all([
    latestRuns(
      workspace,
      accounts.map((a) => a._id),
    ),
    analyticsStatus(),
  ]);
  return {
    analytics: status,
    items: accounts.map((account) => ({
      account: accountView(account),
      connectionStatus: account.connectionStatus,
      ...(runs.get(String(account._id)) ?? { last: null, lastSuccess: null, active: false }),
    })),
  };
}
