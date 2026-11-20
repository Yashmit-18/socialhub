import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { redirectTo } from './lib/browser.js';
import { setAccessToken } from './lib/api.js';
import { apiError, jsonResponse, mockFetch } from './test/fetchMock.js';
import { renderApp } from './test/renderApp.jsx';

vi.mock('./lib/browser.js', () => ({ redirectTo: vi.fn() }));

const user = { id: 'u1', name: 'Ada Lovelace', email: 'ada@example.com' };
const CONNECTION_ID = 'aaaaaaaaaaaaaaaaaaaaaaaa';

const workspace = (role) => ({
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
});

const configured = { facebook: { configured: true }, instagram: { configured: true } };

const connection = (overrides = {}) => ({
  id: CONNECTION_ID,
  provider: 'FACEBOOK_LOGIN',
  displayName: 'Alice Facebook',
  status: 'ACTIVE',
  statusReason: null,
  accountCount: 1,
  missingScopes: { required: [], recommended: [], publishing: [] },
  tokenExpiresAt: new Date(Date.now() + 50 * 86_400_000).toISOString(),
  expiringSoonAt: null,
  ...overrides,
});

const account = (overrides = {}) => ({
  id: 'acc1',
  platform: 'FACEBOOK_PAGE',
  externalId: '5001',
  name: 'Acme Store',
  category: 'Retail',
  connectionStatus: 'ACTIVE',
  publishingStatus: 'READY',
  connection: { displayName: 'Alice Facebook' },
  ...overrides,
});

const emptySummary = {
  accounts: {
    total: 0,
    facebookPages: 0,
    instagramAccounts: 0,
    connected: 0,
    needsAttention: 0,
    ready: 0,
    restricted: 0,
    unavailable: 0,
  },
  connections: null,
  meta: { facebookConfigured: true, instagramConfigured: true },
  truncated: false,
};

function setup(role, routes = {}) {
  return mockFetch({
    'POST /auth/refresh': () => jsonResponse(200, { user, accessToken: 'access' }),
    'GET /workspaces': () => jsonResponse(200, { items: [workspace(role)] }),
    'GET /integrations/meta': () => jsonResponse(200, configured),
    'GET /workspaces/w1/social-accounts': () => jsonResponse(200, { items: [] }),
    'GET /workspaces/w1/social-accounts/summary': () => jsonResponse(200, emptySummary),
    'GET /workspaces/w1/social-connections': () => jsonResponse(200, { items: [] }),
    ...routes,
  });
}

beforeEach(() => {
  setAccessToken(null);
  redirectTo.mockClear();
});
afterEach(() => vi.unstubAllGlobals());

describe('connecting Meta accounts', () => {
  it('starts Facebook Login through the API and redirects the browser to Meta', async () => {
    const mock = setup('OWNER', {
      'POST /workspaces/w1/meta/authorizations': () =>
        jsonResponse(201, {
          authorizationUrl: 'https://www.facebook.com/v27.0/dialog/oauth?state=abc',
        }),
    });
    renderApp('/w/acme/accounts');
    await userEvent.click((await screen.findAllByRole('button', { name: /Connect Facebook/ }))[0]);

    await waitFor(() =>
      expect(redirectTo).toHaveBeenCalledWith(
        'https://www.facebook.com/v27.0/dialog/oauth?state=abc',
      ),
    );
    const call = mock.calls.find((c) => c.key === 'POST /workspaces/w1/meta/authorizations');
    expect(JSON.parse(call.init.body)).toEqual({ provider: 'FACEBOOK_LOGIN' });
    expect(call.init.credentials).toBe('include');
  });

  it('offers reconnecting an expired connection, explaining why', async () => {
    const mock = setup('ADMIN', {
      'GET /workspaces/w1/social-connections': () =>
        jsonResponse(200, {
          items: [
            connection({
              status: 'EXPIRED',
              statusReason: 'The access token has expired. Reconnect to restore access.',
            }),
          ],
        }),
      'POST /workspaces/w1/meta/authorizations': () =>
        jsonResponse(201, { authorizationUrl: 'https://www.facebook.com/x' }),
    });
    renderApp('/w/acme/accounts');
    expect(await screen.findByText(/The access token has expired/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Reconnect' }));
    await waitFor(() => expect(redirectTo).toHaveBeenCalled());
    const call = mock.calls.find((c) => c.key === 'POST /workspaces/w1/meta/authorizations');
    expect(JSON.parse(call.init.body)).toEqual({
      provider: 'FACEBOOK_LOGIN',
      connectionId: CONNECTION_ID,
    });
  });

  it('warns on the Logins tab when access is about to expire and lists missing permissions', async () => {
    setup('OWNER', {
      'GET /workspaces/w1/social-connections': () =>
        jsonResponse(200, {
          items: [
            connection({
              expiringSoonAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
              missingScopes: { required: [], recommended: [], publishing: ['pages_manage_posts'] },
            }),
          ],
        }),
    });
    renderApp('/w/acme/accounts/logins');
    expect(await screen.findByText(/Access expires in 3 days/)).toBeInTheDocument();
    expect(screen.getByText(/pages_manage_posts/)).toBeInTheDocument();
  });

  it('hides connection management from editors but shows the accounts they can access', async () => {
    const mock = setup('EDITOR', {
      'GET /workspaces/w1/social-accounts': () => jsonResponse(200, { items: [account()] }),
    });
    renderApp('/w/acme/accounts');
    expect(await screen.findByText('Acme Store')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Connect Facebook/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Remove Acme Store/ })).not.toBeInTheDocument();
    expect(mock.count('GET /workspaces/w1/social-connections')).toBe(0);
  });

  it('labels permission readiness without claiming publishing works', async () => {
    setup('OWNER', {
      'GET /workspaces/w1/social-accounts': () => jsonResponse(200, { items: [account()] }),
    });
    renderApp('/w/acme/accounts');
    expect(await screen.findByText('Publishing permissions OK')).toBeInTheDocument();
    expect(screen.queryByText(/Ready to publish/i)).not.toBeInTheDocument();
  });
});

