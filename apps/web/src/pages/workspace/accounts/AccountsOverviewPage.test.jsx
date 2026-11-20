// Frontend interaction tests: the SocialHub API is mocked with fetch; no Meta API is involved.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAccessToken } from '../../../lib/api.js';
import { redirectTo } from '../../../lib/browser.js';
import { apiError, jsonResponse, mockFetch } from '../../../test/fetchMock.js';
import { renderApp } from '../../../test/renderApp.jsx';

vi.mock('../../../lib/browser.js', () => ({ redirectTo: vi.fn() }));
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

/* ------------------------------------------------------------------------ fixtures */
// Trimmed from responses captured from the API running against the Meta simulator.

const user = { id: 'u1', name: 'Olivia Owner', email: 'olivia@example.com' };
const FB_LOGIN = '6afff51ce8bea719d246c5bb';
const IG_LOGIN = '6afff51ce8bea719d246c5c4';
const OTHER_WORKSPACE = '6afff51be8bea719d246c5f0';
const SYNCED = '2026-11-20T07:22:04.434Z';
const LIST = 'GET /workspaces/w1/social-accounts';
const CROSS_LIST = 'GET /social-accounts';

const EXPIRED_REASON = 'The access token has expired. Reconnect to restore access.';
const NO_CREATE_CONTENT =
  'This login has no Page role that allows creating content (CREATE_CONTENT task)';
const SYNC_FAILED_MESSAGE =
  'The last synchronization did not complete. The information shown may be out of date.';
const DISCONNECTED_REASON = 'Disconnected by a workspace manager.';

function workspace(role) {
  const full = role === 'OWNER' || role === 'ADMIN';
  return {
    id: 'w1',
    name: 'Acme Social',
    slug: 'acme',
    timezone: 'UTC',
    membership: {
      id: 'm1',
      role,
      permissions: [],
      accountAccess: { mode: full ? 'ALL' : 'SELECTED', socialAccountIds: [] },
    },
  };
}

const betaWorkspace = {
  id: OTHER_WORKSPACE,
  name: 'Beta Brands',
  slug: 'beta',
  timezone: 'UTC',
  membership: {
    id: 'm2',
    role: 'VIEWER',
    permissions: [],
    accountAccess: { mode: 'SELECTED', socialAccountIds: ['6afff51ce8bea719d246c5e1'] },
  },
};

const integration = (facebook = true, instagram = true) => ({
  graphApiVersion: 'v27.0',
  facebook: {
    configured: facebook,
    ready: facebook,
    scopes: ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts'],
  },
  instagram: {
    configured: instagram,
    ready: instagram,
    scopes: ['instagram_business_basic', 'instagram_business_content_publish'],
  },
  checks: [],
});

const READY = {
  connectionStatus: 'ACTIVE',
  connectionStatusReason: null,
  readiness: 'READY',
  readinessReasons: [],
  eligibility: { eligible: true, createContent: true, missingPermissions: [] },
  attention: [],
  needsAttention: false,
};
const RESTRICTED = {
  ...READY,
  readiness: 'RESTRICTED',
  readinessReasons: [NO_CREATE_CONTENT],
  eligibility: { eligible: false, createContent: false, missingPermissions: [] },
  attention: [{ code: 'MISSING_CREATE_CONTENT', message: NO_CREATE_CONTENT }],
  needsAttention: true,
};
const EXPIRED = {
  connectionStatus: 'EXPIRED',
  connectionStatusReason: EXPIRED_REASON,
  readiness: 'UNAVAILABLE',
  readinessReasons: [EXPIRED_REASON],
  eligibility: { eligible: true, createContent: true, missingPermissions: [] },
  attention: [{ code: 'CONNECTION_EXPIRED', message: EXPIRED_REASON }],
  needsAttention: true,
};

const alice = {
  id: FB_LOGIN,
  provider: 'FACEBOOK_LOGIN',
  displayName: 'Alice',
  pictureUrl: 'https://example.fbcdn.net/100.jpg',
  status: 'ACTIVE',
};
const solo = {
  id: IG_LOGIN,
  provider: 'INSTAGRAM_LOGIN',
  displayName: '@solo.creator',
  pictureUrl: 'https://example.cdninstagram.com/17841400000000099.jpg',
  status: 'ACTIVE',
};

