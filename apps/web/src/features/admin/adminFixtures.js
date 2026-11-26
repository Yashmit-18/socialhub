/*
 * Test data for the operator console: answers shaped exactly like admin-spec section 4 (and
 * apps/api/src/modules/admin/admin.views.js). Sample names only. Used by the *.test.jsx files
 * in this folder; nothing in the app imports it.
 */
import { jsonResponse, mockFetch } from '../../test/fetchMock.js';

export const ADMIN = {
  id: '665f1c2e9b1d4a0012ab0001',
  name: 'Petra Platform',
  email: 'petra@example.com',
  platformRole: 'PLATFORM_ADMIN',
};
export const MEMBER = {
  id: '665f1c2e9b1d4a0012ab0009',
  name: 'Ada Lovelace',
  email: 'ada@example.com',
};

export const EDDIE_ID = '665f1c2e9b1d4a0012ab34cd';
export const MALLORY_ID = '665f1c2e9b1d4a0012ab34ce';
export const WORKSPACE_ID = '66601a7c9b1d4a0012ab34ff';

export const workspaceOf = (overrides = {}) => ({
  id: 'w1',
  name: 'Acme Social',
  slug: 'acme',
  timezone: 'UTC',
  membership: { id: 'm1', role: 'OWNER', permissions: [], accountAccess: { mode: 'ALL' } },
  ...overrides,
});

const day = (offset, values = {}) => ({
  day: new Date(Date.UTC(2026, 10, 13 + offset)).toISOString().slice(0, 10),
  signups: 0,
  workspaces: 0,
  realPosts: 0,
  simulatedPosts: 0,
  failedPosts: 0,
  ...values,
});

export const overview = (overrides = {}) => ({
  generatedAt: '2026-11-26T09:41:07.512Z',
  users: {
    total: 12,
    active: 11,
    suspended: 1,
    platformAdmins: 1,
    newLast7Days: 2,
    newLast30Days: 5,
  },
  workspaces: { total: 5, livePublishing: 1, newLast7Days: 1, newLast30Days: 2 },
  accounts: { facebookPages: 9, instagramAccounts: 2 },
  publishing: {
    postsInProgress: 4,
    last7Days: { realPosts: 6, simulatedPosts: 14, failedPosts: 1 },
  },
  activity: {
    timezone: 'UTC',
    days: Array.from({ length: 14 }, (_, i) =>
      day(i, i === 3 ? { signups: 2, realPosts: 1, simulatedPosts: 2 } : { realPosts: i % 2 }),
    ),
  },
  attention: [
    { code: 'WORKER_NOT_RUNNING', severity: 'danger', count: null },
    { code: 'ACCOUNTS_SUSPENDED', severity: 'info', count: 1 },
  ],
  ...overrides,
});

export const userListItem = (overrides = {}) => ({
  id: EDDIE_ID,
  name: 'Eddie Editor',
  email: 'eddie@example.com',
  status: 'ACTIVE',
  platformRole: null,
  createdAt: '2026-11-20T08:14:03.120Z',
  lastLoginAt: '2026-11-25T17:02:44.871Z',
  suspendedAt: null,
  workspaceCount: 2,
  ...overrides,
});

export const users = (items) => ({
  items: items ?? [
    userListItem(),
    userListItem({
      id: MALLORY_ID,
      name: 'Mallory Marsh',
      email: 'mallory@example.com',
      status: 'DISABLED',
      suspendedAt: '2026-11-26T09:30:00.000Z',
      lastLoginAt: null,
      workspaceCount: 1,
    }),
    userListItem({
      id: ADMIN.id,
      name: ADMIN.name,
      email: ADMIN.email,
      platformRole: 'PLATFORM_ADMIN',
    }),
  ],
  total: items ? items.length : 3,
  page: 1,
  limit: 25,
  pages: 1,
  facets: { status: { ACTIVE: 2, DISABLED: 1 } },
});

const SUSPENSION = {
  at: '2026-11-26T09:30:00.000Z',
  by: { id: ADMIN.id, name: ADMIN.name },
  reason: 'Posted the same link to 40 Pages within one hour.',
};

