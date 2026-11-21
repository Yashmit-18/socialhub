// Frontend interaction tests: the SocialHub API is mocked with fetch; no Meta API is involved.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAccessToken } from '../../../lib/api.js';
import { apiError, jsonResponse, mockFetch } from '../../../test/fetchMock.js';
import { renderApp } from '../../../test/renderApp.jsx';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

// Destinations (ids are ObjectIds, as the API returns them).
const STORE = '6b1000000000000000000001';
const IG = '6b1000000000000000000002';
const LABS = '6b1000000000000000000003';

// Memberships.
const OWNER_ID = '6b2000000000000000000001';
const ADMIN_ID = '6b2000000000000000000002';
const EDITOR_ID = '6b2000000000000000000003';
const VIEWER_ID = '6b2000000000000000000004';
const ALL_ID = '6b2000000000000000000005';
const ADMIN2_ID = '6b2000000000000000000006';
const ADMIN3_ID = '6b2000000000000000000007';

const NONE = { mode: 'SELECTED', socialAccountIds: [] };
const configured = { facebook: { configured: true }, instagram: { configured: true } };

const workspace = (role, membershipId) => ({
  id: 'w1',
  name: 'Acme Social',
  slug: 'acme',
  timezone: 'UTC',
  membership: { id: membershipId, role, permissions: [], accountAccess: NONE },
});

const member = (id, name, email, role, accountAccess = NONE, userId = `u-${id.slice(-2)}`) => ({
  id,
  role,
  permissions: [],
  accountAccess,
  joinedAt: '2026-11-20T07:22:03.735Z',
  user: { id: userId, name, email },
  invitedBy: role === 'OWNER' ? null : { id: 'u1', name: 'Ada Lovelace' },
});

const owner = member(OWNER_ID, 'Ada Lovelace', 'ada@example.com', 'OWNER', NONE, 'u1');
const admin = member(ADMIN_ID, 'Adam Admin', 'adam@example.com', 'ADMIN');
const editor = member(EDITOR_ID, 'Eddie Editor', 'eddie@example.com', 'EDITOR', {
  mode: 'SELECTED',
  socialAccountIds: [STORE, IG],
});
const viewer = member(VIEWER_ID, 'Vera Viewer', 'vera@studio.example', 'VIEWER');
const allAccess = member(ALL_ID, 'Alex Everything', 'alex@example.com', 'EDITOR', {
  mode: 'ALL',
  socialAccountIds: [],
});

const health = (readiness = 'READY', attention = []) => ({
  connectionStatus: 'ACTIVE',
  connectionStatusReason: null,
  readiness,
  readinessReasons: attention.map((a) => a.message),
  eligibility: {
    eligible: readiness === 'READY',
    createContent: readiness === 'READY',
    missingPermissions: [],
  },
  attention,
  needsAttention: attention.length > 0,
});

const connection = {
  id: '6b3000000000000000000001',
  provider: 'FACEBOOK_LOGIN',
  displayName: 'Alice',
  pictureUrl: null,
  status: 'ACTIVE',
};

// Sorted by name, as GET /social-accounts returns them.
const destinations = [
  {
    id: IG,
    workspace: 'w1',
    platform: 'INSTAGRAM_ACCOUNT',
    externalId: '17841400000000010',
    name: 'Acme',
    username: 'acme',
    pictureUrl: null,
    tasks: ['CREATE_CONTENT', 'MANAGE'],
    lastSyncedAt: '2026-11-20T07:22:04.434Z',
    createdAt: '2026-11-20T07:22:04.241Z',
    connection,
    linkedPage: { id: STORE, externalId: '5001', name: 'Acme Store' },
    health: health(),
  },
  {
    id: LABS,
    workspace: 'w1',
    platform: 'FACEBOOK_PAGE',
    externalId: '5002',
    name: 'Acme Labs',
    category: 'Brand',
    pictureUrl: null,
    tasks: ['ANALYZE'],
    lastSyncedAt: '2026-11-20T07:22:04.434Z',
    createdAt: '2026-11-20T07:22:04.230Z',
    connection,
    linkedPage: null,
    health: health('RESTRICTED', [
      {
        code: 'MISSING_CREATE_CONTENT',
        message: 'This login has no Page role that allows creating content (CREATE_CONTENT task)',
      },
    ]),
  },
  {
    id: STORE,
    workspace: 'w1',
    platform: 'FACEBOOK_PAGE',
    externalId: '5001',
    name: 'Acme Store',
    category: 'Brand',
    pictureUrl: null,
    tasks: ['ANALYZE', 'CREATE_CONTENT', 'MANAGE'],
    lastSyncedAt: '2026-11-20T07:22:04.434Z',
    createdAt: '2026-11-20T07:22:04.216Z',
    connection,
    linkedPage: null,
    health: health(),
  },
];

