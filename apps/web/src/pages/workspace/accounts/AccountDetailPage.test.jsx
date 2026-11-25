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

/* ------------------------------------------------------------------ fixtures */
// Trimmed from responses captured from the API running against the Meta simulator.

const PAGE_ID = '6b0000000000000000000a01';
const IG_ID = '6b0000000000000000000a02';
const LOGIN_ID = '6b0000000000000000000c01';
const IG_LOGIN_ID = '6b0000000000000000000c02';

const DETAIL_PATH = (id) => `GET /workspaces/w1/social-accounts/${id}`;
const now = Date.now();
const inDays = (days) => new Date(now + days * 86_400_000).toISOString();
const daysAgo = (days) => new Date(now - days * 86_400_000).toISOString();

const user = { id: 'u1', name: 'Olivia Owner', email: 'olivia@example.com' };

const workspace = (role, accountAccess = { mode: 'ALL', socialAccountIds: [] }) => ({
  id: 'w1',
  name: 'Acme Social',
  slug: 'acme',
  timezone: 'UTC',
  membership: { id: 'm1', role, permissions: [], accountAccess },
});

const configured = { facebook: { configured: true }, instagram: { configured: true } };
const unconfigured = { facebook: { configured: false }, instagram: { configured: false } };

const summary = {
  accounts: {
    total: 2,
    facebookPages: 1,
    instagramAccounts: 1,
    connected: 2,
    needsAttention: 1,
    ready: 1,
    restricted: 1,
    unavailable: 0,
  },
  connections: null,
  meta: { facebookConfigured: true, instagramConfigured: true },
  truncated: false,
};

const CREATE_CONTENT_REASON =
  'This login has no Page role that allows creating content (CREATE_CONTENT task)';
const TOKEN_EXPIRED_REASON = 'The access token has expired. Reconnect to restore access.';

const loginSummary = (overrides = {}) => ({
  id: LOGIN_ID,
  provider: 'FACEBOOK_LOGIN',
  displayName: 'Alice',
  pictureUrl: null,
  status: 'ACTIVE',
  ...overrides,
});

/** Full login view (members who manage logins). Never contains token material. */
const fullLogin = (overrides = {}) => ({
  ...loginSummary(),
  statusReason: null,
  grantedScopes: [
    'pages_show_list',
    'pages_read_engagement',
    'business_management',
    'instagram_basic',
    'instagram_content_publish',
  ],
  declinedScopes: ['pages_manage_posts'],
  missingScopes: { required: [], recommended: [], publishing: ['pages_manage_posts'] },
  tokenExpiresAt: inDays(50),
  dataAccessExpiresAt: inDays(80),
  expiringSoonAt: null,
  lastSyncedAt: daysAgo(1),
  lastSyncAttemptAt: daysAgo(1),
  lastSyncOutcome: 'SUCCESS',
  syncInProgress: false,
  lastError: null,
  attention: [],
  needsAttention: false,
  connectedBy: { id: 'u1', name: 'Olivia Owner' },
  disconnectedAt: null,
  createdAt: daysAgo(30),
  ...overrides,
});

const readyHealth = (overrides = {}) => ({
  connectionStatus: 'ACTIVE',
  connectionStatusReason: null,
  readiness: 'READY',
  readinessReasons: [],
  eligibility: { eligible: true, createContent: true, missingPermissions: [] },
  attention: [],
  needsAttention: false,
  ...overrides,
});

/** A Page whose login lacks pages_manage_posts and holds no CREATE_CONTENT role. */
const restrictedHealth = () => ({
  connectionStatus: 'ACTIVE',
  connectionStatusReason: null,
  readiness: 'RESTRICTED',
  readinessReasons: ['Missing permission: pages_manage_posts', CREATE_CONTENT_REASON],
  eligibility: {
    eligible: false,
    createContent: false,
    missingPermissions: ['pages_manage_posts'],
  },
  attention: [
    { code: 'MISSING_PERMISSIONS', message: 'Missing permission: pages_manage_posts' },
    { code: 'MISSING_CREATE_CONTENT', message: CREATE_CONTENT_REASON },
  ],
  needsAttention: true,
});

const expiredHealth = () => ({
  connectionStatus: 'EXPIRED',
  connectionStatusReason: TOKEN_EXPIRED_REASON,
  readiness: 'UNAVAILABLE',
  readinessReasons: [TOKEN_EXPIRED_REASON],
  eligibility: { eligible: false, createContent: false, missingPermissions: [] },
  attention: [{ code: 'CONNECTION_EXPIRED', message: TOKEN_EXPIRED_REASON }],
  needsAttention: true,
});

