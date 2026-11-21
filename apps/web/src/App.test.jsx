import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { safeRedirect } from './lib/utils.js';
import { setAccessToken } from './lib/api.js';
import { apiError, jsonResponse, mockFetch } from './test/fetchMock.js';
import { renderApp } from './test/renderApp.jsx';

const user = { id: 'u1', name: 'Ada Lovelace', email: 'ada@example.com' };

function workspace(role, overrides = {}) {
  return {
    id: 'w1',
    name: 'Acme Social',
    slug: 'acme',
    timezone: 'UTC',
    membership: {
      id: 'm-self',
      role,
      permissions: [],
      accountAccess: { mode: 'ALL', socialAccountIds: [] },
    },
    ...overrides,
  };
}

const member = (id, name, role) => ({
  id,
  role,
  user: { id: `u-${id}`, name, email: `${id}@example.com` },
  accountAccess: { mode: 'ALL', socialAccountIds: [] },
  joinedAt: new Date().toISOString(),
});

function signedIn(role, extra = {}) {
  return mockFetch({
    'POST /auth/refresh': () => jsonResponse(200, { user, accessToken: 'access' }),
    'GET /workspaces': () => jsonResponse(200, { items: [workspace(role)] }),
    'GET /workspaces/w1/members': () =>
      jsonResponse(200, {
        items: [
          { ...member('m-self', user.name, role), user },
          // Exactly one owner: add a separate one unless the signed-in user is the owner.
          ...(role === 'OWNER' ? [] : [member('m-owner', 'Olivia Owner', 'OWNER')]),
          member('m-editor', 'Eddie Editor', 'EDITOR'),
        ],
      }),
    'GET /workspaces/w1/invitations': () => jsonResponse(200, { items: [] }),
    'GET /workspaces/w1/social-accounts': () => jsonResponse(200, { items: [] }),
    'GET /workspaces/w1/social-connections': () => jsonResponse(200, { items: [] }),
    ...extra,
  });
}

beforeEach(() => setAccessToken(null));
afterEach(() => vi.unstubAllGlobals());

describe('safeRedirect', () => {
  it('only allows in-app paths', () => {
    expect(safeRedirect('/w/acme/team')).toBe('/w/acme/team');
    expect(safeRedirect('https://evil.example')).toBe('/');
    expect(safeRedirect('//evil.example')).toBe('/');
    expect(safeRedirect('/\\evil.example')).toBe('/');
    expect(safeRedirect(null)).toBe('/');
  });
});