const base = {
  workspace: 'w1',
  connectionStatus: 'ACTIVE',
  publishingStatus: 'READY',
  lastSyncedAt: SYNCED,
  createdAt: SYNCED,
  updatedAt: SYNCED,
  linkedPage: null,
  health: READY,
};
const acmeStore = {
  ...base,
  id: '6afff51ce8bea719d246c5bd',
  platform: 'FACEBOOK_PAGE',
  externalId: '5001',
  name: 'Acme Store',
  category: 'Brand',
  pictureUrl: 'https://example.fbcdn.net/page-5001.jpg',
  tasks: ['ANALYZE', 'ADVERTISE', 'MODERATE', 'CREATE_CONTENT', 'MANAGE'],
  connection: alice,
};
const acmeLabs = {
  ...base,
  id: '6afff51ce8bea719d246c5bf',
  platform: 'FACEBOOK_PAGE',
  externalId: '5002',
  name: 'Acme Labs',
  category: 'Brand',
  pictureUrl: 'https://example.fbcdn.net/page-5002.jpg',
  tasks: ['ANALYZE'],
  publishingStatus: 'RESTRICTED',
  connection: alice,
  health: RESTRICTED,
};
const acmeInstagram = {
  ...base,
  id: '6afff51ce8bea719d246c5c1',
  platform: 'INSTAGRAM_ACCOUNT',
  externalId: '17841400000000010',
  name: 'Acme',
  username: 'acme',
  pictureUrl: 'https://example.cdninstagram.com/17841400000000010.jpg',
  tasks: ['ANALYZE', 'ADVERTISE', 'MODERATE', 'CREATE_CONTENT', 'MANAGE'],
  connection: alice,
  linkedPage: { id: '6afff51ce8bea719d246c5bd', externalId: '5001', name: 'Acme Store' },
};
const soloCreator = {
  ...base,
  id: '6afff51ce8bea719d246c5c6',
  platform: 'INSTAGRAM_ACCOUNT',
  externalId: '17841400000000099',
  name: 'Solo Creator',
  username: 'solo.creator',
  instagramAccountType: 'CREATOR',
  pictureUrl: 'https://example.cdninstagram.com/17841400000000099.jpg',
  connection: solo,
  health: { ...READY, eligibility: { ...READY.eligibility, createContent: null } },
};
const ACCOUNTS = [acmeInstagram, acmeLabs, acmeStore, soloCreator];

/** A destination after its Facebook login expired (shapes: listAfterExpiry). */
const expired = (account) => ({
  ...account,
  connectionStatus: 'EXPIRED',
  publishingStatus: 'UNAVAILABLE',
  connection: { ...account.connection, status: 'EXPIRED' },
  health: EXPIRED,
});

function login(overrides = {}) {
  return {
    ...alice,
    statusReason: null,
    grantedScopes: ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts'],
    declinedScopes: [],
    missingScopes: { required: [], recommended: [], publishing: [] },
    tokenExpiresAt: '2027-01-19T07:22:04.000Z',
    dataAccessExpiresAt: '2027-02-18T07:22:04.000Z',
    expiringSoonAt: null,
    lastSyncedAt: SYNCED,
    lastSyncAttemptAt: SYNCED,
    lastSyncOutcome: 'SUCCESS',
    syncInProgress: false,
    lastError: null,
    attention: [],
    needsAttention: false,
    connectedBy: { id: 'u1', name: 'Olivia Owner' },
    disconnectedAt: null,
    accountCount: 3,
    accountCounts: { facebookPages: 2, instagramAccounts: 1, needsAttention: 1 },
    createdAt: SYNCED,
    updatedAt: SYNCED,
    ...overrides,
  };
}

const instagramLogin = (overrides = {}) =>
  login({
    ...solo,
    grantedScopes: ['instagram_business_basic', 'instagram_business_content_publish'],
    tokenExpiresAt: '2027-01-19T07:21:08.313Z',
    dataAccessExpiresAt: null,
    accountCount: 1,
    accountCounts: { facebookPages: 0, instagramAccounts: 1, needsAttention: 0 },
    ...overrides,
  });

const expiredLogin = login({
  status: 'EXPIRED',
  statusReason: EXPIRED_REASON,
  lastSyncOutcome: 'TOKEN_EXPIRED',
  lastError: { code: 'TOKEN_EXPIRED', message: 'Session has expired', at: SYNCED },
  attention: [{ code: 'CONNECTION_EXPIRED', message: EXPIRED_REASON }],
  needsAttention: true,
});

const syncFailed = (overrides = {}) => ({
  lastSyncOutcome: 'RATE_LIMITED',
  lastError: { code: 'RATE_LIMITED', message: 'Application request limit reached', at: SYNCED },
  attention: [{ code: 'SYNC_FAILED', message: SYNC_FAILED_MESSAGE }],
  needsAttention: true,
  ...overrides,
});

const ZERO_ACCOUNTS = {
  total: 0,
  facebookPages: 0,
  instagramAccounts: 0,
  connected: 0,
  needsAttention: 0,
  ready: 0,
  restricted: 0,
  unavailable: 0,
};

function summary({ accounts = {}, connections = {}, ...rest } = {}) {
  return {
    accounts: {
      total: 4,
      facebookPages: 2,
      instagramAccounts: 2,
      connected: 4,
      needsAttention: 1,
      ready: 3,
      restricted: 1,
      unavailable: 0,
      ...accounts,
    },
    connections:
      connections === null
        ? null
        : {
            total: 2,
            facebook: 1,
            instagram: 1,
            active: 2,
            expired: 0,
            revoked: 0,
            disconnected: 0,
            error: 0,
            expiringSoon: 0,
            needsAttention: 0,
            ...connections,
          },
    meta: { facebookConfigured: true, instagramConfigured: true },
    truncated: false,
    ...rest,
  };
}

const countBy = (items, pick) =>
  items.reduce((out, item) => ({ ...out, [pick(item)]: (out[pick(item)] ?? 0) + 1 }), {});

