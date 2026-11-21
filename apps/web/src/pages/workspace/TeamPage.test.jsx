// Frontend interaction tests: the SocialHub API is mocked with fetch; no Meta API is involved.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAccessToken } from '../../lib/api.js';
import { apiError, jsonResponse, mockFetch } from '../../test/fetchMock.js';
import { renderApp } from '../../test/renderApp.jsx';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

// Destinations (ObjectIds, as the API returns them).
const STORE = '6b1000000000000000000001';
const IG = '6b1000000000000000000002';
const LABS = '6b1000000000000000000003';

const OWNER_ID = '6b2000000000000000000001';
const VIEWER_ID = '6b2000000000000000000004';

const NONE = { mode: 'SELECTED', socialAccountIds: [] };

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
const members = [
  owner,
  member('6b2000000000000000000002', 'Adam Admin', 'adam@example.com', 'ADMIN'),
  member('6b2000000000000000000003', 'Eddie Editor', 'eddie@example.com', 'EDITOR', {
    mode: 'SELECTED',
    socialAccountIds: [STORE, IG],
  }),
  member(VIEWER_ID, 'Vera Viewer', 'vera@example.com', 'VIEWER', NONE),
  member('6b2000000000000000000005', 'Alex Everything', 'alex@example.com', 'EDITOR', {
    mode: 'ALL',
    socialAccountIds: [],
  }),
];

const invitation = (id, email, role, accountAccess) => ({
  id,
  email,
  role,
  status: 'PENDING',
  invitedBy: { id: 'u1', name: 'Ada Lovelace' },
  expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
  lastSentAt: '2026-11-20T07:22:05.195Z',
  sendCount: 1,
  accountAccess,
  createdAt: '2026-11-20T07:22:05.196Z',
});

const invitations = [
  invitation('6b4000000000000000000001', 'new.editor@example.com', 'EDITOR', {
    mode: 'SELECTED',
    socialAccountIds: [STORE, IG],
  }),
  invitation('6b4000000000000000000002', 'new.admin@example.com', 'ADMIN', null),
  invitation('6b4000000000000000000003', 'new.viewer@example.com', 'VIEWER', null),
];

