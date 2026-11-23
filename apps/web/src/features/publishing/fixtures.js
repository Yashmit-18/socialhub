/** Test data shaped like the publishing API responses (see the contract in docs). */
export const WS = 'w1';
export const BASE = `/workspaces/${WS}`;

export const workspace = (role = 'OWNER') => ({
  id: WS,
  name: 'Acme Social',
  slug: 'acme',
  timezone: 'UTC',
  membership: {
    id: 'm1',
    role,
    permissions: [],
    accountAccess: { mode: 'ALL', socialAccountIds: [] },
  },
});

export const status = (overrides = {}) => ({
  mode: 'LIVE',
  canPublish: true,
  reason: null,
  message: null,
  // The member-facing status: no server-wide counts, worker numbers or storage driver.
  queue: { status: 'READY' },
  worker: { status: 'RUNNING' },
  storage: { publicUrls: true },
  ...overrides,
});

export const summary = (counts = {}) => {
  const all = {
    SCHEDULED: 0,
    QUEUED: 0,
    PROCESSING: 0,
    PUBLISHED: 0,
    PARTIALLY_PUBLISHED: 0,
    FAILED: 0,
    CANCELLED: 0,
    ...counts,
  };
  return { counts: all, total: Object.values(all).reduce((a, b) => a + b, 0) };
};

let nextId = 1;

export const destination = (overrides = {}) => ({
  id: `d${nextId++}`,
  socialAccountId: 'a1',
  platform: 'FACEBOOK_PAGE',
  accountName: 'Acme Store',
  accountUsername: null,
  state: 'PUBLISHED',
  simulated: false,
  attemptCount: 1,
  maxAttempts: 4,
  scheduledAt: null,
  nextAttemptAt: null,
  queuedAt: '2026-11-21T09:00:00.000Z',
  processingAt: '2026-11-21T09:00:01.000Z',
  completedAt: '2026-11-21T09:00:02.000Z',
  externalPostId: null,
  externalUrl: null,
  error: null,
  warnings: [],
  attempts: [],
  canRetry: false,
  canCancel: false,
  ...overrides,
});

export const job = (overrides = {}) => {
  const destinations = overrides.destinations ?? [destination()];
  return {
    id: `j${nextId++}`,
    status: 'PUBLISHED',
    mode: 'LIVE',
    simulated: false,
    contentPackageId: 'p1',
    content: { captionPreview: 'Autumn sale starts today', mediaCount: 2, hasVideo: false },
    counts: {},
    destinationCount: destinations.length,
    hiddenDestinationCount: 0,
    scheduledAt: null,
    createdBy: { id: 'u1', name: 'Olivia Owner' },
    createdAt: '2026-11-21T09:00:00.000Z',
    startedAt: null,
    completedAt: null,
    canCancel: false,
    ...overrides,
    destinations,
  };
};

export const draft = (overrides = {}) => ({
  id: 'c00000000000000000000001',
  caption: 'Winter collection teaser',
  media: [{ id: 'm1' }],
  targetAccountIds: ['a1', 'a2'],
  updatedAt: '2026-11-21T08:00:00.000Z',
  ...overrides,
});
