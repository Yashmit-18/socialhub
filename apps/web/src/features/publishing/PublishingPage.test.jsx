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

/** Mocks the three requests every page load makes, plus one detail route per listed job. */
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
    expect(screen.getByRole('heading', { name: 'Publishing' })).toBeInTheDocument();
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

    // "Queue" is two statuses, so two requests.
    await userEvent.click(screen.getByRole('button', { name: /^Queue/ }));
    await waitFor(() => {
      expect(listStatuses(mock)).toContain('QUEUED');
      expect(listStatuses(mock)).toContain('SCHEDULED');
    });
    expect(router.state.location.search).toBe('?tab=queue');

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

    await waitFor(() => expect(mock.count(RETRY)).toBe(1));
    expect(bodyOf(mock.calls.find((c) => c.key === RETRY))).toEqual({});
    expect(await within(dialog).findByText('Waiting')).toBeInTheDocument();
    expect(
      within(dialog).queryByText('Instagram did not accept this image.'),
    ).not.toBeInTheDocument();
    expect(toast.success).toHaveBeenCalledWith('Trying Acme Labs again');
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

    await userEvent.click(within(confirm).getByRole('button', { name: 'Retry anyway' }));
    await waitFor(() => expect(mock.count(RETRY)).toBe(1));
    expect(bodyOf(mock.calls.find((c) => c.key === RETRY))).toEqual({
      acknowledgeDuplicateRisk: true,
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
    const confirm = await screen.findByRole('dialog', {
      name: 'This post may already be published',
    });
    await userEvent.click(within(confirm).getByRole('button', { name: 'Retry anyway' }));
    await waitFor(() => expect(mock.count(RETRY)).toBe(2));
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
    await userEvent.dblClick(within(dialog).getByRole('button', { name: 'Publish' }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Sent to the publishing queue'));
    expect(mock.count(CREATE)).toBe(1);
    const body = bodyOf(mock.calls.find((c) => c.key === CREATE));
    expect(body).toEqual({
      contentPackageId: 'c00000000000000000000001',
      idempotencyKey: expect.stringMatching(/^[A-Za-z0-9]{16,100}$/),
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
    await userEvent.click(within(dialog).getByRole('button', { name: 'Publish' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'This post is already being published.',
    );
    expect(
      within(dialog).queryByRole('button', { name: 'Publish again anyway' }),
    ).not.toBeInTheDocument();
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