export const userView = (overrides = {}) => ({
  id: EDDIE_ID,
  name: 'Eddie Editor',
  email: 'eddie@example.com',
  status: 'ACTIVE',
  platformRole: null,
  createdAt: '2026-11-20T08:14:03.120Z',
  lastLoginAt: '2026-11-25T17:02:44.871Z',
  lastActiveAt: '2026-11-26T09:20:11.004Z',
  passwordChangedAt: null,
  suspension: null,
  ...overrides,
});

/** GET /admin/users/:id for an active person who owns one workspace with no other admin. */
export const userDetail = ({ suspended = false, user = {}, actions } = {}) => ({
  user: userView({
    ...(suspended ? { status: 'DISABLED', suspension: SUSPENSION } : {}),
    ...user,
  }),
  memberships: [
    {
      id: '66601a7c9b1d4a0012ab3501',
      workspace: { id: WORKSPACE_ID, name: 'Northwind Studio', slug: 'northwind-studio' },
      role: 'OWNER',
      joinedAt: '2026-11-20T08:15:10.000Z',
      memberCount: 4,
      adminCount: 0,
      onlyOwner: true,
    },
    {
      id: '66601a7c9b1d4a0012ab3502',
      workspace: { id: '66601a7c9b1d4a0012ab3600', name: 'Acme Social', slug: 'acme' },
      role: 'EDITOR',
      joinedAt: '2026-11-21T08:15:10.000Z',
      memberCount: 3,
      adminCount: 1,
      onlyOwner: false,
    },
  ],
  membershipsTruncated: false,
  impact: {
    liveSessions: suspended ? 0 : 2,
    passwordResetPending: false,
    workspaces: { total: 2, owned: 1, ownedWithoutOtherAdmin: 1 },
    waitingPosts: { posts: 3, deliveries: 5, realDeliveries: 2, sendingNow: 0 },
  },
  actions: actions ?? {
    canSuspend: !suspended,
    canReactivate: suspended,
    blockedBy: null,
  },
});

export const workspaceList = () => ({
  items: [
    {
      id: WORKSPACE_ID,
      name: 'Northwind Studio',
      slug: 'northwind-studio',
      createdAt: '2026-11-20T08:15:10.000Z',
      publishingMode: 'LIVE',
      owner: { id: EDDIE_ID, name: 'Eddie Editor', email: 'eddie@example.com', status: 'ACTIVE' },
      memberCount: 4,
      accounts: { facebookPages: 2, instagramAccounts: 1 },
    },
    {
      id: '66601a7c9b1d4a0012ab3700',
      name: 'Harbour Cafe',
      slug: 'harbour-cafe',
      createdAt: '2026-11-18T08:15:10.000Z',
      publishingMode: 'SIMULATED',
      owner: {
        id: MALLORY_ID,
        name: 'Mallory Marsh',
        email: 'mallory@example.com',
        status: 'DISABLED',
      },
      memberCount: 2,
      accounts: { facebookPages: 1, instagramAccounts: 0 },
    },
  ],
  total: 2,
  page: 1,
  limit: 25,
  pages: 1,
  facets: { publishingMode: { SIMULATED: 1, LIVE: 1 } },
});

