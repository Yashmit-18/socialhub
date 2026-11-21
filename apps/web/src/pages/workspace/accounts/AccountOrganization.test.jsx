// Frontend interaction tests for account organisation (labels, stars, notes, export, links,
// the All accounts tab). The SocialHub API is mocked with fetch; no Meta API is involved.
import { configure, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initialLabelStates, labelChanges, platformUrl } from '../../../lib/accountOrganization.js';
import { setAccessToken } from '../../../lib/api.js';
import { apiError, jsonResponse, mockFetch } from '../../../test/fetchMock.js';
import { renderApp } from '../../../test/renderApp.jsx';

configure({ asyncUtilTimeout: 5000 });

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

const user = { id: 'u1', name: 'Olivia Owner', email: 'olivia@example.com' };
const LOGIN = 'c00000000000000000000001';
const STORE = 'a00000000000000000000001';
const GRAM = 'a00000000000000000000002';
const CLIENT_A = 'f00000000000000000000001';
const NORTH = 'f00000000000000000000002';
const LIST = 'GET /workspaces/w1/social-accounts';
const LABELS = 'GET /workspaces/w1/account-labels';

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
        : { mode: 'SELECTED', socialAccountIds: [STORE, GRAM] },
  },
});

const configured = { facebook: { configured: true }, instagram: { configured: true } };
const summary = {
  accounts: {
    total: 2,
    facebookPages: 1,
    instagramAccounts: 1,
    connected: 2,
    needsAttention: 0,
    ready: 2,
    restricted: 0,
    unavailable: 0,
  },
  followers: {
    total: null,
    facebook: null,
    instagram: null,
    counted: 0,
    missing: 2,
    facebookMissing: 1,
    instagramMissing: 1,
    asOf: null,
  },
  connections: null,
  meta: { facebookConfigured: true, instagramConfigured: true },
  truncated: false,
};

const health = {
  connectionStatus: 'ACTIVE',
  connectionStatusReason: null,
  readiness: 'READY',
  readinessReasons: [],
  eligibility: { eligible: true, createContent: true, missingPermissions: [] },
  attention: [],
  needsAttention: false,
};
const clientA = { id: CLIENT_A, name: 'Client A', color: 'sky' };
const north = { id: NORTH, name: 'North', color: 'green' };

const store = {
  id: STORE,
  workspace: 'w1',
  platform: 'FACEBOOK_PAGE',
  externalId: '5001',
  name: 'Acme Store',
  category: 'Brand',
  pictureUrl: null,
  tasks: ['CREATE_CONTENT', 'MANAGE'],
  connectionStatus: 'ACTIVE',
  publishingStatus: 'READY',
  lastSyncedAt: '2026-11-20T07:22:04.434Z',
  createdAt: '2026-11-20T07:22:04.216Z',
  followersCount: 1200,
  followersCountUpdatedAt: '2026-11-20T07:22:04.434Z',
  labels: [clientA, north],
  starred: true,
  hasNotes: true,
  connection: {
    id: LOGIN,
    provider: 'FACEBOOK_LOGIN',
    displayName: 'Alice',
    pictureUrl: null,
    status: 'ACTIVE',
  },
  linkedPage: null,
  health,
};
const gram = {
  ...store,
  id: GRAM,
  platform: 'INSTAGRAM_ACCOUNT',
  externalId: '17841400000000010',
  name: 'Acme Gram',
  username: 'acme.gram',
  category: undefined,
  followersCount: null,
  labels: [clientA],
  starred: false,
  hasNotes: false,
  linkedPage: { id: STORE, externalId: '5001', name: 'Acme Store' },
};

const list = (items) => ({
  items,
  total: items.length,
  page: 1,
  limit: 25,
  pages: 1,
  facets: {
    platform: { FACEBOOK_PAGE: 1, INSTAGRAM_ACCOUNT: 1 },
    status: { ACTIVE: 2 },
    readiness: { READY: 2 },
    attention: 0,
    labels: { [CLIENT_A]: 2, [NORTH]: 1 },
    starred: 1,
  },
  truncated: false,
});

