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
const PATH = '/w/acme/accounts/logins/c1';
const DETAIL = 'GET /workspaces/w1/social-connections/c1';
const RUNS = 'GET /workspaces/w1/social-connections/c1/sync-runs';

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

const SUMMARY = {
  accounts: {
    total: 3,
    facebookPages: 2,
    instagramAccounts: 1,
    connected: 3,
    needsAttention: 2,
    ready: 1,
    restricted: 2,
    unavailable: 0,
  },
  connections: {
    total: 1,
    facebook: 1,
    instagram: 0,
    active: 1,
    expired: 0,
    revoked: 0,
    disconnected: 0,
    error: 0,
    expiringSoon: 0,
    needsAttention: 0,
  },
  meta: { facebookConfigured: true, instagramConfigured: true },
  truncated: false,
};

const EXPIRED_REASON = 'The access token has expired. Reconnect to restore access.';

/* Trimmed from a real GET /social-connections/:id response (Meta simulator), own ids. */

const GRANTED = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_posts',
  'business_management',
  'instagram_basic',
];

const connection = (overrides = {}) => ({
  id: 'c1',
  provider: 'FACEBOOK_LOGIN',
  displayName: 'Alice',
  pictureUrl: 'https://example.fbcdn.net/100.jpg',
  status: 'ACTIVE',
  statusReason: null,
  grantedScopes: GRANTED,
  declinedScopes: ['instagram_content_publish'],
  missingScopes: { required: [], recommended: [], publishing: ['instagram_content_publish'] },
  tokenExpiresAt: at(60 * DAY),
  dataAccessExpiresAt: at(89 * DAY),
  expiringSoonAt: null,
  lastSyncedAt: at(-10 * MINUTE),
  lastSyncAttemptAt: at(-10 * MINUTE),
  lastSyncOutcome: 'SUCCESS',
  syncInProgress: false,
  lastRefreshedAt: at(-DAY),
  lastError: null,
  attention: [],
  needsAttention: false,
  connectedBy: { id: 'u1', name: 'Olivia Owner' },
  disconnectedAt: null,
  accountCount: 3,
  accountCounts: { facebookPages: 2, instagramAccounts: 1, needsAttention: 2 },
  createdAt: at(-30 * DAY),
  updatedAt: at(-10 * MINUTE),
  ...overrides,
});

const summaryOf = (c) => ({
  id: c.id,
  provider: c.provider,
  displayName: c.displayName,
  pictureUrl: c.pictureUrl,
  status: c.status,
});

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

const accounts = (login = connection()) => [
  {
    id: 'a2',
    platform: 'FACEBOOK_PAGE',
    externalId: '5002',
    name: 'Acme Labs',
    pictureUrl: 'https://example.fbcdn.net/page-5002.jpg',
    category: 'Brand',
    tasks: ['ANALYZE'],
    lastSyncedAt: at(-10 * MINUTE),
    createdAt: at(-30 * DAY),
    connection: summaryOf(login),
    linkedPage: null,
    health: health({
      readiness: 'RESTRICTED',
      readinessReasons: [
        'This login has no Page role that allows creating content (CREATE_CONTENT task)',
      ],
      eligibility: { eligible: false, createContent: false, missingPermissions: [] },
      attention: [
        {
          code: 'MISSING_CREATE_CONTENT',
          message: 'This login has no Page role that allows creating content (CREATE_CONTENT task)',
        },
      ],
      needsAttention: true,
    }),
  },
  {
    id: 'a1',
    platform: 'FACEBOOK_PAGE',
    externalId: '5001',
    name: 'Acme Store',
    pictureUrl: 'https://example.fbcdn.net/page-5001.jpg',
    category: 'Brand',
    tasks: ['ANALYZE', 'ADVERTISE', 'MODERATE', 'CREATE_CONTENT', 'MANAGE'],
    lastSyncedAt: at(-10 * MINUTE),
    createdAt: at(-30 * DAY),
    connection: summaryOf(login),
    linkedPage: null,
    health: health(),
  },
  {
    id: 'a3',
    platform: 'INSTAGRAM_ACCOUNT',
    externalId: '17841400000000010',
    name: 'Acme',
    username: 'acme',
    pictureUrl: 'https://example.cdninstagram.com/17841400000000010.jpg',
    tasks: ['ANALYZE', 'ADVERTISE', 'MODERATE', 'CREATE_CONTENT', 'MANAGE'],
    lastSyncedAt: at(-10 * MINUTE),
    createdAt: at(-30 * DAY),
    connection: summaryOf(login),
    linkedPage: { id: 'a1', externalId: '5001', name: 'Acme Store' },
    health: health({
      readiness: 'RESTRICTED',
      readinessReasons: ['Missing permission: instagram_content_publish'],
      eligibility: {
        eligible: false,
        createContent: true,
        missingPermissions: ['instagram_content_publish'],
      },
      attention: [
        {
          code: 'MISSING_PERMISSIONS',
          message: 'Missing permission: instagram_content_publish',
        },
      ],
      needsAttention: true,
    }),
  },
];

