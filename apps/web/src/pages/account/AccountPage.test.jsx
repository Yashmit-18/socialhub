// Account settings: the SocialHub API is mocked with fetch; no Meta API is involved.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAccessToken } from '../../lib/api.js';
import { jsonResponse, mockFetch } from '../../test/fetchMock.js';
import { renderApp } from '../../test/renderApp.jsx';

const user = { id: 'u1', name: 'Ada Lovelace', email: 'ada@example.com' };

function setup() {
  return mockFetch({
    'POST /auth/refresh': () => jsonResponse(200, { user, accessToken: 'access' }),
    'GET /workspaces': () =>
      jsonResponse(200, {
        items: [
          {
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
          },
        ],
      }),
    'POST /auth/logout-all': () => jsonResponse(204),
  });
}

beforeEach(() => {
  setAccessToken(null);
  vi.clearAllMocks();
});
afterEach(() => vi.unstubAllGlobals());

describe('Account settings', () => {
  it('asks before signing out everywhere, and only then signs out', async () => {
    const mock = setup();
    const { router } = renderApp('/account');

    await userEvent.click(await screen.findByRole('button', { name: 'Sign out everywhere' }));
    const dialog = await screen.findByRole('dialog', { name: 'Sign out everywhere?' });
    expect(mock.count('POST /auth/logout-all')).toBe(0);

    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(mock.count('POST /auth/logout-all')).toBe(0);

    await userEvent.click(screen.getByRole('button', { name: 'Sign out everywhere' }));
    const again = await screen.findByRole('dialog', { name: 'Sign out everywhere?' });
    await userEvent.click(within(again).getByRole('button', { name: 'Sign out everywhere' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(mock.count('POST /auth/logout-all')).toBe(1);
  });

  it('previews the name as it is typed', async () => {
    setup();
    renderApp('/account');

    const field = await screen.findByLabelText('Full name');
    await userEvent.clear(field);
    await userEvent.type(field, 'Ada King');
    expect(screen.getByText('Ada King')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save profile' })).toBeEnabled();

    // An emptied field falls back to the saved name.
    await userEvent.clear(field);
    expect(screen.getAllByText('Ada Lovelace').length).toBeGreaterThan(0);
  });
});