const connection = {
  id: '6b3000000000000000000001',
  provider: 'FACEBOOK_LOGIN',
  displayName: 'Alice',
  pictureUrl: null,
  status: 'ACTIVE',
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
const destination = (id, fields) => ({
  id,
  workspace: 'w1',
  pictureUrl: null,
  tasks: ['CREATE_CONTENT', 'MANAGE'],
  lastSyncedAt: '2026-11-20T07:22:04.434Z',
  createdAt: '2026-11-20T07:22:04.216Z',
  connection,
  linkedPage: null,
  health,
  ...fields,
});
// Sorted by name, as GET /social-accounts returns them.
const destinations = [
  destination(IG, {
    platform: 'INSTAGRAM_ACCOUNT',
    externalId: '17841400000000010',
    name: 'Acme',
    username: 'acme',
    linkedPage: { id: STORE, externalId: '5001', name: 'Acme Store' },
  }),
  destination(LABS, { platform: 'FACEBOOK_PAGE', externalId: '5002', name: 'Acme Labs' }),
  destination(STORE, { platform: 'FACEBOOK_PAGE', externalId: '5001', name: 'Acme Store' }),
];

function setup(routes = {}) {
  return mockFetch({
    'POST /auth/refresh': () => jsonResponse(200, { user: owner.user, accessToken: 'access' }),
    'GET /workspaces': () =>
      jsonResponse(200, {
        items: [
          {
            id: 'w1',
            name: 'Acme Social',
            slug: 'acme',
            timezone: 'UTC',
            membership: { id: OWNER_ID, role: 'OWNER', permissions: [], accountAccess: NONE },
          },
        ],
      }),
    'GET /integrations/meta': () =>
      jsonResponse(200, { facebook: { configured: true }, instagram: { configured: true } }),
    'GET /workspaces/w1/social-accounts/summary': () =>
      jsonResponse(200, {
        accounts: { total: 3, facebookPages: 2, instagramAccounts: 1 },
        connections: null,
        meta: { facebookConfigured: true, instagramConfigured: true },
      }),
    'GET /workspaces/w1/members': () => jsonResponse(200, { items: members }),
    'GET /workspaces/w1/invitations': () => jsonResponse(200, { items: invitations }),
    'GET /workspaces/w1/social-accounts': () =>
      jsonResponse(200, { items: destinations, total: 3, page: 1, limit: 500, pages: 1 }),
    ...routes,
  });
}

const invited = (body) =>
  jsonResponse(201, {
    invitation: invitation('6b4000000000000000000009', body.email, body.role, null),
    inviteUrl: 'http://localhost:5173/invite/abc123',
    emailDelivered: false,
  });

const postInvite = {
  'POST /workspaces/w1/invitations': ({ init }) => invited(JSON.parse(init.body)),
};
const inviteBody = (mock) =>
  JSON.parse(mock.calls.find((c) => c.key === 'POST /workspaces/w1/invitations').init.body);

async function openInvite() {
  await userEvent.click(await screen.findByRole('button', { name: /Invite teammate/ }));
  return screen.findByRole('dialog', { name: 'Invite a teammate' });
}

const rowWith = (text) => screen.getByText(text).closest('li');

beforeEach(() => {
  setAccessToken(null);
  vi.clearAllMocks();
});
afterEach(() => vi.unstubAllGlobals());

describe('inviting with account access', () => {
  it('invites an editor with the two accounts that were selected', async () => {
    const mock = setup(postInvite);
    renderApp('/w/acme/team');
    const dialog = await openInvite();

    await userEvent.type(within(dialog).getByLabelText('Email address'), 'sam@example.com');
    expect(within(dialog).getByRole('combobox', { name: 'Role' })).toHaveValue('EDITOR');
    expect(within(dialog).getByRole('heading', { name: 'Account access' })).toBeInTheDocument();
    // Least privilege: nothing is selected until the inviter chooses accounts.
    expect(
      within(dialog).getByText('No accounts selected — they will not see any social accounts.'),
    ).toBeInTheDocument();

    await userEvent.click(await within(dialog).findByRole('checkbox', { name: /^Acme Store/ }));
    await userEvent.click(within(dialog).getByRole('checkbox', { name: /^Acme@acme/ }));
    expect(within(dialog).getByText('2 of 3 accounts selected')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send invitation' }));

    await waitFor(() =>
      expect(screen.getByRole('dialog')).toHaveAccessibleName('Invitation ready'),
    );
    expect(inviteBody(mock)).toEqual({
      email: 'sam@example.com',
      role: 'EDITOR',
      accountAccess: { mode: 'SELECTED', socialAccountIds: [IG, STORE] },
    });
  });

  it('invites an admin without any account access', async () => {
    const mock = setup(postInvite);
    renderApp('/w/acme/team');
    const dialog = await openInvite();

    await userEvent.type(within(dialog).getByLabelText('Email address'), 'boss@example.com');
    await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: 'Role' }), 'ADMIN');
    expect(
      within(dialog).getByText('Admins can use every social account in the workspace.'),
    ).toBeInTheDocument();
    expect(within(dialog).queryByRole('checkbox')).not.toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send invitation' }));

    await waitFor(() => expect(mock.count('POST /workspaces/w1/invitations')).toBe(1));
    const body = inviteBody(mock);
    expect(body).toEqual({ email: 'boss@example.com', role: 'ADMIN' });
    expect(body).not.toHaveProperty('accountAccess');
  });

  it('can invite a viewer to every account', async () => {
    const mock = setup(postInvite);
    renderApp('/w/acme/team');
    const dialog = await openInvite();

    await userEvent.type(within(dialog).getByLabelText('Email address'), 'vic@example.com');
    await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: 'Role' }), 'VIEWER');
    await userEvent.click(within(dialog).getByRole('radio', { name: /^All accounts/ }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send invitation' }));

    await waitFor(() => expect(mock.count('POST /workspaces/w1/invitations')).toBe(1));
    expect(inviteBody(mock)).toEqual({
      email: 'vic@example.com',
      role: 'VIEWER',
      accountAccess: { mode: 'ALL', socialAccountIds: [] },
    });
  });

  it('starts every invitation with no accounts selected', async () => {
    setup();
    renderApp('/w/acme/team');
    let dialog = await openInvite();
    await userEvent.type(within(dialog).getByLabelText('Email address'), 'sam@example.com');
    await userEvent.click(await within(dialog).findByRole('checkbox', { name: /^Acme Store/ }));
    expect(within(dialog).getByRole('checkbox', { name: /^Acme Store/ })).toBeChecked();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    dialog = await openInvite();
    expect(within(dialog).getByLabelText('Email address')).toHaveValue('');
    expect(await within(dialog).findByRole('checkbox', { name: /^Acme Store/ })).not.toBeChecked();
    expect(
      within(dialog).getByText('No accounts selected — they will not see any social accounts.'),
    ).toBeInTheDocument();
  });

  it('explains when the server rejects an account in the invitation', async () => {
    const mock = setup({
      'POST /workspaces/w1/invitations': () =>
        apiError(422, 'VALIDATION_ERROR', 'Some fields are invalid', {
          fields: { accountAccess: 'One or more accounts do not belong to this workspace' },
        }),
    });
    renderApp('/w/acme/team');
    const dialog = await openInvite();
    await userEvent.type(within(dialog).getByLabelText('Email address'), 'sam@example.com');
    await userEvent.click(await within(dialog).findByRole('checkbox', { name: /^Acme Labs/ }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send invitation' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'One or more accounts do not belong to this workspace',
    );
    expect(mock.count('POST /workspaces/w1/invitations')).toBe(1);
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Invite a teammate');
  });
});