const activity = [
  {
    id: 'e3',
    actorName: 'Olivia Owner',
    action: 'social_connection.synced',
    target: { type: 'social_connection', id: 'c1', label: 'Alice' },
    metadata: { refreshed: 3, lost: 0, from: 'ACTIVE', to: 'ACTIVE' },
    createdAt: at(-10 * MINUTE),
  },
  {
    id: 'e2',
    actorName: 'Olivia Owner',
    action: 'social_account.added',
    target: { type: 'social_account', id: 'a1', label: 'Acme Store' },
    metadata: { platform: 'FACEBOOK_PAGE', via: 'Alice' },
    createdAt: at(-30 * DAY + MINUTE),
  },
  {
    id: 'e1',
    actorName: 'Olivia Owner',
    action: 'social_connection.connected',
    target: { type: 'social_connection', id: 'c1', label: 'Alice' },
    metadata: { provider: 'FACEBOOK_LOGIN', grantedScopes: GRANTED },
    createdAt: at(-30 * DAY),
  },
];

const detail = ({ login = connection(), ...overrides } = {}) => ({
  connection: login,
  accounts: accounts(login),
  permissions: {
    granted: login.grantedScopes,
    declined: login.declinedScopes,
    requested: [
      'pages_show_list',
      'pages_read_engagement',
      'pages_manage_posts',
      'instagram_basic',
      'instagram_content_publish',
    ],
    missing: login.missingScopes,
  },
  syncHistory: [],
  activity,
  capabilities: { providerConfigured: true },
  ...overrides,
});

const run = (id, overrides = {}) => ({
  id,
  trigger: 'MANUAL',
  actorName: 'Olivia Owner',
  startedAt: at(-10 * MINUTE),
  finishedAt: at(-10 * MINUTE + 50),
  durationMs: 50,
  outcome: 'SUCCESS',
  statusBefore: 'ACTIVE',
  statusAfter: 'ACTIVE',
  accounts: { refreshed: 3, lost: 0 },
  ...overrides,
});

const FIRST_PAGE = {
  items: [run('r3'), run('r2', { trigger: 'BULK', startedAt: at(-DAY) })],
  nextCursor: 'r2',
};
const SECOND_PAGE = {
  items: [
    run('r1', {
      trigger: 'SCHEDULED',
      actorName: null,
      startedAt: at(-3 * DAY),
      outcome: 'TOKEN_EXPIRED',
      statusAfter: 'EXPIRED',
      accounts: { refreshed: 0, lost: 0 },
      error: { kind: 'TOKEN_EXPIRED', code: '190', message: 'Session has expired' },
    }),
  ],
  nextCursor: null,
};

function setup(role, routes = {}) {
  return mockFetch({
    'POST /auth/refresh': () => jsonResponse(200, { user, accessToken: 'access' }),
    'GET /workspaces': () => jsonResponse(200, { items: [workspace(role)] }),
    'GET /integrations/meta': () => jsonResponse(200, CONFIGURED),
    'GET /workspaces/w1/social-accounts/summary': () => jsonResponse(200, SUMMARY),
    [DETAIL]: () => jsonResponse(200, detail()),
    [RUNS]: ({ url }) =>
      jsonResponse(200, url.searchParams.get('cursor') === 'r2' ? SECOND_PAGE : FIRST_PAGE),
    ...routes,
  });
}

