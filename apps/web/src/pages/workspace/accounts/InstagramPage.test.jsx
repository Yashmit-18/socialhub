// Frontend interaction tests: the SocialHub API is mocked with fetch; no Meta API is involved.
import { configure, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAccessToken } from '../../../lib/api.js';
import { redirectTo } from '../../../lib/browser.js';
import { jsonResponse, mockFetch } from '../../../test/fetchMock.js';
import { renderApp } from '../../../test/renderApp.jsx';

// The first render loads the lazy route chunks, which can take over a second on a busy machine.
configure({ asyncUtilTimeout: 5000 });

vi.mock('../../../lib/browser.js', () => ({ redirectTo: vi.fn() }));
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

const user = { id: 'u1', name: 'Olivia Owner', email: 'olivia@example.com' };
const FB_LOGIN = 'c00000000000000000000001';
const IG_LOGIN = 'c00000000000000000000002';
const STORE_PAGE = 'a00000000000000000000001';
const ACME = 'a00000000000000000000011';
const PARTNER = 'a00000000000000000000012';
const SOLO = 'a00000000000000000000013';
const LIST = 'GET /workspaces/w1/social-accounts';
const EXPIRED_REASON = 'The access token has expired. Reconnect to restore access.';

const workspace = (role) => ({
  id: 'w1',
  name: 'Acme Social',
  slug: 'acme',
  timezone: 'UTC',
  membership: {
    id: 'm1',
    role,
    permissions: [],
    accountAccess:
      role === 'OWNER' || role === 'ADMIN'
        ? { mode: 'ALL', socialAccountIds: [] }
        : { mode: 'SELECTED', socialAccountIds: [ACME, STORE_PAGE] },
  },
});

const summary = {
  accounts: {
    total: 4,
    facebookPages: 1,
    instagramAccounts: 3,
    connected: 4,
    needsAttention: 0,
    ready: 4,
    restricted: 0,
    unavailable: 0,
  },
  connections: null,
  meta: { facebookConfigured: true, instagramConfigured: true },
  truncated: false,
};

const facebookIdentity = {
  id: FB_LOGIN,
  provider: 'FACEBOOK_LOGIN',
  displayName: 'Alice',
  pictureUrl: null,
  status: 'ACTIVE',
};
const instagramIdentity = {
  id: IG_LOGIN,
  provider: 'INSTAGRAM_LOGIN',
  displayName: '@solo.creator',
  pictureUrl: null,
  status: 'ACTIVE',
};
// GET /social-connections items, trimmed from the Meta simulator capture.
const logins = [
  { ...facebookIdentity, accountCount: 3, attention: [], needsAttention: false },
  { ...instagramIdentity, accountCount: 1, attention: [], needsAttention: false },
];

const health = (overrides = {}) => ({
  connectionStatus: 'ACTIVE',
  connectionStatusReason: null,
  readiness: 'READY',
  readinessReasons: [],
  eligibility: { eligible: true, createContent: true, missingPermissions: [] },
  attention: [],
  needsAttention: false,
  ...overrides,
});

const instagram = (overrides = {}) => ({
  id: ACME,
  workspace: 'w1',
  platform: 'INSTAGRAM_ACCOUNT',
  externalId: '17841400000000010',
  name: 'Acme',
  username: 'acme',
  pictureUrl: null,
  linkedFacebookPageExternalId: '5001',
  linkedFacebookPageName: 'Acme Store',
  tasks: ['ANALYZE', 'ADVERTISE', 'MODERATE', 'CREATE_CONTENT', 'MANAGE'],
  connectionStatus: 'ACTIVE',
  publishingStatus: 'READY',
  lastSyncedAt: '2026-11-20T07:22:04.434Z',
  createdAt: '2026-11-20T07:22:04.241Z',
  connection: facebookIdentity,
  linkedPage: { id: STORE_PAGE, externalId: '5001', name: 'Acme Store' },
  health: health(),
  ...overrides,
});

// Linked through Facebook Login; no instagramAccountType reported (shown as "Professional").
const acme = instagram();
// Linked Page exists at Meta but is not in this workspace / not shared: the API sends id null.
const partner = instagram({
  id: PARTNER,
  externalId: '17841400000000020',
  name: 'Partner Brand',
  username: 'partner.brand',
  instagramAccountType: 'BUSINESS',
  linkedFacebookPageExternalId: '5009',
  linkedFacebookPageName: 'Partner Page',
  linkedPage: { id: null, externalId: '5009', name: 'Partner Page' },
});
// Connected directly with Instagram Login.
const solo = instagram({
  id: SOLO,
  externalId: '17841400000000099',
  name: 'Solo Creator',
  username: 'solo.creator',
  instagramAccountType: 'CREATOR',
  linkedFacebookPageExternalId: undefined,
  linkedFacebookPageName: undefined,
  tasks: undefined,
  connection: instagramIdentity,
  linkedPage: null,
  health: health({ eligibility: { eligible: true, createContent: null, missingPermissions: [] } }),
});
// After the Facebook login's token expired (captured as `listAfterExpiry`).
const expiredAcme = instagram({
  connectionStatus: 'EXPIRED',
  publishingStatus: 'UNAVAILABLE',
  connection: { ...facebookIdentity, status: 'EXPIRED' },
  health: health({
    connectionStatus: 'EXPIRED',
    connectionStatusReason: EXPIRED_REASON,
    readiness: 'UNAVAILABLE',
    readinessReasons: [EXPIRED_REASON],
    attention: [{ code: 'CONNECTION_EXPIRED', message: EXPIRED_REASON }],
    needsAttention: true,
  }),
});

