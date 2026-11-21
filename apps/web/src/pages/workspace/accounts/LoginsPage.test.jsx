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

const MINUTE = 60_000;
const DAY = 86_400_000;
const at = (offset) => new Date(Date.now() + offset).toISOString();
/** The first render lazy-loads the route modules. */
const LOAD = { timeout: 5000 };
const PATH = '/w/acme/accounts/logins';

const user = { id: 'u1', name: 'Olivia Owner', email: 'olivia@example.com' };

const workspace = (role) => ({
  id: 'w1',
  name: 'Acme Social',
  slug: 'acme',
  timezone: 'UTC',
  membership: {
    id: 'm1',
    role,
    permissions: [],
    accountAccess: { mode: 'SELECTED', socialAccountIds: [] },
  },
});

const CONFIGURED = { facebook: { configured: true }, instagram: { configured: true } };
const NOT_CONFIGURED = { facebook: { configured: false }, instagram: { configured: false } };

const summary = (role = 'OWNER') => ({
  accounts: {
    total: 5,
    facebookPages: 3,
    instagramAccounts: 2,
    connected: 4,
    needsAttention: 2,
    ready: 3,
    restricted: 1,
    unavailable: 1,
  },
  connections:
    role === 'OWNER' || role === 'ADMIN'
      ? {
          total: 3,
          facebook: 2,
          instagram: 1,
          active: 2,
          expired: 1,
          revoked: 0,
          disconnected: 0,
          error: 0,
          expiringSoon: 1,
          needsAttention: 2,
        }
      : null,
  meta: { facebookConfigured: true, instagramConfigured: true },
  truncated: false,
});

/* Logins trimmed from real GET /social-connections responses (Meta simulator), own ids. */

const alice = (overrides = {}) => ({
  id: 'c1',
  provider: 'FACEBOOK_LOGIN',
  displayName: 'Alice',
  pictureUrl: 'https://example.fbcdn.net/100.jpg',
  status: 'ACTIVE',
  statusReason: null,
  grantedScopes: [
    'pages_show_list',
    'pages_read_engagement',
    'pages_manage_posts',
    'instagram_basic',
    'instagram_content_publish',
  ],
  declinedScopes: [],
  missingScopes: { required: [], recommended: [], publishing: [] },
  tokenExpiresAt: at(60 * DAY),
  dataAccessExpiresAt: at(89 * DAY),
  expiringSoonAt: null,
  lastSyncedAt: at(-5 * MINUTE),
  lastSyncAttemptAt: at(-5 * MINUTE),
  lastSyncOutcome: 'SUCCESS',
  syncInProgress: false,
  lastRefreshedAt: at(-DAY),
  lastError: null,
  attention: [],
  needsAttention: false,
  connectedBy: { id: 'u1', name: 'Olivia Owner' },
  disconnectedAt: null,
  accountCount: 3,
  accountCounts: { facebookPages: 2, instagramAccounts: 1, needsAttention: 1 },
  createdAt: at(-30 * DAY),
  updatedAt: at(-5 * MINUTE),
  ...overrides,
});

const soloCreator = (overrides = {}) =>
  alice({
    id: 'c2',
    provider: 'INSTAGRAM_LOGIN',
    displayName: '@solo.creator',
    pictureUrl: 'https://example.cdninstagram.com/17841400000000099.jpg',
    grantedScopes: ['instagram_business_basic', 'instagram_business_content_publish'],
    tokenExpiresAt: at(3 * DAY),
    dataAccessExpiresAt: null,
    expiringSoonAt: at(3 * DAY),
    attention: [
      {
        code: 'EXPIRING_SOON',
        message: 'Access expires soon. Reconnect before then to avoid an interruption.',
      },
    ],
    needsAttention: true,
    accountCount: 1,
    accountCounts: { facebookPages: 0, instagramAccounts: 1, needsAttention: 0 },
    ...overrides,
  });

const EXPIRED_REASON = 'The access token has expired. Reconnect to restore access.';