describe('choosing accounts from a connection', () => {
  const candidates = [
    {
      platform: 'FACEBOOK_PAGE',
      externalId: '5001',
      name: 'Acme Store',
      state: 'NEW',
      hasAccessToken: true,
      publishing: { status: 'READY' },
    },
    {
      platform: 'FACEBOOK_PAGE',
      externalId: '5002',
      name: 'Shared Page',
      state: 'CONNECTED_VIA_OTHER',
      connectedVia: { id: 'x', displayName: 'Bob Facebook' },
      hasAccessToken: true,
      publishing: { status: 'READY' },
    },
    {
      platform: 'INSTAGRAM_ACCOUNT',
      externalId: '17841400000000010',
      name: 'Acme IG',
      username: 'acme',
      linkedPage: { externalId: '5001', name: 'Acme Store' },
      state: 'NEW',
      hasAccessToken: true,
      publishing: { status: 'RESTRICTED', reason: 'Missing permission: instagram_content_publish' },
    },
  ];

  it('adds only the selected accounts and protects ones connected through another login', async () => {
    const mock = setup('OWNER', {
      [`GET /workspaces/w1/social-connections/${CONNECTION_ID}/discovery`]: () =>
        jsonResponse(200, {
          connection: connection(),
          candidates,
          warnings: ['Required permission not granted: pages_show_list. Reconnect and allow it.'],
        }),
      [`POST /workspaces/w1/social-connections/${CONNECTION_ID}/accounts`]: () =>
        jsonResponse(200, { added: [account()], updated: [], relinked: [], skipped: [] }),
    });
    const { router } = renderApp(`/w/acme/accounts/logins/${CONNECTION_ID}/select`);

    expect(
      await screen.findByRole('heading', { name: 'Choose accounts to add' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Required permission not granted: pages_show_list/),
    ).toBeInTheDocument();
    expect(screen.getByText('Added via Bob Facebook')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Add Shared Page' })).toBeDisabled();
    expect(screen.getByText(/instagram_content_publish/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('checkbox', { name: 'Add Acme Store' }));
    await userEvent.click(screen.getByRole('button', { name: /Add 1 account/ }));

    // After adding, the login's own page lists what was added through it.
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(`/w/acme/accounts/logins/${CONNECTION_ID}`),
    );
    const call = mock.calls.find(
      (c) => c.key === `POST /workspaces/w1/social-connections/${CONNECTION_ID}/accounts`,
    );
    expect(JSON.parse(call.init.body)).toEqual({
      accounts: [{ platform: 'FACEBOOK_PAGE', externalId: '5001' }],
    });
  });

  it('can select every available account at once (reached through the Phase 2 URL)', async () => {
    const mock = setup('OWNER', {
      [`GET /workspaces/w1/social-connections/${CONNECTION_ID}/discovery`]: () =>
        jsonResponse(200, { connection: connection(), candidates, warnings: [] }),
      [`POST /workspaces/w1/social-connections/${CONNECTION_ID}/accounts`]: () =>
        jsonResponse(200, { added: [], updated: [], relinked: [], skipped: [] }),
    });
    // The Phase 2 selection URL redirects to the login's select page.
    const { router } = renderApp(`/w/acme/accounts/connections/${CONNECTION_ID}`);
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(
        `/w/acme/accounts/logins/${CONNECTION_ID}/select`,
      ),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Select all available' }));
    await userEvent.click(screen.getByRole('button', { name: /Add 2 accounts/ }));
    await waitFor(() =>
      expect(mock.count(`POST /workspaces/w1/social-connections/${CONNECTION_ID}/accounts`)).toBe(
        1,
      ),
    );
    const call = mock.calls.find((c) => c.key.startsWith('POST') && c.key.endsWith('/accounts'));
    expect(JSON.parse(call.init.body).accounts.map((a) => a.externalId)).toEqual([
      '5001',
      '17841400000000010',
    ]);
  });

  it('asks to reconnect when Meta rejects the stored token', async () => {
    setup('OWNER', {
      [`GET /workspaces/w1/social-connections/${CONNECTION_ID}/discovery`]: () =>
        apiError(
          409,
          'META_RECONNECT_REQUIRED',
          'The access token has expired. Reconnect to restore access.',
        ),
      'GET /workspaces/w1/social-connections': () =>
        jsonResponse(200, { items: [connection({ status: 'EXPIRED' })] }),
      'POST /workspaces/w1/meta/authorizations': () =>
        jsonResponse(201, { authorizationUrl: 'https://www.facebook.com/r' }),
    });
    renderApp(`/w/acme/accounts/logins/${CONNECTION_ID}/select`);
    expect(
      await screen.findByRole('heading', { name: 'This login needs to be reconnected' }),
    ).toBeInTheDocument();
    const button = screen.getByRole('button', { name: /Reconnect/ });
    await waitFor(() => expect(button).toBeEnabled());
    await userEvent.click(button);
    await waitFor(() => expect(redirectTo).toHaveBeenCalledWith('https://www.facebook.com/r'));
  });
});

describe('OAuth result page', () => {
  it('explains a cancelled authorization', async () => {
    setup('OWNER');
    renderApp(
      '/oauth/meta/result?status=error&reason=USER_CANCELLED&provider=facebook&workspace=acme',
    );
    const alert = await screen.findByRole('alert');
    expect(
      within(alert).getByRole('heading', { name: 'Authorization cancelled' }),
    ).toBeInTheDocument();
    expect(within(alert).getByText(/Nothing was connected/)).toBeInTheDocument();
    expect(within(alert).getByRole('link', { name: 'Back to social accounts' })).toHaveAttribute(
      'href',
      '/w/acme/accounts',
    );
  });

  it('explains a browser mismatch', async () => {
    setup('OWNER');
    renderApp('/oauth/meta/result?status=error&reason=BROWSER_MISMATCH&workspace=acme');
    expect(await screen.findByText(/same browser where it was started/)).toBeInTheDocument();
  });

  it('continues to account selection after a new connection', async () => {
    setup('OWNER', {
      [`GET /workspaces/w1/social-connections/${CONNECTION_ID}/discovery`]: () =>
        jsonResponse(200, { connection: connection(), candidates: [], warnings: [] }),
    });
    const { router } = renderApp(
      `/oauth/meta/result?status=success&reason=CONNECTED&provider=facebook&workspace=acme&connection=${CONNECTION_ID}`,
    );
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(
        `/w/acme/accounts/logins/${CONNECTION_ID}/select`,
      ),
    );
  });

  it('returns to the login after a reconnect', async () => {
    setup('OWNER', {
      [`GET /workspaces/w1/social-connections/${CONNECTION_ID}`]: () =>
        jsonResponse(200, {
          connection: connection(),
          accounts: [],
          permissions: { granted: [], declined: [], requested: [], missing: {} },
          syncHistory: [],
          activity: [],
          capabilities: { providerConfigured: true },
        }),
      [`GET /workspaces/w1/social-connections/${CONNECTION_ID}/sync-runs`]: () =>
        jsonResponse(200, { items: [], nextCursor: null }),
    });
    const { router } = renderApp(
      `/oauth/meta/result?status=success&reason=RECONNECTED&provider=facebook&workspace=acme&connection=${CONNECTION_ID}`,
    );
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(`/w/acme/accounts/logins/${CONNECTION_ID}`),
    );
  });

  it('ignores malformed identifiers in the result URL', async () => {
    setup('OWNER');
    renderApp(
      '/oauth/meta/result?status=success&reason=CONNECTED&workspace=..%2F..%2Fevil&connection=xyz',
    );
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to social accounts' })).toHaveAttribute(
      'href',
      '/',
    );
  });
});