const labelsResponse = {
  items: [
    { ...clientA, accountCount: 2 },
    { ...north, accountCount: 1 },
  ],
  limit: 100,
};

function setup(role, routes = {}) {
  return mockFetch({
    'POST /auth/refresh': () => jsonResponse(200, { user, accessToken: 'access' }),
    'GET /workspaces': () => jsonResponse(200, { items: [workspace(role)] }),
    'GET /integrations/meta': () => jsonResponse(200, configured),
    'GET /workspaces/w1/social-accounts/summary': () => jsonResponse(200, summary),
    [LIST]: () => jsonResponse(200, list([store, gram])),
    [LABELS]: () => jsonResponse(200, labelsResponse),
    'GET /workspaces/w1/social-connections': () => jsonResponse(200, { items: [] }),
    ...routes,
  });
}

const listCalls = (mock) => mock.calls.filter((c) => c.key === LIST);
const lastQuery = (mock) => listCalls(mock).at(-1).url.searchParams;
const findRow = async (name) => (await screen.findByRole('link', { name })).closest('tr');
const bodyOf = (call) => JSON.parse(call.init.body);

beforeEach(() => {
  setAccessToken(null);
  vi.clearAllMocks();
});
afterEach(() => vi.unstubAllGlobals());

/* ---------------------------------------------------------------- helpers */

describe('label helpers', () => {
  it('works out which labels all, some or none of the accounts carry, and the changes', () => {
    const states = initialLabelStates([store, gram], [clientA, north, { id: 'x', name: 'X' }]);
    expect(states).toEqual({ [CLIENT_A]: 'all', [NORTH]: 'some', x: 'none' });
    expect(labelChanges(states, { ...states, [NORTH]: 'all', [CLIENT_A]: 'none' })).toEqual({
      add: [NORTH],
      remove: [CLIENT_A],
    });
    expect(labelChanges(states, states)).toEqual({ add: [], remove: [] });
  });

  it('builds the public Facebook and Instagram addresses only from safe values', () => {
    expect(platformUrl(store)).toBe('https://www.facebook.com/5001');
    expect(platformUrl(gram)).toBe('https://www.instagram.com/acme.gram/');
    expect(platformUrl({ ...gram, username: undefined })).toBeNull();
    expect(platformUrl({ ...gram, username: 'evil/../x' })).toBeNull();
    expect(platformUrl({ ...store, externalId: 'javascript:alert(1)' })).toBeNull();
  });
});

/* -------------------------------------------------------- All accounts tab */

