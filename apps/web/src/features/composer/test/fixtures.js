import { jsonResponse, mockFetch } from '../../../test/fetchMock.js';

/**
 * Test data for composer tests. Accounts come in both API shapes:
 *  - legacy (Phase 2): stored connectionStatus / publishingStatus only;
 *  - Phase 3: plus the computed `health` object (preferred by model/accounts.js).
 */

export const user = { id: 'u1', name: 'Ada Lovelace', email: 'ada@example.com' };

export const workspace = (role = 'EDITOR', overrides = {}) => ({
  id: 'w1',
  name: 'Acme Social',
  slug: 'acme',
  timezone: 'UTC',
  membership: {
    id: 'm1',
    role,
    permissions: [],
    accountAccess: { mode: 'ALL', socialAccountIds: [] },
  },
  ...overrides,
});

export const fbPage = (overrides = {}) => ({
  id: 'acc-fb-1',
  platform: 'FACEBOOK_PAGE',
  externalId: '5001',
  name: 'Acme Store',
  category: 'Retail',
  pictureUrl: null,
  connectionStatus: 'ACTIVE',
  connectionStatusReason: null,
  publishingStatus: 'READY',
  publishingStatusReason: null,
  connection: { id: 'c1', provider: 'FACEBOOK_LOGIN', displayName: 'Alice Facebook' },
  ...overrides,
});

export const igAccount = (overrides = {}) => ({
  id: 'acc-ig-1',
  platform: 'INSTAGRAM_ACCOUNT',
  externalId: '17841400000000010',
  name: 'Acme Instagram',
  username: 'acme',
  instagramAccountType: 'BUSINESS',
  pictureUrl: null,
  connectionStatus: 'ACTIVE',
  connectionStatusReason: null,
  publishingStatus: 'READY',
  publishingStatusReason: null,
  linkedPage: { id: 'acc-fb-1', externalId: '5001', name: 'Acme Store' },
  connection: { id: 'c1', provider: 'FACEBOOK_LOGIN', displayName: 'Alice Facebook' },
  ...overrides,
});

/** Adds the Phase 3 `health` object to an account fixture. */
export const withHealth = (account, health = {}) => ({
  ...account,
  health: {
    connectionStatus: 'ACTIVE',
    connectionStatusReason: null,
    readiness: 'READY',
    readinessReasons: [],
    eligibility: { eligible: true, createContent: true, missingPermissions: [] },
    attention: [],
    needsAttention: false,
    ...health,
  },
});

/** A representative account list: 2 Pages + 2 Instagram accounts, one of them restricted. */
export const accountList = () => [
  fbPage(),
  fbPage({ id: 'acc-fb-2', externalId: '5002', name: 'Acme Outlet', category: 'Shopping' }),
  igAccount(),
  withHealth(
    igAccount({
      id: 'acc-ig-2',
      externalId: '17841400000000011',
      name: 'Acme Studio',
      username: 'acme.studio',
      instagramAccountType: 'CREATOR',
      linkedPage: null,
    }),
    {
      readiness: 'RESTRICTED',
      readinessReasons: ['Missing permission: instagram_content_publish'],
      needsAttention: true,
    },
  ),
];

/**
 * Installs the standard API mocks for an authenticated composer session. `routes` adds or
 * overrides handlers ("METHOD /path" → handler).
 */
export function setupComposerApi({ role = 'EDITOR', accounts = accountList(), routes = {} } = {}) {
  return mockFetch({
    'POST /auth/refresh': () => jsonResponse(200, { user, accessToken: 'access' }),
    'GET /workspaces': () => jsonResponse(200, { items: [workspace(role)] }),
    'GET /workspaces/w1/social-accounts': () =>
      jsonResponse(200, {
        items: accounts,
        total: accounts.length,
        page: 1,
        limit: 500,
        pages: 1,
      }),
    ...routes,
  });
}
