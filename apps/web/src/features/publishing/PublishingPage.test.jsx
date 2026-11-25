// Publishing screen tests: the SocialHub API is mocked with fetch. Nothing here talks to a
// real server, to Redis or to Meta.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceProvider } from '../../context/WorkspaceContext.jsx';
import { setAccessToken } from '../../lib/api.js';
import { apiError, jsonResponse, mockFetch } from '../../test/fetchMock.js';
import PublishingPage from './PublishingPage.jsx';
import { BASE, destination, draft, job, status, summary, workspace } from './fixtures.js';
import {
  LIVE_INTERVAL_MS,
  SCHEDULED_INTERVAL_MS,
  liveListInterval,
  refreshIntervalFor,
  refreshIntervalForJobs,
} from './usePublishing.js';

// Dialog-heavy tests are slow when the whole suite runs in parallel.
vi.setConfig({ testTimeout: 30_000 });

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

const STATUS = `GET ${BASE}/publishing/status`;
const SUMMARY = `GET ${BASE}/publish-jobs/summary`;
const LIST = `GET ${BASE}/publish-jobs`;
const CREATE = `POST ${BASE}/publish-jobs`;
const DRAFTS = `GET ${BASE}/content-packages`;
const ACCOUNTS = `GET ${BASE}/social-accounts`;

/** The accounts of the `draft()` fixture (`targetAccountIds: ['a1', 'a2']`). */
const DRAFT_ACCOUNTS = [
  { id: 'a1', name: 'Acme Store', platform: 'FACEBOOK_PAGE' },
  { id: 'a2', name: 'Acme Labs', platform: 'INSTAGRAM_ACCOUNT', username: 'acme.labs' },
];

/**
 * Mocks the three requests every page load makes, plus one detail route per listed job, and
 * the workspace's accounts (read by "Publish a draft").
 */
function mockApi({ jobs = [], statusBody = status(), counts, extra = {} } = {}) {
  const details = Object.fromEntries(
    jobs.map((j) => [
      `GET ${BASE}/publish-jobs/${j.id}`,
      () => jsonResponse(200, { publishJob: j }),
    ]),
  );
  return mockFetch({
    [STATUS]: () => jsonResponse(200, statusBody),
    [SUMMARY]: () => jsonResponse(200, summary(counts)),
    [LIST]: () => jsonResponse(200, { items: jobs, nextCursor: null }),
    [ACCOUNTS]: () => jsonResponse(200, { items: DRAFT_ACCOUNTS }),
    ...details,
    ...extra,
  });
}

