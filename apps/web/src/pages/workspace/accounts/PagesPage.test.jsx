// Frontend interaction tests: the SocialHub API is mocked with fetch; no Meta API is involved.
import { configure, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAccessToken } from '../../../lib/api.js';
import { apiError, jsonResponse, mockFetch } from '../../../test/fetchMock.js';
import { renderApp } from '../../../test/renderApp.jsx';

// The first render loads the lazy route chunks, which can take over a second on a busy machine.
configure({ asyncUtilTimeout: 5000 });

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

const user = { id: 'u1', name: 'Olivia Owner', email: 'olivia@example.com' };
const LOGIN = 'c00000000000000000000001';
const IG_LOGIN = 'c00000000000000000000002';
const STORE = 'a00000000000000000000001';
const LABS = 'a00000000000000000000002';
const ADMIN_MEMBER = 'b00000000000000000000002';
const EDITOR_MEMBER = 'b00000000000000000000003';
const VIEWER_MEMBER = 'b00000000000000000000004';
const LIST = 'GET /workspaces/w1/social-accounts';

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
        : { mode: 'SELECTED', socialAccountIds: [STORE] },
  },
});

const configured = { facebook: { configured: true }, instagram: { configured: true } };

const summary = {
  accounts: {
    total: 2,
    facebookPages: 2,
    instagramAccounts: 0,
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

// Trimmed from the GET /social-connections response captured against the Meta simulator.
const facebookLogin = {
  id: LOGIN,
  provider: 'FACEBOOK_LOGIN',
  displayName: 'Alice',
  pictureUrl: null,
  status: 'ACTIVE',
  statusReason: null,
  grantedScopes: ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts'],
  missingScopes: { required: [], recommended: [], publishing: [] },
  lastSyncOutcome: 'SUCCESS',
  syncInProgress: false,
  attention: [],
  needsAttention: true,
  accountCount: 2,
  accountCounts: { facebookPages: 2, instagramAccounts: 0, needsAttention: 1 },
};
const instagramLogin = {
  ...facebookLogin,
  id: IG_LOGIN,
  provider: 'INSTAGRAM_LOGIN',
  displayName: '@solo.creator',
  grantedScopes: ['instagram_business_basic', 'instagram_business_content_publish'],
  needsAttention: false,
  accountCount: 1,
  accountCounts: { facebookPages: 0, instagramAccounts: 1, needsAttention: 0 },
};

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

// Destination items as returned by GET /workspaces/:id/social-accounts (Meta simulator capture).
const page = (overrides = {}) => ({
  id: STORE,
  workspace: 'w1',
  platform: 'FACEBOOK_PAGE',
  externalId: '5001',
  name: 'Acme Store',
  category: 'Brand',
  pictureUrl: null,
  tasks: ['ANALYZE', 'ADVERTISE', 'MODERATE', 'CREATE_CONTENT', 'MANAGE'],
  connectionStatus: 'ACTIVE',
  publishingStatus: 'READY',
  lastSyncedAt: '2026-11-20T07:22:04.434Z',
  createdAt: '2026-11-20T07:22:04.216Z',
  connection: {
    id: LOGIN,
    provider: 'FACEBOOK_LOGIN',
    displayName: 'Alice',
    pictureUrl: null,
    status: 'ACTIVE',
  },
  linkedPage: null,
  health: health(),
  ...overrides,
});

const store = page();
const labs = page({
  id: LABS,
  externalId: '5002',
  name: 'Acme Labs',
  tasks: ['ANALYZE'],
  // A stale stored value: the page must show the computed `health`, never this.
  publishingStatus: 'READY',
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
});

const facets = (overrides = {}) => ({
  platform: { FACEBOOK_PAGE: 2, INSTAGRAM_ACCOUNT: 1 },
  status: { ACTIVE: 2 },
  readiness: { READY: 1, RESTRICTED: 1 },
  attention: 1,
  ...overrides,
});

const list = (items, overrides = {}) => ({
  items,
  total: items.length,
  page: 1,
  limit: 25,
  pages: 1,
  facets: facets(),
  truncated: false,
  ...overrides,
});

const member = (id, role, name, socialAccountIds = []) => ({
  id,
  role,
  accountAccess: { mode: 'SELECTED', socialAccountIds },
  joinedAt: '2026-11-20T07:22:03.735Z',
  user: { id: `user-${id}`, name, email: `${name.split(' ')[0].toLowerCase()}@example.com` },
});
const members = [
  { ...member('m1', 'OWNER', 'Olivia Owner'), user: user },
  member(ADMIN_MEMBER, 'ADMIN', 'Adam Admin'),
  member(EDITOR_MEMBER, 'EDITOR', 'Eddie Editor'),
  member(VIEWER_MEMBER, 'VIEWER', 'Vera Viewer', [STORE]),
];

function setup(role, routes = {}) {
  return mockFetch({
    'POST /auth/refresh': () => jsonResponse(200, { user, accessToken: 'access' }),
    'GET /workspaces': () => jsonResponse(200, { items: [workspace(role)] }),
    'GET /integrations/meta': () => jsonResponse(200, configured),
    'GET /workspaces/w1/social-accounts/summary': () => jsonResponse(200, summary),
    [LIST]: () => jsonResponse(200, list([store, labs])),
    'GET /workspaces/w1/social-connections': () =>
      jsonResponse(200, { items: [facebookLogin, instagramLogin] }),
    ...routes,
  });
}

const listCalls = (mock) => mock.calls.filter((c) => c.key === LIST);
const lastQuery = (mock) => listCalls(mock).at(-1).url.searchParams;
const rowOf = (name) => screen.getByRole('link', { name }).closest('tr');
const findRow = async (name) => (await screen.findByRole('link', { name })).closest('tr');
const bodyOf = (call) => JSON.parse(call.init.body);

beforeEach(() => {
  setAccessToken(null);
  vi.clearAllMocks();
});
afterEach(() => vi.unstubAllGlobals());

describe('Facebook Pages tab', () => {
  it('shows each Page with its ID, Page-role check and the readiness computed by the server', async () => {
    const mock = setup('OWNER');
    renderApp('/w/acme/accounts/pages');

    const storeRow = await findRow('Acme Store');
    expect(within(storeRow).getByText('5001')).toBeInTheDocument();
    expect(within(storeRow).getByText('Can create content')).toBeInTheDocument();
    expect(within(storeRow).getByText('Publishing permissions OK')).toBeInTheDocument();
    expect(within(storeRow).getByRole('link', { name: 'Acme Store' })).toHaveAttribute(
      'href',
      `/w/acme/accounts/a/${STORE}`,
    );
    expect(within(storeRow).getByRole('link', { name: 'Alice' })).toHaveAttribute(
      'href',
      `/w/acme/accounts/logins/${LOGIN}`,
    );

    const labsRow = rowOf('Acme Labs');
    expect(within(labsRow).getByText('5002')).toBeInTheDocument();
    expect(within(labsRow).getByText('Cannot create content')).toBeInTheDocument();
    // The stored publishingStatus says READY; only the computed health is displayed.
    expect(within(labsRow).getByText('Missing publishing access')).toBeInTheDocument();
    expect(within(labsRow).queryByText('Publishing permissions OK')).not.toBeInTheDocument();
    expect(screen.queryByText(/Ready to publish/i)).not.toBeInTheDocument();

    const legend = screen.getByText('How publishing readiness is decided').closest('details');
    expect(legend).toHaveTextContent(/granted pages_manage_posts and pages_read_engagement and/);
    expect(legend).toHaveTextContent(/Page role with the CREATE_CONTENT task/);
    expect(legend).toHaveTextContent(/publishing itself arrives in a later phase/);

    const query = listCalls(mock)[0].url.searchParams;
    expect(query.get('platform')).toBe('FACEBOOK_PAGE');
    expect(query.get('limit')).toBe('25');
    // Only Facebook logins can have Pages.
    const loginFilter = screen.getByRole('combobox', { name: 'Filter by login' });
    expect(
      within(loginFilter)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['All logins', 'Alice']);
  });

  it('sends search, filters, sort order and page to the API', async () => {
    const ue = userEvent.setup();
    const mock = setup('OWNER', {
      [LIST]: () => jsonResponse(200, list([store, labs], { total: 30, pages: 2 })),
    });
    renderApp('/w/acme/accounts/pages');
    await findRow('Acme Store');

    await ue.type(screen.getByRole('searchbox', { name: 'Search accounts' }), 'labs');
    await waitFor(() => expect(lastQuery(mock).get('q')).toBe('labs'));

    await ue.selectOptions(
      screen.getByRole('combobox', { name: 'Filter by connection status' }),
      'EXPIRED',
    );
    await waitFor(() => expect(lastQuery(mock).get('status')).toBe('EXPIRED'));

    await ue.click(screen.getByRole('button', { name: /^Needs attention/ }));
    await waitFor(() => expect(lastQuery(mock).get('attention')).toBe('true'));

    await ue.click(screen.getByRole('button', { name: /^Account, sorted ascending/ }));
    await waitFor(() => expect(lastQuery(mock).get('sort')).toBe('-name'));

    await ue.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(lastQuery(mock).get('page')).toBe('2'));

    expect(Object.fromEntries(lastQuery(mock))).toEqual({
      platform: 'FACEBOOK_PAGE',
      q: 'labs',
      status: 'EXPIRED',
      attention: 'true',
      sort: '-name',
      page: '2',
      limit: '25',
    });
  });

  it('refreshes the selected Pages and shows what each login reported', async () => {
    const ue = userEvent.setup();
    const mock = setup('ADMIN', {
      'POST /workspaces/w1/social-accounts/refresh': () =>
        jsonResponse(200, {
          results: [
            { accountId: STORE, name: 'Acme Store', connectionId: LOGIN, outcome: 'SUCCESS' },
            { accountId: LABS, name: 'Acme Labs', connectionId: LOGIN, outcome: 'SUCCESS' },
          ],
          connections: [
            {
              connectionId: LOGIN,
              displayName: 'Alice',
              provider: 'FACEBOOK_LOGIN',
              outcome: 'SUCCESS',
              status: 'ACTIVE',
              accounts: { refreshed: 2, lost: 0 },
              message: null,
            },
          ],
          summary: { total: 1, succeeded: 1, failed: 0, skipped: 0 },
        }),
    });
    renderApp('/w/acme/accounts/pages');

    await ue.click(await screen.findByRole('checkbox', { name: 'Select Acme Store' }));
    await ue.click(screen.getByRole('checkbox', { name: 'Select Acme Labs' }));
    const bar = screen.getByRole('region', { name: 'Bulk actions' });
    expect(bar).toHaveTextContent('2 Pages selected');
    await ue.click(within(bar).getByRole('button', { name: /Refresh selected/ }));

    const dialog = await screen.findByRole('dialog', { name: 'Refresh results' });
    expect(within(dialog).getByText('Alice')).toBeInTheDocument();
    expect(within(dialog).getByText('Accounts: Acme Store, Acme Labs')).toBeInTheDocument();
    expect(mock.count('POST /workspaces/w1/social-accounts/refresh')).toBe(1);
    const call = mock.calls.find((c) => c.key === 'POST /workspaces/w1/social-accounts/refresh');
    expect(bodyOf(call)).toEqual({ accountIds: [STORE, LABS] });
    expect(toast.success).toHaveBeenCalledWith('1 login synced');
    // The selection is cleared once the bulk action completed.
    expect(screen.queryByRole('region', { name: 'Bulk actions' })).not.toBeInTheDocument();
  });

  it('removes the selected Pages only after confirmation', async () => {
    const ue = userEvent.setup();
    const mock = setup('OWNER', {
      'POST /workspaces/w1/social-accounts/remove': () => jsonResponse(200, { removed: 2 }),
    });
    renderApp('/w/acme/accounts/pages');

    await ue.click(
      await screen.findByRole('checkbox', { name: 'Select all accounts on this page' }),
    );
    const bar = screen.getByRole('region', { name: 'Bulk actions' });
    await ue.click(within(bar).getByRole('button', { name: /Remove from workspace/ }));

    let dialog = await screen.findByRole('dialog', { name: 'Remove 2 Pages from the workspace?' });
    expect(within(dialog).getByText('Acme Store')).toBeInTheDocument();
    expect(within(dialog).getByText('Acme Labs')).toBeInTheDocument();
    await ue.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mock.count('POST /workspaces/w1/social-accounts/remove')).toBe(0);

    await ue.click(within(bar).getByRole('button', { name: /Remove from workspace/ }));
    dialog = await screen.findByRole('dialog', { name: 'Remove 2 Pages from the workspace?' });
    await ue.click(within(dialog).getByRole('button', { name: 'Remove 2 Pages' }));

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith('2 Pages removed from the workspace'),
    );
    const call = mock.calls.find((c) => c.key === 'POST /workspaces/w1/social-accounts/remove');
    expect(bodyOf(call)).toEqual({ accountIds: [STORE, LABS] });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Bulk actions' })).not.toBeInTheDocument();
  });

  it('keeps the selection while paging', async () => {
    const ue = userEvent.setup();
    const other = page({ id: 'a00000000000000000000003', externalId: '5003', name: 'Acme Outlet' });
    setup('OWNER', {
      [LIST]: ({ url }) =>
        jsonResponse(
          200,
          url.searchParams.get('page') === '2'
            ? list([other], { total: 26, page: 2, pages: 2 })
            : list([store, labs], { total: 26, pages: 2 }),
        ),
    });
    renderApp('/w/acme/accounts/pages');

    await ue.click(await screen.findByRole('checkbox', { name: 'Select Acme Store' }));
    await ue.click(screen.getByRole('button', { name: /Next/ }));
    await ue.click(await screen.findByRole('checkbox', { name: 'Select Acme Outlet' }));

    const bar = screen.getByRole('region', { name: 'Bulk actions' });
    expect(bar).toHaveTextContent('2 Pages selected');
    expect(bar).toHaveTextContent('1 of them is not shown on this page.');
    await ue.click(within(bar).getByRole('button', { name: 'Clear selection' }));
    expect(screen.queryByRole('region', { name: 'Bulk actions' })).not.toBeInTheDocument();
  });

  it('refreshes or removes a single Page from its row actions', async () => {
    const ue = userEvent.setup();
    const mock = setup('OWNER', {
      [`POST /workspaces/w1/social-accounts/${STORE}/refresh`]: () =>
        jsonResponse(200, {
          result: { accountId: STORE, name: 'Acme Store', connectionId: LOGIN, outcome: 'SUCCESS' },
          connections: [],
        }),
      [`DELETE /workspaces/w1/social-accounts/${LABS}`]: () => jsonResponse(204),
    });
    renderApp('/w/acme/accounts/pages');

    await ue.click(await screen.findByRole('button', { name: 'Actions for Acme Store' }));
    const menu = screen.getByRole('menu');
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual(['View details', 'Refresh', 'View login', 'Remove from workspace']);
    await ue.click(within(menu).getByRole('menuitem', { name: 'Refresh' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Acme Store refreshed'));
    expect(mock.count(`POST /workspaces/w1/social-accounts/${STORE}/refresh`)).toBe(1);

    await ue.click(screen.getByRole('button', { name: 'Actions for Acme Labs' }));
    await ue.click(screen.getByRole('menuitem', { name: 'Remove from workspace' }));
    const dialog = await screen.findByRole('dialog', {
      name: 'Remove Acme Labs from the workspace?',
    });
    expect(mock.count(`DELETE /workspaces/w1/social-accounts/${LABS}`)).toBe(0);
    await ue.click(within(dialog).getByRole('button', { name: 'Remove from workspace' }));
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith('Acme Labs removed from the workspace'),
    );
    expect(mock.count(`DELETE /workspaces/w1/social-accounts/${LABS}`)).toBe(1);
  });

  it('opens row actions outside the scrolling table, focused, and Escape returns focus', async () => {
    const ue = userEvent.setup();
    setup('OWNER');
    renderApp('/w/acme/accounts/pages');

    const trigger = await screen.findByRole('button', { name: 'Actions for Acme Store' });
    await ue.click(trigger);
    const menu = screen.getByRole('menu');
    // Portal: the table's horizontal scroll container cannot clip the menu.
    expect(trigger.closest('table')).not.toContainElement(menu);
    await waitFor(() => expect(within(menu).getAllByRole('menuitem')[0]).toHaveFocus());

    await ue.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('shows editors the Pages shared with them without selection or management actions', async () => {
    const ue = userEvent.setup();
    const mock = setup('EDITOR', {
      [LIST]: () => jsonResponse(200, list([store], { facets: facets({ attention: 0 }) })),
    });
    const { router } = renderApp('/w/acme/accounts/pages');

    const row = await findRow('Acme Store');
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    expect(within(row).getByText('Alice')).toBeInTheDocument();
    expect(within(row).queryByRole('link', { name: 'Alice' })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Filter by login' })).not.toBeInTheDocument();

    await ue.click(within(row).getByRole('button', { name: 'Actions for Acme Store' }));
    const menu = screen.getByRole('menu');
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual(['View details']);
    expect(screen.queryByText('Remove from workspace')).not.toBeInTheDocument();
    expect(mock.count('GET /workspaces/w1/social-connections')).toBe(0);

    await ue.click(within(menu).getByRole('menuitem', { name: 'View details' }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/w/acme/accounts/a/${STORE}`));
  });

  it('grants the selected Pages to an editor from Manage access', async () => {
    const ue = userEvent.setup();
    const patchKey = `PATCH /workspaces/w1/members/${EDITOR_MEMBER}/account-access`;
    const mock = setup('OWNER', {
      'GET /workspaces/w1/members': () => jsonResponse(200, { items: members }),
      [patchKey]: () =>
        jsonResponse(200, {
          member: { ...members[2], accountAccess: { mode: 'SELECTED', socialAccountIds: [STORE] } },
        }),
    });
    renderApp('/w/acme/accounts/pages');

    await ue.click(await screen.findByRole('checkbox', { name: 'Select Acme Store' }));
    await ue.click(screen.getByRole('button', { name: /Manage access/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Manage account access' });

    const editor = await within(dialog).findByRole('checkbox', { name: 'Eddie Editor' });
    expect(editor).toBeEnabled();
    expect(within(dialog).getByRole('checkbox', { name: 'Vera Viewer' })).toBeEnabled();
    // Owners and admins always see every account (and nobody edits their own access here).
    expect(within(dialog).getByRole('checkbox', { name: 'Olivia Owner' })).toBeDisabled();
    expect(within(dialog).getByRole('checkbox', { name: 'Adam Admin' })).toBeDisabled();
    expect(within(dialog).getAllByText('Full access')).toHaveLength(2);
    expect(within(dialog).getByText('Has access to the selected account')).toBeInTheDocument();

    const grant = within(dialog).getByRole('button', { name: 'Grant access' });
    expect(grant).toBeDisabled();
    await ue.click(editor);
    await ue.click(grant);

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Access granted to 1 member'));
    const patches = mock.calls.filter((c) => c.key.startsWith('PATCH /workspaces/w1/members/'));
    expect(patches.map((c) => c.key)).toEqual([patchKey]);
    expect(bodyOf(patches[0])).toMatchObject({ add: [STORE] });
    expect(bodyOf(patches[0]).remove ?? []).toEqual([]);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Bulk actions' })).not.toBeInTheDocument();
  });

  it('lists members whose access could not be changed without stopping the others', async () => {
    const ue = userEvent.setup();
    const viewerKey = `PATCH /workspaces/w1/members/${VIEWER_MEMBER}/account-access`;
    const mock = setup('OWNER', {
      'GET /workspaces/w1/members': () => jsonResponse(200, { items: members }),
      [`PATCH /workspaces/w1/members/${EDITOR_MEMBER}/account-access`]: () =>
        apiError(403, 'FORBIDDEN', 'You can only manage members with a lower role than yours'),
      [viewerKey]: () => jsonResponse(200, { member: members[3] }),
    });
    renderApp('/w/acme/accounts/pages');

    await ue.click(
      await screen.findByRole('checkbox', { name: 'Select all accounts on this page' }),
    );
    await ue.click(screen.getByRole('button', { name: /Manage access/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Manage account access' });
    await ue.click(await within(dialog).findByRole('button', { name: 'Select all' }));
    await ue.click(within(dialog).getByRole('button', { name: 'Revoke access' }));

    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent('Eddie Editor');
    expect(alert).toHaveTextContent('You can only manage members with a lower role than yours');
    expect(mock.count(viewerKey)).toBe(1);
    expect(bodyOf(mock.calls.find((c) => c.key === viewerKey))).toMatchObject({
      remove: [STORE, LABS],
    });
    expect(toast.warning).toHaveBeenCalledWith(
      'Access revoked for 1 of 2 members — see the errors',
    );
    // The dialog stays open with only the failed member selected, ready to retry.
    expect(within(dialog).getByRole('checkbox', { name: 'Eddie Editor' })).toBeChecked();
    expect(within(dialog).getByRole('checkbox', { name: 'Vera Viewer' })).not.toBeChecked();
  });

  it('explains when there is nobody whose access can be changed', async () => {
    const ue = userEvent.setup();
    const mock = setup('ADMIN', {
      'GET /workspaces/w1/members': () =>
        jsonResponse(200, {
          // The acting admin is membership m1; the owner is someone else.
          items: [
            { ...members[0], id: 'b00000000000000000000001' },
            { ...members[1], id: 'm1' },
          ],
        }),
    });
    renderApp('/w/acme/accounts/pages');

    await ue.click(await screen.findByRole('checkbox', { name: 'Select Acme Store' }));
    await ue.click(screen.getByRole('button', { name: /Manage access/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Manage account access' });

    expect(
      await within(dialog).findByText(/no editors or viewers whose access you can change/),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: 'invite teammates' })).toHaveAttribute(
      'href',
      '/w/acme/team',
    );
    expect(within(dialog).getByText('(you)')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Grant access' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Revoke access' })).toBeDisabled();
    expect(mock.calls.some((c) => c.key.startsWith('PATCH'))).toBe(false);
  });

  it('points managers to their logins when no Page has been added yet', async () => {
    setup('OWNER', {
      [LIST]: () =>
        jsonResponse(
          200,
          list([], {
            facets: facets({ platform: { INSTAGRAM_ACCOUNT: 1 }, status: {}, readiness: {} }),
          }),
        ),
    });
    renderApp('/w/acme/accounts/pages');

    const heading = await screen.findByRole('heading', { name: 'No Facebook Pages yet' });
    const empty = heading.parentElement;
    expect(empty).toHaveTextContent(/Open a login on the Logins tab to choose which of its Pages/);
    expect(within(empty).getByRole('link', { name: 'Go to Logins' })).toHaveAttribute(
      'href',
      '/w/acme/accounts/logins',
    );
    // Only Facebook Login yields Pages.
    expect(within(empty).getByRole('button', { name: /Connect Facebook/ })).toBeInTheDocument();
    expect(within(empty).queryByRole('button', { name: /Connect Instagram/ })).toBeNull();
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
  });

  it('tells members when no Page has been shared with them', async () => {
    setup('VIEWER', {
      [LIST]: () =>
        jsonResponse(
          200,
          list([], { facets: facets({ platform: {}, status: {}, readiness: {}, attention: 0 }) }),
        ),
    });
    renderApp('/w/acme/accounts/pages');

    expect(
      await screen.findByText(/No Facebook Pages have been shared with you in this workspace/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Go to Logins' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Connect/ })).not.toBeInTheDocument();
  });

  it('offers to clear the filters when no Page matches them', async () => {
    const ue = userEvent.setup();
    const mock = setup('OWNER', {
      [LIST]: ({ url }) =>
        jsonResponse(200, url.searchParams.get('q') ? list([]) : list([store, labs])),
    });
    renderApp('/w/acme/accounts/pages?q=nothing');

    const heading = await screen.findByRole('heading', { name: 'No Pages match these filters' });
    expect(screen.getByRole('searchbox', { name: 'Search accounts' })).toHaveValue('nothing');
    await ue.click(within(heading.parentElement).getByRole('button', { name: 'Clear filters' }));

    expect(await screen.findByRole('link', { name: 'Acme Store' })).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Search accounts' })).toHaveValue('');
    expect(lastQuery(mock).has('q')).toBe(false);

    // The filter bar's own Clear filters empties the search box as well.
    await ue.type(screen.getByRole('searchbox', { name: 'Search accounts' }), 'zzz{Enter}');
    await screen.findByRole('heading', { name: 'No Pages match these filters' });
    const filterBar = screen.getByRole('search', { name: 'Filter accounts' });
    await ue.click(within(filterBar).getByRole('button', { name: 'Clear filters' }));
    expect(await screen.findByRole('link', { name: 'Acme Store' })).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Search accounts' })).toHaveValue('');
  });

  it('shows skeleton rows while the Pages load', async () => {
    setup('OWNER', { [LIST]: () => new Promise(() => {}) });
    renderApp('/w/acme/accounts/pages');

    const table = await screen.findByRole('table', { name: 'Facebook Pages' });
    expect(table.closest('[aria-busy="true"]')).not.toBeNull();
    expect(within(table).queryByRole('link')).not.toBeInTheDocument();
  });

  it('shows an error with a retry when the Pages cannot be loaded', async () => {
    const ue = userEvent.setup();
    let fail = true;
    setup('OWNER', {
      [LIST]: () =>
        fail
          ? apiError(500, 'INTERNAL_ERROR', 'The server had a problem')
          : jsonResponse(200, list([store])),
    });
    renderApp('/w/acme/accounts/pages');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Facebook Pages could not be loaded');
    expect(alert).toHaveTextContent('The server had a problem');
    fail = false;
    await ue.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('link', { name: 'Acme Store' })).toBeInTheDocument();
  });

  it('explains that refreshing needs the Meta setup when the server has no credentials', async () => {
    const ue = userEvent.setup();
    const mock = setup('OWNER', {
      'GET /integrations/meta': () =>
        jsonResponse(200, { facebook: { configured: false }, instagram: { configured: false } }),
    });
    renderApp('/w/acme/accounts/pages');

    expect(await screen.findByRole('region', { name: 'Meta setup required' })).toBeInTheDocument();
    const row = await findRow('Acme Store');
    await ue.click(within(row).getByRole('button', { name: 'Actions for Acme Store' }));
    const refresh = screen.getByRole('menuitem', { name: /Refresh/ });
    expect(refresh).toBeDisabled();
    expect(refresh).toHaveTextContent('Meta setup required');
    await ue.keyboard('{Escape}');

    await ue.click(within(row).getByRole('checkbox', { name: 'Select Acme Store' }));
    const bar = screen.getByRole('region', { name: 'Bulk actions' });
    expect(within(bar).getByRole('button', { name: /Refresh selected/ })).toBeDisabled();
    expect(bar).toHaveTextContent(/setup required/);
    expect(mock.count('POST /workspaces/w1/social-accounts/refresh')).toBe(0);
  });
});
