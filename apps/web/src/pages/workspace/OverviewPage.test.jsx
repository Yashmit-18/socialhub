// Overview (main screen) tests: the SocialHub API is mocked with fetch; no Meta API is involved.
import { screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAccessToken } from '../../lib/api.js';
import { apiError, jsonResponse, mockFetch } from '../../test/fetchMock.js';
import { renderApp } from '../../test/renderApp.jsx';

const NONE = { mode: 'SELECTED', socialAccountIds: [] };
const user = { id: 'u1', name: 'Ada Lovelace', email: 'ada@example.com' };

const followers = (overrides = {}) => ({
  total: null,
  facebook: null,
  instagram: null,
  counted: 0,
  missing: 0,
  facebookMissing: 0,
  instagramMissing: 0,
  asOf: null,
  ...overrides,
});

function setup({ role = 'OWNER', accounts, followers: counts, summary } = {}) {
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
            membership: { id: 'm1', role, permissions: [], accountAccess: NONE },
          },
        ],
      }),
    'GET /workspaces/w1/overview': () =>
      jsonResponse(200, {
        stats: {
          members: 1,
          pendingInvitations: 0,
          facebookPages: accounts.facebookPages,
          instagramAccounts: accounts.instagramAccounts,
        },
        recentActivity: [],
      }),
    'GET /workspaces/w1/social-accounts/summary':
      summary ??
      (() =>
        jsonResponse(200, {
          accounts,
          followers: counts,
          connections: null,
          meta: { facebookConfigured: true, instagramConfigured: true },
        })),
  });
}

/** The followers card once its figures have loaded (the total replaces the skeleton). */
const followersCard = async () => (await screen.findByTestId('followers-total')).closest('section');

beforeEach(() => {
  setAccessToken(null);
  vi.clearAllMocks();
});
afterEach(() => vi.unstubAllGlobals());

describe('Overview: combined followers', () => {
  it('shows the Facebook, Instagram and combined totals', async () => {
    setup({
      accounts: { total: 11, facebookPages: 6, instagramAccounts: 5 },
      followers: followers({
        total: 8_420,
        facebook: 5_210,
        instagram: 3_210,
        counted: 11,
        asOf: new Date().toISOString(),
      }),
    });
    renderApp('/w/acme');

    expect(await screen.findByTestId('followers-total')).toHaveTextContent('8,420');
    const facebook = screen.getByTestId('followers-facebook');
    expect(within(facebook).getByText('5,210')).toBeVisible();
    expect(within(facebook).getByText('Across 6 Pages')).toBeVisible();
    const instagram = screen.getByTestId('followers-instagram');
    expect(within(instagram).getByText('3,210')).toBeVisible();
    expect(within(instagram).getByText('Across 5 accounts')).toBeVisible();
    expect(screen.getByTestId('followers-split')).toBeVisible();
  });

  it('stays on the screen with no accounts and offers to connect them', async () => {
    setup({
      accounts: { total: 0, facebookPages: 0, instagramAccounts: 0 },
      followers: followers(),
    });
    renderApp('/w/acme');

    const card = await followersCard();
    expect(within(card).getByTestId('followers-total')).toHaveTextContent('—');
    expect(within(card).getByRole('link', { name: /Connect accounts/ })).toHaveAttribute(
      'href',
      '/w/acme/accounts',
    );
  });

  it('asks viewers without account access to contact an admin instead', async () => {
    setup({
      role: 'VIEWER',
      accounts: { total: 0, facebookPages: 0, instagramAccounts: 0 },
      followers: followers(),
    });
    renderApp('/w/acme');

    const card = await followersCard();
    expect(within(card).getByText('Ask a workspace owner or admin for access.')).toBeVisible();
    expect(within(card).queryByRole('link', { name: /Connect accounts/ })).toBeNull();
  });

  it('shows an error with a retry when the totals cannot be loaded', async () => {
    setup({
      accounts: { total: 0, facebookPages: 0, instagramAccounts: 0 },
      summary: () => apiError(500, 'INTERNAL', 'Summary failed'),
    });
    renderApp('/w/acme');

    expect(await screen.findByText('Couldn’t load combined followers')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeVisible();
  });
});