/** The card (Card renders a <section>) whose title is `title`. */
const card = (title) => screen.getByRole('heading', { level: 2, name: title }).closest('section');
const findTitle = () => screen.findByRole('heading', { level: 1, name: 'Alice' }, LOAD);

beforeEach(() => {
  setAccessToken(null);
  vi.clearAllMocks();
});
afterEach(() => vi.unstubAllGlobals());

describe('Login detail page', () => {
  it('shows the login with its health, details, permissions, accounts and activity', async () => {
    setup('OWNER');
    renderApp(PATH);

    await findTitle();
    expect(screen.getByRole('link', { name: 'Logins' })).toHaveAttribute(
      'href',
      '/w/acme/accounts/logins',
    );
    expect(screen.getByText('Facebook login')).toBeInTheDocument();
    expect(screen.getByText('2 Facebook Pages · 1 Instagram account')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sync now' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Reconnect' })).toBeEnabled();
    const chooseLinks = screen.getAllByRole('link', { name: 'Choose accounts' });
    expect(chooseLinks.length).toBeGreaterThan(0);
    for (const link of chooseLinks) {
      expect(link).toHaveAttribute('href', '/w/acme/accounts/logins/c1/select');
    }

    const healthCard = card('Health');
    expect(within(healthCard).getByText('Connected')).toBeInTheDocument();
    expect(
      within(healthCard).getByText(/2 of 3 accounts from this login need attention/),
    ).toBeInTheDocument();

    const details = card('Login details');
    expect(within(details).getByText('Facebook Login')).toBeInTheDocument();
    expect(within(details).getByText(/by Olivia Owner/)).toBeInTheDocument();
    expect(within(details).getByText(/Token valid until/)).toBeInTheDocument();
    expect(within(details).getByText(/Expiry date:/)).toBeInTheDocument();
    expect(within(details).getByText(/Reconnecting renews Meta's data access/)).toBeInTheDocument();
    expect(within(details).getByText('Synced')).toBeInTheDocument();

    const permissions = card('Permissions');
    const forPublishing = within(permissions).getByRole('list', {
      name: 'Missing: for publishing',
    });
    expect(within(forPublishing).getByText('instagram_content_publish')).toBeInTheDocument();
    expect(
      within(permissions).getByText(/needed for publishing in a later phase/),
    ).toBeInTheDocument();
    const granted = within(permissions).getByRole('list', { name: 'Granted' });
    expect(within(granted).getAllByRole('listitem')).toHaveLength(GRANTED.length);
    expect(within(granted).queryByText('instagram_content_publish')).not.toBeInTheDocument();
    expect(
      within(within(permissions).getByRole('list', { name: 'Declined' })).getByText(
        'instagram_content_publish',
      ),
    ).toBeInTheDocument();
    expect(
      within(permissions).getByRole('list', { name: 'Requested by SocialHub' }),
    ).toBeInTheDocument();
    expect(
      within(permissions).queryByRole('list', { name: 'Missing: required' }),
    ).not.toBeInTheDocument();

    const accountsCard = card('Accounts from this login');
    expect(within(accountsCard).getByRole('link', { name: 'Acme Store' })).toHaveAttribute(
      'href',
      '/w/acme/accounts/a/a1',
    );
    expect(within(accountsCard).getByRole('link', { name: 'Acme Labs' })).toHaveAttribute(
      'href',
      '/w/acme/accounts/a/a2',
    );
    expect(within(accountsCard).getByRole('link', { name: 'Acme' })).toHaveAttribute(
      'href',
      '/w/acme/accounts/a/a3',
    );
    expect(
      within(accountsCard).getByText('Instagram account · @acme · linked to Acme Store'),
    ).toBeInTheDocument();
    // Readiness is the server-computed health: only Acme Store has every permission and role.
    expect(within(accountsCard).getAllByText('Publishing permissions OK')).toHaveLength(1);
    expect(within(accountsCard).getAllByText('Missing publishing access')).toHaveLength(2);
    expect(within(accountsCard).getByText('No content-creation role')).toBeInTheDocument();
    expect(screen.queryByText(/Ready to publish/i)).not.toBeInTheDocument();

    const activityCard = card('Activity');
    expect(
      within(activityCard).getByText(/connected the Facebook login Alice/),
    ).toBeInTheDocument();
    expect(within(activityCard).getByText(/added Acme Store via Alice/)).toBeInTheDocument();
  });

  it('pages through the sync history with the cursor of the last page', async () => {
    const mock = setup('OWNER');
    renderApp(PATH);
    await findTitle();

    const history = card('Sync history');
    expect(await within(history).findByText('Manual sync')).toBeInTheDocument();
    expect(within(history).getByText('Bulk sync')).toBeInTheDocument();
    expect(within(history).queryByText('Scheduled sync')).not.toBeInTheDocument();

    await userEvent.click(within(history).getByRole('button', { name: 'Load more' }));

    expect(await within(history).findByText('Scheduled sync')).toBeInTheDocument();
    expect(within(history).getByText('Session has expired')).toBeInTheDocument();
    expect(within(history).getByText('Token expired')).toBeInTheDocument();
    expect(within(history).queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
    const cursors = mock.calls
      .filter((c) => c.key === RUNS)
      .map((c) => c.url.searchParams.get('cursor'));
    expect(cursors).toEqual([null, 'r2']);
  });

  it('explains an expired login and reconnects it through Meta', async () => {
    const expired = connection({
      status: 'EXPIRED',
      statusReason: EXPIRED_REASON,
      lastSyncAttemptAt: at(-2 * MINUTE),
      lastSyncOutcome: 'TOKEN_EXPIRED',
      lastError: { code: 'TOKEN_EXPIRED', message: 'Session has expired', at: at(-2 * MINUTE) },
      attention: [{ code: 'CONNECTION_EXPIRED', message: EXPIRED_REASON }],
      needsAttention: true,
      accountCounts: { facebookPages: 2, instagramAccounts: 1, needsAttention: 3 },
    });
    const mock = setup('OWNER', {
      [DETAIL]: () => jsonResponse(200, detail({ login: expired })),
      'POST /workspaces/w1/meta/authorizations': () =>
        jsonResponse(201, {
          authorizationUrl: 'https://www.facebook.com/v27.0/dialog/oauth?state=again',
        }),
    });
    renderApp(PATH);
    await findTitle();

    const healthCard = card('Health');
    expect(within(healthCard).getByText('Expired')).toBeInTheDocument();
    expect(within(healthCard).getByText(EXPIRED_REASON)).toBeInTheDocument();
    expect(within(healthCard).getByText('Session has expired')).toBeInTheDocument();
    expect(within(healthCard).getByText('TOKEN_EXPIRED')).toBeInTheDocument();
    expect(within(card('Login details')).getByText('Token expired')).toBeInTheDocument();
    expect(
      within(card('Login details')).getByText('Not usable until this login is reconnected'),
    ).toBeInTheDocument();
    // Accounts cannot be chosen through an expired login.
    expect(screen.queryByRole('link', { name: 'Choose accounts' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Reconnect' }));
    await waitFor(() =>
      expect(redirectTo).toHaveBeenCalledWith(
        'https://www.facebook.com/v27.0/dialog/oauth?state=again',
      ),
    );
    const call = mock.calls.find((c) => c.key === 'POST /workspaces/w1/meta/authorizations');
    expect(JSON.parse(call.init.body)).toEqual({ provider: 'FACEBOOK_LOGIN', connectionId: 'c1' });
  });

  it('syncs the login, reports the outcome and reloads the page data', async () => {
    const mock = setup('OWNER', {
      'POST /workspaces/w1/social-connections/c1/sync': () =>
        jsonResponse(200, {
          connection: connection({ lastSyncedAt: at(0) }),
          accounts: { refreshed: 3, lost: 0 },
          outcome: 'SUCCESS',
          statusChanged: false,
        }),
    });
    renderApp(PATH);
    await findTitle();

    await userEvent.click(screen.getByRole('button', { name: 'Sync now' }));

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith('Alice synced · 3 accounts refreshed'),
    );
    expect(mock.count('POST /workspaces/w1/social-connections/c1/sync')).toBe(1);
    await waitFor(() => expect(mock.count(DETAIL)).toBe(2));
    await waitFor(() => expect(mock.count(RUNS)).toBe(2));
  });

  it('disconnects the login only after confirmation', async () => {
    let current = detail();
    const mock = setup('OWNER', {
      [DETAIL]: () => jsonResponse(200, current),
      'POST /workspaces/w1/social-connections/c1/disconnect': () => {
        current = detail({
          login: connection({
            status: 'DISCONNECTED',
            statusReason: 'Disconnected by a workspace manager.',
            attention: [{ code: 'DISCONNECTED', message: 'Disconnected by a workspace manager.' }],
            needsAttention: true,
            tokenExpiresAt: null,
            dataAccessExpiresAt: null,
            disconnectedAt: at(0),
          }),
        });
        return jsonResponse(200, { connection: current.connection, revokedAtMeta: false });
      },
    });
    renderApp(PATH);
    await findTitle();
    const disconnectKey = 'POST /workspaces/w1/social-connections/c1/disconnect';

    await userEvent.click(screen.getByRole('button', { name: 'More actions for Alice' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Disconnect' }));
    const dialog = await screen.findByRole('dialog', { name: 'Disconnect Alice?' });
    expect(within(dialog).getByText(/erases this login's access tokens/)).toBeInTheDocument();
    expect(mock.count(disconnectKey)).toBe(0);

    await userEvent.click(within(dialog).getByRole('button', { name: 'Disconnect' }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Alice disconnected'));
    expect(mock.count(disconnectKey)).toBe(1);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(
      await within(card('Health')).findByText('Disconnected by a workspace manager.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sync now' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Sync now' })).toHaveAttribute(
      'title',
      expect.stringMatching(/disconnected/),
    );
    expect(
      within(card('Login details')).getByText(
        'Tokens were erased when this login was disconnected',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Choose accounts' })).not.toBeInTheDocument();
  });

  it('removes the login with its accounts and returns to the Logins tab', async () => {
    const mock = setup('OWNER', {
      'DELETE /workspaces/w1/social-connections/c1': () =>
        jsonResponse(200, { accountsRemoved: 3, revokedAtMeta: false }),
      'GET /workspaces/w1/social-connections': () => jsonResponse(200, { items: [] }),
    });
    const { router } = renderApp(PATH);
    await findTitle();
    const removeKey = 'DELETE /workspaces/w1/social-connections/c1';

    await userEvent.click(screen.getByRole('button', { name: 'More actions for Alice' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Remove with its accounts' }));
    const dialog = await screen.findByRole('dialog', { name: 'Remove Alice?' });
    expect(
      within(dialog).getByText(/The login and the 3 accounts added through it are removed/),
    ).toBeInTheDocument();
    expect(mock.count(removeKey)).toBe(0);

    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Remove login and accounts' }),
    );

    await waitFor(() => expect(router.state.location.pathname).toBe('/w/acme/accounts/logins'));
    expect(mock.count(removeKey)).toBe(1);
    expect(toast.success).toHaveBeenCalledWith('Alice removed with 3 accounts');
    expect(
      await screen.findByRole('heading', { name: 'No logins connected yet' }, LOAD),
    ).toBeInTheDocument();
    // The removed login is not read again (it would only answer 404).
    expect(mock.count(DETAIL)).toBe(1);
  });

  it('says the login was not found for an unknown id', async () => {
    setup('OWNER', {
      'GET /workspaces/w1/social-connections/c9': () =>
        apiError(404, 'NOT_FOUND', 'Connection not found'),
    });
    renderApp('/w/acme/accounts/logins/c9');

    expect(
      await screen.findByRole('heading', { name: 'Login not found' }, LOAD),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to logins' })).toHaveAttribute(
      'href',
      '/w/acme/accounts/logins',
    );
    expect(screen.getByRole('link', { name: 'Logins' })).toHaveAttribute(
      'href',
      '/w/acme/accounts/logins',
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows an error with a retry when the login cannot be loaded', async () => {
    let fail = true;
    setup('OWNER', {
      [DETAIL]: () =>
        fail
          ? apiError(500, 'INTERNAL_ERROR', 'The database is unavailable.')
          : jsonResponse(200, detail()),
    });
    renderApp(PATH);

    const alert = await screen.findByRole('alert', {}, LOAD);
    expect(
      within(alert).getByRole('heading', { name: 'Could not load this login' }),
    ).toBeInTheDocument();
    expect(within(alert).getByText('The database is unavailable.')).toBeInTheDocument();

    fail = false;
    await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await findTitle()).toBeInTheDocument();
  });

  it('disables sync and reconnect and shows the setup notice when Meta is not configured', async () => {
    const mock = setup('OWNER', {
      'GET /integrations/meta': () =>
        jsonResponse(200, { facebook: { configured: false }, instagram: { configured: true } }),
      [DETAIL]: () => jsonResponse(200, detail({ capabilities: { providerConfigured: false } })),
    });
    renderApp(PATH);
    await findTitle();

    expect(
      await screen.findByRole('region', { name: 'Facebook Login is not configured' }),
    ).toBeInTheDocument();
    const syncButton = screen.getByRole('button', { name: 'Sync now' });
    expect(syncButton).toBeDisabled();
    expect(syncButton).toHaveAttribute(
      'title',
      expect.stringMatching(/unavailable until Facebook Login is configured/),
    );
    expect(screen.getByRole('button', { name: 'Reconnect' })).toBeDisabled();
    expect(
      within(card('Health')).getByText(
        'Sync and reconnect are unavailable until Facebook Login is configured on this server.',
      ),
    ).toBeInTheDocument();
    expect(mock.count('POST /workspaces/w1/social-connections/c1/sync')).toBe(0);
  });

  it('invites choosing accounts when none were added from the login yet', async () => {
    setup('OWNER', {
      [DETAIL]: () =>
        jsonResponse(
          200,
          detail({
            login: connection({
              accountCount: 0,
              accountCounts: { facebookPages: 0, instagramAccounts: 0, needsAttention: 0 },
            }),
            accounts: [],
            activity: [],
          }),
        ),
      [RUNS]: () => jsonResponse(200, { items: [], nextCursor: null }),
    });
    renderApp(PATH);
    await findTitle();

    const accountsCard = card('Accounts from this login');
    expect(
      within(accountsCard).getByRole('heading', { name: 'No accounts added from this login yet' }),
    ).toBeInTheDocument();
    expect(within(accountsCard).getByRole('link', { name: 'Choose accounts' })).toHaveAttribute(
      'href',
      '/w/acme/accounts/logins/c1/select',
    );
    expect(
      within(card('Sync history')).getByText('This login has not been synchronized yet.'),
    ).toBeInTheDocument();
    expect(within(card('Activity')).getByText('No activity yet')).toBeInTheDocument();
    expect(within(card('Health')).getByText(/Nothing needs attention/)).toBeInTheDocument();
  });

  it('is restricted for editors and never requests the login', async () => {
    const mock = setup('EDITOR');
    renderApp(PATH);

    const heading = await screen.findByRole(
      'heading',
      { name: 'Login details are restricted' },
      LOAD,
    );
    // The back link (just before the card) leads to the section editors can use.
    const backLink = heading.closest('section').previousElementSibling;
    expect(backLink).toHaveAttribute('href', '/w/acme/accounts');
    expect(backLink).toHaveTextContent('Social accounts');
    expect(screen.queryByRole('button', { name: 'Sync now' })).not.toBeInTheDocument();
    expect(mock.calls.some((c) => c.key.includes('/social-connections'))).toBe(false);
  });
});
