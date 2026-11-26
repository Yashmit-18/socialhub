import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAccessToken } from '../../lib/api.js';
import { apiError, jsonResponse } from '../../test/fetchMock.js';
import { renderApp } from '../../test/renderApp.jsx';
import {
  ADMIN,
  EDDIE_ID,
  MALLORY_ID,
  MEMBER,
  WORKSPACE_ID,
  adminApi,
  auditEntry,
  auditLog,
  overview,
  userDetail,
  users,
} from './adminFixtures.js';

beforeEach(() => setAccessToken(null));
afterEach(() => vi.unstubAllGlobals());

const noUndefinedRequests = (api) =>
  expect(api.calls.filter((call) => call.url.pathname.includes('undefined'))).toEqual([]);

const adminCalls = (api) => api.calls.filter((call) => call.key.includes('/admin'));

describe('who gets in', () => {
  it('shows the normal not-found page to someone who is not a platform admin', async () => {
    const api = adminApi({ user: MEMBER });
    renderApp('/admin');
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to SocialHub' })).toHaveAttribute('href', '/');
    expect(screen.queryByText('Admin console')).not.toBeInTheDocument();
    expect(adminCalls(api)).toEqual([]);
  });

  it('hides every page below /admin the same way', async () => {
    const api = adminApi({ user: MEMBER });
    renderApp(`/admin/users/${EDDIE_ID}`);
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
    expect(adminCalls(api)).toEqual([]);
  });

  it('shows the overview to a platform admin, inside the admin area of the shell', async () => {
    const api = adminApi();
    renderApp('/admin');
    expect(await screen.findByRole('heading', { name: 'Overview', level: 1 })).toBeInTheDocument();
    const nav = screen.getAllByRole('navigation', { name: 'Admin' })[0];
    for (const page of ['Overview', 'Users', 'Workspaces', 'System status', 'Audit log']) {
      expect(within(nav).getByRole('link', { name: page })).toBeInTheDocument();
    }
    expect(await screen.findByRole('link', { name: 'Back to Acme Social' })).toHaveAttribute(
      'href',
      '/w/acme',
    );
    noUndefinedRequests(api);
  });

  it('works for a platform admin who has no workspace', async () => {
    const api = adminApi({ workspaces: [] });
    renderApp('/admin');
    expect(await screen.findByRole('heading', { name: 'Overview', level: 1 })).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Create a workspace' })).toHaveAttribute(
      'href',
      '/onboarding',
    );
    expect(await screen.findByText('1 account is suspended.')).toBeInTheDocument();
    noUndefinedRequests(api);
  });

  it('shows the not-found page for an admin address that does not exist', async () => {
    adminApi();
    renderApp('/admin/nothing-here');
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  });
});