describe('account access on the team list', () => {
  it('labels what each member can use', async () => {
    setup();
    renderApp('/w/acme/team');

    expect(await screen.findByText('Vera Viewer')).toBeInTheDocument();
    expect(within(rowWith('Vera Viewer')).getByText('No accounts')).toBeInTheDocument();
    expect(within(rowWith('Eddie Editor')).getByText('2 accounts')).toBeInTheDocument();
    expect(within(rowWith('Alex Everything')).getByText('All accounts')).toBeInTheDocument();
    expect(within(rowWith('Adam Admin')).getByText('Full access')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Account access' })).toHaveAttribute(
      'href',
      '/w/acme/accounts/access',
    );
  });

  it('shows what each pending invitation grants', async () => {
    setup();
    renderApp('/w/acme/team');

    expect(await screen.findByRole('heading', { name: 'Pending invitations' })).toBeInTheDocument();
    expect(within(rowWith('new.editor@example.com')).getByText('2 accounts')).toBeInTheDocument();
    expect(within(rowWith('new.admin@example.com')).getByText('Full access')).toBeInTheDocument();
    expect(within(rowWith('new.viewer@example.com')).getByText('No accounts')).toBeInTheDocument();
  });

  it('edits a member’s access with the shared account editor', async () => {
    // Within 'Selected accounts only' only the change is sent (PATCH { add, remove }).
    const accessKey = `PATCH /workspaces/w1/members/${VIEWER_ID}/account-access`;
    const mock = setup({
      [accessKey]: ({ init }) =>
        jsonResponse(200, {
          member: {
            ...members[3],
            accountAccess: { mode: 'SELECTED', socialAccountIds: JSON.parse(init.body).add },
          },
        }),
    });
    renderApp('/w/acme/team');

    await userEvent.click(await screen.findByRole('button', { name: 'Actions for Vera Viewer' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Edit account access' }));
    const dialog = await screen.findByRole('dialog', { name: 'Social account access' });
    await userEvent.click(await within(dialog).findByRole('checkbox', { name: /^Acme Labs/ }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save access' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(JSON.parse(mock.calls.find((c) => c.key === accessKey).init.body)).toEqual({
      add: [LABS],
      remove: [],
    });
    expect(toast.success).toHaveBeenCalledWith('Account access updated for Vera Viewer');
  });

  it('never offers access editing for owners and admins', async () => {
    setup();
    renderApp('/w/acme/team');

    await userEvent.click(await screen.findByRole('button', { name: 'Actions for Adam Admin' }));
    expect(screen.getByRole('menuitem', { name: 'Remove from workspace' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Edit account access' })).not.toBeInTheDocument();
  });
});
