import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { apiError, jsonResponse, mockFetch } from '../../test/fetchMock.js';
import { renderApp } from '../../test/renderApp.jsx';
import { legalNavigation } from './legalNavigation.js';
import { LEGAL_LINKS } from './legalLinks.js';

const user = { id: 'u1', name: 'Ada Lovelace', email: 'ada@example.com' };
const guest = () => mockFetch({ 'POST /auth/refresh': () => apiError(401, 'UNAUTHENTICATED') });
const signedIn = () =>
  mockFetch({
    'POST /auth/refresh': () => jsonResponse(200, { user, accessToken: 'access' }),
    'GET /workspaces': () => jsonResponse(200, { items: [] }),
  });

describe('public legal routes', () => {
  for (const { alias, path, title } of LEGAL_LINKS) {
    it(`${alias} forwards a signed-out visitor to ${path}`, async () => {
      guest();
      const replace = vi.spyOn(legalNavigation, 'replace').mockImplementation(() => {});
      const { router } = renderApp(alias);
      await waitFor(() => expect(replace).toHaveBeenCalledWith(path));
      // Never bounced to the sign-in page.
      expect(router.state.location.pathname).toBe(alias);
      expect(screen.getByRole('link', { name: title })).toHaveAttribute('href', path);
    });
  }

  it('also forwards signed-in users (no workspace redirect, no auth guard)', async () => {
    signedIn();
    const replace = vi.spyOn(legalNavigation, 'replace').mockImplementation(() => {});
    const { router } = renderApp('/privacy');
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/privacy.html'));
    expect(router.state.location.pathname).toBe('/privacy');
  });

  it('links the legal pages from the sign-in page', async () => {
    guest();
    renderApp('/login');
    const nav = await screen.findByRole('navigation', { name: 'Legal' }, { timeout: 5000 });
    for (const { path, title } of LEGAL_LINKS) {
      expect(screen.getByRole('link', { name: title })).toHaveAttribute('href', path);
    }
    expect(nav).toBeInTheDocument();
  });
});