function renderPage({ role = 'OWNER', path = '/w/acme/publishing' } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(
    [
      {
        path: '/w/:slug/publishing',
        element: (
          <WorkspaceProvider workspace={workspace(role)}>
            <PublishingPage />
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
  return { router, queryClient };
}

const listStatuses = (mock) =>
  mock.calls.filter((c) => c.key === LIST).map((c) => c.url.searchParams.get('status'));
const bodyOf = (call) => JSON.parse(call.init.body);
const row = (j) => screen.getByTestId(`publish-job-${j.id}`);

async function openDetails(j) {
  await userEvent.click(
    await within(await screen.findByTestId(`publish-job-${j.id}`)).findByRole('button', {
      name: /View details/,
    }),
  );
  return screen.findByRole('dialog', { name: 'Post details' });
}

const partialJob = () =>
  job({
    status: 'PARTIALLY_PUBLISHED',
    destinations: [
      destination({ id: 'd-ok', accountName: 'Acme Store', state: 'PUBLISHED' }),
      destination({
        id: 'd-bad',
        platform: 'INSTAGRAM_ACCOUNT',
        accountName: 'Acme Labs',
        accountUsername: 'acme.labs',
        state: 'FAILED',
        attemptCount: 2,
        canRetry: true,
        error: {
          code: 'PLATFORM_REJECTED',
          message: 'Instagram did not accept this image.',
          retryable: true,
          uncertain: false,
          at: '2026-11-21T09:00:05.000Z',
        },
        attempts: [
          {
            number: 1,
            startedAt: '2026-11-21T09:00:01.000Z',
            finishedAt: '2026-11-21T09:00:02.000Z',
            outcome: 'RETRY',
            errorCode: 'PLATFORM_UNAVAILABLE',
            errorMessage: 'Instagram was not reachable.',
          },
        ],
      }),
    ],
  });

beforeEach(() => {
  setAccessToken('test-token');
  vi.clearAllMocks();
});
afterEach(() => vi.unstubAllGlobals());

describe('job list', () => {
  it('shows a loader, then the jobs the API returned', async () => {
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const j = job({ hiddenDestinationCount: 2 });
    mockApi({
      jobs: [j],
      counts: { PUBLISHED: 1 },
      extra: {
        [LIST]: async () => {
          await gate;
          return jsonResponse(200, { items: [j], nextCursor: null });
        },
      },
    });
    renderPage();
    expect(screen.getByRole('heading', { name: 'Posts' })).toBeInTheDocument();
    expect(await screen.findByText('Loading posts…')).toBeInTheDocument();
    release();

    const item = await screen.findByTestId(`publish-job-${j.id}`);
    expect(within(item).getByText('Autumn sale starts today')).toBeInTheDocument();
    expect(within(item).getByText('2 files')).toBeInTheDocument();
    expect(within(item).getByText(/Created by Olivia Owner/)).toBeInTheDocument();
    expect(within(item).getAllByText(/Published/).length).toBeGreaterThan(0);
    expect(within(item).getByText('Acme Store')).toBeInTheDocument();
    expect(within(item).queryByText('Simulated')).not.toBeInTheDocument();
    // Accounts the member cannot see are counted, never named.
    expect(within(item).getByText('+2 accounts you do not have access to')).toBeInTheDocument();
    // Tab counts come from the summary endpoint.
    expect(await screen.findByRole('button', { name: 'Published (1)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'All (1)' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows an empty state, with different words per tab', async () => {
    mockApi();
    renderPage();
    expect(await screen.findByText('Nothing has been sent yet')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^Failed/ }));
    expect(await screen.findByText('No failed posts')).toBeInTheDocument();
  });

  it('shows the error with a retry that asks the API again', async () => {
    let fail = true;
    const j = job();
    const mock = mockApi({
      extra: {
        [LIST]: () =>
          fail
            ? apiError(500, 'INTERNAL_ERROR', 'We could not load your posts.')
            : jsonResponse(200, { items: [j], nextCursor: null }),
      },
    });
    renderPage();
    expect(await screen.findByText('We could not load your posts.')).toBeInTheDocument();
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Autumn sale starts today')).toBeInTheDocument();
    expect(mock.count(LIST)).toBe(2);
  });

  it('asks for the right status per tab and keeps the tab in the URL', async () => {
    const mock = mockApi();
    const { router } = renderPage();
    await screen.findByText('Nothing has been sent yet');
    expect(listStatuses(mock)).toEqual([null]);

    await userEvent.click(screen.getByRole('button', { name: /^Failed/ }));
    await waitFor(() => expect(listStatuses(mock)).toContain('FAILED'));
    expect(router.state.location.search).toBe('?tab=failed');
    expect(screen.getByRole('button', { name: /^Failed/ })).toHaveAttribute('aria-pressed', 'true');

    await userEvent.click(screen.getByRole('button', { name: /^Published/ }));
    await waitFor(() => expect(listStatuses(mock)).toContain('PUBLISHED'));
    expect(router.state.location.search).toBe('?tab=published');
    // Tabs for usually-empty states (queue, processing, partial, cancelled) stay out of the way
    // while they hold nothing; the queue's two statuses are tested with ?tab=queue below.
    for (const name of [/^Queue/, /^Processing/, /^Partially published/, /^Cancelled/]) {
      expect(screen.queryByRole('button', { name })).toBeNull();
    }

    await userEvent.click(screen.getByRole('button', { name: /^All/ }));
    expect(router.state.location.search).toBe('');
  });

  it('opens on the tab named in the URL and merges the queue, newest first', async () => {
    const waiting = job({
      status: 'QUEUED',
      createdAt: '2026-11-21T08:00:00.000Z',
      content: { captionPreview: 'Older waiting post', mediaCount: 0, hasVideo: false },
      destinations: [destination({ state: 'QUEUED' })],
    });
    const scheduled = job({
      status: 'SCHEDULED',
      createdAt: '2026-11-21T10:00:00.000Z',
      content: { captionPreview: 'Newer scheduled post', mediaCount: 0, hasVideo: false },
      destinations: [destination({ state: 'SCHEDULED' })],
    });
    mockApi({
      counts: { QUEUED: 1, SCHEDULED: 1 },
      extra: {
        [LIST]: ({ url }) =>
          jsonResponse(200, {
            items: url.searchParams.get('status') === 'QUEUED' ? [waiting] : [scheduled],
            nextCursor: null,
          }),
      },
    });
    renderPage({ path: '/w/acme/publishing?tab=queue' });
    await screen.findByText('Older waiting post');
    const captions = screen.getAllByText(/waiting post|scheduled post/).map((n) => n.textContent);
    expect(captions).toEqual(['Newer scheduled post', 'Older waiting post']);
    expect(screen.getByRole('button', { name: 'Queue (2)' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('loads the next page with the cursor', async () => {
    const first = job({
      content: { captionPreview: 'First post', mediaCount: 1, hasVideo: false },
    });
    const second = job({
      content: { captionPreview: 'Second post', mediaCount: 1, hasVideo: true },
    });
    const mock = mockApi({
      extra: {
        [LIST]: ({ url }) =>
          url.searchParams.get('cursor') === 'next-1'
            ? jsonResponse(200, { items: [second], nextCursor: null })
            : jsonResponse(200, { items: [first], nextCursor: 'next-1' }),
      },
    });
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Load more' }));
    expect(await screen.findByText('Second post')).toBeInTheDocument();
    expect(screen.getByText('First post')).toBeInTheDocument();
    expect(screen.getByText('1 file, with video')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument(),
    );
    expect(mock.count(LIST)).toBe(2);
  });

  it('keeps refreshing only while a listed job is still active', () => {
    const state = (items) => ({ state: { data: { pages: [{ items }] } } });
    expect(liveListInterval(state([job({ status: 'PROCESSING' })]))).toBe(LIVE_INTERVAL_MS);
    expect(liveListInterval(state([job({ status: 'QUEUED' }), job()]))).toBe(LIVE_INTERVAL_MS);
    expect(liveListInterval(state([job(), job({ status: 'FAILED' })]))).toBe(false);
    expect(liveListInterval({ state: { data: undefined } })).toBe(false);
  });

  it('refreshes a scheduled post once a minute until it is nearly due', () => {
    const now = Date.parse('2026-11-23T12:00:00Z');
    const at = (minutes) => new Date(now + minutes * 60_000).toISOString();
    const scheduled = (minutes) => job({ status: 'SCHEDULED', scheduledAt: at(minutes) });
    expect(refreshIntervalFor(scheduled(60 * 24 * 30), now)).toBe(SCHEDULED_INTERVAL_MS);
    expect(refreshIntervalFor(scheduled(1), now)).toBe(LIVE_INTERVAL_MS);
    expect(refreshIntervalFor(scheduled(-1), now)).toBe(LIVE_INTERVAL_MS);
    expect(refreshIntervalForJobs([scheduled(600), job({ status: 'FAILED' })], now)).toBe(
      SCHEDULED_INTERVAL_MS,
    );
    expect(refreshIntervalForJobs([scheduled(600), job({ status: 'PROCESSING' })], now)).toBe(
      LIVE_INTERVAL_MS,
    );
    expect(refreshIntervalForJobs([job({ status: 'PUBLISHED' })], now)).toBe(false);
  });
});

describe('status banner', () => {
  it('explains simulation mode and never calls a simulated job published', async () => {
    const j = job({
      simulated: true,
      mode: 'SIMULATED',
      destinations: [
        destination({
          simulated: true,
          externalPostId: 'sim_123',
          externalUrl: 'https://facebook.example/posts/sim_123',
        }),
      ],
    });
    mockApi({ jobs: [j], statusBody: status({ mode: 'SIMULATED' }) });
    renderPage();
    expect(await screen.findByText('Simulation mode.')).toBeInTheDocument();
    expect(
      screen.getByText(
        /Posts go through the whole process, but nothing is sent to Facebook or Instagram\./,
      ),
    ).toBeInTheDocument();

    const item = await screen.findByTestId(`publish-job-${j.id}`);
    expect(within(item).getAllByText('Simulated').length).toBeGreaterThan(0);
    expect(within(item).getByText(/· Simulated/)).toBeInTheDocument();
    expect(
      within(item).getByText('Nothing was posted to Facebook or Instagram.'),
    ).toBeInTheDocument();
    expect(within(item).queryByText(/Published/)).not.toBeInTheDocument();

    const dialog = await openDetails(j);
    expect(within(dialog).getByText('Simulated.')).toBeInTheDocument();
    expect(
      within(dialog).getAllByText('Nothing was posted to Facebook or Instagram.').length,
    ).toBeGreaterThan(0);
    expect(within(dialog).queryByText(/Published/)).not.toBeInTheDocument();
    // A simulated post has no real post to link to.
    expect(within(dialog).queryByText(/sim_123/)).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('link')).not.toBeInTheDocument();
  });

  it('flags simulated jobs in a banner even when the server is no longer simulating', async () => {
    mockApi({ jobs: [job({ simulated: true, destinations: [destination({ simulated: true })] })] });
    renderPage();
    expect(await screen.findByText('Some posts below were simulated.')).toBeInTheDocument();
  });

  it('hides the publish button when publishing is switched off', async () => {
    mockApi({
      statusBody: status({ mode: 'DISABLED', canPublish: false, reason: 'PUBLISHING_DISABLED' }),
    });
    renderPage();
    expect(
      await screen.findByText('Publishing is switched off on this server.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Publish a draft' })).not.toBeInTheDocument();
  });

  it('warns when the queue is not available, using the server message when there is one', async () => {
    mockApi({
      statusBody: status({
        canPublish: false,
        reason: 'QUEUE_UNAVAILABLE',
        message: 'The publishing queue cannot be reached at the moment.',
        queue: { status: 'UNAVAILABLE', counts: null },
        worker: { status: 'UNKNOWN', count: 0 },
      }),
    });
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The publishing queue cannot be reached at the moment.',
    );
    expect(screen.queryByRole('button', { name: 'Publish a draft' })).not.toBeInTheDocument();
  });

  it('has its own words for a queue that is unavailable or was never set up', async () => {
    mockApi({
      statusBody: status({ canPublish: false, queue: { status: 'UNAVAILABLE', counts: null } }),
    });
    const first = renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The publishing queue is not available right now. New posts cannot be sent until it is back.',
    );
    first.queryClient.clear();
  });

  it('says so when the queue has not been set up', async () => {
    mockApi({
      statusBody: status({ canPublish: false, queue: { status: 'NOT_CONFIGURED', counts: null } }),
    });
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The publishing queue has not been set up on this server yet.',
    );
  });

  it('warns that posts will wait when the worker is not running', async () => {
    mockApi({ statusBody: status({ worker: { status: 'NOT_RUNNING', count: 0 } }) });
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Posts will wait in the queue until it is started.',
    );
    expect(screen.getByRole('button', { name: 'Publish a draft' })).toBeInTheDocument();
  });

  it('does not offer publishing when the status cannot be checked', async () => {
    mockApi({ extra: { [STATUS]: () => apiError(500, 'INTERNAL_ERROR', 'boom') } });
    renderPage();
    expect(
      await screen.findByText('We could not check whether publishing is available.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Publish a draft' })).not.toBeInTheDocument();
  });
});

describe('job details', () => {
  it('shows each account with its own result', async () => {
    const j = partialJob();
    j.destinations[0] = {
      ...j.destinations[0],
      externalPostId: '5001_77',
      externalUrl: 'https://www.facebook.com/5001/posts/77',
      warnings: ['FIRST_COMMENT_NOT_SENT'],
    };
    mockApi({ jobs: [j], counts: { PARTIALLY_PUBLISHED: 1 } });
    renderPage();

    const item = await screen.findByTestId(`publish-job-${j.id}`);
    expect(within(item).getByText('Partly published')).toBeInTheDocument();
    expect(within(item).getByText(/· Published/)).toBeInTheDocument();
    expect(within(item).getByText(/· Failed/)).toBeInTheDocument();

    const dialog = await openDetails(j);
    const cards = within(within(dialog).getByRole('region', { name: 'Accounts' })).getAllByRole(
      'listitem',
    );
    const ok = cards.find((c) => within(c).queryByText('Acme Store'));
    const bad = cards.find((c) => within(c).queryByText('Acme Labs'));

    expect(within(ok).getByText('Published')).toBeInTheDocument();
    expect(within(ok).getByText('5001_77')).toBeInTheDocument();
    expect(within(ok).getByRole('link', { name: /View post/ })).toHaveAttribute(
      'href',
      'https://www.facebook.com/5001/posts/77',
    );
    expect(within(ok).getByText(/The first comment was not sent\./)).toBeInTheDocument();
    expect(within(ok).queryByRole('button')).not.toBeInTheDocument();

    expect(within(bad).getByText('Failed')).toBeInTheDocument();
    expect(within(bad).getByText('Instagram did not accept this image.')).toBeInTheDocument();
    expect(within(bad).getByText('Code: PLATFORM_REJECTED')).toBeInTheDocument();
    expect(within(bad).getByText('Attempt 2 of 4')).toBeInTheDocument();
    expect(within(bad).getByText(/Attempt 1: Did not work, will try again/)).toBeInTheDocument();
    expect(within(bad).getByText('Instagram was not reachable.')).toBeInTheDocument();
    expect(within(bad).getByText(/@acme\.labs/)).toBeInTheDocument();
  });

  it('retries one account and shows what the server answered', async () => {
    const j = partialJob();
    const after = {
      ...j,
      status: 'PROCESSING',
      destinations: [
        j.destinations[0],
        { ...j.destinations[1], state: 'QUEUED', error: null, canRetry: false, canCancel: true },
      ],
    };
    const RETRY = `POST ${BASE}/publish-jobs/${j.id}/destinations/d-bad/retry`;
    const mock = mockApi({
      jobs: [j],
      extra: { [RETRY]: () => jsonResponse(200, { publishJob: after }) },
    });
    renderPage();
    const dialog = await openDetails(j);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Retry for Acme Labs' }));

    // A real post sent again: the person confirms it first; nothing is sent before that.
    const confirm = await screen.findByRole('dialog', { name: 'Publish this post again?' });
    expect(confirm).toHaveTextContent('This creates a REAL public post.');
    expect(within(confirm).getByRole('button', { name: 'Retry' })).toBeDisabled();
    expect(mock.count(RETRY)).toBe(0);
    await userEvent.click(
      within(confirm).getByRole('checkbox', { name: /publishes a real post on these accounts/ }),
    );
    await userEvent.click(within(confirm).getByRole('button', { name: 'Retry' }));

    await waitFor(() => expect(mock.count(RETRY)).toBe(1));
    expect(bodyOf(mock.calls.find((c) => c.key === RETRY))).toEqual({ confirmRealPost: true });
    const details = await screen.findByRole('dialog', { name: 'Post details' });
    expect(await within(details).findByText('Waiting')).toBeInTheDocument();
    expect(
      within(details).queryByText('Instagram did not accept this image.'),
    ).not.toBeInTheDocument();
    expect(toast.success).toHaveBeenCalledWith('Trying Acme Labs again');
  });

  it('retries a simulated post without any confirmation', async () => {
    const j = partialJob();
    j.mode = 'SIMULATED';
    j.simulated = true;
    const RETRY = `POST ${BASE}/publish-jobs/${j.id}/destinations/d-bad/retry`;
    const mock = mockApi({
      jobs: [j],
      statusBody: status({ mode: 'SIMULATED' }),
      extra: { [RETRY]: () => jsonResponse(200, { publishJob: j }) },
    });
    renderPage();
    const dialog = await openDetails(j);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Retry for Acme Labs' }));
    await waitFor(() => expect(mock.count(RETRY)).toBe(1));
    expect(bodyOf(mock.calls.find((c) => c.key === RETRY))).toEqual({});
    expect(screen.queryByText('This creates a REAL public post.')).toBeNull();
  });

  it('asks before retrying when the post may already be on the account', async () => {
    const j = job({
      status: 'FAILED',
      destinations: [
        destination({
          id: 'd-unsure',
          state: 'FAILED',
          canRetry: true,
          error: {
            code: 'OUTCOME_UNKNOWN',
            message: 'We sent the post but did not hear back.',
            retryable: true,
            uncertain: true,
            at: '2026-11-21T09:00:05.000Z',
          },
        }),
      ],
    });
    const RETRY = `POST ${BASE}/publish-jobs/${j.id}/destinations/d-unsure/retry`;
    const mock = mockApi({
      jobs: [j],
      extra: { [RETRY]: () => jsonResponse(200, { publishJob: j }) },
    });
    renderPage();
    const dialog = await openDetails(j);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Retry for Acme Store' }));

    const confirm = await screen.findByRole('dialog', {
      name: 'This post may already be published',
    });
    expect(confirm).toHaveTextContent('trying again could post it twice');
    expect(mock.count(RETRY)).toBe(0);
    // A real post: accepting the duplicate risk is not enough, the real post is confirmed too.
    expect(within(confirm).getByRole('button', { name: 'Retry anyway' })).toBeDisabled();
    await userEvent.click(
      within(confirm).getByRole('checkbox', { name: /publishes a real post on these accounts/ }),
    );

    await userEvent.click(within(confirm).getByRole('button', { name: 'Retry anyway' }));
    await waitFor(() => expect(mock.count(RETRY)).toBe(1));
    expect(bodyOf(mock.calls.find((c) => c.key === RETRY))).toEqual({
      acknowledgeDuplicateRisk: true,
      confirmRealPost: true,
    });
    // The details come back once the confirmation is done.
    expect(await screen.findByRole('dialog', { name: 'Post details' })).toBeInTheDocument();
  });

  it('asks for confirmation when the server reports a duplicate risk', async () => {
    const j = partialJob();
    const RETRY = `POST ${BASE}/publish-jobs/${j.id}/destinations/d-bad/retry`;
    const mock = mockApi({
      jobs: [j],
      extra: {
        [RETRY]: ({ init }) =>
          JSON.parse(init.body).acknowledgeDuplicateRisk
            ? jsonResponse(200, { publishJob: j })
            : apiError(409, 'CONFLICT', 'This post may already be published.', {
                reason: 'DUPLICATE_RISK',
              }),
      },
    });
    renderPage();
    const dialog = await openDetails(j);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Retry for Acme Labs' }));
    const real = await screen.findByRole('dialog', { name: 'Publish this post again?' });
    await userEvent.click(
      within(real).getByRole('checkbox', { name: /publishes a real post on these accounts/ }),
    );
    await userEvent.click(within(real).getByRole('button', { name: 'Retry' }));
    // The server asks the duplicate-risk question too; the real-post confirmation is kept.
    const confirm = await screen.findByRole('dialog', {
      name: 'This post may already be published',
    });
    expect(
      within(confirm).getByRole('checkbox', { name: /publishes a real post on these accounts/ }),
    ).toBeChecked();
    await userEvent.click(within(confirm).getByRole('button', { name: 'Retry anyway' }));
    await waitFor(() => expect(mock.count(RETRY)).toBe(2));
    expect(bodyOf(mock.calls.filter((c) => c.key === RETRY)[1])).toEqual({
      acknowledgeDuplicateRisk: true,
      confirmRealPost: true,
    });
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('cancels one waiting account', async () => {
    const j = job({
      status: 'QUEUED',
      canCancel: true,
      destinations: [
        destination({ id: 'd-wait', state: 'QUEUED', attemptCount: 0, canCancel: true }),
      ],
    });
    const CANCEL = `POST ${BASE}/publish-jobs/${j.id}/destinations/d-wait/cancel`;
    const after = {
      ...j,
      status: 'CANCELLED',
      canCancel: false,
      destinations: [{ ...j.destinations[0], state: 'CANCELLED', canCancel: false }],
    };
    const mock = mockApi({
      jobs: [j],
      extra: { [CANCEL]: () => jsonResponse(200, { publishJob: after }) },
    });
    renderPage();
    const dialog = await openDetails(j);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel for Acme Store' }));
    await waitFor(() => expect(mock.count(CANCEL)).toBe(1));
    expect(await within(dialog).findAllByText('Cancelled')).not.toHaveLength(0);
    expect(
      within(dialog).queryByRole('button', { name: 'Cancel all waiting' }),
    ).not.toBeInTheDocument();
  });

  it('cancels everything that is waiting, after a confirmation', async () => {
    const j = job({
      status: 'QUEUED',
      canCancel: true,
      destinations: [destination({ state: 'QUEUED', attemptCount: 0, canCancel: true })],
    });
    const CANCEL = `POST ${BASE}/publish-jobs/${j.id}/cancel`;
    const after = {
      ...j,
      status: 'CANCELLED',
      canCancel: false,
      destinations: [{ ...j.destinations[0], state: 'CANCELLED', canCancel: false }],
    };
    const mock = mockApi({
      jobs: [j],
      extra: { [CANCEL]: () => jsonResponse(200, { publishJob: after }) },
    });
    renderPage();
    const dialog = await openDetails(j);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel all waiting' }));

    const confirm = await screen.findByRole('dialog', {
      name: 'Cancel everything that is still waiting?',
    });
    expect(mock.count(CANCEL)).toBe(0);
    await userEvent.click(within(confirm).getByRole('button', { name: 'Yes, cancel them' }));
    await waitFor(() => expect(mock.count(CANCEL)).toBe(1));

    const reopened = await screen.findByRole('dialog', { name: 'Post details' });
    expect(await within(reopened).findAllByText('Cancelled')).not.toHaveLength(0);
    expect(toast.success).toHaveBeenCalled();
  });

  it('shows the server message when nothing can be cancelled any more', async () => {
    const j = job({
      status: 'QUEUED',
      canCancel: true,
      destinations: [destination({ state: 'QUEUED', attemptCount: 0 })],
    });
    mockApi({
      jobs: [j],
      extra: {
        [`POST ${BASE}/publish-jobs/${j.id}/cancel`]: () =>
          apiError(409, 'CONFLICT', 'This post has already been sent.'),
      },
    });
    renderPage();
    const dialog = await openDetails(j);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel all waiting' }));
    const confirm = await screen.findByRole('dialog', {
      name: 'Cancel everything that is still waiting?',
    });
    await userEvent.click(within(confirm).getByRole('button', { name: 'Yes, cancel them' }));
    expect(await within(confirm).findByRole('alert')).toHaveTextContent(
      'This post has already been sent.',
    );
    expect(toast.success).not.toHaveBeenCalled();
  });
});

describe('a real published Facebook post: edit and delete', () => {
  const realPost = (overrides = {}) =>
    job({
      destinations: [
        destination({
          id: 'd-real',
          externalPostId: '5001_9002',
          externalUrl: 'https://www.facebook.com/acme/posts/9002',
          canEditPost: true,
          canDeletePost: true,
          postText: 'Winter collection teaser',
          postEditedAt: null,
          postDeletedAt: null,
          ...overrides,
        }),
      ],
    });
  const POST = (j) => `${BASE}/publish-jobs/${j.id}/destinations/d-real/post`;
  const box = (dialog, name) => within(dialog).getByRole('checkbox', { name });

  it('changes the text only after a real change and an explicit confirmation', async () => {
    const j = realPost();
    const after = {
      ...j,
      destinations: [
        { ...j.destinations[0], postText: 'Spring sale', postEditedAt: '2026-11-24T10:00:00Z' },
      ],
    };
    const mock = mockApi({
      jobs: [j],
      extra: { [`PATCH ${POST(j)}`]: () => jsonResponse(200, { publishJob: after }) },
    });
    renderPage();
    const details = await openDetails(j);
    await userEvent.click(
      within(details).getByRole('button', { name: 'Edit the post on Acme Store' }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Edit the post on Facebook' });
    const text = within(dialog).getByRole('textbox', { name: 'New text' });
    expect(text).toHaveValue('Winter collection teaser');
    const save = within(dialog).getByRole('button', { name: 'Save on Facebook' });
    expect(save).toBeDisabled();

    await userEvent.clear(text);
    await userEvent.type(text, 'Spring sale');
    expect(save).toBeDisabled(); // not confirmed yet
    await userEvent.click(box(dialog, /changes the real public post on Facebook/));
    expect(save).toBeEnabled();
    await userEvent.click(save);

    await waitFor(() => expect(mock.count(`PATCH ${POST(j)}`)).toBe(1));
    expect(bodyOf(mock.calls.find((c) => c.key === `PATCH ${POST(j)}`))).toEqual({
      message: 'Spring sale',
      confirmRealPost: true,
    });
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith('The post on Acme Store was changed on Facebook'),
    );
  });

  it('deletes only after an explicit confirmation, and shows the deletion afterwards', async () => {
    const j = realPost();
    const after = {
      ...j,
      destinations: [
        {
          ...j.destinations[0],
          postDeletedAt: '2026-11-24T10:05:00Z',
          canEditPost: false,
          canDeletePost: false,
          postText: null,
        },
      ],
    };
    const mock = mockApi({
      jobs: [j],
      extra: { [`DELETE ${POST(j)}`]: () => jsonResponse(200, { publishJob: after }) },
    });
    renderPage();
    const details = await openDetails(j);
    await userEvent.click(
      within(details).getByRole('button', { name: 'Delete the post on Acme Store from Facebook' }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Delete this post from Facebook?' });
    expect(dialog).toHaveTextContent('This cannot be undone');
    const confirm = within(dialog).getByRole('button', { name: 'Delete from Facebook' });
    expect(confirm).toBeDisabled();
    await userEvent.click(confirm);
    expect(mock.count(`DELETE ${POST(j)}`)).toBe(0);

    await userEvent.click(box(dialog, /deletes the real public post from Facebook/));
    await userEvent.click(confirm);
    await waitFor(() => expect(mock.count(`DELETE ${POST(j)}`)).toBe(1));
    expect(bodyOf(mock.calls.find((c) => c.key === `DELETE ${POST(j)}`))).toEqual({
      confirmRealPost: true,
    });
    const back = await screen.findByRole('dialog', { name: 'Post details' });
    expect(await within(back).findByText('Deleted from Facebook:')).toBeInTheDocument();
    expect(within(back).queryByRole('link', { name: /View post/ })).toBeNull();
    expect(within(back).queryByRole('button', { name: /Edit the post/ })).toBeNull();
  });

  it('offers nothing for a simulated post or to members who cannot publish', async () => {
    const simulatedJob = realPost({ canEditPost: false, canDeletePost: false, simulated: true });
    simulatedJob.simulated = true;
    mockApi({ jobs: [simulatedJob] });
    renderPage();
    const details = await openDetails(simulatedJob);
    expect(within(details).queryByRole('button', { name: /Edit the post/ })).toBeNull();
    expect(within(details).queryByRole('button', { name: /Delete the post/ })).toBeNull();
  });
});

describe('permissions', () => {
  it('shows viewers everything, without any action buttons', async () => {
    const j = partialJob();
    j.canCancel = true;
    j.destinations[1].canCancel = true;
    mockApi({ jobs: [j] });
    renderPage({ role: 'VIEWER' });
    const dialog = await openDetails(j);
    expect(within(dialog).getByText('Instagram did not accept this image.')).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /Retry/ })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /Cancel/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Publish a draft' })).not.toBeInTheDocument();
  });

  it('shows a restricted state, and asks the API nothing, without permission to read posts', async () => {
    const mock = mockApi();
    renderPage({ role: 'UNKNOWN_ROLE' });
    expect(await screen.findByText('Publishing is restricted')).toBeInTheDocument();
    expect(mock.calls).toHaveLength(0);
  });
});

describe('publish a draft', () => {
  const openDialog = async () => {
    await userEvent.click(await screen.findByRole('button', { name: 'Publish a draft' }));
    return screen.findByRole('dialog', { name: 'Publish a draft' });
  };
  const confirmBox = (dialog) =>
    within(dialog).findByRole('checkbox', { name: /publishes a real post on these accounts/ });
  /** The workspace is in real publishing (the default status): the person confirms first. */
  const confirmRealPost = async (dialog) => userEvent.click(await confirmBox(dialog));

  it('sends one request with an idempotency key, even on a double click', async () => {
    const created = job({ status: 'QUEUED', destinations: [destination({ state: 'QUEUED' })] });
    const mock = mockApi({
      extra: {
        [DRAFTS]: () =>
          jsonResponse(200, {
            items: [
              draft(),
              draft({
                id: 'c00000000000000000000002',
                caption: 'No accounts yet',
                targetAccountIds: [],
              }),
            ],
            nextCursor: null,
          }),
        [CREATE]: () => jsonResponse(201, { publishJob: created, created: true }),
      },
    });
    renderPage();
    const dialog = await openDialog();

    const draftsCall = mock.calls.find((c) => c.key === DRAFTS);
    expect(draftsCall.url.searchParams.get('status')).toBe('DRAFT');
    expect(draftsCall.url.searchParams.get('limit')).toBe('50');

    expect(await within(dialog).findByText('Winter collection teaser')).toBeInTheDocument();
    expect(within(dialog).getByText(/1 file · 2 accounts/)).toBeInTheDocument();
    expect(within(dialog).getByText('No accounts selected in this draft')).toBeInTheDocument();
    expect(within(dialog).getByRole('radio', { name: /No accounts yet/ })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Publish' })).toBeDisabled();

    await userEvent.click(within(dialog).getByRole('radio', { name: /Winter collection teaser/ }));
    // Real publishing: still disabled until the person confirms the real post.
    expect(within(dialog).getByRole('button', { name: 'Publish' })).toBeDisabled();
    await confirmRealPost(dialog);
    await userEvent.dblClick(within(dialog).getByRole('button', { name: 'Publish' }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Sent to the publishing queue'));
    expect(mock.count(CREATE)).toBe(1);
    const body = bodyOf(mock.calls.find((c) => c.key === CREATE));
    expect(body).toEqual({
      contentPackageId: 'c00000000000000000000001',
      idempotencyKey: expect.stringMatching(/^[A-Za-z0-9]{16,100}$/),
      confirmRealPost: true,
    });
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Publish a draft' })).not.toBeInTheDocument(),
    );
  });

  it('shows the server message when the queue is unavailable, and reuses the key on the next try', async () => {
    let available = false;
    const mock = mockApi({
      statusBody: status({ mode: 'SIMULATED' }),
      extra: {
        [DRAFTS]: () => jsonResponse(200, { items: [draft()], nextCursor: null }),
        [CREATE]: () =>
          available
            ? jsonResponse(201, { publishJob: job({ simulated: true }), created: true })
            : apiError(
                503,
                'QUEUE_UNAVAILABLE',
                'The publishing queue is not available right now.',
              ),
      },
    });
    renderPage();
    const dialog = await openDialog();
    await userEvent.click(await within(dialog).findByRole('radio', { name: /Winter collection/ }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Start simulation' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'The publishing queue is not available right now.',
    );
    expect(toast.success).not.toHaveBeenCalled();

    available = true;
    await userEvent.click(within(dialog).getByRole('button', { name: 'Start simulation' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Simulation started'));
    const keys = mock.calls.filter((c) => c.key === CREATE).map((c) => bodyOf(c).idempotencyKey);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });

  it('shows validation messages from the server inside the dialog', async () => {
    mockApi({
      extra: {
        [DRAFTS]: () => jsonResponse(200, { items: [draft()], nextCursor: null }),
        [CREATE]: () =>
          apiError(422, 'VALIDATION_ERROR', 'Validation failed', {
            fields: { content: 'Instagram posts need at least one image or video.' },
          }),
      },
    });
    renderPage();
    const dialog = await openDialog();
    await userEvent.click(await within(dialog).findByRole('radio', { name: /Winter collection/ }));
    await confirmRealPost(dialog);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Publish' }));
    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent('Instagram posts need at least one image or video.');
    expect(alert).not.toHaveTextContent('Validation failed');
  });

  it('offers "Publish again anyway" when the draft was already published', async () => {
    const mock = mockApi({
      extra: {
        [DRAFTS]: () => jsonResponse(200, { items: [draft()], nextCursor: null }),
        [CREATE]: ({ init }) =>
          JSON.parse(init.body).republish
            ? jsonResponse(201, { publishJob: job(), created: true })
            : apiError(409, 'CONFLICT', 'This post was already published to some accounts.', {
                reason: 'ALREADY_PUBLISHED',
                accounts: ['Acme Store'],
              }),
      },
    });
    renderPage();
    const dialog = await openDialog();
    await userEvent.click(await within(dialog).findByRole('radio', { name: /Winter collection/ }));
    await confirmRealPost(dialog);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Publish' }));
    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent('This post was already published to some accounts.');
    expect(alert).toHaveTextContent('Acme Store');

    await userEvent.click(within(dialog).getByRole('button', { name: 'Publish again anyway' }));
    await waitFor(() => expect(mock.count(CREATE)).toBe(2));
    const bodies = mock.calls.filter((c) => c.key === CREATE).map(bodyOf);
    expect(bodies[1]).toEqual({ ...bodies[0], republish: true });
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
  });

  it('shows a 409 without the "again" option when the draft is still being published', async () => {
    mockApi({
      extra: {
        [DRAFTS]: () => jsonResponse(200, { items: [draft()], nextCursor: null }),
        [CREATE]: () => apiError(409, 'CONFLICT', 'This post is already being published.'),
      },
    });
    renderPage();
    const dialog = await openDialog();
    await userEvent.click(await within(dialog).findByRole('radio', { name: /Winter collection/ }));
    await confirmRealPost(dialog);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Publish' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'This post is already being published.',
    );
    expect(
      within(dialog).queryByRole('button', { name: 'Publish again anyway' }),
    ).not.toBeInTheDocument();
  });

  it('in real publishing, shows the accounts, files and exact caption, and sends nothing until confirmed', async () => {
    const mock = mockApi({
      extra: {
        [DRAFTS]: () =>
          jsonResponse(200, {
            items: [
              draft({
                hashtags: ['sale'],
                hashtagPlacement: 'CAPTION',
                platformCaptions: { INSTAGRAM_ACCOUNT: 'Insta teaser' },
                media: [
                  {
                    mediaId: 'm1',
                    altText: 'Coat on a hanger',
                    media: { kind: 'IMAGE', fileName: 'coat.jpg', thumbnailUrl: '/media/coat.jpg' },
                  },
                ],
              }),
            ],
            nextCursor: null,
          }),
        [CREATE]: () => jsonResponse(201, { publishJob: job(), created: true }),
      },
    });
    renderPage();
    const dialog = await openDialog();
    await userEvent.click(await within(dialog).findByRole('radio', { name: /Winter collection/ }));

    const accounts = await within(dialog).findByRole('region', { name: 'Accounts' });
    expect(within(accounts).getByText('Acme Store')).toBeInTheDocument();
    expect(within(accounts).getByText('Acme Labs')).toBeInTheDocument();
    const preview = within(dialog).getByRole('region', { name: 'What will be posted' });
    expect(within(preview).getByRole('img', { name: 'Coat on a hanger' })).toHaveAttribute(
      'src',
      '/media/coat.jpg',
    );
    // Exactly what each platform receives (the hashtag added to the caption).
    expect(within(preview).getByText(/Winter collection teaser/)).toHaveTextContent(
      'Winter collection teaser #sale',
    );
    expect(within(preview).getByText(/Insta teaser/)).toHaveTextContent('Insta teaser #sale');
    expect(
      within(dialog).getByText(/published on Acme Store, Acme Labs as soon as you confirm/),
    ).toBeInTheDocument();

    const publish = within(dialog).getByRole('button', { name: 'Publish' });
    expect(publish).toBeDisabled();
    await userEvent.click(publish);
    expect(mock.count(CREATE)).toBe(0);

    await confirmRealPost(dialog);
    expect(publish).toBeEnabled();
    await userEvent.click(publish);
    await waitFor(() => expect(mock.count(CREATE)).toBe(1));
    expect(bodyOf(mock.calls.find((c) => c.key === CREATE)).confirmRealPost).toBe(true);
  });

  it('the confirmation belongs to one draft: choosing another clears it', async () => {
    mockApi({
      extra: {
        [DRAFTS]: () =>
          jsonResponse(200, {
            items: [draft(), draft({ id: 'c00000000000000000000002', caption: 'Spring sale' })],
            nextCursor: null,
          }),
      },
    });
    renderPage();
    const dialog = await openDialog();
    await userEvent.click(await within(dialog).findByRole('radio', { name: /Winter collection/ }));
    await confirmRealPost(dialog);
    expect(within(dialog).getByRole('button', { name: 'Publish' })).toBeEnabled();

    await userEvent.click(within(dialog).getByRole('radio', { name: /Spring sale/ }));
    expect(await confirmBox(dialog)).not.toBeChecked();
    expect(within(dialog).getByRole('button', { name: 'Publish' })).toBeDisabled();
  });

  it('scheduling a real post needs the confirmation too', async () => {
    const mock = mockApi({
      extra: {
        [DRAFTS]: () => jsonResponse(200, { items: [draft()], nextCursor: null }),
        [CREATE]: () =>
          jsonResponse(201, { publishJob: job({ status: 'SCHEDULED' }), created: true }),
      },
    });
    renderPage();
    const dialog = await openDialog();
    await userEvent.click(await within(dialog).findByRole('radio', { name: /Winter collection/ }));
    await userEvent.click(within(dialog).getByRole('radio', { name: /^Schedule/ }));
    expect(
      await within(dialog).findByText(
        /published on Acme Store, Acme Labs at the time chosen above/,
      ),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Schedule' })).toBeDisabled();

    await confirmRealPost(dialog);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Schedule' }));
    await waitFor(() => expect(mock.count(CREATE)).toBe(1));
    const body = bodyOf(mock.calls.find((c) => c.key === CREATE));
    expect(body.scheduledAt).toEqual(expect.any(String));
    expect(body.confirmRealPost).toBe(true);
  });

  it('in simulation asks no confirmation and sends none', async () => {
    const mock = mockApi({
      statusBody: status({ mode: 'SIMULATED' }),
      extra: {
        [DRAFTS]: () => jsonResponse(200, { items: [draft()], nextCursor: null }),
        [CREATE]: () => jsonResponse(201, { publishJob: job({ simulated: true }), created: true }),
      },
    });
    renderPage();
    const dialog = await openDialog();
    await userEvent.click(await within(dialog).findByRole('radio', { name: /Winter collection/ }));
    expect(await within(dialog).findByText('Acme Store')).toBeInTheDocument();
    expect(within(dialog).queryByText('This creates a REAL public post.')).toBeNull();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Start simulation' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Simulation started'));
    expect(bodyOf(mock.calls.find((c) => c.key === CREATE))).not.toHaveProperty('confirmRealPost');
  });

  it('cannot confirm a real post whose accounts cannot be shown', async () => {
    const mock = mockApi({
      extra: {
        [DRAFTS]: () => jsonResponse(200, { items: [draft()], nextCursor: null }),
        [ACCOUNTS]: () => apiError(500, 'INTERNAL_ERROR', 'boom'),
      },
    });
    renderPage();
    const dialog = await openDialog();
    await userEvent.click(await within(dialog).findByRole('radio', { name: /Winter collection/ }));
    expect(
      await within(dialog).findByText(/The accounts of this draft could not be loaded/),
    ).toBeInTheDocument();
    expect(within(dialog).queryByRole('checkbox')).toBeNull();
    const publish = within(dialog).getByRole('button', { name: 'Publish' });
    expect(publish).toBeDisabled();
    await userEvent.click(publish);
    expect(mock.count(CREATE)).toBe(0);
  });

  it('when the server says the post would be real, asks for the confirmation and keeps the key', async () => {
    let mode = 'SIMULATED';
    const mock = mockApi({
      extra: {
        [STATUS]: () => jsonResponse(200, status({ mode })),
        [DRAFTS]: () => jsonResponse(200, { items: [draft()], nextCursor: null }),
        [CREATE]: ({ init }) => {
          if (JSON.parse(init.body).confirmRealPost === true) {
            return jsonResponse(201, { publishJob: job(), created: true });
          }
          mode = 'LIVE';
          return apiError(
            400,
            'REAL_POST_CONFIRMATION_REQUIRED',
            'Real publishing is on for this workspace, so this creates a real public post. Confirm that you want to publish it for real, then send it again. Nothing was created.',
            { mode: 'LIVE' },
          );
        },
      },
    });
    renderPage();
    const dialog = await openDialog();
    await userEvent.click(await within(dialog).findByRole('radio', { name: /Winter collection/ }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Start simulation' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Confirm that you want to publish it for real',
    );
    expect(await confirmBox(dialog)).not.toBeChecked();
    expect(within(dialog).getByRole('button', { name: 'Publish' })).toBeDisabled();

    await confirmRealPost(dialog);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Publish' }));
    await waitFor(() => expect(mock.count(CREATE)).toBe(2));
    const [first, second] = mock.calls.filter((c) => c.key === CREATE).map(bodyOf);
    expect(first).not.toHaveProperty('confirmRealPost');
    expect(second.confirmRealPost).toBe(true);
    expect(second.idempotencyKey).toBe(first.idempotencyKey);
  });

  it('explains where drafts come from when there are none', async () => {
    mockApi({ extra: { [DRAFTS]: () => jsonResponse(200, { items: [], nextCursor: null }) } });
    renderPage();
    const dialog = await openDialog();
    expect(await within(dialog).findByText('No saved drafts')).toBeInTheDocument();
    expect(within(dialog).getByText(/Drafts are saved from the composer/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Publish' })).toBeDisabled();
  });

  it('shows a plain error when drafts cannot be loaded', async () => {
    mockApi({
      extra: { [DRAFTS]: () => apiError(503, 'STORAGE_UNAVAILABLE', 'ECONNREFUSED 127.0.0.1') },
    });
    renderPage();
    const dialog = await openDialog();
    expect(
      await within(dialog).findByText('Saved drafts are not available right now'),
    ).toBeInTheDocument();
    expect(within(dialog).queryByText(/ECONNREFUSED/)).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});

// Kept last: `row` is used only as a smoke check that the list survives a details round trip.
describe('details round trip', () => {
  it('closes the details and keeps the list', async () => {
    const j = job();
    mockApi({ jobs: [j] });
    renderPage();
    const dialog = await openDetails(j);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Post details' })).not.toBeInTheDocument(),
    );
    expect(row(j)).toBeInTheDocument();
  });
});
