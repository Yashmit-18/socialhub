/** Test data shaped like the analytics API answers (MOCKED: no server, Redis or Meta). */
export const WS = 'w1';
export const BASE = `/workspaces/${WS}/analytics`;

export const workspace = (role = 'OWNER', timezone = 'UTC') => ({
  id: WS,
  name: 'Acme Social',
  slug: 'acme',
  timezone,
  membership: {
    id: 'm1',
    role,
    permissions: [],
    accountAccess: { mode: 'ALL', socialAccountIds: [] },
  },
});

export const status = (overrides = {}) => ({
  mode: 'DISABLED',
  source: null,
  canSync: false,
  reason: 'ANALYTICS_DISABLED',
  message:
    'Insights are not read from Meta on this server yet. Publishing figures from SocialHub are still shown.',
  queue: { status: 'NOT_CONFIGURED' },
  ...overrides,
});

const metric = (value, reporting = value === null ? 0 : 2, scope = 3) => ({
  value,
  accountsReporting: reporting,
  accountsInScope: scope,
});

export const insightsMetrics = (overrides = {}) => ({
  reach: metric(350),
  impressions: metric(null),
  views: metric(180, 1),
  likes: metric(20, 1),
  comments: metric(null),
  shares: metric(null),
  saves: metric(null),
  engagement: metric(null),
  followers: metric(1510),
  profileVisits: metric(null),
  watchTimeSec: metric(null),
  followerGrowth: metric(10, 1),
  ...overrides,
});

export const publishingMode = (overrides = {}) => ({
  mode: 'SIMULATED',
  simulated: true,
  jobs: {
    total: 3,
    byStatus: {
      SCHEDULED: 0,
      QUEUED: 0,
      PROCESSING: 1,
      PUBLISHED: 1,
      PARTIALLY_PUBLISHED: 1,
      FAILED: 0,
      CANCELLED: 0,
    },
  },
  destinations: {
    total: 6,
    byState: {
      SCHEDULED: 1,
      QUEUED: 0,
      PROCESSING: 0,
      RETRY_SCHEDULED: 0,
      PUBLISHED: 3,
      FAILED: 1,
      CANCELLED: 1,
    },
  },
  retries: { destinationsRetried: 2, extraAttempts: 3 },
  successRate: 75,
  averageDurationSec: 2.7,
  ...overrides,
});

const range = { startDate: '2026-11-01', endDate: '2026-11-03', timeZone: 'UTC' };

export const overview = ({
  hasData = true,
  metrics = insightsMetrics(),
  source = 'META',
  publishing = [publishingMode()],
  analytics = status(),
} = {}) => ({
  range,
  accountCount: 3,
  publishing,
  insights: { source, simulated: source === 'SIMULATED', hasData, metrics },
  analytics,
});

export const trends = ({ source = 'META', points } = {}) => ({
  range,
  publishing: [
    {
      mode: 'SIMULATED',
      simulated: true,
      series: [
        { day: '2026-11-01', created: 2, published: 2, failed: 0 },
        { day: '2026-11-02', created: 2, published: 1, failed: 1 },
        { day: '2026-11-03', created: 0, published: 0, failed: 0 },
      ],
    },
  ],
  insights: {
    source,
    simulated: source === 'SIMULATED',
    hasData: true,
    series: points ?? [
      {
        day: '2026-11-01',
        accountsReporting: 1,
        metrics: { reach: 100, views: 150, engagement: null, followers: 500 },
      },
      {
        day: '2026-11-02',
        accountsReporting: 2,
        metrics: { reach: 250, views: null, engagement: null, followers: 1510 },
      },
      {
        day: '2026-11-03',
        accountsReporting: 1,
        metrics: { reach: null, views: 30, engagement: null, followers: null },
      },
    ],
  },
});

export const accountsList = [
  {
    id: 'a'.repeat(24),
    platform: 'FACEBOOK_PAGE',
    name: 'Acme Store',
    username: null,
    pictureUrl: null,
  },
  {
    id: 'b'.repeat(24),
    platform: 'INSTAGRAM_ACCOUNT',
    name: 'Acme Instagram',
    username: 'acme',
    pictureUrl: null,
  },
];

export const accounts = () => ({
  range,
  source: 'META',
  simulated: false,
  items: accountsList.map((account, i) => ({
    account,
    connectionStatus: 'ACTIVE',
    publishing: [
      {
        mode: 'SIMULATED',
        simulated: true,
        total: 2,
        byState: {
          PUBLISHED: 2 - i,
          FAILED: i,
          SCHEDULED: 0,
          QUEUED: 0,
          PROCESSING: 0,
          RETRY_SCHEDULED: 0,
          CANCELLED: 0,
        },
        successRate: i ? 50 : 100,
      },
    ],
    insights: {
      daysReported: i ? 0 : 3,
      metrics: insightsMetrics(
        i
          ? { reach: metric(null, 0, 1), views: metric(null, 0, 1), followers: metric(null, 0, 1) }
          : {},
      ),
    },
    sync: null,
  })),
});

export const topPosts = (items = []) => ({
  range,
  source: 'META',
  simulated: false,
  metric: 'engagement',
  items,
});

export const post = (overrides = {}) => ({
  id: 'p'.repeat(24),
  jobId: 'j'.repeat(24),
  account: { id: 'a'.repeat(24), name: 'Acme Store', platform: 'FACEBOOK_PAGE' },
  platform: 'FACEBOOK_PAGE',
  simulated: false,
  publishedAt: '2026-11-02T10:00:00.000Z',
  captionPreview: 'Winter collection drops Friday',
  mediaCount: 0,
  thumbnailUrl: null,
  url: 'https://www.facebook.com/123_456',
  metricsSource: 'META',
  metricsFetchedAt: '2026-11-03T10:00:00.000Z',
  metrics: {
    reach: 400,
    impressions: null,
    views: null,
    likes: 30,
    comments: null,
    shares: null,
    saves: null,
    engagement: 40,
    followers: null,
    profileVisits: null,
    watchTimeSec: null,
    avgWatchTimeSec: null,
  },
  engagementRate: 10,
  ...overrides,
});

export const syncStatus = (analytics = status()) => ({
  analytics,
  items: accountsList.map((account) => ({
    account,
    connectionStatus: 'ACTIVE',
    last: null,
    lastSuccess: null,
    active: false,
  })),
});
