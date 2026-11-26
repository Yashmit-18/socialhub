import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LayoutDashboard, ShieldCheck, Users } from 'lucide-react';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../../context/AuthContext.jsx';
import { setAccessToken } from '../../lib/api.js';
import { jsonResponse, mockFetch } from '../../test/fetchMock.js';
import { renderApp } from '../../test/renderApp.jsx';
import { AppShell, PageHeader } from './AppShell.jsx';

const ada = { id: 'u1', name: 'Ada Lovelace', email: 'ada@example.com' };
const operator = { ...ada, platformRole: 'PLATFORM_ADMIN' };

const workspace = (role) => ({
  id: 'w1',
  name: 'Acme Social',
  slug: 'acme',
  timezone: 'UTC',
  membership: { id: 'm1', role, permissions: [], accountAccess: { mode: 'ALL' } },
});

function signedIn(user, workspaces = [workspace('OWNER')]) {
  return mockFetch({
    'POST /auth/refresh': () => jsonResponse(200, { user, accessToken: 'access' }),
    'GET /workspaces': () => jsonResponse(200, { items: workspaces }),
    'GET /workspaces/w1/overview': () => jsonResponse(200, {}),
    'GET /workspaces/w1/sharing-tasks': () =>
      jsonResponse(200, { items: [], total: 0, counts: { open: 0, done: 0, skipped: 0 } }),
  });
}

const sidebar = () => screen.getAllByRole('navigation', { name: /^(Workspace|Admin)$/ })[0];

const AREA = {
  id: 'admin',
  label: 'Admin',
  description: 'Operator console',
  icon: ShieldCheck,
  tone: 'from-fuchsia-500 to-purple-600',
  back: { to: '/w/acme', label: 'Back to Acme Social' },
  sections: [
    {
      id: 'admin-main',
      label: null,
      items: [
        { to: '/admin', label: 'Overview', icon: LayoutDashboard, tone: 'x', end: true },
        { to: '/admin/users', label: 'Users', icon: Users, tone: 'from-sky-500 to-cyan-600' },
      ],
    },
  ],
};

function renderArea(path) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const page = (
    <AppShell area={AREA}>
      <PageHeader title="Users" />
    </AppShell>
  );
  const router = createMemoryRouter(
    [
      { path: '/admin', element: page },
      { path: '/admin/users', element: page },
    ],
    { initialEntries: [path] },
  );
  render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>,
  );
  return router;
}

beforeEach(() => setAccessToken(null));
afterEach(() => vi.unstubAllGlobals());

describe('AppShell outside a workspace route', () => {
  it('keeps the role-gated pages in the sidebar on Account settings', async () => {
    signedIn(ada);
    renderApp('/account');
    expect(await screen.findByRole('heading', { name: 'Account settings' })).toBeInTheDocument();
    const nav = await waitFor(() => {
      const found = sidebar();
      expect(within(found).getByRole('link', { name: 'Create post' })).toBeInTheDocument();
      return found;
    });
    expect(within(nav).getByRole('link', { name: 'Analytics' })).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Activity' })).toBeInTheDocument();
  });

  it('shows a viewer only the pages a viewer may open there', async () => {
    signedIn(ada, [workspace('VIEWER')]);
    renderApp('/account');
    await screen.findByRole('heading', { name: 'Account settings' });
    const nav = await waitFor(() => {
      const found = sidebar();
      expect(within(found).getByRole('link', { name: 'Team' })).toBeInTheDocument();
      return found;
    });
    expect(within(nav).queryByRole('link', { name: 'Create post' })).not.toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: 'Activity' })).not.toBeInTheDocument();
  });
});

describe('the operator console entry', () => {
  it('is listed for a platform admin, in the sidebar and the palette', async () => {
    signedIn(operator);
    renderApp('/w/acme/team');
    const link = await screen.findByRole('link', { name: 'Admin console' });
    expect(link).toHaveAttribute('href', '/admin');
    await userEvent.keyboard('{Control>}k{/Control}');
    const palette = await screen.findByRole('dialog', { name: 'Search and jump to' });
    expect(within(palette).getByText('Admin console')).toBeInTheDocument();
  });

  it('does not exist for anyone else', async () => {
    signedIn(ada);
    renderApp('/w/acme/team');
    await screen.findByRole('link', { name: 'Team' });
    expect(screen.queryByRole('link', { name: 'Admin console' })).not.toBeInTheDocument();
    expect(screen.queryByText('Operator')).not.toBeInTheDocument();
  });

  it('is where a platform admin without a workspace lands', async () => {
    signedIn(operator, []);
    const { router } = renderApp('/');
    await waitFor(() => expect(router.state.location.pathname).toBe('/admin'));
  });

  it('is not where anyone else without a workspace lands', async () => {
    signedIn(ada, []);
    const { router } = renderApp('/');
    await waitFor(() => expect(router.state.location.pathname).toBe('/onboarding'));
  });
});

describe('AppShell with an area', () => {
  it('lists the area pages instead of a workspace and offers the way back', async () => {
    signedIn(operator);
    renderArea('/admin/users');
    const nav = await screen.findByRole('navigation', { name: 'Admin' });
    expect(within(nav).getByRole('link', { name: 'Users' })).toHaveAttribute(
      'href',
      '/admin/users',
    );
    expect(screen.getByRole('link', { name: 'Back to Acme Social' })).toHaveAttribute(
      'href',
      '/w/acme',
    );
    expect(screen.queryByRole('navigation', { name: 'Workspace' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'New post' })).not.toBeInTheDocument();
    expect(screen.queryByText('Choose a workspace')).not.toBeInTheDocument();
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(crumbs).getByText('Admin')).toBeInTheDocument();
    expect(within(crumbs).getByText('Users')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('heading', { level: 1, name: 'Users' })).toBeInTheDocument();
  });

  it('asks for nothing that belongs to a workspace', async () => {
    const mock = signedIn(operator);
    renderArea('/admin');
    await screen.findByRole('navigation', { name: 'Admin' });
    await userEvent.keyboard('{Control>}k{/Control}');
    const palette = await screen.findByRole('dialog', { name: 'Search and jump to' });
    expect(within(palette).getByText('Users')).toBeInTheDocument();
    // The user's workspaces stay reachable from the palette.
    expect(await within(palette).findByText('Acme Social')).toBeInTheDocument();
    const paths = mock.calls.map((call) => call.key);
    expect(paths.some((key) => key.includes('undefined'))).toBe(false);
    expect(paths.some((key) => key.includes('sharing-tasks'))).toBe(false);
  });
});