describe('All accounts tab', () => {
  it('lists both platforms with their labels, stars and notes marker', async () => {
    const mock = setup('OWNER');
    renderApp('/w/acme/accounts/all');

    const storeRow = await findRow('Acme Store');
    expect(within(storeRow).getByText('Client A')).toBeInTheDocument();
    expect(within(storeRow).getByText('North')).toBeInTheDocument();
    expect(within(storeRow).getByRole('button', { name: 'Unstar Acme Store' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(storeRow).getByRole('img', { name: 'Has team notes' })).toBeInTheDocument();
    const gramRow = await findRow('Acme Gram');
    expect(within(gramRow).getByRole('button', { name: 'Star Acme Gram' })).toBeInTheDocument();

    // No platform is fixed on this tab.
    expect(listCalls(mock)[0].url.searchParams.get('platform')).toBeNull();
    expect(screen.getByRole('link', { name: /All accounts/ })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('filters by label, by stars and sorts by followers through the API', async () => {
    const mock = setup('OWNER');
    const ue = userEvent.setup();
    renderApp('/w/acme/accounts/all');
    await findRow('Acme Store');

    const labelSelect = await screen.findByRole('combobox', { name: 'Filter by label' });
    expect(within(labelSelect).getByRole('option', { name: 'Client A (2)' })).toBeInTheDocument();
    await ue.selectOptions(labelSelect, NORTH);
    await waitFor(() => expect(lastQuery(mock).get('label')).toBe(NORTH));

    await ue.click(screen.getByRole('button', { name: /Starred \(1\)/ }));
    await waitFor(() => expect(lastQuery(mock).get('starred')).toBe('true'));

    await ue.selectOptions(screen.getByRole('combobox', { name: 'Sort accounts' }), '-followers');
    await waitFor(() => expect(lastQuery(mock).get('sort')).toBe('-followers'));

    // A label chip in a row is a shortcut to the same filter.
    await ue.selectOptions(labelSelect, '');
    const gramRow = await findRow('Acme Gram');
    await ue.click(within(gramRow).getByRole('button', { name: 'Client A' }));
    await waitFor(() => expect(lastQuery(mock).get('label')).toBe(CLIENT_A));
  });

  it('stars and unstars an account for the signed-in person', async () => {
    const mock = setup('VIEWER', {
      [`PUT /workspaces/w1/social-accounts/${GRAM}/star`]: () =>
        jsonResponse(200, { starred: true }),
      [`DELETE /workspaces/w1/social-accounts/${STORE}/star`]: () =>
        jsonResponse(200, { starred: false }),
    });
    const ue = userEvent.setup();
    renderApp('/w/acme/accounts/all');

    await ue.click(
      within(await findRow('Acme Gram')).getByRole('button', { name: 'Star Acme Gram' }),
    );
    await waitFor(() =>
      expect(mock.count(`PUT /workspaces/w1/social-accounts/${GRAM}/star`)).toBe(1),
    );
    await ue.click(
      within(await findRow('Acme Store')).getByRole('button', { name: 'Unstar Acme Store' }),
    );
    await waitFor(() =>
      expect(mock.count(`DELETE /workspaces/w1/social-accounts/${STORE}/star`)).toBe(1),
    );
  });

  it('applies labels to the selected accounts, sending only what changed', async () => {
    const mock = setup('OWNER', {
      'POST /workspaces/w1/social-accounts/labels': () =>
        jsonResponse(200, { updated: 1, accounts: [] }),
    });
    const ue = userEvent.setup();
    renderApp('/w/acme/accounts/all');

    await ue.click(
      within(await findRow('Acme Store')).getByRole('checkbox', { name: 'Select Acme Store' }),
    );
    await ue.click(
      within(await findRow('Acme Gram')).getByRole('checkbox', { name: 'Select Acme Gram' }),
    );
    await ue.click(screen.getByRole('button', { name: 'Labels', exact: true }));

    const dialog = await screen.findByRole('dialog', { name: 'Labels for 2 accounts' });
    const clientBox = await within(dialog).findByRole('checkbox', { name: 'Client A' });
    const northBox = within(dialog).getByRole('checkbox', { name: 'North' });
    expect(clientBox).toBeChecked();
    expect(northBox).toHaveProperty('indeterminate', true);
    expect(within(dialog).getByRole('button', { name: 'Apply' })).toBeDisabled();

    await ue.click(northBox); // some → all
    await ue.click(within(dialog).getByRole('button', { name: 'Apply +1' }));
    await waitFor(() => expect(mock.count('POST /workspaces/w1/social-accounts/labels')).toBe(1));
    const call = mock.calls.find((c) => c.key === 'POST /workspaces/w1/social-accounts/labels');
    expect(bodyOf(call)).toEqual({ accountIds: [STORE, GRAM], add: [NORTH], remove: [] });
    expect(toast.success).toHaveBeenCalledWith('Labels updated on 1 account');
  });

  it('creates a label from the label manager and shows the server’s duplicate error', async () => {
    let attempts = 0;
    const mock = setup('ADMIN', {
      'POST /workspaces/w1/account-labels': () => {
        attempts += 1;
        return attempts === 1
          ? jsonResponse(201, {
              label: { id: 'f9', name: 'Retail', color: 'sky', accountCount: 0 },
            })
          : apiError(409, 'CONFLICT', 'A label called “Retail” already exists.', {
              fields: { name: 'A label with this name already exists' },
            });
      },
    });
    const ue = userEvent.setup();
    renderApp('/w/acme/accounts/all');
    await findRow('Acme Store');

    await ue.click(screen.getByRole('button', { name: 'Manage labels' }));
    const dialog = await screen.findByRole('dialog', { name: 'Account labels' });
    expect(await within(dialog).findByText('Client A')).toBeInTheDocument();

    await ue.type(within(dialog).getByLabelText('New label'), 'Retail');
    await ue.click(within(dialog).getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Label “Retail” created'));
    const call = mock.calls.find((c) => c.key === 'POST /workspaces/w1/account-labels');
    expect(bodyOf(call)).toEqual({ name: 'Retail', color: 'sky' });

    await ue.type(within(dialog).getByLabelText('New label'), 'retail');
    await ue.click(within(dialog).getByRole('button', { name: 'Add' }));
    expect(
      await within(dialog).findByText('A label with this name already exists'),
    ).toBeInTheDocument();
  });

  it('shows viewers no labelling or selection, but lets them export and open accounts', async () => {
    setup('VIEWER');
    const ue = userEvent.setup();
    renderApp('/w/acme/accounts/all');
    const row = await findRow('Acme Store');
    expect(within(row).queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Labels', exact: true })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Manage labels' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Export CSV/ })).toBeInTheDocument();

    await ue.click(within(row).getByRole('button', { name: 'Actions for Acme Store' }));
    const menu = await screen.findByRole('menu');
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual(['View details', 'Open on Facebook', 'Copy Meta ID']);
  });

  it('downloads the filtered accounts as CSV', async () => {
    const createObjectURL = vi.fn(() => 'blob:export');
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const mock = setup('OWNER', {
      'GET /workspaces/w1/social-accounts/export': () =>
        new Response('\uFEFFName\r\nAcme Store\r\n', {
          status: 200,
          headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': 'attachment; filename="socialhub-accounts-acme-2026-11-21.csv"',
          },
        }),
    });
    const ue = userEvent.setup();
    renderApp(`/w/acme/accounts/all?label=${CLIENT_A}&starred=true`);
    await findRow('Acme Store');

    await ue.click(screen.getByRole('button', { name: /Export CSV/ }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Export downloaded'));
    const call = mock.calls.find((c) => c.key === 'GET /workspaces/w1/social-accounts/export');
    expect(call.url.searchParams.get('label')).toBe(CLIENT_A);
    expect(call.url.searchParams.get('starred')).toBe('true');
    expect(call.url.searchParams.get('page')).toBeNull();
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    click.mockRestore();
  });

  it('reports an export the server refused', async () => {
    setup('OWNER', {
      'GET /workspaces/w1/social-accounts/export': () =>
        apiError(403, 'FORBIDDEN', 'You do not have permission to perform this action'),
    });
    const ue = userEvent.setup();
    renderApp('/w/acme/accounts/all');
    await findRow('Acme Store');
    await ue.click(screen.getByRole('button', { name: /Export CSV/ }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('You do not have permission to perform this action'),
    );
  });
});

/* ----------------------------------------------------------------- overview */

describe('Overview organisation cards', () => {
  it('shows starred accounts and labels; a label shows exactly its accounts', async () => {
    const mock = setup('OWNER', {
      [LIST]: ({ url }) =>
        jsonResponse(
          200,
          list(url.searchParams.get('starred') === 'true' ? [store] : [store, gram]),
        ),
    });
    const ue = userEvent.setup();
    renderApp('/w/acme/accounts');

    const starredCard = (
      await screen.findByRole('heading', { name: 'Your starred accounts' })
    ).closest('section');
    expect(await within(starredCard).findByRole('link', { name: 'Acme Store' })).toHaveAttribute(
      'href',
      `/w/acme/accounts/a/${STORE}`,
    );

    const labelsCard = screen.getByRole('heading', { name: 'Labels' }).closest('section');
    await ue.click(await within(labelsCard).findByRole('button', { name: 'Client A' }));
    await waitFor(() =>
      expect(
        listCalls(mock).some(
          (c) =>
            c.url.searchParams.get('label') === CLIENT_A &&
            c.url.searchParams.get('limit') === '25',
        ),
      ).toBe(true),
    );
  });
});

/* ------------------------------------------------------------------- detail */

const detail = (overrides = {}) => ({
  account: store,
  notes: {
    text: 'Client contact: Dana.\nPost before 10am.',
    updatedAt: '2026-11-20T07:22:04.434Z',
    updatedBy: { id: 'u1', name: 'Olivia Owner' },
  },
  connection: store.connection,
  linkedPage: null,
  linkedInstagram: [],
  permissions: {
    granted: ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts'],
    requiredForPublishing: ['pages_manage_posts', 'pages_read_engagement'],
    missing: [],
    tasks: ['CREATE_CONTENT', 'MANAGE'],
    createContent: true,
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

describe('Account detail organisation', () => {
  it('shows labels, notes and links to the account on Facebook for everyone', async () => {
    setup('VIEWER', {
      [`GET /workspaces/w1/social-accounts/${STORE}`]: () => jsonResponse(200, detail()),
    });
    renderApp(`/w/acme/accounts/a/${STORE}`);

    const notes = (await screen.findByRole('heading', { name: 'Team notes' })).closest('section');
    expect(within(notes).getByText(/Client contact: Dana\./)).toBeInTheDocument();
    expect(within(notes).getByText(/Last edited by Olivia Owner/)).toBeInTheDocument();
    expect(within(notes).queryByRole('button', { name: /Edit|Add notes/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open on Facebook/ })).toHaveAttribute(
      'href',
      'https://www.facebook.com/5001',
    );
    expect(screen.getByRole('link', { name: /Open on Facebook/ })).toHaveAttribute(
      'rel',
      'noopener noreferrer',
    );
    expect(screen.getAllByText('Client A').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Edit labels' })).not.toBeInTheDocument();
  });

  it('lets managers edit the notes and the labels of the account', async () => {
    const mock = setup('OWNER', {
      [`GET /workspaces/w1/social-accounts/${STORE}`]: () =>
        jsonResponse(
          200,
          detail({
            capabilities: {
              canManageConnections: true,
              canManageAccess: false,
              canViewActivity: false,
              providerConfigured: true,
            },
          }),
        ),
      [`PUT /workspaces/w1/social-accounts/${STORE}/notes`]: ({ init }) =>
        jsonResponse(200, {
          notes: {
            text: JSON.parse(init.body).notes,
            updatedAt: '2026-11-21T07:00:00.000Z',
            updatedBy: { id: 'u1', name: 'Olivia Owner' },
          },
        }),
      'POST /workspaces/w1/social-accounts/labels': () =>
        jsonResponse(200, { updated: 1, accounts: [] }),
    });
    const ue = userEvent.setup();
    renderApp(`/w/acme/accounts/a/${STORE}`);

    const notes = (await screen.findByRole('heading', { name: 'Team notes' })).closest('section');
    await ue.click(within(notes).getByRole('button', { name: 'Edit' }));
    const box = within(notes).getByRole('textbox', { name: 'Team notes' });
    await ue.clear(box);
    await ue.type(box, 'Approval needed from Sam');
    await ue.click(within(notes).getByRole('button', { name: 'Save notes' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Notes saved'));
    const save = mock.calls.find(
      (c) => c.key === `PUT /workspaces/w1/social-accounts/${STORE}/notes`,
    );
    expect(bodyOf(save)).toEqual({ notes: 'Approval needed from Sam' });

    await ue.click(screen.getByRole('button', { name: 'Edit labels' }));
    const dialog = await screen.findByRole('dialog', { name: 'Labels for Acme Store' });
    await ue.click(await within(dialog).findByRole('checkbox', { name: 'North' }));
    await ue.click(within(dialog).getByRole('button', { name: 'Apply −1' }));
    await waitFor(() => expect(mock.count('POST /workspaces/w1/social-accounts/labels')).toBe(1));
    const call = mock.calls.find((c) => c.key === 'POST /workspaces/w1/social-accounts/labels');
    expect(bodyOf(call)).toEqual({ accountIds: [STORE], add: [], remove: [NORTH] });
  });
});
