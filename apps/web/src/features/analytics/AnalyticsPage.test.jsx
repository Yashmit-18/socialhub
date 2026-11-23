// Analytics screen tests. MOCKED FRONTEND TESTS: the SocialHub API is mocked with fetch;
// nothing here talks to a real server, to Redis or to Meta. The API side is tested in
// apps/api/test/analytics*.test.js.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceProvider } from '../../context/WorkspaceContext.jsx';
import { setAccessToken } from '../../lib/api.js';
import { apiError, jsonResponse, mockFetch } from '../../test/fetchMock.js';
import AnalyticsPage from './AnalyticsPage.jsx';
import {
  BASE,
  accounts,
  overview,
  post,
  status,
  syncStatus,
  topPosts,
  trends,
  workspace,
} from './fixtures.js';

vi.setConfig({ testTimeout: 30_000 });
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

const OVERVIEW = `GET ${BASE}/overview`;
const TRENDS = `GET ${BASE}/trends`;

function setup({
  role = 'OWNER',
  path = '/w/acme/analytics',
  routes = {},
  analytics = status(),
  timezone = 'UTC',
} = {}) {
  const mock = mockFetch({
    [OVERVIEW]: () => jsonResponse(200, overview({ analytics })),
    [TRENDS]: () => jsonResponse(200, trends()),
    [`GET ${BASE}/accounts`]: () => jsonResponse(200, accounts()),
    [`GET ${BASE}/top-posts`]: () => jsonResponse(200, topPosts([post()])),
    [`GET ${BASE}/sync-status`]: () => jsonResponse(200, syncStatus(analytics)),
    ...routes,
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(
    [
      {
        path: '/w/:slug/analytics',
        element: (
          <WorkspaceProvider workspace={workspace(role, timezone)}>
            <AnalyticsPage />
          </WorkspaceProvider>
        ),
      },
    ],
    { initialEntries: [path] },
  );
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { mock, router };
}

const lastQuery = (mock, key) => mock.calls.filter((c) => c.key === key).at(-1)?.url.searchParams;

beforeEach(() => {
  setAccessToken('test-token');
  vi.clearAllMocks();
});
afterEach(() => vi.unstubAllGlobals());

describe('loading and states', () => {
  it('shows skeletons, then SocialHub publishing figures labelled as simulated', async () => {
    setup();
    const section = await screen.findByRole('region', { name: 'Publishing performance' });
    expect(await within(section).findByText('Simulated publishing')).toBeInTheDocument();
    expect(within(section).getByText('Simulated: nothing was posted to Meta')).toBeInTheDocument();
    expect(within(section).getByText('75%')).toBeInTheDocument();
    expect(within(section).getByText('2.7 s')).toBeInTheDocument();
  });

  it('shows unreported metrics as Unavailable, never 0, with who reported the rest', async () => {
    setup();
    const section = await screen.findByRole('region', { name: 'Audience and engagement' });
    // The tile's label (the chart's metric switch also says "Engagement").
    const engagement = (await within(section).findAllByText('Engagement')).find(
      (el) => el.tagName === 'P',
    );
    expect(engagement.parentElement).toHaveTextContent('Unavailable');
    expect(engagement.parentElement).not.toHaveTextContent(/\b0\b/);
    expect(
      within(section).getByText(/Daily reach, added up\. 2 of 3 accounts reported this/),
    ).toBeInTheDocument();
    expect(within(section).getByText('+10')).toBeInTheDocument();
  });

  it('explains when Meta insights are not switched on, and shows the empty state', async () => {
    setup({
      routes: { [OVERVIEW]: () => jsonResponse(200, overview({ hasData: false })) },
    });
    expect(
      await screen.findByText(/reading insights from Meta is not switched on/),
    ).toBeInTheDocument();
    expect(await screen.findByText('No insights for this range')).toBeInTheDocument();
  });

  it('points to the demo data when the server only makes demo insights', async () => {
    const analytics = status({
      mode: 'SIMULATED',
      source: 'SIMULATED',
      canSync: true,
      reason: null,
      message: null,
      queue: { status: 'READY' },
    });
    setup({
      analytics,
      routes: { [OVERVIEW]: () => jsonResponse(200, overview({ hasData: false, analytics })) },
    });
    expect(
      await screen.findByText(/choose "Demo data \(made up\)" under Insights/),
    ).toBeInTheDocument();
  });

  it('shows an error with a retry', async () => {
    let fail = true;
    setup({
      routes: {
        [OVERVIEW]: () =>
          fail
            ? apiError(500, 'INTERNAL_ERROR', 'Analytics are temporarily unavailable')
            : jsonResponse(200, overview()),
      },
    });
    expect(await screen.findByText('Analytics are temporarily unavailable')).toBeInTheDocument();
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(
      await screen.findByRole('region', { name: 'Publishing performance' }),
    ).toBeInTheDocument();
  });

  it('tells members without access that analytics are restricted', async () => {
    // A role without analytics:read does not exist today; a made-up role stands in for it.
    setup({ role: 'NOBODY' });
    expect(await screen.findByText('Analytics are restricted')).toBeInTheDocument();
  });
});

describe('filters', () => {
  it('asks for the last 30 days by default and for the chosen preset after a click', async () => {
    const { mock, router } = setup();
    await screen.findByRole('region', { name: 'Publishing performance' });
    const first = lastQuery(mock, OVERVIEW);
    const days = (q) =>
      (Date.parse(q.get('endDate')) - Date.parse(q.get('startDate'))) / 86_400_000 + 1;
    expect(days(first)).toBe(30);
    await userEvent.click(screen.getByRole('button', { name: 'Last 7 days' }));
    await waitFor(() => expect(days(lastQuery(mock, OVERVIEW))).toBe(7));
    expect(router.state.location.search).toBe('?range=7d');
  });

  it('refuses a custom range that ends before it starts, without asking the API', async () => {
    const { mock } = setup({
      path: '/w/acme/analytics?range=custom&from=2026-11-10&to=2026-11-01',
    });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The end date is before the start date.',
    );
    expect(mock.count(OVERVIEW)).toBe(0);
  });

  it('sends platform, account and source filters', async () => {
    const { mock } = setup();
    await screen.findByRole('region', { name: 'Publishing performance' });
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Platform' }),
      'INSTAGRAM_ACCOUNT',
    );
    await waitFor(() =>
      expect(lastQuery(mock, OVERVIEW).get('platform')).toBe('INSTAGRAM_ACCOUNT'),
    );
    // Only Instagram accounts are offered now.
    const account = screen.getByRole('combobox', { name: 'Account' });
    expect(within(account).queryByRole('option', { name: 'Acme Store' })).toBeNull();
    await userEvent.selectOptions(account, 'b'.repeat(24));
    await waitFor(() => expect(lastQuery(mock, OVERVIEW).get('accountId')).toBe('b'.repeat(24)));
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Insights' }), 'SIMULATED');
    await waitFor(() => expect(lastQuery(mock, OVERVIEW).get('source')).toBe('SIMULATED'));
    expect(await screen.findByText(/DEMO DATA\./)).toBeInTheDocument();
  });
});