const list = (items, overrides = {}) => ({
  items,
  total: items.length,
  page: 1,
  limit: 25,
  pages: 1,
  facets: {
    platform: { FACEBOOK_PAGE: 1, INSTAGRAM_ACCOUNT: items.length },
    status: { ACTIVE: items.length },
    readiness: { READY: items.length },
    attention: 0,
  },
  truncated: false,
  ...overrides,
});

function setup(role, routes = {}) {
  return mockFetch({
    'POST /auth/refresh': () => jsonResponse(200, { user, accessToken: 'access' }),
    'GET /workspaces': () => jsonResponse(200, { items: [workspace(role)] }),
    'GET /integrations/meta': () =>
      jsonResponse(200, { facebook: { configured: true }, instagram: { configured: true } }),
    'GET /workspaces/w1/social-accounts/summary': () => jsonResponse(200, summary),
    [LIST]: () => jsonResponse(200, list([acme, partner, solo])),
    'GET /workspaces/w1/social-connections': () => jsonResponse(200, { items: logins }),
    ...routes,
  });
}

const rowOf = (name) => screen.getByRole('link', { name }).closest('tr');
const findRow = async (name) => (await screen.findByRole('link', { name })).closest('tr');

beforeEach(() => {
  setAccessToken(null);
  vi.clearAllMocks();
});
afterEach(() => vi.unstubAllGlobals());