describe('routing and authentication', () => {
  it('sends guests to the login page and preserves where they were going', async () => {
    mockFetch({ 'POST /auth/refresh': () => apiError(401, 'UNAUTHENTICATED') });
    const { router } = renderApp('/w/acme/team');
    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
    expect(new URLSearchParams(router.state.location.search).get('redirect')).toBe('/w/acme/team');
  });

  it('validates the login form on the client before calling the API', async () => {
    const mock = mockFetch({ 'POST /auth/refresh': () => apiError(401, 'UNAUTHENTICATED') });
    renderApp('/login');
    await userEvent.click(await screen.findByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Enter a valid email address')).toBeInTheDocument();
    expect(mock.count('POST /auth/login')).toBe(0);
  });

  it('shows the server message for wrong credentials', async () => {
    mockFetch({
      'POST /auth/refresh': () => apiError(401, 'UNAUTHENTICATED'),
      'POST /auth/login': () =>
        apiError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect'),
    });
    renderApp('/login');
    await userEvent.type(await screen.findByLabelText('Email'), 'ada@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'wrong-pass1');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Email or password is incorrect');
  });

  it('signs in and continues to the requested page', async () => {
    mockFetch({
      'POST /auth/refresh': () => apiError(401, 'UNAUTHENTICATED'),
      'POST /auth/login': () => jsonResponse(200, { user, accessToken: 'access' }),
      'GET /workspaces': () => jsonResponse(200, { items: [workspace('OWNER')] }),
      'GET /workspaces/w1/social-accounts': () => jsonResponse(200, { items: [] }),
      'GET /workspaces/w1/social-connections': () => jsonResponse(200, { items: [] }),
    });
    const { router } = renderApp('/login?redirect=%2Fw%2Facme%2Faccounts');
    await userEvent.type(await screen.findByLabelText('Email'), 'ada@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'correct-pass1');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('heading', { name: 'Social accounts' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/w/acme/accounts');
  });

  it('sends users without a workspace to onboarding', async () => {
    mockFetch({
      'POST /auth/refresh': () => jsonResponse(200, { user, accessToken: 'access' }),
      'GET /workspaces': () => jsonResponse(200, { items: [] }),
    });
    const { router } = renderApp('/');
    expect(await screen.findByRole('heading', { name: /Welcome, Ada/ })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/onboarding');
  });

  it('shows a not-found state for workspaces the user does not belong to', async () => {
    signedIn('OWNER');
    renderApp('/w/someone-else');
    expect(await screen.findByRole('heading', { name: 'Workspace not found' })).toBeInTheDocument();
  });
});

describe('permission-aware UI', () => {
  it('lets owners invite and manage members', async () => {
    signedIn('OWNER');
    renderApp('/w/acme/team');
    expect(await screen.findByRole('button', { name: /Invite teammate/ })).toBeInTheDocument();
    const roleSelect = await screen.findByRole('combobox', { name: 'Role for Eddie Editor' });
    expect(
      within(roleSelect)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Editor', 'Admin', 'Viewer']);
    expect(screen.queryByRole('button', { name: 'Leave' })).not.toBeInTheDocument();
  });

  it('hides management controls from viewers', async () => {
    signedIn('VIEWER');
    renderApp('/w/acme/team');
    expect(await screen.findByText('Eddie Editor')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Invite teammate/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /Role for/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Leave' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Activity' })).not.toBeInTheDocument();
  });

  it('never offers the Admin role to admins', async () => {
    signedIn('ADMIN');
    renderApp('/w/acme/team');
    const roleSelect = await screen.findByRole('combobox', { name: 'Role for Eddie Editor' });
    expect(
      within(roleSelect)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Editor', 'Viewer']);
  });

  it('is honest when the Meta integration is not configured on the server', async () => {
    signedIn('OWNER', {
      'GET /integrations/meta': () =>
        jsonResponse(200, { facebook: { configured: false }, instagram: { configured: false } }),
    });
    renderApp('/w/acme/accounts');
    // Phase 3 wording: a "setup required" state that explains what is missing.
    const notice = await screen.findByRole('region', { name: 'Meta setup required' });
    expect(within(notice).getByText(/META_APP_ID and META_APP_SECRET/)).toBeInTheDocument();
    expect(
      within(notice).getByText(/cannot connect, reconnect or synchronize/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Connect Facebook/ })).not.toBeInTheDocument();
  });

  it('shows the invite link and email delivery status after inviting', async () => {
    signedIn('OWNER', {
      'POST /workspaces/w1/invitations': () =>
        jsonResponse(201, {
          invitation: {
            id: 'i1',
            email: 'new@example.com',
            role: 'EDITOR',
            status: 'PENDING',
            expiresAt: new Date(Date.now() + 864e5).toISOString(),
          },
          inviteUrl: 'http://localhost:5173/invite/abc123',
          emailDelivered: false,
        }),
    });
    renderApp('/w/acme/team');
    await userEvent.click(await screen.findByRole('button', { name: /Invite teammate/ }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Email address'), 'new@example.com');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send invitation' }));

    await waitFor(() =>
      expect(screen.getByRole('dialog')).toHaveAccessibleName('Invitation ready'),
    );
    expect(screen.getByLabelText('Invitation link')).toHaveValue(
      'http://localhost:5173/invite/abc123',
    );
    expect(screen.getByText(/Email delivery is not configured/)).toBeInTheDocument();
  });
});