const pageAccount = (overrides = {}) => ({
  id: PAGE_ID,
  workspace: 'w1',
  platform: 'FACEBOOK_PAGE',
  externalId: '5002',
  name: 'Acme Labs',
  pictureUrl: null,
  category: 'Brand',
  tasks: ['ANALYZE'],
  connectionStatus: 'ACTIVE',
  publishingStatus: 'RESTRICTED',
  lastSyncedAt: daysAgo(1),
  createdAt: daysAgo(30),
  updatedAt: daysAgo(1),
  connection: loginSummary(),
  linkedPage: null,
  health: restrictedHealth(),
  ...overrides,
});

const igAccount = (overrides = {}) => ({
  id: IG_ID,
  workspace: 'w1',
  platform: 'INSTAGRAM_ACCOUNT',
  externalId: '17841400000000010',
  name: 'Acme',
  username: 'acme',
  pictureUrl: null,
  linkedFacebookPageExternalId: '5002',
  linkedFacebookPageName: 'Acme Labs',
  tasks: ['ANALYZE', 'ADVERTISE', 'MODERATE', 'CREATE_CONTENT', 'MANAGE'],
  connectionStatus: 'ACTIVE',
  publishingStatus: 'READY',
  lastSyncedAt: daysAgo(1),
  createdAt: daysAgo(30),
  updatedAt: daysAgo(1),
  connection: loginSummary(),
  linkedPage: { id: PAGE_ID, externalId: '5002', name: 'Acme Labs' },
  health: readyHealth(),
  ...overrides,
});

const members = () => [
  {
    memberId: 'm1',
    user: { id: 'u1', name: 'Olivia Owner', email: 'olivia@example.com' },
    role: 'OWNER',
    mode: 'ALL',
    hasAccess: true,
    fullAccess: true,
    manageable: false,
  },
  {
    memberId: 'm2',
    user: { id: 'u2', name: 'Adam Admin', email: 'adam@example.com' },
    role: 'ADMIN',
    mode: 'ALL',
    hasAccess: true,
    fullAccess: true,
    manageable: false,
  },
  {
    memberId: 'm3',
    user: { id: 'u3', name: 'Eddie Editor', email: 'eddie@example.com' },
    role: 'EDITOR',
    mode: 'SELECTED',
    hasAccess: false,
    fullAccess: false,
    manageable: true,
  },
  {
    memberId: 'm4',
    user: { id: 'u4', name: 'Vera Viewer', email: 'vera@example.com' },
    role: 'VIEWER',
    mode: 'ALL',
    hasAccess: true,
    fullAccess: false,
    manageable: true,
  },
];

const managerCapabilities = {
  canManageConnections: true,
  canManageAccess: true,
  canViewActivity: true,
  providerConfigured: true,
};

/** Owner/admin view of the restricted Page (shape of GET /workspaces/:id/social-accounts/:id). */
const pageDetail = (overrides = {}) => ({
  account: pageAccount(),
  connection: fullLogin(),
  linkedPage: null,
  linkedInstagram: [igAccount()],
  permissions: {
    granted: fullLogin().grantedScopes,
    declined: ['pages_manage_posts'],
    requiredForPublishing: ['pages_manage_posts', 'pages_read_engagement'],
    missing: ['pages_manage_posts'],
    tasks: ['ANALYZE'],
    createContent: false,
  },
  syncHistory: [
    {
      id: 'run1',
      workspace: 'w1',
      connection: LOGIN_ID,
      trigger: 'BULK',
      actorName: 'Olivia Owner',
      startedAt: daysAgo(1),
      finishedAt: daysAgo(1),
      durationMs: 50,
      outcome: 'SUCCESS',
      statusBefore: 'ACTIVE',
      statusAfter: 'ACTIVE',
      accounts: { refreshed: 3, lost: 0 },
    },
  ],
  activity: [
    {
      id: 'act1',
      workspace: 'w1',
      actorName: 'Olivia Owner',
      action: 'social_account.added',
      target: { type: 'social_account', id: PAGE_ID, label: 'Acme Labs' },
      metadata: { platform: 'FACEBOOK_PAGE', via: 'Alice' },
      createdAt: daysAgo(30),
    },
  ],
  access: members(),
  capabilities: managerCapabilities,
  ...overrides,
});