/** A small stand-in for the list endpoint: applies the query the page sent. */
function listRoute(items, { truncated = false } = {}) {
  return ({ url }) => {
    const p = url.searchParams;
    const q = (p.get('q') ?? '').toLowerCase();
    const matches = items.filter(
      (a) =>
        (!p.get('platform') || a.platform === p.get('platform')) &&
        (!p.get('status') || a.health.connectionStatus === p.get('status')) &&
        (!p.get('readiness') || a.health.readiness === p.get('readiness')) &&
        (!p.get('workspaceId') || a.workspace?.id === p.get('workspaceId')) &&
        (!p.get('connectionId') || a.connection?.id === p.get('connectionId')) &&
        (p.get('attention') !== 'true' || a.health.needsAttention) &&
        (!q || a.name.toLowerCase().includes(q)),
    );
    const limit = Number(p.get('limit') ?? 500);
    const page = Number(p.get('page') ?? 1);
    return jsonResponse(200, {
      items: matches.slice((page - 1) * limit, page * limit),
      total: matches.length,
      page,
      limit,
      pages: Math.max(1, Math.ceil(matches.length / limit)),
      facets: {
        platform: countBy(items, (a) => a.platform),
        status: countBy(items, (a) => a.health.connectionStatus),
        readiness: countBy(items, (a) => a.health.readiness),
        attention: items.filter((a) => a.health.needsAttention).length,
      },
      truncated,
    });
  };
}

const MANAGERS = new Set(['OWNER', 'ADMIN']);

function setup(role, routes = {}) {
  return mockFetch({
    'POST /auth/refresh': () => jsonResponse(200, { user, accessToken: 'access' }),
    'GET /workspaces': () => jsonResponse(200, { items: [workspace(role)] }),
    'GET /integrations/meta': () => jsonResponse(200, integration()),
    'GET /workspaces/w1/social-accounts/summary': () =>
      jsonResponse(200, summary(MANAGERS.has(role) ? {} : { connections: null })),
    [LIST]: listRoute(ACCOUNTS),
    'GET /workspaces/w1/social-connections': () =>
      jsonResponse(200, { items: [login(), instagramLogin()] }),
    ...routes,
  });
}

/** Query of the latest request made by the all-accounts table (25 per page). */
const lastTableQuery = (mock, key = LIST) =>
  mock.calls.filter((c) => c.key === key && c.url.searchParams.get('limit') === '25').at(-1)?.url
    .searchParams;

const stat = (label) =>
  within(screen.getByRole('list', { name: 'Account totals' }))
    .getByText(label)
    .closest('li');

async function expectStat(label, value) {
  await screen.findByRole('list', { name: 'Account totals' });
  expect(await within(stat(label)).findByText(value)).toBeInTheDocument();
}

const lastBody = (mock, key) => JSON.parse(mock.calls.findLast((c) => c.key === key).init.body);

beforeEach(() => {
  setAccessToken(null);
  vi.clearAllMocks();
});
afterEach(() => vi.unstubAllGlobals());

/* --------------------------------------------------------------------------- tests */