export const workspaceDetail = () => ({
  workspace: {
    id: WORKSPACE_ID,
    name: 'Northwind Studio',
    slug: 'northwind-studio',
    timezone: 'Asia/Kolkata',
    createdAt: '2026-11-20T08:15:10.000Z',
    publishingMode: 'LIVE',
    publishingModeChangedAt: '2026-11-24T06:02:00.000Z',
    lastActivityAt: null,
  },
  members: [
    {
      id: '66601a7c9b1d4a0012ab3501',
      user: { id: EDDIE_ID, name: 'Eddie Editor', email: 'eddie@example.com', status: 'ACTIVE' },
      role: 'OWNER',
      joinedAt: '2026-11-20T08:15:10.000Z',
    },
    {
      id: '66601a7c9b1d4a0012ab3503',
      user: {
        id: MALLORY_ID,
        name: 'Mallory Marsh',
        email: 'mallory@example.com',
        status: 'DISABLED',
      },
      role: 'EDITOR',
      joinedAt: '2026-11-21T08:15:10.000Z',
    },
  ],
  membersTruncated: false,
  counts: {
    members: 2,
    pendingInvitations: 1,
    connections: { ACTIVE: 2, EXPIRED: 0, REVOKED: 0, ERROR: 0, DISCONNECTED: 1 },
    accounts: { facebookPages: 2, instagramAccounts: 1 },
    drafts: 7,
    mediaFiles: 12,
    mediaBytes: 48211003,
    posts: {
      SCHEDULED: 3,
      QUEUED: 0,
      PROCESSING: 0,
      PUBLISHED: 41,
      PARTIALLY_PUBLISHED: 1,
      FAILED: 2,
      CANCELLED: 4,
    },
    facebookGroups: 18,
    openSharingTasks: 5,
  },
});

export const system = () => ({
  generatedAt: '2026-11-26T09:41:07.512Z',
  api: { version: '0.1.0', uptimeSeconds: 10872, environment: 'production' },
  database: { state: 'connected', transactions: true },
  publishing: {
    mode: 'LIVE',
    queue: { status: 'READY', counts: { waiting: 0, active: 0, delayed: 4 } },
    worker: { status: 'RUNNING', count: 1 },
    deliveries: {
      waiting: 4,
      sending: 0,
      late: 0,
      latePosts: 0,
      interrupted: 0,
      nextDueAt: '2026-11-26T12:00:00.000Z',
      lastFinishedAt: null,
    },
  },
  analytics: {
    mode: 'LIVE',
    queue: { status: 'READY', counts: null },
    worker: { status: 'UNKNOWN', count: null },
  },
  storage: { driver: 's3', publicUrls: true },
  email: { configured: false },
});

export const auditEntry = (overrides = {}) => ({
  id: '6665a0019b1d4a0012ab9001',
  action: 'platform.user_suspended',
  actor: { id: ADMIN.id, name: ADMIN.name },
  target: { type: 'user', id: EDDIE_ID, label: 'Eddie Editor' },
  metadata: {
    email: 'eddie@example.com',
    reason: 'Posted the same link to 40 Pages within one hour.',
    sessionsEnded: 2,
    resetLinkCleared: false,
  },
  createdAt: '2026-11-26T09:30:00.000Z',
  ...overrides,
});

export const auditLog = (items, nextCursor = null) => ({
  items: items ?? [
    auditEntry(),
    auditEntry({
      id: '6665a0019b1d4a0012ab9000',
      action: 'platform.admin_granted',
      actor: { id: null, name: 'Command line' },
      target: { type: 'user', id: ADMIN.id, label: ADMIN.name },
      metadata: { email: ADMIN.email, via: 'CLI' },
      createdAt: '2026-11-20T09:30:00.000Z',
    }),
  ],
  nextCursor,
});

/** A signed-in session plus every admin answer; `routes` adds or replaces answers. */
export function adminApi({ user = ADMIN, workspaces = [workspaceOf()], routes = {} } = {}) {
  return mockFetch({
    'POST /auth/refresh': () => jsonResponse(200, { user, accessToken: 'access' }),
    'GET /workspaces': () => jsonResponse(200, { items: workspaces }),
    'GET /admin/overview': () => jsonResponse(200, overview()),
    'GET /admin/users': () => jsonResponse(200, users()),
    [`GET /admin/users/${EDDIE_ID}`]: () => jsonResponse(200, userDetail()),
    [`GET /admin/users/${MALLORY_ID}`]: () => jsonResponse(200, userDetail({ suspended: true })),
    'GET /admin/workspaces': () => jsonResponse(200, workspaceList()),
    [`GET /admin/workspaces/${WORKSPACE_ID}`]: () => jsonResponse(200, workspaceDetail()),
    'GET /admin/system': () => jsonResponse(200, system()),
    'GET /admin/audit-log': () => jsonResponse(200, auditLog()),
    ...routes,
  });
}