/** Editor/viewer view: login summary only, no history, activity or team access. */
const editorDetail = (overrides = {}) => ({
  ...pageDetail(),
  connection: loginSummary(),
  permissions: {
    granted: fullLogin().grantedScopes,
    requiredForPublishing: ['pages_manage_posts', 'pages_read_engagement'],
    missing: ['pages_manage_posts'],
    tasks: ['ANALYZE'],
    createContent: false,
  },
  syncHistory: null,
  activity: null,
  access: null,
  capabilities: {
    canManageConnections: false,
    canManageAccess: false,
    canViewActivity: false,
    providerConfigured: true,
  },
  ...overrides,
});

function setup(role, routes = {}, { accountAccess, integration = configured } = {}) {
  return mockFetch({
    'POST /auth/refresh': () => jsonResponse(200, { user, accessToken: 'access' }),
    'GET /workspaces': () => jsonResponse(200, { items: [workspace(role, accountAccess)] }),
    'GET /integrations/meta': () => jsonResponse(200, integration),
    'GET /workspaces/w1/social-accounts/summary': () => jsonResponse(200, summary),
    ...routes,
  });
}

/** The card (a <section>) whose heading is `name`. */
const card = (name) => screen.getByRole('heading', { level: 2, name }).closest('section');
const findCard = async (name) =>
  (await screen.findByRole('heading', { level: 2, name })).closest('section');

beforeEach(() => {
  setAccessToken(null);
  vi.clearAllMocks();
});
afterEach(() => vi.unstubAllGlobals());

/* --------------------------------------------------------------------- tests */

