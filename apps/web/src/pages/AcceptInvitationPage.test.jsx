// Accept invitation: the SocialHub API is mocked with fetch; no Meta API is involved.
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAccessToken } from '../lib/api.js';
import { apiError, jsonResponse, mockFetch } from '../test/fetchMock.js';
import { renderApp } from '../test/renderApp.jsx';

const TOKEN = 'tok123';
const PREVIEW = `GET /invitations/${TOKEN}`;
const ACCEPT = `POST /invitations/${TOKEN}/accept`;

const invitation = (overrides = {}) => ({
  email: 'sam@example.com',
  role: 'EDITOR',
  status: 'PENDING',
  workspace: { name: 'Acme Social' },
  invitedBy: { name: 'Ada Lovelace' },
  expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
  ...overrides,
});

const workspace = {
  id: 'w1',
  name: 'Acme Social',
  slug: 'acme',
  timezone: 'UTC',
  membership: {
    id: 'm1',
    role: 'EDITOR',
    permissions: [],
    accountAccess: { mode: 'ALL', socialAccountIds: [] },
  },
};

function setup({
  me = null,
  preview = () => jsonResponse(200, { invitation: invitation() }),
} = {}) {
  return mockFetch({
    'POST /auth/refresh': () =>
      me
        ? jsonResponse(200, { user: me, accessToken: 'access' })
        : apiError(401, 'UNAUTHENTICATED'),
    'POST /auth/logout': () => jsonResponse(204),
    [PREVIEW]: preview,
    [ACCEPT]: () => jsonResponse(200, { workspace }),
    'GET /workspaces': () => jsonResponse(200, { items: [workspace] }),
  });
}

beforeEach(() => {
  setAccessToken(null);
  vi.clearAllMocks();
});
afterEach(() => vi.unstubAllGlobals());

describe('Accept invitation', () => {
  it('explains an invalid link', async () => {
    setup({ preview: () => apiError(404, 'NOT_FOUND') });
    renderApp(`/invite/${TOKEN}`);

    expect(
      await screen.findByRole('heading', { name: 'This invitation link is not valid' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to SocialHub' })).toHaveAttribute('href', '/');
  });

  it('tells a guest how to accept, without an error', async () => {
    setup();
    renderApp(`/invite/${TOKEN}`);

    expect(await screen.findByRole('heading', { name: 'Join Acme Social' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Create account to accept' })).toHaveAttribute(
      'href',
      expect.stringMatching(/^\/register\?redirect=%2Finvite%2Ftok123&email=sam%40example\.com$/),
    );
    expect(screen.getByRole('link', { name: 'I already have an account' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('says calmly that an invitation is no longer pending', async () => {
    setup({ preview: () => jsonResponse(200, { invitation: invitation({ status: 'EXPIRED' }) }) });
    renderApp(`/invite/${TOKEN}`);

    expect(await screen.findByRole('heading', { name: 'Join Acme Social' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      'This invitation is expired. Ask for a new one.',
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Create account to accept' })).toBeNull();
  });

  it('accepts for the invited person and opens the workspace', async () => {
    const mock = setup({ me: { id: 'u2', name: 'Sam Smith', email: 'sam@example.com' } });
    const { router } = renderApp(`/invite/${TOKEN}`);

    await userEvent.click(await screen.findByRole('button', { name: 'Accept and join as Editor' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/w/acme'));
    expect(mock.count(ACCEPT)).toBe(1);
  });

  it('asks someone signed in with another email to switch accounts', async () => {
    setup({ me: { id: 'u3', name: 'Other', email: 'other@example.com' } });
    renderApp(`/invite/${TOKEN}`);

    expect(await screen.findByRole('heading', { name: 'Join Acme Social' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      "You're signed in as other@example.com, but this invitation is for sam@example.com.",
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in with sam@example.com' })).toBeVisible();
  });
});
