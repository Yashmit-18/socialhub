// Onboarding: the SocialHub API is mocked with fetch; no Meta API is involved.
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAccessToken } from '../lib/api.js';
import { jsonResponse, mockFetch } from '../test/fetchMock.js';
import { renderApp } from '../test/renderApp.jsx';

const user = { id: 'u1', name: 'Ada Lovelace', email: 'ada@example.com' };
const workspace = {
  id: 'w1',
  name: 'Acme Social',
  slug: 'acme',
  timezone: 'UTC',
  membership: {
    id: 'm1',
    role: 'OWNER',
    permissions: [],
    accountAccess: { mode: 'ALL', socialAccountIds: [] },
  },
};

function setup({ me = user, workspaces = [] } = {}) {
  return mockFetch({
    'POST /auth/refresh': () => jsonResponse(200, { user: me, accessToken: 'access' }),
    'POST /auth/logout': () => jsonResponse(204),
    'GET /workspaces': () => jsonResponse(200, { items: workspaces }),
  });
}

beforeEach(() => {
  setAccessToken(null);
  vi.clearAllMocks();
});
afterEach(() => vi.unstubAllGlobals());

describe('Onboarding', () => {
  it('welcomes a first-time user, previews what comes next and offers no Back link', async () => {
    setup();
    renderApp('/onboarding');

    expect(await screen.findByRole('heading', { name: /Welcome, Ada/ })).toBeInTheDocument();
    const steps = screen.getByRole('list', { name: 'Setup steps' });
    expect(steps).toHaveTextContent('Create a workspace');
    expect(steps).toHaveTextContent('Invite your team');
    expect(screen.queryByRole('link', { name: 'Back' })).not.toBeInTheDocument();
    expect(screen.getByText(/Signed in as/)).toHaveTextContent('ada@example.com');
  });

  it('offers a way back to someone who already has a workspace', async () => {
    setup({ workspaces: [workspace] });
    renderApp('/onboarding');

    expect(await screen.findByRole('heading', { name: 'Create a workspace' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute('href', '/');
    expect(screen.queryByRole('list', { name: 'Setup steps' })).not.toBeInTheDocument();
  });

  it('offers a way back to a platform admin without a workspace', async () => {
    setup({ me: { ...user, platformRole: 'PLATFORM_ADMIN' } });
    renderApp('/onboarding');

    expect(await screen.findByRole('heading', { name: /Welcome, Ada/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute('href', '/');
  });

  it('signs out from the onboarding screen', async () => {
    const mock = setup();
    const { router } = renderApp('/onboarding');

    await userEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(mock.count('POST /auth/logout')).toBe(1);
  });
});