const bob = (overrides = {}) =>
  alice({
    id: 'c3',
    displayName: 'Bob Builder',
    pictureUrl: null,
    status: 'EXPIRED',
    statusReason: EXPIRED_REASON,
    lastSyncedAt: null,
    lastSyncAttemptAt: at(-2 * MINUTE),
    lastSyncOutcome: 'TOKEN_EXPIRED',
    lastError: { code: 'TOKEN_EXPIRED', message: 'Session has expired', at: at(-2 * MINUTE) },
    attention: [{ code: 'CONNECTION_EXPIRED', message: EXPIRED_REASON }],
    needsAttention: true,
    connectedBy: null,
    accountCount: 1,
    accountCounts: { facebookPages: 1, instagramAccounts: 0, needsAttention: 1 },
    ...overrides,
  });

function setup(role, routes = {}) {
  return mockFetch({
    'POST /auth/refresh': () => jsonResponse(200, { user, accessToken: 'access' }),
    'GET /workspaces': () => jsonResponse(200, { items: [workspace(role)] }),
    'GET /integrations/meta': () => jsonResponse(200, CONFIGURED),
    'GET /workspaces/w1/social-accounts/summary': () => jsonResponse(200, summary(role)),
    'GET /workspaces/w1/social-connections': () =>
      jsonResponse(200, { items: [alice(), soloCreator(), bob()] }),
    ...routes,
  });
}

const findCard = (name) => screen.findByRole('article', { name }, LOAD);
const card = (name) => screen.getByRole('article', { name });

beforeEach(() => {
  setAccessToken(null);
  vi.clearAllMocks();
});
afterEach(() => vi.unstubAllGlobals());