describe('charts', () => {
  it('draws the chosen metric with gaps, and offers the numbers as a table', async () => {
    setup();
    const section = await screen.findByRole('region', { name: 'Audience and engagement' });
    expect(
      await within(section).findByRole('img', { name: 'Reach: 2 of 3 days reported' }),
    ).toBeInTheDocument();
    await userEvent.click(within(section).getByRole('button', { name: 'Views' }));
    expect(
      within(section).getByRole('img', { name: 'Views: 2 of 3 days reported' }),
    ).toBeInTheDocument();
    await userEvent.click(within(section).getByRole('button', { name: 'Show table' }));
    const table = within(section).getByRole('table', { name: 'Views per day' });
    expect(within(table).getAllByText('Unavailable')).toHaveLength(1);
    // Engagement was never reported: nothing to draw, and it says so.
    await userEvent.click(within(section).getByRole('button', { name: 'Engagement' }));
    expect(within(section).getByText(/was not reported for any day/)).toBeInTheDocument();
  });

  it('draws publishing results per day with a legend', async () => {
    setup();
    const section = await screen.findByRole('region', { name: 'Publishing performance' });
    expect(
      await within(section).findByRole('img', { name: 'Simulated publishing results per day' }),
    ).toBeInTheDocument();
    const legend = within(section).getByRole('list', { name: 'Legend' });
    expect(legend).toHaveTextContent('Published');
    expect(legend).toHaveTextContent('Failed');
  });
});