describe('account detail — managers', () => {
  it('shows the full detail of a restricted Facebook Page to an owner', async () => {
    setup('OWNER', { [DETAIL_PATH(PAGE_ID)]: () => jsonResponse(200, pageDetail()) });
    renderApp(`/w/acme/accounts/a/${PAGE_ID}`);

    expect(await screen.findByRole('heading', { level: 1, name: 'Acme Labs' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Facebook Pages' })).toHaveAttribute(
      'href',
      '/w/acme/accounts/pages',
    );
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled();
    // The login is healthy, so reconnecting is offered only from the menu.
    expect(screen.queryByRole('button', { name: 'Reconnect login' })).not.toBeInTheDocument();

    // Readiness: the server-computed reasons, never "ready to publish".
    const health = card('Health and publishing readiness');
    expect(within(health).getByText('Missing publishing access')).toBeInTheDocument();
    const reasons = within(health).getByRole('list', { name: 'Why this account is not ready' });
    expect(within(reasons).getByText(CREATE_CONTENT_REASON)).toBeInTheDocument();
    expect(within(reasons).getByText('Missing permission: pages_manage_posts')).toBeInTheDocument();
    expect(within(health).getByText('Cannot create content')).toBeInTheDocument();
    expect(
      within(within(health).getByRole('list', { name: 'Missing permissions' })).getByText(
        'pages_manage_posts',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/ready to publish/i)).not.toBeInTheDocument();

    // Account information.
    const info = card('Account information');
    expect(within(info).getByText('Page ID')).toBeInTheDocument();
    expect(within(info).getByText('5002')).toBeInTheDocument();
    expect(within(info).getByText('Brand')).toBeInTheDocument();
    expect(within(info).getByText('ANALYZE')).toBeInTheDocument();

    // Login, with a link to the login page and its expiry for managers.
    const login = card('Login');
    expect(within(login).getByRole('link', { name: 'Alice' })).toHaveAttribute(
      'href',
      `/w/acme/accounts/logins/${LOGIN_ID}`,
    );
    expect(within(login).getByText('Facebook login')).toBeInTheDocument();
    expect(within(login).getByText(/Token valid until/)).toBeInTheDocument();
    expect(within(login).getByText(/Connected by Olivia Owner/)).toBeInTheDocument();

    // Linked Instagram account.
    expect(within(card('Linked accounts')).getByRole('link', { name: 'Acme' })).toHaveAttribute(
      'href',
      `/w/acme/accounts/a/${IG_ID}`,
    );

    // Permissions checklist.
    const permissions = card('Permissions');
    const checklist = within(permissions).getByRole('list', { name: 'Needed for publishing' });
    expect(within(checklist).getByText('pages_manage_posts').closest('li')).toHaveTextContent(
      'Missing',
    );
    expect(within(checklist).getByText('pages_read_engagement').closest('li')).toHaveTextContent(
      'Granted',
    );
    expect(
      within(within(permissions).getByRole('list', { name: 'Declined permissions' })).getByText(
        'pages_manage_posts',
      ),
    ).toBeInTheDocument();
    expect(
      within(
        within(permissions).getByRole('list', { name: 'Other granted permissions' }),
      ).getByText('instagram_content_publish'),
    ).toBeInTheDocument();

    // Sync history of the login, with a link to its full history.
    const history = card('Sync history');
    expect(within(history).getByText('Bulk sync')).toBeInTheDocument();
    expect(within(history).getByText('Synced')).toBeInTheDocument();
    expect(within(history).getByRole('link', { name: 'Full history' })).toHaveAttribute(
      'href',
      `/w/acme/accounts/logins/${LOGIN_ID}`,
    );

    // Activity.
    expect(within(card('Activity')).getByText(/added Acme Labs via Alice/)).toBeInTheDocument();

    // Team access.
    const team = card('Team access');
    const owner = within(team).getByRole('checkbox', { name: 'Access for Olivia Owner' });
    expect(owner).toBeChecked();
    expect(owner).toBeDisabled();
    expect(owner.closest('li')).toHaveTextContent('Full access');
    expect(owner.closest('li')).toHaveTextContent('(you)');
    const eddie = within(team).getByRole('checkbox', { name: 'Access for Eddie Editor' });
    expect(eddie).not.toBeChecked();
    expect(eddie).toBeEnabled();
    expect(eddie.closest('li')).toHaveTextContent('No access');
    expect(
      within(team).getByRole('checkbox', { name: 'Access for Vera Viewer' }).closest('li'),
    ).toHaveTextContent('All accounts');
    expect(within(team).getByRole('button', { name: 'Save changes' })).toBeDisabled();
  });

  it('saves team access changes as one grant/revoke request', async () => {
    let access = members();
    const accessPath = `PATCH /workspaces/w1/social-accounts/${PAGE_ID}/access`;
    const mock = setup('OWNER', {
      [DETAIL_PATH(PAGE_ID)]: () => jsonResponse(200, pageDetail({ access })),
      [accessPath]: ({ init }) => {
        const { grant, revoke } = JSON.parse(init.body);
        access = access.map((m) => {
          if (grant.includes(m.memberId)) return { ...m, hasAccess: true };
          if (revoke.includes(m.memberId)) return { ...m, hasAccess: false, mode: 'SELECTED' };
          return m;
        });
        return jsonResponse(200, { members: access });
      },
    });
    renderApp(`/w/acme/accounts/a/${PAGE_ID}`);

    const team = await findCard('Team access');
    const save = within(team).getByRole('button', { name: 'Save changes' });
    const reset = within(team).getByRole('button', { name: 'Reset' });
    expect(within(team).getByText('No unsaved changes')).toBeInTheDocument();

    const eddie = within(team).getByRole('checkbox', { name: 'Access for Eddie Editor' });
    const vera = within(team).getByRole('checkbox', { name: 'Access for Vera Viewer' });
    // Unchecking an "All accounts" member is explained before anything is saved.
    expect(vera).toHaveAccessibleDescription(/switches them to selected accounts/);

    await userEvent.click(eddie);
    await userEvent.click(vera);
    expect(eddie.closest('li')).toHaveTextContent('Gets access when you save');
    expect(vera.closest('li')).toHaveTextContent(
      'Switches to selected accounts when you save, keeping every other account',
    );
    expect(within(team).getByText('2 unsaved changes')).toBeInTheDocument();

    // Toggling back removes the change; Reset discards everything.
    await userEvent.click(eddie);
    expect(within(team).getByText('1 unsaved change')).toBeInTheDocument();
    await userEvent.click(reset);
    expect(vera).toBeChecked();
    expect(within(team).getByText('No unsaved changes')).toBeInTheDocument();

    await userEvent.click(eddie);
    await userEvent.click(vera);
    await userEvent.click(save);

    await waitFor(() => expect(mock.count(accessPath)).toBe(1));
    const call = mock.calls.find((c) => c.key === accessPath);
    expect(JSON.parse(call.init.body)).toEqual({ grant: ['m3'], revoke: ['m4'] });
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        'Access to Acme Labs updated: 1 member added, 1 member removed',
      ),
    );

    // The list now shows what the server saved, with nothing pending.
    expect(within(team).getByText('No unsaved changes')).toBeInTheDocument();
    expect(within(team).getByRole('checkbox', { name: 'Access for Eddie Editor' })).toBeChecked();
    const veraAfter = within(team).getByRole('checkbox', { name: 'Access for Vera Viewer' });
    expect(veraAfter).not.toBeChecked();
    expect(veraAfter.closest('li')).toHaveTextContent('No access');
    expect(mock.count(DETAIL_PATH(PAGE_ID))).toBe(2);
  });

  it('shows a rejected team access change and keeps the selection', async () => {
    const accessPath = `PATCH /workspaces/w1/social-accounts/${PAGE_ID}/access`;
    setup('ADMIN', {
      [DETAIL_PATH(PAGE_ID)]: () => jsonResponse(200, pageDetail()),
      [accessPath]: () =>
        apiError(409, 'CONFLICT', 'Access was changed by someone else. Reload and try again.'),
    });
    renderApp(`/w/acme/accounts/a/${PAGE_ID}`);

    const team = await findCard('Team access');
    const eddie = within(team).getByRole('checkbox', { name: 'Access for Eddie Editor' });
    await userEvent.click(eddie);
    await userEvent.click(within(team).getByRole('button', { name: 'Save changes' }));

    expect(await within(team).findByRole('alert')).toHaveTextContent(
      'Access was changed by someone else. Reload and try again.',
    );
    expect(eddie).toBeChecked();
    expect(toast.success).not.toHaveBeenCalled();

    await userEvent.click(within(team).getByRole('button', { name: 'Reset' }));
    expect(within(team).queryByRole('alert')).not.toBeInTheDocument();
    expect(eddie).not.toBeChecked();
  });

  it('refreshes the account through its login and reports the result', async () => {
    const refreshPath = `POST /workspaces/w1/social-accounts/${PAGE_ID}/refresh`;
    const mock = setup('OWNER', {
      [DETAIL_PATH(PAGE_ID)]: () => jsonResponse(200, pageDetail()),
      [refreshPath]: () =>
        jsonResponse(200, {
          result: {
            accountId: PAGE_ID,
            name: 'Acme Labs',
            connectionId: LOGIN_ID,
            outcome: 'SUCCESS',
            message: null,
          },
          connections: [
            {
              connectionId: LOGIN_ID,
              displayName: 'Alice',
              provider: 'FACEBOOK_LOGIN',
              outcome: 'SUCCESS',
              status: 'ACTIVE',
              accounts: { refreshed: 2, lost: 0 },
              message: null,
            },
          ],
        }),
    });
    renderApp(`/w/acme/accounts/a/${PAGE_ID}`);

    await userEvent.click(await screen.findByRole('button', { name: 'Refresh' }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Acme Labs refreshed'));
    expect(mock.count(refreshPath)).toBe(1);
    // The detail is fetched again so the page shows the refreshed state.
    await waitFor(() => expect(mock.count(DETAIL_PATH(PAGE_ID))).toBe(2));
  });

  it('disables Refresh and shows the setup notice when the login provider is not configured', async () => {
    const refreshPath = `POST /workspaces/w1/social-accounts/${PAGE_ID}/refresh`;
    const mock = setup(
      'OWNER',
      {
        [DETAIL_PATH(PAGE_ID)]: () =>
          jsonResponse(
            200,
            pageDetail({ capabilities: { ...managerCapabilities, providerConfigured: false } }),
          ),
      },
      { integration: unconfigured },
    );
    renderApp(`/w/acme/accounts/a/${PAGE_ID}`);

    const refresh = await screen.findByRole('button', { name: 'Refresh' });
    expect(refresh).toBeDisabled();
    expect(refresh).toHaveAccessibleDescription(
      'Facebook Login is not configured on this server, so SocialHub cannot refresh or reconnect this account.',
    );
    expect(await screen.findByRole('region', { name: 'Meta setup required' })).toBeInTheDocument();

    await userEvent.click(refresh);
    expect(mock.count(refreshPath)).toBe(0);
  });

  it('removes the account after confirmation and returns to the Facebook Pages tab', async () => {
    const deletePath = `DELETE /workspaces/w1/social-accounts/${PAGE_ID}`;
    const mock = setup('OWNER', {
      [DETAIL_PATH(PAGE_ID)]: () => jsonResponse(200, pageDetail()),
      [deletePath]: () => jsonResponse(204),
      'GET /workspaces/w1/social-accounts': () =>
        jsonResponse(200, {
          items: [],
          total: 0,
          page: 1,
          limit: 25,
          pages: 0,
          facets: { platform: {}, status: {}, readiness: {}, attention: 0 },
          truncated: false,
        }),
    });
    const { router } = renderApp(`/w/acme/accounts/a/${PAGE_ID}`);

    await userEvent.click(
      await screen.findByRole('button', { name: 'More actions for Acme Labs' }),
    );
    await userEvent.click(screen.getByRole('menuitem', { name: 'Remove from workspace' }));
    const dialog = screen.getByRole('dialog', { name: 'Remove Acme Labs?' });
    expect(mock.count(deletePath)).toBe(0);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove account' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/w/acme/accounts/pages'));
    expect(mock.count(deletePath)).toBe(1);
    expect(toast.success).toHaveBeenCalledWith('Acme Labs removed from the workspace');
    // The removed account is not fetched again (it would only answer 404).
    expect(mock.count(DETAIL_PATH(PAGE_ID))).toBe(1);
  });

  it('reconnects an expired login through Meta authorization', async () => {
    const mock = setup('ADMIN', {
      [DETAIL_PATH(PAGE_ID)]: () =>
        jsonResponse(
          200,
          pageDetail({
            account: pageAccount({
              health: expiredHealth(),
              connection: loginSummary({ status: 'EXPIRED' }),
            }),
            connection: fullLogin({ status: 'EXPIRED', statusReason: TOKEN_EXPIRED_REASON }),
          }),
        ),
      'POST /workspaces/w1/meta/authorizations': () =>
        jsonResponse(201, {
          authorizationUrl: 'https://www.facebook.com/v27.0/dialog/oauth?state=abc',
        }),
    });
    renderApp(`/w/acme/accounts/a/${PAGE_ID}`);

    const login = await findCard('Login');
    expect(within(login).getByText(TOKEN_EXPIRED_REASON)).toBeInTheDocument();
    expect(within(login).getByText('Expired')).toBeInTheDocument();
    expect(
      within(card('Health and publishing readiness')).getByText('Unavailable'),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Reconnect login' }));
    await waitFor(() =>
      expect(redirectTo).toHaveBeenCalledWith(
        'https://www.facebook.com/v27.0/dialog/oauth?state=abc',
      ),
    );
    const call = mock.calls.find((c) => c.key === 'POST /workspaces/w1/meta/authorizations');
    expect(JSON.parse(call.init.body)).toEqual({
      provider: 'FACEBOOK_LOGIN',
      connectionId: LOGIN_ID,
    });
  });

  it('explains when the login the account came through was removed', async () => {
    setup('OWNER', {
      [DETAIL_PATH(PAGE_ID)]: () =>
        jsonResponse(
          200,
          pageDetail({
            account: pageAccount({
              connection: null,
              health: {
                connectionStatus: 'ERROR',
                connectionStatusReason:
                  'No longer accessible through this login (the role was removed or the account was unlinked).',
                readiness: 'UNAVAILABLE',
                readinessReasons: [
                  'No longer accessible through this login (the role was removed or the account was unlinked).',
                ],
                eligibility: { eligible: false, createContent: null, missingPermissions: [] },
                attention: [
                  {
                    code: 'ACCESS_LOST',
                    message:
                      'No longer accessible through this login (the role was removed or the account was unlinked).',
                  },
                ],
                needsAttention: true,
              },
            }),
            connection: null,
            permissions: null,
            syncHistory: null,
            capabilities: { ...managerCapabilities, providerConfigured: false },
          }),
        ),
    });
    renderApp(`/w/acme/accounts/a/${PAGE_ID}`);

    const login = await findCard('Login');
    expect(
      within(login).getByText(
        'The login this account was added through has been removed. Reconnect a login that manages it.',
      ),
    ).toBeInTheDocument();
    expect(within(login).getByRole('link', { name: 'Go to logins' })).toHaveAttribute(
      'href',
      '/w/acme/accounts/logins',
    );
    const refresh = screen.getByRole('button', { name: 'Refresh' });
    expect(refresh).toBeDisabled();
    expect(refresh).toHaveAccessibleDescription(/has been removed/);
    // Not a configuration problem: no setup notice, and no sync history without a login.
    expect(screen.queryByRole('region', { name: /not configured|setup required/i })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Sync history' })).not.toBeInTheDocument();
    expect(
      within(card('Permissions')).getByText(/Permissions are not available/),
    ).toBeInTheDocument();
  });
});

describe('account detail — Instagram accounts', () => {
  it('names a linked Page the member cannot open without linking to it', async () => {
    setup(
      'EDITOR',
      {
        [DETAIL_PATH(IG_ID)]: () =>
          jsonResponse(
            200,
            editorDetail({
              account: igAccount({
                linkedPage: { id: null, externalId: '5002', name: 'Acme Labs' },
              }),
              linkedPage: null,
              linkedInstagram: [],
              permissions: {
                granted: fullLogin().grantedScopes,
                requiredForPublishing: [
                  'instagram_basic',
                  'instagram_content_publish',
                  'pages_read_engagement',
                ],
                missing: [],
                tasks: igAccount().tasks,
                createContent: true,
              },
            }),
          ),
      },
      { accountAccess: { mode: 'SELECTED', socialAccountIds: [IG_ID] } },
    );
    renderApp(`/w/acme/accounts/a/${IG_ID}`);

    expect(await screen.findByRole('heading', { level: 1, name: 'Acme' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Instagram' })).toHaveAttribute(
      'href',
      '/w/acme/accounts/instagram',
    );
    const linked = card('Linked accounts');
    expect(within(linked).getByText('Acme Labs')).toBeInTheDocument();
    expect(within(linked).getByText('(not shared with you)')).toBeInTheDocument();
    expect(within(linked).queryByRole('link')).not.toBeInTheDocument();
    expect(
      within(card('Account information')).getByText('Instagram account ID'),
    ).toBeInTheDocument();
    expect(within(card('Account information')).getByText('@acme')).toBeInTheDocument();
  });

  it('links to the Page when the member can open it, and says when a Page is not in the workspace', async () => {
    setup('OWNER', {
      [DETAIL_PATH(IG_ID)]: () =>
        jsonResponse(
          200,
          pageDetail({
            account: igAccount(),
            linkedPage: pageAccount(),
            linkedInstagram: [],
          }),
        ),
    });
    const { unmount } = renderApp(`/w/acme/accounts/a/${IG_ID}`);
    const linked = await findCard('Linked accounts');
    expect(within(linked).getByRole('link', { name: 'Acme Labs' })).toHaveAttribute(
      'href',
      `/w/acme/accounts/a/${PAGE_ID}`,
    );
    unmount();

    // For an owner a Page without id can only be one that was never added to the workspace.
    setup('OWNER', {
      [DETAIL_PATH(IG_ID)]: () =>
        jsonResponse(
          200,
          pageDetail({
            account: igAccount({ linkedPage: { id: null, externalId: '5009', name: 'Old Page' } }),
            linkedPage: null,
            linkedInstagram: [],
          }),
        ),
    });
    renderApp(`/w/acme/accounts/a/${IG_ID}`);
    const linkedAgain = await findCard('Linked accounts');
    expect(within(linkedAgain).getByText('Old Page')).toBeInTheDocument();
    expect(within(linkedAgain).getByText('(not added to this workspace)')).toBeInTheDocument();
  });

  it('describes an Instagram Login account without a Facebook Page or Page role', async () => {
    const igLoginAccount = igAccount({
      externalId: '17841400000000099',
      name: 'Solo Creator',
      username: 'solo.creator',
      instagramAccountType: 'CREATOR',
      linkedFacebookPageExternalId: undefined,
      linkedFacebookPageName: undefined,
      tasks: undefined,
      linkedPage: null,
      connection: loginSummary({
        id: IG_LOGIN_ID,
        provider: 'INSTAGRAM_LOGIN',
        displayName: '@solo.creator',
      }),
      health: readyHealth({
        eligibility: { eligible: true, createContent: null, missingPermissions: [] },
      }),
    });
    setup('OWNER', {
      [DETAIL_PATH(IG_ID)]: () =>
        jsonResponse(
          200,
          pageDetail({
            account: igLoginAccount,
            connection: fullLogin({
              id: IG_LOGIN_ID,
              provider: 'INSTAGRAM_LOGIN',
              displayName: '@solo.creator',
              grantedScopes: ['instagram_business_basic', 'instagram_business_content_publish'],
              declinedScopes: [],
              dataAccessExpiresAt: null,
            }),
            linkedPage: null,
            linkedInstagram: [],
            permissions: {
              granted: ['instagram_business_basic', 'instagram_business_content_publish'],
              declined: [],
              requiredForPublishing: ['instagram_business_content_publish'],
              missing: [],
              tasks: null,
              createContent: null,
            },
          }),
        ),
    });
    renderApp(`/w/acme/accounts/a/${IG_ID}`);

    const linked = await findCard('Linked accounts');
    expect(
      within(linked).getByText('Connected directly with Instagram Login — no Facebook Page.'),
    ).toBeInTheDocument();
    const health = card('Health and publishing readiness');
    expect(within(health).getByText('Publishing permissions OK')).toBeInTheDocument();
    expect(
      within(health).getByText('SocialHub has the permissions this account needs for publishing.'),
    ).toBeInTheDocument();
    expect(within(health).getByText('Not applicable')).toBeInTheDocument();
    const info = card('Account information');
    expect(within(info).getByText('Creator')).toBeInTheDocument();
    expect(within(info).getByText('Not applicable (Instagram Login)')).toBeInTheDocument();
    expect(within(card('Login')).getByText('Instagram login')).toBeInTheDocument();
    const checklist = within(card('Permissions')).getByRole('list', {
      name: 'Needed for publishing',
    });
    expect(
      within(checklist).getByText('instagram_business_content_publish').closest('li'),
    ).toHaveTextContent('Granted');
  });
});

describe('account detail — other roles and states', () => {
  it('shows editors the information they can see, without actions, history, activity or access', async () => {
    const mock = setup(
      'EDITOR',
      { [DETAIL_PATH(PAGE_ID)]: () => jsonResponse(200, editorDetail()) },
      { accountAccess: { mode: 'SELECTED', socialAccountIds: [PAGE_ID, IG_ID] } },
    );
    renderApp(`/w/acme/accounts/a/${PAGE_ID}`);

    expect(await screen.findByRole('heading', { level: 1, name: 'Acme Labs' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Refresh' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /More actions/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reconnect login' })).not.toBeInTheDocument();
    for (const heading of ['Sync history', 'Activity', 'Team access']) {
      expect(screen.queryByRole('heading', { name: heading })).not.toBeInTheDocument();
    }

    // Readiness and information are visible.
    const health = card('Health and publishing readiness');
    expect(within(health).getByText(CREATE_CONTENT_REASON)).toBeInTheDocument();
    expect(within(card('Account information')).getByText('5002')).toBeInTheDocument();

    // Login summary without links or management details.
    const login = card('Login');
    expect(within(login).getByText('Alice')).toBeInTheDocument();
    expect(within(login).queryByRole('link')).not.toBeInTheDocument();
    expect(within(login).queryByText(/Token valid until/)).not.toBeInTheDocument();

    // Linked accounts they can access stay linked; declined permissions are not shown.
    expect(within(card('Linked accounts')).getByRole('link', { name: 'Acme' })).toHaveAttribute(
      'href',
      `/w/acme/accounts/a/${IG_ID}`,
    );
    expect(within(card('Permissions')).queryByText('Declined')).not.toBeInTheDocument();
    expect(mock.count('GET /integrations/meta')).toBe(0);
  });

  it('shows "Account not found" when the account does not exist or is not accessible', async () => {
    setup('EDITOR', {
      [DETAIL_PATH(PAGE_ID)]: () => apiError(404, 'NOT_FOUND', 'Social account not found'),
    });
    renderApp(`/w/acme/accounts/a/${PAGE_ID}`);

    expect(await screen.findByRole('heading', { name: 'Account not found' })).toBeInTheDocument();
    expect(
      screen.getByText('It may have been removed, or you may not have access to it.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to social accounts' })).toHaveAttribute(
      'href',
      '/w/acme/accounts',
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows a loading skeleton, then an error with retry for other failures', async () => {
    let fail = true;
    let respond;
    const responded = new Promise((resolve) => {
      respond = resolve;
    });
    setup('OWNER', {
      [DETAIL_PATH(PAGE_ID)]: async () => {
        await responded;
        return fail
          ? apiError(500, 'INTERNAL_ERROR', 'The server had a problem. Please try again.')
          : jsonResponse(200, pageDetail());
      },
    });
    renderApp(`/w/acme/accounts/a/${PAGE_ID}`);

    // The first answer is held back, so the loading state is visible until it arrives.
    expect(await screen.findByText('Loading account…')).toBeInTheDocument();
    expect(
      within(screen.getByRole('main')).getByRole('link', { name: 'Social accounts' }),
    ).toHaveAttribute('href', '/w/acme/accounts');
    respond();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not load this account');
    expect(alert).toHaveTextContent('The server had a problem. Please try again.');

    fail = false;
    await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Acme Labs' })).toBeInTheDocument();
  });
});