describe('Social accounts overview: figures', () => {
  it('shows owners every login and account figure from the summary', async () => {
    setup('OWNER', {
      'GET /workspaces/w1/social-accounts/summary': () =>
        jsonResponse(
          200,
          summary({
            accounts: {
              total: 12,
              facebookPages: 7,
              instagramAccounts: 5,
              connected: 11,
              needsAttention: 4,
              ready: 6,
              restricted: 4,
              unavailable: 2,
            },
            connections: { total: 6, facebook: 3, instagram: 3, expired: 2, revoked: 1 },
          }),
        ),
    });
    renderApp('/w/acme/accounts');

    await expectStat('Facebook logins', '3');
    await expectStat('Facebook Pages', '7');
    await expectStat('Instagram accounts', '5');
    await expectStat('Connected accounts', '11');
    await expectStat('Expired logins', '2');
    await expectStat('Revoked logins', '1');
    await expectStat('Accounts needing attention', '4');
    expect(
      within(screen.getByRole('list', { name: 'Account totals' })).getAllByRole('listitem'),
    ).toHaveLength(7);
    expect(within(stat('Facebook logins')).getByText('Plus 3 Instagram logins')).toBeVisible();
    expect(within(stat('Connected accounts')).getByText('of 12 accounts')).toBeVisible();

    // Readiness breakdown: the permission labels, never a claim that publishing works.
    const readiness = screen.getByRole('region', { name: 'Publishing readiness' });
    expect(
      within(readiness).getByText(/Publishing itself is not available in SocialHub yet/),
    ).toBeInTheDocument();
    for (const [label, count] of [
      ['Publishing permissions OK', '6'],
      ['Missing publishing access', '4'],
      ['Unavailable', '2'],
    ]) {
      expect(
        within(within(readiness).getByText(label).closest('li')).getByText(count),
      ).toBeVisible();
    }
    expect(
      within(readiness).getByRole('img', { name: /Publishing readiness of 12 accounts/ }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Ready to publish/i)).not.toBeInTheDocument();
  });

  it('never shows login figures, login actions or login requests to editors', async () => {
    const mock = setup('EDITOR', {
      'GET /workspaces/w1/social-accounts/summary': () =>
        jsonResponse(
          200,
          summary({
            accounts: {
              total: 2,
              facebookPages: 2,
              instagramAccounts: 0,
              connected: 2,
              needsAttention: 1,
              ready: 1,
              restricted: 1,
            },
            connections: null,
          }),
        ),
      [LIST]: listRoute([acmeStore, acmeLabs]),
    });
    // A login filter in a shared link is not offered to editors, so it is not sent either.
    renderApp(`/w/acme/accounts?connectionId=${FB_LOGIN}`);

    await expectStat('Facebook Pages', '2');
    const totals = screen.getByRole('list', { name: 'Account totals' });
    for (const label of ['Facebook logins', 'Expired logins', 'Revoked logins']) {
      expect(within(totals).queryByText(label)).not.toBeInTheDocument();
    }
    expect(within(totals).getAllByRole('listitem')).toHaveLength(4);

    // The table lists the accounts the editor can use, without links to the logins.
    const table = screen.getByRole('table', { name: 'Social accounts' });
    expect(await within(table).findByRole('link', { name: 'Acme Store' })).toHaveAttribute(
      'href',
      `/w/acme/accounts/a/${acmeStore.id}`,
    );
    expect(within(table).getAllByText('Alice')).toHaveLength(2);
    expect(within(table).queryByRole('link', { name: 'Alice' })).not.toBeInTheDocument();

    // Problems are listed, with who can fix login problems; no login actions.
    const attention = await screen.findByRole('region', { name: 'Needs attention' });
    expect(within(attention).getByRole('link', { name: 'Acme Labs' })).toBeInTheDocument();
    expect(
      within(attention).getByText(/can only be fixed by a workspace owner or admin/),
    ).toBeInTheDocument();
    expect(
      within(attention).queryByRole('button', { name: /Reconnect|Sync now/ }),
    ).not.toBeInTheDocument();

    expect(screen.queryByRole('button', { name: 'Sync all logins' })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Filter by login' })).not.toBeInTheDocument();
    expect(lastTableQuery(mock).has('connectionId')).toBe(false);
    expect(mock.count('GET /workspaces/w1/social-connections')).toBe(0);
  });

  it('reports a failed summary and loads it again on retry', async () => {
    let fail = true;
    setup('OWNER', {
      'GET /workspaces/w1/social-accounts/summary': () =>
        fail
          ? apiError(500, 'INTERNAL_ERROR', 'The server had a problem')
          : jsonResponse(200, summary()),
    });
    renderApp('/w/acme/accounts');

    expect(await screen.findByText('Could not load the account totals')).toBeInTheDocument();
    expect(screen.getByText('The server had a problem')).toBeInTheDocument();
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await expectStat('Facebook Pages', '2');
    expect(screen.getByRole('region', { name: 'Publishing readiness' })).toBeInTheDocument();
  });
});

describe('Social accounts overview: all-accounts table', () => {
  it('sends search, status, attention and platform filters to the account list', async () => {
    const mock = setup('OWNER');
    renderApp('/w/acme/accounts');
    const table = await screen.findByRole('table', { name: 'Social accounts' });
    await within(table).findByRole('link', { name: 'Acme Store' });
    expect(Object.fromEntries(lastTableQuery(mock))).toEqual({
      sort: 'name',
      page: '1',
      limit: '25',
    });

    await userEvent.type(screen.getByRole('searchbox', { name: 'Search accounts' }), 'acme');
    await waitFor(() => expect(lastTableQuery(mock).get('q')).toBe('acme'));

    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Filter by connection status' }),
      'ACTIVE',
    );
    await waitFor(() => expect(lastTableQuery(mock).get('status')).toBe('ACTIVE'));

    const attentionToggle = screen.getByRole('button', { name: /^Needs attention/ });
    await userEvent.click(attentionToggle);
    await waitFor(() => expect(lastTableQuery(mock).get('attention')).toBe('true'));
    expect(attentionToggle).toHaveAttribute('aria-pressed', 'true');

    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Filter by platform' }),
      'FACEBOOK_PAGE',
    );
    await waitFor(() => expect(lastTableQuery(mock).get('platform')).toBe('FACEBOOK_PAGE'));

    expect(Object.fromEntries(lastTableQuery(mock))).toEqual({
      q: 'acme',
      status: 'ACTIVE',
      attention: 'true',
      platform: 'FACEBOOK_PAGE',
      sort: 'name',
      page: '1',
      limit: '25',
    });
    await waitFor(() =>
      expect(within(table).queryByRole('link', { name: 'Acme Store' })).not.toBeInTheDocument(),
    );
    expect(within(table).getByRole('link', { name: 'Acme Labs' })).toBeInTheDocument();
  });

  it('sorts through the column headers and the sort menu', async () => {
    const mock = setup('OWNER');
    renderApp('/w/acme/accounts');
    const table = await screen.findByRole('table', { name: 'Social accounts' });
    await within(table).findByRole('link', { name: 'Acme Store' });

    await userEvent.click(within(table).getByRole('button', { name: /^Last sync/ }));
    await waitFor(() => expect(lastTableQuery(mock).get('sort')).toBe('-lastSyncedAt'));

    await userEvent.click(within(table).getByRole('button', { name: /^Account/ }));
    await waitFor(() => expect(lastTableQuery(mock).get('sort')).toBe('name'));

    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Sort accounts' }),
      'attention',
    );
    await waitFor(() => expect(lastTableQuery(mock).get('sort')).toBe('attention'));
  });

  it('links accounts and, for managers, their logins, and filters by login', async () => {
    const mock = setup('ADMIN');
    renderApp('/w/acme/accounts');
    const table = await screen.findByRole('table', { name: 'Social accounts' });
    const row = (await within(table).findByRole('link', { name: 'Solo Creator' })).closest('tr');
    expect(within(row).getByRole('link', { name: 'Solo Creator' })).toHaveAttribute(
      'href',
      `/w/acme/accounts/a/${soloCreator.id}`,
    );
    expect(within(row).getByRole('link', { name: '@solo.creator' })).toHaveAttribute(
      'href',
      `/w/acme/accounts/logins/${IG_LOGIN}`,
    );
    expect(within(row).getByText('Publishing permissions OK')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Pagination' })).toHaveTextContent(
      'Showing 1–4 of 4 accounts',
    );

    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Filter by login' }),
      FB_LOGIN,
    );
    await waitFor(() => expect(lastTableQuery(mock).get('connectionId')).toBe(FB_LOGIN));
    await waitFor(() =>
      expect(within(table).queryByRole('link', { name: 'Solo Creator' })).not.toBeInTheDocument(),
    );
    expect(within(table).getByRole('link', { name: 'Acme Store' })).toBeInTheDocument();
  });

  it('shows the accounts behind a readiness figure, replacing other filters', async () => {
    const mock = setup('OWNER');
    renderApp('/w/acme/accounts?q=acme&status=ACTIVE');
    const readiness = await screen.findByRole('region', { name: 'Publishing readiness' });
    expect(screen.getByRole('searchbox', { name: 'Search accounts' })).toHaveValue('acme');

    await userEvent.click(
      await within(readiness).findByRole('button', {
        name: 'Show accounts: Missing publishing access',
      }),
    );
    await waitFor(() =>
      expect(Object.fromEntries(lastTableQuery(mock))).toEqual({
        readiness: 'RESTRICTED',
        sort: 'name',
        page: '1',
        limit: '25',
      }),
    );
    expect(screen.getByRole('searchbox', { name: 'Search accounts' })).toHaveValue('');
    expect(screen.getByRole('combobox', { name: 'Filter by publishing readiness' })).toHaveValue(
      'RESTRICTED',
    );
    const region = screen.getByRole('region', { name: 'All accounts' });
    expect(region).toHaveFocus();
    await waitFor(() =>
      expect(within(region).queryByRole('link', { name: 'Acme Store' })).not.toBeInTheDocument(),
    );
    expect(within(region).getByRole('link', { name: 'Acme Labs' })).toBeInTheDocument();
  });

  it('offers to clear filters that match nothing', async () => {
    const mock = setup('OWNER');
    renderApp('/w/acme/accounts?q=nomatch');
    const region = await screen.findByRole('region', { name: 'All accounts' });
    expect(await within(region).findByText('No accounts match these filters')).toBeVisible();
    expect(screen.getByRole('searchbox', { name: 'Search accounts' })).toHaveValue('nomatch');

    const buttons = within(region).getAllByRole('button', { name: 'Clear filters' });
    await userEvent.click(buttons.at(-1));
    await waitFor(() => expect(lastTableQuery(mock).get('q')).toBeNull());
    expect(await within(region).findByRole('link', { name: 'Acme Store' })).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Search accounts' })).toHaveValue('');
  });

  it('says when only the first 5,000 accounts were evaluated', async () => {
    setup('OWNER', { [LIST]: listRoute(ACCOUNTS, { truncated: true }) });
    renderApp('/w/acme/accounts');
    const region = await screen.findByRole('region', { name: 'All accounts' });
    expect(
      await within(region).findByText(/Only the first 5,000 accounts are evaluated/),
    ).toBeInTheDocument();
  });
});