describe('Logins tab', () => {
  it('shows each login with the Pages and Instagram accounts it brings, its sync state and expiry', async () => {
    setup('OWNER');
    renderApp(PATH);

    const aliceCard = await findCard('Alice');
    expect(within(aliceCard).getByText('Facebook login')).toBeInTheDocument();
    expect(within(aliceCard).getByText('Connected')).toBeInTheDocument();
    // One Facebook login can bring several Pages and Instagram accounts.
    expect(
      within(aliceCard).getByText('2 Facebook Pages · 1 Instagram account'),
    ).toBeInTheDocument();
    expect(within(aliceCard).getByText(/1 needs attention/)).toBeInTheDocument();
    expect(within(aliceCard).getByText(/^Connected .+ by Olivia Owner$/)).toBeInTheDocument();
    expect(within(aliceCard).getByText(/Last successful sync/)).toBeInTheDocument();
    expect(within(aliceCard).getByText(/Token valid until/)).toBeInTheDocument();
    expect(within(aliceCard).getByRole('link', { name: 'Alice' })).toHaveAttribute(
      'href',
      '/w/acme/accounts/logins/c1',
    );
    // "View Pages" opens the Pages tab filtered to this login (and likewise for Instagram).
    expect(within(aliceCard).getByRole('link', { name: 'View Pages' })).toHaveAttribute(
      'href',
      '/w/acme/accounts/pages?connectionId=c1',
    );
    expect(
      within(aliceCard).getByRole('link', { name: 'View Instagram accounts' }),
    ).toHaveAttribute('href', '/w/acme/accounts/instagram?connectionId=c1');
    expect(within(aliceCard).getByRole('link', { name: /View details/ })).toHaveAttribute(
      'href',
      '/w/acme/accounts/logins/c1',
    );
    expect(within(aliceCard).getByRole('link', { name: /Choose accounts/ })).toHaveAttribute(
      'href',
      '/w/acme/accounts/logins/c1/select',
    );
    // A working login without problems does not push Reconnect.
    expect(within(aliceCard).queryByRole('button', { name: 'Reconnect' })).not.toBeInTheDocument();

    const instagramCard = card('@solo.creator');
    expect(within(instagramCard).getByText('Instagram login')).toBeInTheDocument();
    expect(within(instagramCard).getByText('1 Instagram account')).toBeInTheDocument();
    expect(within(instagramCard).getByText(/Access expires in 3 days/)).toBeInTheDocument();
    expect(within(instagramCard).getByRole('button', { name: 'Reconnect' })).toBeEnabled();

    const expiredCard = card('Bob Builder');
    expect(within(expiredCard).getByText('Expired')).toBeInTheDocument();
    expect(within(expiredCard).getByText(EXPIRED_REASON)).toBeInTheDocument();
    expect(within(expiredCard).getByText('Never synced')).toBeInTheDocument();
    expect(within(expiredCard).getByText(/Last attempt/)).toBeInTheDocument();
    expect(within(expiredCard).getByText('Token expired')).toBeInTheDocument();
    // Who connected it is unknown: the line only gives the date.
    expect(within(expiredCard).getByText(/^Connected \S/)).not.toHaveTextContent(/ by /);
    expect(
      within(expiredCard).queryByRole('link', { name: /Choose accounts/ }),
    ).not.toBeInTheDocument();

    expect(screen.getByText('3 logins')).toBeInTheDocument();
  });

  it('lists missing permissions: publishing ones as information, required ones as a reconnect', async () => {
    const requiredMessage =
      'Required permission not granted: pages_show_list. Reconnect and allow it.';
    setup('OWNER', {
      'GET /workspaces/w1/social-connections': () =>
        jsonResponse(200, {
          items: [
            alice({
              grantedScopes: ['pages_show_list', 'pages_read_engagement', 'instagram_basic'],
              missingScopes: {
                required: [],
                recommended: [],
                publishing: ['pages_manage_posts', 'instagram_content_publish'],
              },
            }),
            alice({
              id: 'c4',
              displayName: 'Carol',
              grantedScopes: ['pages_read_engagement'],
              missingScopes: {
                required: ['pages_show_list'],
                recommended: [],
                publishing: ['pages_manage_posts'],
              },
              attention: [{ code: 'MISSING_PERMISSIONS', message: requiredMessage }],
              needsAttention: true,
            }),
          ],
        }),
    });
    renderApp(PATH);

    const aliceCard = await findCard('Alice');
    expect(
      within(aliceCard).getByText(
        'Not granted (needed for publishing in a later phase): pages_manage_posts, instagram_content_publish',
      ),
    ).toBeInTheDocument();
    expect(within(aliceCard).queryByRole('button', { name: 'Reconnect' })).not.toBeInTheDocument();

    const carolCard = card('Carol');
    expect(within(carolCard).getByText('Missing permissions:')).toBeInTheDocument();
    expect(within(carolCard).getByText(requiredMessage)).toBeInTheDocument();
    expect(within(carolCard).queryByText(/needed for publishing/)).not.toBeInTheDocument();
    // Only a new authorization can grant the permission: Reconnect becomes the main action.
    expect(within(carolCard).getByRole('button', { name: 'Reconnect' })).toBeEnabled();
  });

  it("explains an expired login and reconnects it through Meta's authorization", async () => {
    const mock = setup('OWNER', {
      'POST /workspaces/w1/meta/authorizations': () =>
        jsonResponse(201, {
          authorizationUrl: 'https://www.facebook.com/v27.0/dialog/oauth?state=reconnect',
        }),
    });
    renderApp(PATH);

    const expiredCard = await findCard('Bob Builder');
    expect(within(expiredCard).getByText(EXPIRED_REASON)).toBeInTheDocument();
    await userEvent.click(within(expiredCard).getByRole('button', { name: 'Reconnect' }));

    await waitFor(() =>
      expect(redirectTo).toHaveBeenCalledWith(
        'https://www.facebook.com/v27.0/dialog/oauth?state=reconnect',
      ),
    );
    const call = mock.calls.find((c) => c.key === 'POST /workspaces/w1/meta/authorizations');
    expect(JSON.parse(call.init.body)).toEqual({ provider: 'FACEBOOK_LOGIN', connectionId: 'c3' });
  });

  it('reconnects a working login from its menu to update permissions', async () => {
    const mock = setup('ADMIN', {
      'POST /workspaces/w1/meta/authorizations': () =>
        jsonResponse(201, { authorizationUrl: 'https://www.facebook.com/v27.0/dialog/oauth' }),
    });
    renderApp(PATH);

    const aliceCard = await findCard('Alice');
    await userEvent.click(
      within(aliceCard).getByRole('button', { name: 'More actions for Alice' }),
    );
    await userEvent.click(screen.getByRole('menuitem', { name: 'Reconnect / update permissions' }));

    await waitFor(() => expect(redirectTo).toHaveBeenCalled());
    const call = mock.calls.find((c) => c.key === 'POST /workspaces/w1/meta/authorizations');
    expect(JSON.parse(call.init.body)).toEqual({ provider: 'FACEBOOK_LOGIN', connectionId: 'c1' });
  });

  it('syncs one login and reports the outcome', async () => {
    const mock = setup('OWNER', {
      'POST /workspaces/w1/social-connections/c1/sync': () =>
        jsonResponse(200, {
          connection: alice({ lastSyncedAt: at(0) }),
          accounts: { refreshed: 3, lost: 0 },
          outcome: 'SUCCESS',
          statusChanged: false,
        }),
    });
    renderApp(PATH);

    const aliceCard = await findCard('Alice');
    await userEvent.click(within(aliceCard).getByRole('button', { name: 'Sync now' }));

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith('Alice synced · 3 accounts refreshed'),
    );
    expect(mock.count('POST /workspaces/w1/social-connections/c1/sync')).toBe(1);
    // The list is read again so the card shows the new state.
    await waitFor(() => expect(mock.count('GET /workspaces/w1/social-connections')).toBe(2));
  });

  it("shows the server's message when a sync is refused because Meta is not configured", async () => {
    const message =
      'Facebook Login is not configured on this server, so SocialHub cannot contact Meta for this login.';
    setup('OWNER', {
      'POST /workspaces/w1/social-connections/c1/sync': () =>
        apiError(409, 'META_NOT_CONFIGURED', message),
    });
    renderApp(PATH);

    const aliceCard = await findCard('Alice');
    await userEvent.click(within(aliceCard).getByRole('button', { name: 'Sync now' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(message));
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('syncs every login and lists each outcome in a results dialog', async () => {
    const mock = setup('OWNER', {
      'POST /workspaces/w1/social-connections/sync': () =>
        jsonResponse(200, {
          results: [
            {
              connectionId: 'c1',
              displayName: 'Alice',
              provider: 'FACEBOOK_LOGIN',
              outcome: 'SUCCESS',
              status: 'ACTIVE',
              accounts: { refreshed: 3, lost: 0 },
              message: null,
            },
            {
              connectionId: 'c2',
              displayName: '@solo.creator',
              provider: 'INSTAGRAM_LOGIN',
              skipReason: 'CONFIG_REQUIRED',
              status: 'ACTIVE',
              accounts: { refreshed: 0, lost: 0 },
              message: 'Instagram Login is not configured on this server.',
            },
            {
              connectionId: 'c3',
              displayName: 'Bob Builder',
              provider: 'FACEBOOK_LOGIN',
              outcome: 'TOKEN_EXPIRED',
              status: 'EXPIRED',
              accounts: { refreshed: 0, lost: 0 },
              message: EXPIRED_REASON,
            },
          ],
          summary: { total: 3, succeeded: 1, failed: 1, skipped: 1 },
        }),
    });
    renderApp(PATH);

    await findCard('Alice');
    await userEvent.click(screen.getByRole('button', { name: 'Sync all' }));

    const dialog = await screen.findByRole('dialog', { name: 'Sync results' });
    expect(within(dialog).getByText(/1 synced · 1 failed · 1 skipped/)).toBeInTheDocument();
    const rows = within(dialog).getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByText('Alice')).toBeInTheDocument();
    expect(within(rows[0]).getByText('Synced')).toBeInTheDocument();
    expect(within(rows[1]).getByText('@solo.creator')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Setup required')).toBeInTheDocument();
    expect(within(rows[2]).getByText('Bob Builder')).toBeInTheDocument();
    expect(within(rows[2]).getByText('Token expired')).toBeInTheDocument();
    expect(within(rows[2]).getByRole('button', { name: /Reconnect/ })).toBeInTheDocument();

    const call = mock.calls.find((c) => c.key === 'POST /workspaces/w1/social-connections/sync');
    expect(JSON.parse(call.init.body)).toEqual({});
    expect(toast.warning).toHaveBeenCalledWith('1 of 3 logins synced — see the results');
  });

  it('disconnects a login only after confirmation', async () => {
    let items = [alice(), soloCreator(), bob()];
    const mock = setup('OWNER', {
      'GET /workspaces/w1/social-connections': () => jsonResponse(200, { items }),
      'POST /workspaces/w1/social-connections/c1/disconnect': () => {
        items = items.map((c) =>
          c.id === 'c1'
            ? alice({
                status: 'DISCONNECTED',
                statusReason: 'Disconnected by a workspace manager.',
                attention: [
                  { code: 'DISCONNECTED', message: 'Disconnected by a workspace manager.' },
                ],
                disconnectedAt: at(0),
              })
            : c,
        );
        return jsonResponse(200, { connection: items[0], revokedAtMeta: false });
      },
    });
    renderApp(PATH);
    const disconnectKey = 'POST /workspaces/w1/social-connections/c1/disconnect';

    const aliceCard = await findCard('Alice');
    await userEvent.click(
      within(aliceCard).getByRole('button', { name: 'More actions for Alice' }),
    );
    await userEvent.click(screen.getByRole('menuitem', { name: 'Disconnect' }));
    let dialog = await screen.findByRole('dialog', { name: 'Disconnect Alice?' });
    expect(
      within(dialog).getByText(
        "SocialHub erases this login's access tokens. Its 3 accounts stay listed but cannot be used until the login is reconnected.",
      ),
    ).toBeInTheDocument();

    // Cancelling changes nothing.
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mock.count(disconnectKey)).toBe(0);

    await userEvent.click(
      within(aliceCard).getByRole('button', { name: 'More actions for Alice' }),
    );
    await userEvent.click(screen.getByRole('menuitem', { name: 'Disconnect' }));
    dialog = await screen.findByRole('dialog', { name: 'Disconnect Alice?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Disconnect' }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Alice disconnected'));
    expect(mock.count(disconnectKey)).toBe(1);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const updated = card('Alice');
    expect(await within(updated).findByText('Disconnected')).toBeInTheDocument();
    expect(within(updated).getByRole('button', { name: 'Sync now' })).toBeDisabled();
    expect(within(updated).getByRole('button', { name: 'Reconnect' })).toBeEnabled();
  });

  it('removes a login with its accounts only after confirmation', async () => {
    let items = [alice(), soloCreator(), bob()];
    const mock = setup('OWNER', {
      'GET /workspaces/w1/social-connections': () => jsonResponse(200, { items }),
      'DELETE /workspaces/w1/social-connections/c1': () => {
        items = items.filter((c) => c.id !== 'c1');
        return jsonResponse(200, { accountsRemoved: 3, revokedAtMeta: false });
      },
    });
    renderApp(PATH);
    const removeKey = 'DELETE /workspaces/w1/social-connections/c1';

    const aliceCard = await findCard('Alice');
    await userEvent.click(
      within(aliceCard).getByRole('button', { name: 'More actions for Alice' }),
    );
    await userEvent.click(screen.getByRole('menuitem', { name: 'Remove with its accounts' }));
    const dialog = await screen.findByRole('dialog', { name: 'Remove Alice?' });
    expect(
      within(dialog).getByText(/The login and the 3 accounts added through it are removed/),
    ).toBeInTheDocument();
    expect(mock.count(removeKey)).toBe(0);

    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Remove login and accounts' }),
    );

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith('Alice removed with 3 accounts'),
    );
    expect(mock.count(removeKey)).toBe(1);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() =>
      expect(screen.queryByRole('article', { name: 'Alice' })).not.toBeInTheDocument(),
    );
    expect(card('Bob Builder')).toBeInTheDocument();
  });

  it('shows a removal failure inside the confirmation', async () => {
    setup('OWNER', {
      'DELETE /workspaces/w1/social-connections/c1': () =>
        apiError(403, 'FORBIDDEN', 'You do not have permission to manage connections.'),
    });
    renderApp(PATH);

    const aliceCard = await findCard('Alice');
    await userEvent.click(
      within(aliceCard).getByRole('button', { name: 'More actions for Alice' }),
    );
    await userEvent.click(screen.getByRole('menuitem', { name: 'Remove with its accounts' }));
    const dialog = await screen.findByRole('dialog', { name: 'Remove Alice?' });
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Remove login and accounts' }),
    );

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'You do not have permission to manage connections.',
    );
    expect(toast.success).not.toHaveBeenCalled();
    expect(card('Alice')).toBeInTheDocument();
  });

  it('filters the loaded logins by name, provider and status', async () => {
    const mock = setup('OWNER');
    renderApp(PATH);
    await findCard('Alice');

    await userEvent.type(screen.getByRole('searchbox', { name: 'Search logins by name' }), 'solo');
    expect(card('@solo.creator')).toBeInTheDocument();
    expect(screen.queryByRole('article', { name: 'Alice' })).not.toBeInTheDocument();
    expect(screen.queryByRole('article', { name: 'Bob Builder' })).not.toBeInTheDocument();
    expect(screen.getByText('1 of 3 logins')).toBeInTheDocument();
    // Option counts reflect the other filters.
    expect(screen.getByRole('option', { name: 'Facebook (0)' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Instagram (1)' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Filter by provider' }),
      'FACEBOOK_LOGIN',
    );
    expect(card('Alice')).toBeInTheDocument();
    expect(card('Bob Builder')).toBeInTheDocument();
    expect(screen.queryByRole('article', { name: '@solo.creator' })).not.toBeInTheDocument();

    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Filter by status' }),
      'EXPIRED',
    );
    expect(card('Bob Builder')).toBeInTheDocument();
    expect(screen.queryByRole('article', { name: 'Alice' })).not.toBeInTheDocument();
    expect(screen.getByText('1 of 3 logins')).toBeInTheDocument();

    await userEvent.type(screen.getByRole('searchbox', { name: 'Search logins by name' }), 'zzz');
    expect(
      screen.getByRole('heading', { name: 'No logins match these filters' }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole('button', { name: 'Clear filters' })[0]);
    expect(card('Alice')).toBeInTheDocument();
    expect(card('@solo.creator')).toBeInTheDocument();
    expect(card('Bob Builder')).toBeInTheDocument();
    expect(screen.getByText('3 logins')).toBeInTheDocument();

    // Filtering happens on the loaded list: the API was asked once.
    expect(mock.count('GET /workspaces/w1/social-connections')).toBe(1);
  });

  it('disables sync and reconnect when the Meta app is not configured', async () => {
    const mock = setup('OWNER', {
      'GET /integrations/meta': () => jsonResponse(200, NOT_CONFIGURED),
    });
    renderApp(PATH);

    const expiredCard = await findCard('Bob Builder');
    expect(screen.getByRole('region', { name: 'Meta setup required' })).toBeInTheDocument();

    const syncButton = within(expiredCard).getByRole('button', { name: 'Sync now' });
    expect(syncButton).toBeDisabled();
    expect(syncButton).toHaveAttribute(
      'title',
      expect.stringMatching(/unavailable until Facebook Login is configured/),
    );
    // Screen readers get the same explanation (and which login the button belongs to).
    expect(syncButton).toHaveAccessibleDescription(
      'Bob Builder Sync and reconnect are unavailable until Facebook Login is configured on this server.',
    );
    expect(within(expiredCard).getByRole('button', { name: 'Reconnect' })).toBeDisabled();
    expect(
      within(expiredCard).getByText(
        'Sync and reconnect are unavailable until Facebook Login is configured on this server.',
      ),
    ).toBeInTheDocument();
    expect(within(card('Alice')).getByRole('button', { name: 'Sync now' })).toBeDisabled();
    expect(within(card('@solo.creator')).getByRole('button', { name: 'Reconnect' })).toBeDisabled();

    expect(screen.getByRole('button', { name: 'Sync all' })).toBeDisabled();
    expect(
      screen.getByText(/Sync is unavailable until Meta setup is complete/),
    ).toBeInTheDocument();

    await userEvent.click(
      within(expiredCard).getByRole('button', { name: 'More actions for Bob Builder' }),
    );
    expect(screen.getByRole('menuitem', { name: 'Reconnect / update permissions' })).toBeDisabled();

    expect(mock.count('POST /workspaces/w1/social-connections/c3/sync')).toBe(0);
    expect(mock.count('POST /workspaces/w1/meta/authorizations')).toBe(0);
  });

  it('only blocks the logins whose provider is not configured, and never syncs a disconnected login', async () => {
    setup('OWNER', {
      'GET /integrations/meta': () =>
        jsonResponse(200, { facebook: { configured: true }, instagram: { configured: false } }),
      'GET /workspaces/w1/social-connections': () =>
        jsonResponse(200, {
          items: [
            alice(),
            soloCreator(),
            bob({
              status: 'DISCONNECTED',
              statusReason: 'Disconnected by a workspace manager.',
              attention: [
                { code: 'DISCONNECTED', message: 'Disconnected by a workspace manager.' },
              ],
            }),
          ],
        }),
    });
    renderApp(PATH);

    const aliceCard = await findCard('Alice');
    expect(within(aliceCard).getByRole('button', { name: 'Sync now' })).toBeEnabled();

    const instagramCard = card('@solo.creator');
    expect(within(instagramCard).getByRole('button', { name: 'Sync now' })).toBeDisabled();
    expect(within(instagramCard).getByRole('button', { name: 'Reconnect' })).toBeDisabled();
    expect(
      within(instagramCard).getByText(/until Instagram Login is configured/),
    ).toBeInTheDocument();

    const disconnectedCard = card('Bob Builder');
    const syncButton = within(disconnectedCard).getByRole('button', { name: 'Sync now' });
    expect(syncButton).toBeDisabled();
    expect(syncButton).toHaveAttribute('title', expect.stringMatching(/disconnected/));
    expect(syncButton).toHaveAccessibleDescription(
      /^Bob Builder This login is disconnected and its access tokens were erased/,
    );
    expect(within(disconnectedCard).getByRole('button', { name: 'Reconnect' })).toBeEnabled();
    await userEvent.click(
      within(disconnectedCard).getByRole('button', { name: 'More actions for Bob Builder' }),
    );
    expect(screen.queryByRole('menuitem', { name: 'Disconnect' })).not.toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Remove with its accounts' })).toBeInTheDocument();

    expect(screen.getByRole('button', { name: 'Sync all' })).toBeEnabled();
  });

  it('explains logins and offers the Connect buttons when there are none', async () => {
    const mock = setup('OWNER', {
      'GET /workspaces/w1/social-connections': () => jsonResponse(200, { items: [] }),
      'POST /workspaces/w1/meta/authorizations': () =>
        jsonResponse(201, { authorizationUrl: 'https://www.facebook.com/v27.0/dialog/oauth?s=1' }),
    });
    renderApp(PATH);

    const heading = await screen.findByRole('heading', { name: 'No logins connected yet' }, LOAD);
    const empty = heading.closest('section');
    expect(within(empty).getByText(/can bring many Facebook Pages/)).toBeInTheDocument();
    expect(within(empty).getByText(/Each login is independent/)).toBeInTheDocument();
    expect(within(empty).getByRole('button', { name: /Connect Instagram/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sync all' })).not.toBeInTheDocument();

    await userEvent.click(within(empty).getByRole('button', { name: /Connect Facebook/ }));
    await waitFor(() =>
      expect(redirectTo).toHaveBeenCalledWith('https://www.facebook.com/v27.0/dialog/oauth?s=1'),
    );
    const call = mock.calls.find((c) => c.key === 'POST /workspaces/w1/meta/authorizations');
    expect(JSON.parse(call.init.body)).toEqual({ provider: 'FACEBOOK_LOGIN' });
  });

  it('says connecting is unavailable until Meta setup is complete', async () => {
    setup('OWNER', {
      'GET /integrations/meta': () => jsonResponse(200, NOT_CONFIGURED),
      'GET /workspaces/w1/social-connections': () => jsonResponse(200, { items: [] }),
    });
    renderApp(PATH);

    const heading = await screen.findByRole('heading', { name: 'No logins connected yet' }, LOAD);
    const empty = heading.closest('section');
    expect(
      within(empty).getByText(/Connecting is unavailable until Meta setup is complete/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Connect Facebook/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Connect Instagram/ })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Meta setup required' })).toBeInTheDocument();
  });

  it('shows an error with a retry when the logins cannot be loaded', async () => {
    let fail = true;
    setup('OWNER', {
      'GET /workspaces/w1/social-connections': () =>
        fail
          ? apiError(500, 'INTERNAL_ERROR', 'The database is unavailable.')
          : jsonResponse(200, { items: [alice()] }),
    });
    renderApp(PATH);

    const alert = await screen.findByRole('alert', {}, LOAD);
    expect(
      within(alert).getByRole('heading', { name: 'Could not load logins' }),
    ).toBeInTheDocument();
    expect(within(alert).getByText('The database is unavailable.')).toBeInTheDocument();

    fail = false;
    await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await findCard('Alice')).toBeInTheDocument();
  });

  it('is restricted for editors and never requests the logins', async () => {
    const mock = setup('EDITOR');
    renderApp(PATH);

    expect(
      await screen.findByRole('heading', { name: 'Logins are restricted' }, LOAD),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to social accounts' })).toHaveAttribute(
      'href',
      '/w/acme/accounts',
    );
    expect(screen.queryByRole('button', { name: 'Sync all' })).not.toBeInTheDocument();
    expect(mock.count('GET /workspaces/w1/social-connections')).toBe(0);
    expect(mock.calls.some((c) => c.key.includes('/social-connections'))).toBe(false);
  });
});
