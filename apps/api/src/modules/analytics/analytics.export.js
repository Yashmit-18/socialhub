/**
 * CSV exports of the analytics screens. Each file is built from the same service calls as the
 * screens (same access rules and filters), so it never holds anything the member could not
 * see, and never token material. Unavailable metrics are empty cells, never 0. Cells that a
 * spreadsheet would run as a formula are neutralised (csvCell).
 */
import {
  ANALYTICS_METRICS,
  METRIC_KEYS,
  PUBLISHING_MODES,
  SOCIAL_PLATFORMS,
} from '@socialhub/shared';
import { csvCell } from '../socialAccounts/accountExport.js';
import { PublishDestination } from '../../models/index.js';
import { analyticsScope, getAccounts, getPosts } from './analytics.service.js';

const PLATFORM = {
  [SOCIAL_PLATFORMS.FACEBOOK_PAGE]: 'Facebook Page',
  [SOCIAL_PLATFORMS.INSTAGRAM_ACCOUNT]: 'Instagram account',
};
const MAX_ROWS = 5000;
const SUMMED = METRIC_KEYS.filter((k) => ANALYTICS_METRICS[k].aggregate !== 'none');

// A number is never a formula, so it is written as is: a follower growth of -3 must stay a
// number in the spreadsheet, not the text "'-3". Every other value goes through csvCell.
const cell = (value) =>
  typeof value === 'number' && Number.isFinite(value) ? String(value) : csvCell(value);
const toCsv = (header, rows) =>
  `${[header, ...rows].map((row) => row.map(cell).join(',')).join('\r\n')}\r\n`;

const sourceLabel = (source) => (source === 'SIMULATED' ? 'Demo data (simulated)' : 'Meta');

async function accountsCsv(workspace, membership, query) {
  const data = await getAccounts(workspace, membership, query);
  const header = [
    'Account',
    'Platform',
    'Insights source',
    'Days with insights',
    ...SUMMED.map((k) => ANALYTICS_METRICS[k].rangeLabel ?? ANALYTICS_METRICS[k].label),
    'Follower growth',
    'Posts published (live)',
    'Posts published (simulated)',
    'Posts failed (live)',
    'Posts failed (simulated)',
  ];
  const rows = data.items.map((item) => {
    const byMode = Object.fromEntries(item.publishing.map((p) => [p.mode, p.byState]));
    return [
      item.account.name,
      PLATFORM[item.account.platform] ?? item.account.platform,
      sourceLabel(data.source),
      item.insights.daysReported,
      ...SUMMED.map((k) => item.insights.metrics[k]?.value ?? ''),
      item.insights.metrics.followerGrowth?.value ?? '',
      byMode[PUBLISHING_MODES.LIVE]?.PUBLISHED ?? 0,
      byMode[PUBLISHING_MODES.SIMULATED]?.PUBLISHED ?? 0,
      byMode[PUBLISHING_MODES.LIVE]?.FAILED ?? 0,
      byMode[PUBLISHING_MODES.SIMULATED]?.FAILED ?? 0,
    ];
  });
  return toCsv(header, rows);
}

async function postsCsv(workspace, membership, query) {
  // One aggregation for the whole file (at most MAX_ROWS rows), not one per page of 100: the
  // rows cannot shift between pages, and the scope queries run once.
  const { items: rows } = await getPosts(workspace, membership, {
    ...query,
    page: 1,
    limit: MAX_ROWS,
    sortBy: 'publishedAt',
    sortOrder: 'desc',
  });
  const header = [
    'Published at',
    'Account',
    'Platform',
    'Simulated post',
    'Caption',
    'Post link',
    'Metrics source',
    ...METRIC_KEYS.map((k) => ANALYTICS_METRICS[k].label),
    'Engagement rate (%)',
  ];
  return toCsv(
    header,
    rows.map((post) => [
      new Date(post.publishedAt).toISOString(),
      post.account.name,
      PLATFORM[post.platform] ?? post.platform,
      post.simulated ? 'yes' : 'no',
      post.captionPreview,
      post.url ?? '',
      post.metricsSource ? sourceLabel(post.metricsSource) : 'none',
      ...METRIC_KEYS.map((k) => post.metrics[k] ?? ''),
      post.engagementRate ?? '',
    ]),
  );
}

async function publishingCsv(workspace, membership, query) {
  // One row per destination, in the same scope as the screens.
  const { accountIds, hidden, range } = await analyticsScope(workspace, membership, query);
  const destinations = await PublishDestination.find({
    workspace: workspace._id,
    socialAccount: { $in: accountIds },
    ...(hidden.length ? { job: { $nin: hidden } } : {}),
    createdAt: { $gte: range.from, $lt: range.to },
  })
    .select(
      'job accountName platform state simulated attemptCount createdAt completedAt error.code',
    )
    .sort({ createdAt: -1 })
    .limit(MAX_ROWS)
    .lean();
  const header = [
    'Created at',
    'Finished at',
    'Account',
    'Platform',
    'Mode',
    'State',
    'Attempts',
    'Error code',
    'Job',
  ];
  return toCsv(
    header,
    destinations.map((d) => [
      new Date(d.createdAt).toISOString(),
      d.completedAt ? new Date(d.completedAt).toISOString() : '',
      d.accountName,
      PLATFORM[d.platform] ?? d.platform,
      d.simulated ? 'Simulated' : 'Live',
      d.state,
      d.attemptCount,
      d.error?.code ?? '',
      String(d.job),
    ]),
  );
}

const BUILDERS = { accounts: accountsCsv, posts: postsCsv, publishing: publishingCsv };

/** → { filename, csv } */
export async function exportAnalytics(workspace, membership, { type, ...query }) {
  const csv = await BUILDERS[type](workspace, membership, query);
  const end = query.endDate ?? new Date().toISOString().slice(0, 10);
  return { filename: `socialhub-${type}-${end}.csv`, csv };
}