describe('Social accounts overview: empty states', () => {
  const emptyWorkspace = (role, routes = {}) =>
    setup(role, {
      'GET /workspaces/w1/social-accounts/summary': () =>
        jsonResponse(
          200,
          summary({
            accounts: ZERO_ACCOUNTS,
            connections: MANAGERS.has(role) ? { total: 0, facebook: 0, instagram: 0 } : null,
          }),
        ),
      [LIST]: listRoute([]),
      'GET /workspaces/w1/social-connections': () => jsonResponse(200, { items: [] }),
      ...routes,
    });

  it('tells a viewer that nothing has been shared with them yet', async () => {
    emptyWorkspace('VIEWER');
    renderApp('/w/acme/accounts');
    expect(
      await screen.findByText(
        'No social accounts have been shared with you yet. Workspace admins decide which accounts each member can use.',
      ),
    ).toBeVisible();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    expect(screen.queryByText(/All accounts healthy/)).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Publishing readiness' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Connect/ })).not.toBeInTheDocument();
  });

  it('sends managers with logins but no accounts to the Logins tab', async () => {
    emptyWorkspace('OWNER', {
      'GET /workspaces/w1/social-connections': () =>
        jsonResponse(200, { items: [login({ accountCount: 0 })] }),
    });
    renderApp('/w/acme/accounts');
    const region = await screen.findByRole('region', { name: 'All accounts' });
    expect(
      await within(region).findByText(
        'Choose which Pages and Instagram accounts to add from your logins.',
      ),
    ).toBeVisible();
    expect(within(region).getByRole('link', { name: /Go to Logins/ })).toHaveAttribute(
      'href',
      '/w/acme/accounts/logins',
    );
  });

  it('lets managers connect a first login from the empty state', async () => {
    const mock = emptyWorkspace('OWNER', {
      'POST /workspaces/w1/meta/authorizations': () =>
        jsonResponse(201, {
          authorizationUrl: 'https://www.instagram.com/oauth/authorize?state=first',
        }),
    });
    renderApp('/w/acme/accounts');
    const region = await screen.findByRole('region', { name: 'All accounts' });
    expect(await within(region).findByText('Connect your first account')).toBeVisible();
    await userEvent.click(within(region).getByRole('button', { name: /Connect Instagram/ }));

    await waitFor(() =>
      expect(redirectTo).toHaveBeenCalledWith(
        'https://www.instagram.com/oauth/authorize?state=first',
      ),
    );
    expect(lastBody(mock, 'POST /workspaces/w1/meta/authorizations')).toEqual({
      provider: 'INSTAGRAM_LOGIN',
    });
  });

  it('points managers to the setup notice when Meta is not configured', async () => {
    emptyWorkspace('OWNER', {
      'GET /integrations/meta': () => jsonResponse(200, integration(false, false)),
    });
    renderApp('/w/acme/accounts');
    const region = await screen.findByRole('region', { name: 'All accounts' });
    expect(await within(region).findByText(/The setup notice above lists/)).toBeVisible();
    expect(screen.getByRole('region', { name: 'Meta setup required' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Connect (Facebook|Instagram)/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sync all logins' })).not.toBeInTheDocument();
  });
});

describe('Social accounts overview: needs attention and sync', () => {
  it('says all accounts are healthy when nothing needs attention', async () => {
    setup('OWNER', {
      'GET /workspaces/w1/social-accounts/summary': () =>
        jsonResponse(200, summary({ accounts: { needsAttention: 0, ready: 3, restricted: 0 } })),
      [LIST]: listRoute([acmeStore, acmeInstagram, soloCreator]),
    });
    renderApp('/w/acme/accounts');
    expect(await screen.findByText(/All accounts healthy/)).toBeVisible();
    expect(screen.queryByRole('region', { name: 'Needs attention' })).not.toBeInTheDocument();
  });

  it('shows an expired login with its problem and reconnects it', async () => {
    const mock = setup('ADMIN', {
      'GET /workspaces/w1/social-connections': () =>
        jsonResponse(200, { items: [expiredLogin, instagramLogin()] }),
      [LIST]: listRoute([expired(acmeInstagram), expired(acmeStore), soloCreator]),
      'POST /workspaces/w1/meta/authorizations': () =>
        jsonResponse(201, {
          authorizationUrl: 'https://www.facebook.com/v27.0/dialog/oauth?state=expired',
        }),
    });
    renderApp('/w/acme/accounts');

    const card = await screen.findByRole('region', { name: 'Needs attention' });
    const loginRow = within(card).getByRole('link', { name: 'Alice' }).closest('li');
    expect(within(loginRow).getByRole('link', { name: 'Alice' })).toHaveAttribute(
      'href',
      `/w/acme/accounts/logins/${FB_LOGIN}`,
    );
    expect(within(loginRow).getByText('Expired')).toBeInTheDocument();
    expect(within(loginRow).getByText(EXPIRED_REASON)).toBeInTheDocument();
    expect(within(loginRow).queryByRole('button', { name: 'Sync now' })).not.toBeInTheDocument();
    // Its destinations are listed too, most urgent first, linking to their own pages.
    expect(within(card).getByRole('link', { name: 'Acme Store' })).toHaveAttribute(
      'href',
      `/w/acme/accounts/a/${acmeStore.id}`,
    );
    expect(within(card).queryByRole('link', { name: 'Solo Creator' })).not.toBeInTheDocument();

    await userEvent.click(within(loginRow).getByRole('button', { name: 'Reconnect' }));
    await waitFor(() =>
      expect(redirectTo).toHaveBeenCalledWith(
        'https://www.facebook.com/v27.0/dialog/oauth?state=expired',
      ),
    );
    expect(lastBody(mock, 'POST /workspaces/w1/meta/authorizations')).toEqual({
      provider: 'FACEBOOK_LOGIN',
      connectionId: FB_LOGIN,
    });
  });

  it('shows all accounts needing attention in the table', async () => {
    const mock = setup('OWNER');
    renderApp('/w/acme/accounts');
    const card = await screen.findByRole('region', { name: 'Needs attention' });
    expect(within(card).getByRole('link', { name: 'Acme Labs' })).toHaveAttribute(
      'href',
      `/w/acme/accounts/a/${acmeLabs.id}`,
    );
    const preview = mock.calls.find(
      (c) => c.key === LIST && c.url.searchParams.get('limit') === '5',
    );
    expect(Object.fromEntries(preview.url.searchParams)).toEqual({
      attention: 'true',
      sort: 'attention',
      limit: '5',
    });

    await userEvent.click(within(card).getByRole('button', { name: 'Show all in the table' }));
    await waitFor(() => expect(lastTableQuery(mock).get('attention')).toBe('true'));
    expect(screen.getByRole('button', { name: /^Needs attention/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    const region = screen.getByRole('region', { name: 'All accounts' });
    expect(region).toHaveFocus();
    await waitFor(() =>
      expect(within(region).queryByRole('link', { name: 'Acme Store' })).not.toBeInTheDocument(),
    );
    expect(within(region).getByRole('link', { name: 'Acme Labs' })).toBeInTheDocument();
  });

  it('re-syncs a login whose last synchronization failed', async () => {
    const mock = setup('OWNER', {
      'GET /workspaces/w1/social-connections': () =>
        jsonResponse(200, { items: [login(syncFailed()), instagramLogin()] }),
      [`POST /workspaces/w1/social-connections/${FB_LOGIN}/sync`]: () =>
        jsonResponse(200, {
          connection: login(),
          accounts: { refreshed: 3, lost: 0 },
          outcome: 'SUCCESS',
          statusChanged: false,
        }),
    });
    renderApp('/w/acme/accounts');

    const card = await screen.findByRole('region', { name: 'Needs attention' });
    const row = within(card).getByRole('link', { name: 'Alice' }).closest('li');
    expect(within(row).getByText('Last error: Application request limit reached')).toBeVisible();
    expect(within(row).queryByRole('button', { name: 'Reconnect' })).not.toBeInTheDocument();
    await userEvent.click(within(row).getByRole('button', { name: 'Sync now' }));

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith('Alice synced · 3 accounts refreshed'),
    );
    expect(mock.count(`POST /workspaces/w1/social-connections/${FB_LOGIN}/sync`)).toBe(1);
  });

  it('reports every login of Sync all, including skipped ones, and reconnects from there', async () => {
    const configMessage =
      'Instagram Login is not configured on this server, so SocialHub cannot contact Meta for this login. Add the Meta app credentials (see META_SETUP_GUIDE.md) to enable synchronization.';
    const mock = setup('OWNER', {
      'GET /integrations/meta': () => jsonResponse(200, integration(true, false)),
      'GET /workspaces/w1/social-connections': () =>
        jsonResponse(200, {
          items: [
            login({
              status: 'DISCONNECTED',
              statusReason: DISCONNECTED_REASON,
              attention: [{ code: 'DISCONNECTED', message: DISCONNECTED_REASON }],
              needsAttention: true,
            }),
            instagramLogin(),
          ],
        }),
      'POST /workspaces/w1/social-connections/sync': () =>
        jsonResponse(200, {
          results: [
            {
              connectionId: FB_LOGIN,
              displayName: 'Alice',
              provider: 'FACEBOOK_LOGIN',
              skipReason: 'NEEDS_RECONNECT',
              status: 'DISCONNECTED',
              accounts: { refreshed: 0, lost: 0 },
              message: DISCONNECTED_REASON,
            },
            {
              connectionId: IG_LOGIN,
              displayName: '@solo.creator',
              provider: 'INSTAGRAM_LOGIN',
              skipReason: 'CONFIG_REQUIRED',
              status: 'ACTIVE',
              accounts: { refreshed: 0, lost: 0 },
              message: configMessage,
            },
          ],
          summary: { total: 2, succeeded: 0, failed: 0, skipped: 2 },
        }),
      'POST /workspaces/w1/meta/authorizations': () =>
        jsonResponse(201, {
          authorizationUrl: 'https://www.facebook.com/v27.0/dialog/oauth?state=bulk',
        }),
    });
    renderApp('/w/acme/accounts');

    await userEvent.click(await screen.findByRole('button', { name: 'Sync all logins' }));
    const dialog = await screen.findByRole('dialog', { name: 'Sync results' });
    expect(lastBody(mock, 'POST /workspaces/w1/social-connections/sync')).toEqual({});
    expect(dialog).toHaveAccessibleDescription('0 synced · 2 skipped — 2 logins in total');
    expect(toast.warning).toHaveBeenCalledWith('No login could be synced — see the results');

    const instagramRow = within(dialog).getByText('@solo.creator').closest('li');
    expect(within(instagramRow).getByText('Setup required')).toBeInTheDocument();
    expect(within(instagramRow).getByText(configMessage)).toBeInTheDocument();
    expect(within(instagramRow).queryByRole('button', { name: /Reconnect/ })).toBeNull();

    const facebookRow = within(dialog).getByText('Alice').closest('li');
    expect(within(facebookRow).getByText('Reconnect required')).toBeInTheDocument();
    expect(within(facebookRow).getByText(DISCONNECTED_REASON)).toBeInTheDocument();
    await userEvent.click(within(facebookRow).getByRole('button', { name: /Reconnect/ }));

    await waitFor(() =>
      expect(redirectTo).toHaveBeenCalledWith(
        'https://www.facebook.com/v27.0/dialog/oauth?state=bulk',
      ),
    );
    expect(lastBody(mock, 'POST /workspaces/w1/meta/authorizations')).toEqual({
      provider: 'FACEBOOK_LOGIN',
      connectionId: FB_LOGIN,
    });
  });

  it('disables syncing and reconnecting, with the reason, when Meta is not configured', async () => {
    const mock = setup('OWNER', {
      'GET /integrations/meta': () => jsonResponse(200, integration(false, false)),
      'GET /workspaces/w1/social-connections': () =>
        jsonResponse(200, { items: [expiredLogin, instagramLogin(syncFailed())] }),
    });
    renderApp('/w/acme/accounts');

    const syncAll = await screen.findByRole('button', { name: 'Sync all logins' });
    await waitFor(() => expect(syncAll).toBeDisabled());
    expect(syncAll).toHaveAccessibleDescription(
      'Syncing needs Facebook Login or Instagram Login to be configured on the server.',
    );

    const card = await screen.findByRole('region', { name: 'Needs attention' });
    const facebookRow = within(card).getByRole('link', { name: 'Alice' }).closest('li');
    expect(within(facebookRow).getByRole('button', { name: 'Reconnect' })).toBeDisabled();
    expect(
      within(facebookRow).getByText(/Facebook Login is not configured on the server/),
    ).toBeVisible();
    const instagramRow = within(card).getByRole('link', { name: '@solo.creator' }).closest('li');
    expect(within(instagramRow).getByRole('button', { name: 'Sync now' })).toBeDisabled();
    expect(
      within(instagramRow).getByText(/Instagram Login is not configured on the server/),
    ).toBeVisible();

    await userEvent.click(syncAll);
    expect(mock.count('POST /workspaces/w1/social-connections/sync')).toBe(0);
  });
});

describe('Social accounts overview: all my workspaces', () => {
  const acmeItem = {
    ...acmeStore,
    workspace: { id: 'w1', name: 'Acme Social', slug: 'acme' },
    canManage: true,
  };
  const betaItem = {
    ...acmeStore,
    id: '6afff51ce8bea719d246c5e1',
    externalId: '7001',
    name: 'Beta Page',
    connection: { ...alice, id: '6afff51ce8bea719d246c5e2', displayName: 'Bob' },
    workspace: { id: OTHER_WORKSPACE, name: 'Beta Brands', slug: 'beta' },
    canManage: false,
  };

  const twoWorkspaces = () =>
    setup('OWNER', {
      'GET /workspaces': () => jsonResponse(200, { items: [workspace('OWNER'), betaWorkspace] }),
      [CROSS_LIST]: listRoute([acmeItem, betaItem]),
      'GET /social-accounts/summary': () =>
        jsonResponse(200, {
          ...summary({
            accounts: {
              total: 2,
              facebookPages: 2,
              instagramAccounts: 0,
              connected: 2,
              needsAttention: 0,
              ready: 2,
              restricted: 0,
            },
          }),
          workspaces: 2,
        }),
    });

  it('lists accounts of every workspace read-only, with a workspace column and filter', async () => {
    const mock = twoWorkspaces();
    const { router } = renderApp('/w/acme/accounts?scope=all');

    const scope = await screen.findByRole('group', { name: 'Accounts to show' });
    expect(within(scope).getByRole('button', { name: 'All my workspaces' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    const table = await screen.findByRole('table', { name: 'Social accounts' });
    expect(within(table).getByRole('columnheader', { name: 'Workspace' })).toBeInTheDocument();
    expect(await within(table).findByRole('link', { name: 'Beta Page' })).toHaveAttribute(
      'href',
      `/w/beta/accounts/a/${betaItem.id}`,
    );
    expect(within(table).getByRole('cell', { name: 'Beta Brands' })).toBeInTheDocument();
    // Login links only where the user manages logins.
    expect(within(table).getByRole('link', { name: 'Alice' })).toHaveAttribute(
      'href',
      `/w/acme/accounts/logins/${FB_LOGIN}`,
    );
    expect(within(table).queryByRole('link', { name: 'Bob' })).not.toBeInTheDocument();

    await expectStat('Workspaces', '2');
    expect(mock.count(CROSS_LIST)).toBeGreaterThan(0);
    expect(mock.count('GET /social-accounts/summary')).toBe(1);
    expect(mock.count(LIST)).toBe(0);
    expect(mock.count('GET /workspaces/w1/social-connections')).toBe(0);
    expect(screen.queryByRole('button', { name: 'Sync all logins' })).not.toBeInTheDocument();

    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Filter by workspace' }),
      OTHER_WORKSPACE,
    );
    await waitFor(() =>
      expect(lastTableQuery(mock, CROSS_LIST).get('workspaceId')).toBe(OTHER_WORKSPACE),
    );
    await waitFor(() =>
      expect(within(table).queryByRole('link', { name: 'Acme Store' })).not.toBeInTheDocument(),
    );

    // Back to this workspace: its own list, no workspace column, scope gone from the URL.
    await userEvent.click(within(scope).getByRole('button', { name: 'This workspace' }));
    expect(router.state.location.search).not.toMatch(/scope=|workspaceId=/);
    await waitFor(() => expect(lastTableQuery(mock)).toBeDefined());
    expect(screen.queryByRole('columnheader', { name: 'Workspace' })).not.toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Sync all logins' })).toBeInTheDocument();
  });

  it('switches scope from the toggle and keeps it in the URL', async () => {
    const mock = twoWorkspaces();
    const { router } = renderApp('/w/acme/accounts?page=2');
    const scope = await screen.findByRole('group', { name: 'Accounts to show' });
    const all = within(scope).getByRole('button', { name: 'All my workspaces' });
    expect(all).toHaveAttribute('aria-pressed', 'false');

    await userEvent.click(all);
    expect(all).toHaveAttribute('aria-pressed', 'true');
    expect(router.state.location.search).toBe('?scope=all');
    await waitFor(() => expect(lastTableQuery(mock, CROSS_LIST)?.get('page')).toBe('1'));
    expect(await screen.findByRole('columnheader', { name: 'Workspace' })).toBeInTheDocument();
  });

  it('ignores the cross-workspace scope and filter for members of a single workspace', async () => {
    const mock = setup('OWNER');
    renderApp(`/w/acme/accounts?scope=all&workspaceId=${OTHER_WORKSPACE}`);
    const table = await screen.findByRole('table', { name: 'Social accounts' });
    expect(await within(table).findByRole('link', { name: 'Acme Store' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Accounts to show' })).not.toBeInTheDocument();
    // The workspace endpoint rejects unknown query keys, so workspaceId is never sent to it.
    expect(lastTableQuery(mock).has('workspaceId')).toBe(false);
    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument();
    expect(mock.count(CROSS_LIST)).toBe(0);
  });
});