describe('Instagram tab', () => {
  it('shows each account’s type, its linked Facebook Page and how it is connected', async () => {
    const mock = setup('OWNER');
    renderApp('/w/acme/accounts/instagram');

    const acmeRow = await findRow('Acme');
    expect(within(acmeRow).getByText('Professional')).toBeInTheDocument();
    expect(within(acmeRow).getByText('@acme')).toBeInTheDocument();
    // The linked Page is in this workspace: it links to the Page's detail page.
    expect(within(acmeRow).getByRole('link', { name: 'Acme Store' })).toHaveAttribute(
      'href',
      `/w/acme/accounts/a/${STORE_PAGE}`,
    );

    const partnerRow = rowOf('Partner Brand');
    expect(within(partnerRow).getByText('Business')).toBeInTheDocument();
    expect(within(partnerRow).getByText('Partner Page')).toBeInTheDocument();
    expect(within(partnerRow).queryByRole('link', { name: 'Partner Page' })).toBeNull();

    const soloRow = rowOf('Solo Creator');
    expect(within(soloRow).getByText('Creator')).toBeInTheDocument();
    expect(within(soloRow).getByText('None (Instagram Login)')).toBeInTheDocument();
    expect(within(soloRow).getByRole('link', { name: '@solo.creator' })).toHaveAttribute(
      'href',
      `/w/acme/accounts/logins/${IG_LOGIN}`,
    );

    expect(
      screen.getByText(/Only Instagram professional accounts \(Business or Creator\)/),
    ).toHaveTextContent(/Personal accounts are not supported/);
    const legend = screen.getByText('How publishing readiness is decided').closest('details');
    expect(legend).toHaveTextContent(/instagram_basic, instagram_content_publish and/);
    expect(legend).toHaveTextContent(/instagram_business_content_publish/);

    expect(mock.calls.find((c) => c.key === LIST).url.searchParams.get('platform')).toBe(
      'INSTAGRAM_ACCOUNT',
    );
    // Instagram accounts come through both kinds of login.
    const loginFilter = screen.getByRole('combobox', { name: 'Filter by login' });
    expect(
      within(loginFilter)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['All logins', 'Alice', '@solo.creator']);
  });

  it('reconnects the login of an account whose access expired', async () => {
    const ue = userEvent.setup();
    const mock = setup('ADMIN', {
      [LIST]: () => jsonResponse(200, list([expiredAcme, solo])),
      'POST /workspaces/w1/meta/authorizations': () =>
        jsonResponse(201, {
          authorizationUrl: 'https://www.facebook.com/v27.0/dialog/oauth?state=abc',
        }),
    });
    renderApp('/w/acme/accounts/instagram');

    const acmeRow = await findRow('Acme');
    expect(within(acmeRow).getByText('Expired')).toBeInTheDocument();
    expect(within(acmeRow).getByText('Unavailable')).toBeInTheDocument();

    // A healthy login offers no reconnect.
    await ue.click(screen.getByRole('button', { name: 'Actions for Solo Creator' }));
    expect(screen.queryByRole('menuitem', { name: 'Reconnect login' })).not.toBeInTheDocument();
    await ue.keyboard('{Escape}');

    await ue.click(within(acmeRow).getByRole('button', { name: 'Actions for Acme' }));
    await ue.click(screen.getByRole('menuitem', { name: 'Reconnect login' }));

    await waitFor(() =>
      expect(redirectTo).toHaveBeenCalledWith(
        'https://www.facebook.com/v27.0/dialog/oauth?state=abc',
      ),
    );
    const call = mock.calls.find((c) => c.key === 'POST /workspaces/w1/meta/authorizations');
    expect(JSON.parse(call.init.body)).toEqual({
      provider: 'FACEBOOK_LOGIN',
      connectionId: FB_LOGIN,
    });
  });

  it('counts the selected accounts whose login needs reconnecting', async () => {
    const ue = userEvent.setup();
    setup('OWNER', { [LIST]: () => jsonResponse(200, list([expiredAcme, solo])) });
    renderApp('/w/acme/accounts/instagram');

    await ue.click(await screen.findByRole('checkbox', { name: 'Select Solo Creator' }));
    const bar = screen.getByRole('region', { name: 'Bulk actions' });
    expect(bar).toHaveTextContent('1 Instagram account selected');
    expect(bar).not.toHaveTextContent(/reconnecting/);

    await ue.click(screen.getByRole('checkbox', { name: 'Select Acme' }));
    expect(bar).toHaveTextContent('2 Instagram accounts selected');
    expect(bar).toHaveTextContent(
      '1 of the selected Instagram accounts belongs to 1 login that needs reconnecting',
    );
    expect(within(bar).getByRole('link', { name: 'Logins tab' })).toHaveAttribute(
      'href',
      '/w/acme/accounts/logins',
    );
  });

  it('shows viewers the accounts shared with them without management actions', async () => {
    const ue = userEvent.setup();
    const mock = setup('VIEWER', { [LIST]: () => jsonResponse(200, list([acme])) });
    renderApp('/w/acme/accounts/instagram');

    const row = await findRow('Acme');
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    // The API only gives the Page id when the viewer may open it.
    expect(within(row).getByRole('link', { name: 'Acme Store' })).toBeInTheDocument();
    expect(within(row).queryByRole('link', { name: 'Alice' })).not.toBeInTheDocument();

    await ue.click(within(row).getByRole('button', { name: 'Actions for Acme' }));
    expect(
      within(screen.getByRole('menu'))
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual(['View details']);
    expect(mock.count('GET /workspaces/w1/social-connections')).toBe(0);
  });

  it('offers both kinds of Meta login when no Instagram account has been added yet', async () => {
    setup('OWNER', {
      [LIST]: () =>
        jsonResponse(
          200,
          list([], {
            facets: {
              platform: { FACEBOOK_PAGE: 1 },
              status: {},
              readiness: {},
              attention: 0,
            },
          }),
        ),
      'GET /workspaces/w1/social-connections': () => jsonResponse(200, { items: [] }),
    });
    renderApp('/w/acme/accounts/instagram');

    const heading = await screen.findByRole('heading', { name: 'No Instagram accounts yet' });
    const empty = heading.parentElement;
    expect(empty).toHaveTextContent(/connect an Instagram professional account directly/);
    expect(within(empty).getByRole('button', { name: /Connect Facebook/ })).toBeInTheDocument();
    expect(within(empty).getByRole('button', { name: /Connect Instagram/ })).toBeInTheDocument();
    expect(within(empty).getByRole('link', { name: 'Go to Logins' })).toBeInTheDocument();
    // The professional-account note stays visible to explain what can be connected.
    expect(
      screen.getByText(/Only Instagram professional accounts \(Business or Creator\)/),
    ).toBeInTheDocument();
  });

  it('says when no Instagram account matches the filters', async () => {
    setup('OWNER', {
      [LIST]: () =>
        jsonResponse(
          200,
          list([], {
            facets: {
              platform: { FACEBOOK_PAGE: 1, INSTAGRAM_ACCOUNT: 3 },
              status: { ACTIVE: 3 },
              readiness: { READY: 3 },
              attention: 0,
            },
          }),
        ),
    });
    renderApp('/w/acme/accounts/instagram?status=REVOKED');

    expect(
      await screen.findByRole('heading', { name: 'No Instagram accounts match these filters' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Filter by connection status' })).toHaveValue(
      'REVOKED',
    );
  });
});