describe('overview', () => {
  it('shows what needs attention, the platform numbers and the last 14 days', async () => {
    adminApi();
    renderApp('/admin');
    const attention = await screen.findByRole('region', { name: 'Needs attention' });
    expect(
      await within(attention).findByText(
        'No publishing worker is running. Waiting posts are not sent until one starts.',
      ),
    ).toBeInTheDocument();
    expect(within(attention).getByRole('link', { name: /Show them/ })).toHaveAttribute(
      'href',
      '/admin/users?status=DISABLED',
    );

    const numbers = screen.getByRole('region', { name: 'Platform numbers' });
    expect(within(numbers).getByText('Real posts, 7 days')).toBeInTheDocument();
    expect(within(numbers).getByText('14 simulated, 1 failed')).toBeInTheDocument();
    expect(within(numbers).getByText('of 12 accounts')).toBeInTheDocument();

    const chart = screen.getByRole('region', { name: 'Last 14 days' });
    expect(
      within(chart).getByRole('img', {
        name: 'New accounts and real posts per day, last 14 days',
      }),
    ).toBeInTheDocument();
    await userEvent.click(within(chart).getByRole('button', { name: 'Show table' }));
    const table = within(chart).getByRole('table', { name: 'Activity per day' });
    expect(within(table).getAllByRole('row')).toHaveLength(15);
  });

  it('says so when nothing needs attention, and shows an unknown code as it is', async () => {
    adminApi({
      routes: {
        'GET /admin/overview': () => jsonResponse(200, overview({ attention: [] })),
      },
    });
    renderApp('/admin');
    expect(await screen.findByText('Nothing needs your attention right now.')).toBeInTheDocument();
  });

  it('never hides an attention item it does not know', async () => {
    adminApi({
      routes: {
        'GET /admin/overview': () =>
          jsonResponse(
            200,
            overview({ attention: [{ code: 'SOMETHING_NEW', severity: 'warning', count: null }] }),
          ),
      },
    });
    renderApp('/admin');
    expect(await screen.findByText('SOMETHING_NEW')).toBeInTheDocument();
  });

  it('offers to try again when the overview cannot be loaded', async () => {
    adminApi({
      routes: { 'GET /admin/overview': () => apiError(500, 'INTERNAL_ERROR', 'Server error') },
    });
    renderApp('/admin');
    expect(await screen.findByText('Could not load the overview')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});

describe('users', () => {
  it('lists people with their state, and filters by status through the address', async () => {
    const api = adminApi();
    renderApp('/admin/users');
    const table = await screen.findByRole('table', { name: 'Users' });
    expect(within(table).getByRole('link', { name: 'Eddie Editor' })).toHaveAttribute(
      'href',
      `/admin/users/${EDDIE_ID}`,
    );
    expect(within(table).getByText('Suspended')).toBeInTheDocument();
    expect(within(table).getByText('Platform admin')).toBeInTheDocument();
    expect(within(table).getByText('Not recorded')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /^Suspended/ }));
    await waitFor(() =>
      expect(api.calls.some((c) => c.url.searchParams.get('status') === 'DISABLED')).toBe(true),
    );
  });

  it('opens with the filter from a link (the overview links to suspended accounts)', async () => {
    const api = adminApi();
    renderApp('/admin/users?status=DISABLED');
    await screen.findByRole('table', { name: 'Users' });
    const listCall = api.calls.find((c) => c.key === 'GET /admin/users');
    expect(listCall.url.searchParams.get('status')).toBe('DISABLED');
    expect(screen.getByRole('button', { name: /^Suspended/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('says when nobody matches the search', async () => {
    adminApi({ routes: { 'GET /admin/users': () => jsonResponse(200, users([])) } });
    renderApp('/admin/users?q=nobody');
    expect(await screen.findByText('No users match')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeInTheDocument();
  });
});

describe('user detail', () => {
  it('shows the account, what a suspension affects, the workspaces and the history', async () => {
    adminApi();
    renderApp(`/admin/users/${EDDIE_ID}`);
    expect(
      await screen.findByRole('heading', { name: 'Eddie Editor', level: 1 }),
    ).toBeInTheDocument();
    const account = screen.getByRole('region', { name: 'Account' });
    expect(within(account).getByText('Never changed')).toBeInTheDocument();
    expect(within(account).getByText('2 sessions')).toBeInTheDocument();

    const impact = screen.getByRole('region', { name: 'Posts and sessions' });
    expect(
      within(impact).getByText(
        'Northwind Studio: no other admin, so nobody can manage its team or its connected accounts.',
      ),
    ).toBeInTheDocument();

    const workspaces = screen.getByRole('region', { name: 'Workspaces' });
    expect(within(workspaces).getByText('Only owner')).toBeInTheDocument();
    expect(within(workspaces).getByRole('link', { name: 'Northwind Studio' })).toHaveAttribute(
      'href',
      `/admin/workspaces/${WORKSPACE_ID}`,
    );

    const history = screen.getByRole('region', { name: 'Admin history' });
    expect(
      await within(history).findByText('Posted the same link to 40 Pages within one hour.', {
        exact: false,
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Suspend account' })).toBeInTheDocument();
  });

  it('shows who suspended a suspended account and why', async () => {
    adminApi();
    renderApp(`/admin/users/${MALLORY_ID}`);
    const notice = await screen.findByText('This account is suspended.');
    expect(notice.parentElement).toHaveTextContent(
      'Reason: Posted the same link to 40 Pages within one hour.',
    );
    expect(notice.parentElement).toHaveTextContent('by Petra Platform');
    expect(screen.getByRole('button', { name: 'Reactivate account' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Suspend account' })).not.toBeInTheDocument();
  });

  it('offers no suspension for your own account or another platform admin', async () => {
    adminApi({
      routes: {
        [`GET /admin/users/${ADMIN.id}`]: () =>
          jsonResponse(
            200,
            userDetail({
              user: { id: ADMIN.id, name: ADMIN.name, platformRole: 'PLATFORM_ADMIN' },
              actions: { canSuspend: false, canReactivate: false, blockedBy: 'SELF' },
            }),
          ),
        [`GET /admin/users/${EDDIE_ID}`]: () =>
          jsonResponse(
            200,
            userDetail({
              user: { platformRole: 'PLATFORM_ADMIN' },
              actions: {
                canSuspend: false,
                canReactivate: false,
                blockedBy: 'TARGET_IS_PLATFORM_ADMIN',
              },
            }),
          ),
      },
    });
    const { router } = renderApp(`/admin/users/${ADMIN.id}`);
    expect(await screen.findByText('This is your own account.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Suspend account' })).not.toBeInTheDocument();

    await router.navigate(`/admin/users/${EDDIE_ID}`);
    expect(await screen.findByText('This person is a platform admin.')).toBeInTheDocument();
    expect(
      screen.getByText('npm run admin:revoke -w @socialhub/api -- eddie@example.com'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Suspend account' })).not.toBeInTheDocument();
  });

  it('says when the person does not exist', async () => {
    adminApi({
      routes: {
        [`GET /admin/users/${EDDIE_ID}`]: () => apiError(404, 'NOT_FOUND', 'User not found'),
      },
    });
    renderApp(`/admin/users/${EDDIE_ID}`);
    expect(await screen.findByText('User not found')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'All users' })).toBeInTheDocument();
  });
});

describe('workspaces', () => {
  it('lists workspaces with their owner and publishing mode', async () => {
    adminApi();
    renderApp('/admin/workspaces');
    const table = await screen.findByRole('table', { name: 'Workspaces' });
    expect(within(table).getByRole('link', { name: 'Northwind Studio' })).toHaveAttribute(
      'href',
      `/admin/workspaces/${WORKSPACE_ID}`,
    );
    expect(within(table).getByText('Real publishing')).toBeInTheDocument();
    expect(within(table).getByText('Simulation')).toBeInTheDocument();
    // The owner of Harbour Cafe is suspended.
    expect(within(table).getByText('Suspended')).toBeInTheDocument();
  });

  it('shows a workspace as names, people and counts only', async () => {
    adminApi();
    renderApp(`/admin/workspaces/${WORKSPACE_ID}`);
    expect(
      await screen.findByRole('heading', { name: 'Northwind Studio', level: 1 }),
    ).toBeInTheDocument();
    const numbers = screen.getByRole('region', { name: 'Workspace numbers' });
    expect(within(numbers).getByText('46 MB stored')).toBeInTheDocument();
    expect(within(numbers).getByText('2 failed, 4 cancelled')).toBeInTheDocument();
    expect(within(numbers).getByText('1 invitation pending')).toBeInTheDocument();
    const facts = screen.getByRole('region', { name: 'Workspace' });
    expect(within(facts).getByText('Nothing recorded yet')).toBeInTheDocument();
    expect(within(facts).getByText('Asia/Kolkata')).toBeInTheDocument();
    const members = screen.getByRole('table', { name: 'Members of this workspace' });
    expect(within(members).getAllByRole('row')).toHaveLength(3);
  });
});

describe('system status', () => {
  it('shows each part in words, and Unknown where the server could not tell', async () => {
    adminApi();
    renderApp('/admin/system');
    const glance = await screen.findByRole('region', { name: 'At a glance' });
    expect(within(glance).getByText('Connected')).toBeInTheDocument();
    expect(within(glance).getByText('Running')).toBeInTheDocument();
    expect(within(glance).getByText('Not set up')).toBeInTheDocument();

    const publishing = screen.getByRole('region', { name: 'Publishing' });
    expect(
      within(publishing).getByText('0 waiting, 0 active, 4 scheduled for later'),
    ).toBeInTheDocument();
    expect(within(publishing).getByText('No post has finished yet')).toBeInTheDocument();

    const analytics = screen.getByRole('region', { name: 'Analytics' });
    expect(within(analytics).getByText('Unknown')).toBeInTheDocument();
    expect(
      within(analytics).getByText('The queue could not say whether a worker is connected.'),
    ).toBeInTheDocument();
  });
});

describe('audit log', () => {
  it('lists what platform admins did, with reasons, and filters by action', async () => {
    const api = adminApi();
    renderApp('/admin/audit');
    expect(
      await screen.findByText('Posted the same link to 40 Pages within one hour.', {
        exact: false,
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Eddie Editor' })).toHaveAttribute(
      'href',
      `/admin/users/${EDDIE_ID}`,
    );
    expect(screen.getByText('Command line')).toBeInTheDocument();

    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Filter by action' }),
      'platform.user_reactivated',
    );
    await waitFor(() =>
      expect(
        api.calls.some((c) => c.url.searchParams.get('action') === 'platform.user_reactivated'),
      ).toBe(true),
    );
  });

  it('loads older entries with the cursor', async () => {
    const api = adminApi({
      routes: {
        'GET /admin/audit-log': ({ url }) =>
          jsonResponse(
            200,
            url.searchParams.get('cursor')
              ? auditLog([auditEntry({ id: '6665a0019b1d4a0012ab8000' })])
              : auditLog(undefined, '6665a0019b1d4a0012ab9000'),
          ),
      },
    });
    renderApp('/admin/audit');
    await userEvent.click(await screen.findByRole('button', { name: 'Load more' }));
    await waitFor(() =>
      expect(
        api.calls.some((c) => c.url.searchParams.get('cursor') === '6665a0019b1d4a0012ab9000'),
      ).toBe(true),
    );
  });
});