const summary = {
  accounts: {
    total: 3,
    facebookPages: 2,
    instagramAccounts: 1,
    connected: 3,
    needsAttention: 1,
    ready: 2,
    restricted: 1,
    unavailable: 0,
  },
  connections: null,
  meta: { facebookConfigured: true, instagramConfigured: true },
  truncated: false,
};

const accountList = (items) => ({
  items,
  total: items.length,
  page: 1,
  limit: 500,
  pages: 1,
  facets: { platform: {}, status: {}, readiness: {}, attention: 0 },
  truncated: false,
});

/**
 * Signs in as the member `me` (their user and membership). `members` / `accounts` may be
 * functions so a test can change what the next GET returns.
 */
function setup(
  me,
  {
    members = [owner, admin, editor, viewer, allAccess],
    accounts = destinations,
    routes = {},
  } = {},
) {
  const current = (value) => (typeof value === 'function' ? value() : value);
  return mockFetch({
    'POST /auth/refresh': () => jsonResponse(200, { user: me.user, accessToken: 'access' }),
    'GET /workspaces': () => jsonResponse(200, { items: [workspace(me.role, me.id)] }),
    'GET /integrations/meta': () => jsonResponse(200, configured),
    'GET /workspaces/w1/social-accounts/summary': () => jsonResponse(200, summary),
    'GET /workspaces/w1/members': () => jsonResponse(200, { items: current(members) }),
    'GET /workspaces/w1/social-accounts': () => jsonResponse(200, accountList(current(accounts))),
    ...routes,
  });
}

const card = (title) => screen.getByRole('heading', { name: title }).closest('section');
const findCard = async (title) =>
  (await screen.findByRole('heading', { name: title })).closest('section');
const memberRow = (name) => within(card('Members')).getByText(name).closest('li');
const coverageRow = (name) =>
  within(card('Account coverage')).getByRole('link', { name }).closest('li');
const accessUrl = (id) => `PUT /workspaces/w1/members/${id}/account-access`;
/** Changes within 'Selected accounts only' are sent as PATCH { add, remove }. */
const patchUrl = (id) => `PATCH /workspaces/w1/members/${id}/account-access`;

beforeEach(() => {
  setAccessToken(null);
  vi.clearAllMocks();
});
afterEach(() => vi.unstubAllGlobals());