describe('accounts and posts', () => {
  it('compares accounts, with unavailable cells', async () => {
    setup();
    const section = await screen.findByRole('region', { name: 'Accounts' });
    const rows = await within(section).findAllByRole('row');
    expect(rows).toHaveLength(3);
    expect(rows[2]).toHaveTextContent('Acme Instagram');
    expect(within(rows[2]).getAllByText('Unavailable').length).toBeGreaterThan(0);
    expect(rows[1]).toHaveTextContent('Never synced');
    // Publishing is shown per mode and labelled; simulated deliveries are never summed with live.
    expect(rows[2]).toHaveTextContent('Simulated1 published · 1 failed · 50%');
    expect(rows[2]).not.toHaveTextContent(/Live/);
  });

  it('keeps simulated and live publishing on separate lines for one account', async () => {
    const both = accounts();
    const live = {
      ...both.items[0].publishing[0],
      mode: 'LIVE',
      simulated: false,
      total: 3,
      byState: { ...both.items[0].publishing[0].byState, PUBLISHED: 3, FAILED: 0 },
      successRate: 100,
    };
    both.items[0].publishing = [live, both.items[0].publishing[0]];
    setup({ routes: { [`GET ${BASE}/accounts`]: () => jsonResponse(200, both) } });
    const section = await screen.findByRole('region', { name: 'Accounts' });
    const rows = await within(section).findAllByRole('row');
    const lines = within(rows[1]).getAllByRole('listitem');
    expect(lines.map((li) => li.textContent)).toEqual([
      'Live3 published · 0 failed · 100%',
      'Simulated2 published · 0 failed · 100%',
    ]);
    // 5 would mean the two had been added together.
    expect(rows[1]).not.toHaveTextContent(/\b5 published/);
  });

  it('ranks top posts with their metrics and an official link only', async () => {
    setup({
      routes: {
        [`GET ${BASE}/top-posts`]: () =>
          jsonResponse(
            200,
            topPosts([
              post(),
              post({ id: 'q'.repeat(24), url: 'javascript:alert(1)', simulated: true }),
            ]),
          ),
      },
    });
    const section = await screen.findByRole('region', { name: 'Top posts' });
    const items = await within(section).findAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Engagement rate10%');
    expect(within(items[0]).getByRole('link', { name: /View post/ })).toHaveAttribute(
      'href',
      'https://www.facebook.com/123_456',
    );
    expect(within(items[1]).queryByRole('link')).toBeNull();
    expect(items[1]).toHaveTextContent('Simulated');
  });

  it("dates posts in the workspace's time zone", async () => {
    // 22:30 UTC on 2 November is already 3 November in India.
    setup({
      timezone: 'Asia/Kolkata',
      routes: {
        [`GET ${BASE}/top-posts`]: () =>
          jsonResponse(200, topPosts([post({ publishedAt: '2026-11-02T22:30:00.000Z' })])),
      },
    });
    const section = await screen.findByRole('region', { name: 'Top posts' });
    const [item] = await within(section).findAllByRole('listitem');
    const expected = new Intl.DateTimeFormat(undefined, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'Asia/Kolkata',
    }).format(new Date('2026-11-02T22:30:00.000Z'));
    expect(item).toHaveTextContent(expected);
    expect(expected).toMatch(/3/);
  });
});

describe('sync', () => {
  it('is offered but disabled, with the reason, while the server cannot sync', async () => {
    setup();
    const button = await screen.findByRole('button', { name: /Sync insights/ });
    await waitFor(() => expect(button).toBeDisabled());
    expect(button).toHaveAccessibleDescription(/not read from Meta on this server yet/);
  });

  it('starts a demo sync and says it is demo data', async () => {
    const analytics = status({
      mode: 'SIMULATED',
      source: 'SIMULATED',
      canSync: true,
      reason: null,
      message: null,
      queue: { status: 'READY' },
    });
    const { mock } = setup({
      analytics,
      routes: {
        [`POST ${BASE}/sync`]: () =>
          jsonResponse(202, {
            source: 'SIMULATED',
            simulated: true,
            queued: [{ id: 'r1' }, { id: 'r2' }],
            alreadyRunning: [],
            skipped: [],
          }),
      },
    });
    const button = await screen.findByRole('button', { name: /Make demo insights/ });
    await waitFor(() => expect(button).toBeEnabled());
    await userEvent.click(button);
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith('Demo sync started for 2 accounts', {
        description: 'Demo data only: nothing is read from Meta.',
      }),
    );
    expect(mock.count(`POST ${BASE}/sync`)).toBe(1);
  });

  it('is not offered to viewers', async () => {
    setup({ role: 'VIEWER' });
    await screen.findByRole('region', { name: 'Publishing performance' });
    expect(screen.queryByRole('button', { name: /Sync insights|Make demo insights/ })).toBeNull();
  });
});