describe('team access (owners and admins)', () => {
  it('explains the rules and summarises what every member can use', async () => {
    setup(owner);
    renderApp('/w/acme/accounts/access');

    expect(await screen.findByRole('link', { name: 'Team access' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    // The tabs render before the tab's code-split page has loaded: wait for the page itself.
    expect(
      await screen.findByText('Owners and Admins always use every account'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Editors and Viewers only see and use the accounts assigned to them'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('New members and invitations start with no accounts'),
    ).toBeInTheDocument();
    expect(screen.getByText('The server enforces this on every request')).toBeInTheDocument();

    const members = await findCard('Members');
    expect(await within(members).findByText('Eddie Editor')).toBeInTheDocument();
    expect(within(members).getByText('5 members · 1 without any accounts')).toBeInTheDocument();

    const me = within(members).getByText('(you)').closest('li');
    expect(me).toHaveTextContent('Ada Lovelace');
    expect(within(me).getByText('Full access')).toBeInTheDocument();
    expect(within(memberRow('Adam Admin')).getByText('Full access')).toBeInTheDocument();
    expect(within(memberRow('Alex Everything')).getByText('All accounts')).toBeInTheDocument();
    expect(within(memberRow('Vera Viewer')).getByText('No accounts')).toBeInTheDocument();
    expect(within(memberRow('Eddie Editor')).getByText('2 accounts')).toBeInTheDocument();

    // Access can only be edited for editors and viewers — never for owners, admins or yourself.
    expect(
      within(members)
        .getAllByRole('button', { name: /^Edit access for/ })
        .map((b) => b.getAttribute('aria-label')),
    ).toEqual([
      'Edit access for Alex Everything',
      'Edit access for Eddie Editor',
      'Edit access for Vera Viewer',
    ]);
    expect(within(members).getByRole('link', { name: /Invite/ })).toHaveAttribute(
      'href',
      '/w/acme/team?invite=1',
    );
  });

  it('searches members by name or email', async () => {
    setup(owner);
    renderApp('/w/acme/accounts/access');
    const members = await findCard('Members');
    const search = await within(members).findByRole('searchbox', { name: 'Search members' });

    await userEvent.type(search, 'eddie');
    expect(within(members).getByText('Eddie Editor')).toBeInTheDocument();
    expect(within(members).queryByText('Vera Viewer')).not.toBeInTheDocument();

    await userEvent.clear(search);
    await userEvent.type(search, 'studio.example');
    expect(within(members).getByText('Vera Viewer')).toBeInTheDocument();
    expect(within(members).queryByText('Eddie Editor')).not.toBeInTheDocument();

    await userEvent.clear(search);
    await userEvent.type(search, 'nobody');
    expect(within(members).getByText('No members match “nobody”.')).toBeInTheDocument();
    await userEvent.click(within(members).getByRole('button', { name: 'Clear search' }));
    expect(search).toHaveValue('');
    expect(within(members).getByText('Eddie Editor')).toBeInTheDocument();
  });

  it('adds the chosen accounts to a member’s access, sending only the change', async () => {
    let members = [owner, admin, editor, viewer, allAccess];
    const mock = setup(owner, {
      members: () => members,
      routes: {
        [patchUrl(VIEWER_ID)]: ({ init }) => {
          const { add, remove } = JSON.parse(init.body);
          members = members.map((m) =>
            m.id === VIEWER_ID
              ? {
                  ...m,
                  accountAccess: {
                    mode: 'SELECTED',
                    socialAccountIds: [
                      ...m.accountAccess.socialAccountIds.filter((id) => !remove.includes(id)),
                      ...add,
                    ],
                  },
                }
              : m,
          );
          return jsonResponse(200, { member: members.find((m) => m.id === VIEWER_ID) });
        },
      },
    });
    renderApp('/w/acme/accounts/access');

    await userEvent.click(
      await screen.findByRole('button', { name: 'Edit access for Vera Viewer' }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Social account access' });
    expect(
      within(dialog).getByText(
        'No accounts selected — Vera Viewer will not see any social accounts.',
      ),
    ).toBeInTheDocument();
    const save = within(dialog).getByRole('button', { name: 'Save access' });
    expect(save).toBeDisabled(); // nothing changed yet

    await userEvent.click(within(dialog).getByRole('checkbox', { name: /^Acme Store/ }));
    await userEvent.click(within(dialog).getByRole('checkbox', { name: /^Acme Labs/ }));
    expect(within(dialog).getByText('2 of 3 accounts selected')).toBeInTheDocument();
    await userEvent.click(save);

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const call = mock.calls.find((c) => c.key === patchUrl(VIEWER_ID));
    expect(JSON.parse(call.init.body)).toEqual({ add: [LABS, STORE], remove: [] });
    expect(mock.count(accessUrl(VIEWER_ID))).toBe(0);
    expect(toast.success).toHaveBeenCalledWith('Account access updated for Vera Viewer');
    // The lists are refreshed from the API after saving.
    expect(await within(memberRow('Vera Viewer')).findByText('2 accounts')).toBeInTheDocument();
  });

  it('can give a member every account', async () => {
    const mock = setup(owner, {
      routes: {
        [accessUrl(EDITOR_ID)]: () =>
          jsonResponse(200, {
            member: { ...editor, accountAccess: { mode: 'ALL', socialAccountIds: [] } },
          }),
      },
    });
    renderApp('/w/acme/accounts/access');

    await userEvent.click(
      await screen.findByRole('button', { name: 'Edit access for Eddie Editor' }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Social account access' });
    // The editor starts from the member's saved grant.
    expect(within(dialog).getByRole('checkbox', { name: /^Acme Store/ })).toBeChecked();
    expect(within(dialog).getByRole('checkbox', { name: /^Acme@acme/ })).toBeChecked();
    expect(within(dialog).getByRole('checkbox', { name: /^Acme Labs/ })).not.toBeChecked();

    await userEvent.click(within(dialog).getByRole('radio', { name: /^All accounts/ }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save access' }));

    await waitFor(() => expect(mock.count(accessUrl(EDITOR_ID))).toBe(1));
    const call = mock.calls.find((c) => c.key === accessUrl(EDITOR_ID));
    expect(JSON.parse(call.init.body)).toEqual({ mode: 'ALL', socialAccountIds: [] });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('removes an unchecked account without replacing the rest of the grant', async () => {
    const mock = setup(owner, {
      routes: {
        [patchUrl(EDITOR_ID)]: () =>
          jsonResponse(200, {
            member: { ...editor, accountAccess: { mode: 'SELECTED', socialAccountIds: [IG] } },
          }),
      },
    });
    renderApp('/w/acme/accounts/access');

    await userEvent.click(
      await screen.findByRole('button', { name: 'Edit access for Eddie Editor' }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Social account access' });
    await userEvent.click(within(dialog).getByRole('checkbox', { name: /^Acme Store/ }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save access' }));

    await waitFor(() => expect(mock.count(patchUrl(EDITOR_ID))).toBe(1));
    const call = mock.calls.find((c) => c.key === patchUrl(EDITOR_ID));
    expect(JSON.parse(call.init.body)).toEqual({ add: [], remove: [STORE] });
    expect(mock.count(accessUrl(EDITOR_ID))).toBe(0);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('explains a conflicting change and reloads the member’s current access', async () => {
    let members = [owner, admin, editor, viewer, allAccess];
    const mock = setup(owner, {
      members: () => members,
      routes: {
        [patchUrl(VIEWER_ID)]: () => {
          // Another admin granted Acme Store a moment earlier.
          members = members.map((m) =>
            m.id === VIEWER_ID
              ? { ...m, accountAccess: { mode: 'SELECTED', socialAccountIds: [STORE] } }
              : m,
          );
          return apiError(
            409,
            'CONFLICT',
            'This member’s access was changed by someone else; refresh and retry',
          );
        },
      },
    });
    renderApp('/w/acme/accounts/access');

    await userEvent.click(
      await screen.findByRole('button', { name: 'Edit access for Vera Viewer' }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Social account access' });
    await userEvent.click(within(dialog).getByRole('checkbox', { name: /^Acme Labs/ }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save access' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Access was changed by someone else. Reload and try again.',
    );
    expect(toast.success).not.toHaveBeenCalled();

    const loads = mock.count('GET /workspaces/w1/members');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reload' }));
    await waitFor(() => expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument());
    expect(mock.count('GET /workspaces/w1/members')).toBeGreaterThan(loads);
    // The draft now starts again from what is saved.
    expect(within(dialog).getByRole('checkbox', { name: /^Acme Store/ })).toBeChecked();
    expect(within(dialog).getByRole('checkbox', { name: /^Acme Labs/ })).not.toBeChecked();
    expect(within(memberRow('Vera Viewer')).getByText('1 account')).toBeInTheDocument();
  });

  it('closes the editor when the member was removed in the meantime', async () => {
    let members = [owner, admin, editor, viewer, allAccess];
    setup(owner, {
      members: () => members,
      routes: {
        [patchUrl(VIEWER_ID)]: () => {
          members = members.filter((m) => m.id !== VIEWER_ID);
          return apiError(404, 'NOT_FOUND', 'Member not found');
        },
      },
    });
    renderApp('/w/acme/accounts/access');

    await userEvent.click(
      await screen.findByRole('button', { name: 'Edit access for Vera Viewer' }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Social account access' });
    await userEvent.click(within(dialog).getByRole('checkbox', { name: /^Acme Store/ }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save access' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Member not found');

    await userEvent.click(within(dialog).getByRole('button', { name: 'Reload' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(toast.error).toHaveBeenCalledWith('Vera Viewer is no longer a member of Acme Social.');
    expect(within(card('Members')).queryByText('Vera Viewer')).not.toBeInTheDocument();
  });

  it('shows who can use each account and flags accounts no editor or viewer can use', async () => {
    const admin2 = member(ADMIN2_ID, 'Bea Boss', 'bea@example.com', 'ADMIN');
    const admin3 = member(ADMIN3_ID, 'Cy Chief', 'cy@example.com', 'ADMIN');
    setup(owner, { members: [owner, admin, admin2, admin3, editor, viewer] });
    renderApp('/w/acme/accounts/access');

    const coverage = await findCard('Account coverage');
    await within(coverage).findByRole('link', { name: 'Acme Store' });

    const store = coverageRow('Acme Store');
    expect(within(store).getByText('5 members')).toBeInTheDocument();
    expect(within(store).getByText('+1')).toBeInTheDocument(); // four avatars, then a count
    expect(within(store).getByText('1 editor')).toBeInTheDocument();
    expect(
      within(store).getByText(/Ada Lovelace, Adam Admin, Bea Boss, Cy Chief, and Eddie Editor/),
    ).toBeInTheDocument();
    expect(within(store).queryByText('No editors or viewers')).not.toBeInTheDocument();

    const labs = coverageRow('Acme Labs');
    expect(within(labs).getByText('4 members')).toBeInTheDocument();
    expect(within(labs).getByText('No editors or viewers')).toBeInTheDocument();
    expect(within(labs).queryByText('+1')).not.toBeInTheDocument();
    // Per-account access is edited on the account's own page.
    expect(within(coverage).getByRole('link', { name: 'Acme Labs' })).toHaveAttribute(
      'href',
      `/w/acme/accounts/a/${LABS}`,
    );
    expect(
      within(coverage).getByText(
        '1 account can only be used by owners and admins — no editor or viewer has access.',
      ),
    ).toBeInTheDocument();

    await userEvent.click(
      within(coverage).getByRole('checkbox', {
        name: 'Only accounts without editors or viewers (1)',
      }),
    );
    expect(within(coverage).getByRole('link', { name: 'Acme Labs' })).toBeInTheDocument();
    expect(within(coverage).queryByRole('link', { name: 'Acme Store' })).not.toBeInTheDocument();

    await userEvent.click(
      within(coverage).getByRole('checkbox', {
        name: 'Only accounts without editors or viewers (1)',
      }),
    );
    await userEvent.type(
      within(coverage).getByRole('searchbox', { name: 'Search account coverage' }),
      'acme store',
    );
    expect(within(coverage).getByRole('link', { name: 'Acme Store' })).toBeInTheDocument();
    expect(within(coverage).queryByRole('link', { name: 'Acme Labs' })).not.toBeInTheDocument();
  });

  it('shows an empty coverage state when the workspace has no accounts', async () => {
    setup(admin, { accounts: [] });
    renderApp('/w/acme/accounts/access');
    const coverage = await findCard('Account coverage');
    expect(await within(coverage).findByText('No social accounts yet')).toBeInTheDocument();
    // Admins manage editors and viewers, but not the owner or themselves.
    const members = card('Members');
    expect(
      await within(members).findByRole('button', { name: 'Edit access for Vera Viewer' }),
    ).toBeInTheDocument();
    expect(within(memberRow('Adam Admin')).queryByRole('button')).not.toBeInTheDocument();
    expect(within(members).getByText('(you)').closest('li')).toHaveTextContent('Adam Admin');
  });

  it('shows loading and error states with a working retry', async () => {
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    let fail = true;
    setup(owner, {
      routes: {
        'GET /workspaces/w1/members': async () => {
          await gate;
          return fail
            ? apiError(500, 'INTERNAL_ERROR', 'The database is not reachable')
            : jsonResponse(200, { items: [owner, admin, editor, viewer] });
        },
      },
    });
    renderApp('/w/acme/accounts/access');

    expect(await screen.findByText('Loading members…')).toBeInTheDocument();
    release();
    const members = await findCard('Members');
    expect(await within(members).findByText('The database is not reachable')).toBeInTheDocument();
    expect(
      within(card('Account coverage')).getByText('Coverage could not be loaded'),
    ).toBeInTheDocument();

    fail = false;
    await userEvent.click(within(members).getByRole('button', { name: 'Try again' }));
    expect(await within(members).findByText('Eddie Editor')).toBeInTheDocument();
    expect(
      await within(card('Account coverage')).findByRole('link', { name: 'Acme Store' }),
    ).toBeInTheDocument();
  });
});

describe('team access (other roles)', () => {
  it('shows editors a restricted state without requesting member data', async () => {
    const mock = setup(editor);
    renderApp('/w/acme/accounts/access');

    expect(
      await screen.findByRole('heading', { name: 'Only owners and admins can manage team access' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View your accounts' })).toHaveAttribute(
      'href',
      '/w/acme/accounts',
    );
    expect(screen.queryByRole('link', { name: 'Team access' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Edit access/ })).not.toBeInTheDocument();
    expect(mock.count('GET /workspaces/w1/members')).toBe(0);
    expect(mock.count('GET /workspaces/w1/social-accounts')).toBe(0);
  });
});
