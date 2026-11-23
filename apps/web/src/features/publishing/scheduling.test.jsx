// Scheduling on the Publishing screen. MOCKED FRONTEND TESTS: the SocialHub API is mocked
// with fetch; nothing here talks to a real server, to Redis or to Meta. The API side of
// scheduling is tested in apps/api/test/publishing.schedule.test.js.
import { createPublishJobSchema, rescheduleJobSchema } from '@socialhub/shared';
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

vi.setConfig({ testTimeout: 30_000 });
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

beforeEach(() => {
  setAccessToken('test-token');
  vi.clearAllMocks();
});
afterEach(() => vi.unstubAllGlobals());

const LIST = `GET ${BASE}/publish-jobs`;
const bodyOf = (call) => JSON.parse(call.init.body);
const inHours = (h) => new Date(Date.now() + h * 3600_000).toISOString();

const scheduledJob = (overrides = {}) => {
  const at = overrides.scheduledAt ?? inHours(5);
  return job({
    id: 'job-sched',
    status: 'SCHEDULED',
    mode: 'SIMULATED',
    simulated: true,
    scheduledAt: at,
    canCancel: true,
    canReschedule: true,
    destinations: [destination({ state: 'SCHEDULED', scheduledAt: at, canCancel: true })],
    ...overrides,
  });
};

function setup({
  jobs = [],
  role = 'OWNER',
  routes = {},
  path = '/w/acme/publishing?tab=scheduled',
} = {}) {
  const mock = mockFetch({
    [`GET ${BASE}/publishing/status`]: () =>
      jsonResponse(
        200,
        status({ mode: 'SIMULATED', storage: { driver: 'local', publicUrls: false } }),
      ),
    [`GET ${BASE}/publish-jobs/summary`]: () =>
      jsonResponse(200, summary({ SCHEDULED: jobs.length })),
    [LIST]: () => jsonResponse(200, { items: jobs, nextCursor: null }),
    ...Object.fromEntries(
      jobs.map((j) => [
        `GET ${BASE}/publish-jobs/${j.id}`,
        () => jsonResponse(200, { publishJob: j }),
      ]),
    ),
    ...routes,
  });
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
  return mock;
}

describe('the Scheduled tab', () => {
  it('asks for scheduled jobs soonest first and shows when each goes out', async () => {
    const mock = setup({ jobs: [scheduledJob()] });
    const row = await screen.findByTestId('publish-job-job-sched');
    const listCall = mock.calls.find((c) => c.key === LIST);
    expect(listCall.url.searchParams.get('status')).toBe('SCHEDULED');
    expect(listCall.url.searchParams.get('order')).toBe('scheduled');
    expect(row).toHaveTextContent(/Goes out .*UTC/);
    expect(row).toHaveTextContent(/in 5 hours/);
    expect(screen.getByRole('button', { name: 'Scheduled (1)' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('has its own empty state', async () => {
    setup({ jobs: [] });
    expect(await screen.findByText('Nothing is scheduled')).toBeInTheDocument();
  });

  it('offers no changes to members who cannot publish', async () => {
    setup({ jobs: [scheduledJob({ canReschedule: false, canCancel: false })], role: 'VIEWER' });
    const row = await screen.findByTestId('publish-job-job-sched');
    expect(within(row).queryByRole('button', { name: /Change time/ })).toBeNull();
  });
});

describe('changing the time', () => {
  it('sends the new time in the workspace time zone and refreshes the list', async () => {
    const original = scheduledJob();
    const mock = setup({
      jobs: [original],
      routes: {
        [`PATCH ${BASE}/publish-jobs/job-sched/schedule`]: ({ init }) =>
          jsonResponse(200, {
            publishJob: { ...original, scheduledAt: JSON.parse(init.body).scheduledAt },
          }),
      },
    });
    const row = await screen.findByTestId('publish-job-job-sched');
    await userEvent.click(within(row).getByRole('button', { name: /Change time/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Change scheduled time' });

    const day = inHours(48).slice(0, 10);
    const date = within(dialog).getByLabelText('Date');
    await userEvent.clear(date);
    await userEvent.type(date, day);
    const time = within(dialog).getByLabelText('Time');
    await userEvent.clear(time);
    await userEvent.type(time, '18:45');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save new time' }));

    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    const patch = mock.calls.find((c) => c.key.startsWith('PATCH'));
    const body = rescheduleJobSchema.parse(bodyOf(patch));
    expect(body.scheduledAt).toBe(`${day}T18:45:00.000Z`);
    expect(toast.success.mock.calls.at(-1)[1]).toMatchObject({
      description: 'Simulation: nothing will be posted.',
    });
    await waitFor(() => expect(mock.calls.filter((c) => c.key === LIST).length).toBeGreaterThan(1));
  });

  it('refuses a past time without asking the server', async () => {
    const mock = setup({ jobs: [scheduledJob()] });
    const row = await screen.findByTestId('publish-job-job-sched');
    await userEvent.click(within(row).getByRole('button', { name: /Change time/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Change scheduled time' });
    const date = within(dialog).getByLabelText('Date');
    await userEvent.clear(date);
    await userEvent.type(date, '2020-05-01');
    expect(within(dialog).getByRole('alert')).toHaveTextContent(/already passed/);
    expect(within(dialog).getByRole('button', { name: 'Save new time' })).toBeDisabled();
    expect(mock.calls.some((c) => c.key.startsWith('PATCH'))).toBe(false);
  });

  it('explains when the post started before the change arrived', async () => {
    setup({
      jobs: [scheduledJob()],
      routes: {
        [`PATCH ${BASE}/publish-jobs/job-sched/schedule`]: () =>
          apiError(409, 'CONFLICT', 'No longer waiting', { reason: 'NOT_RESCHEDULABLE' }),
      },
    });
    const row = await screen.findByTestId('publish-job-job-sched');
    await userEvent.click(within(row).getByRole('button', { name: /Change time/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Change scheduled time' });
    const time = within(dialog).getByLabelText('Time');
    await userEvent.clear(time);
    await userEvent.type(time, '23:15');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save new time' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      /no longer waiting for its scheduled time/,
    );
  });

  it('can also be reached from the post details, next to cancelling', async () => {
    setup({ jobs: [scheduledJob()] });
    const row = await screen.findByTestId('publish-job-job-sched');
    await userEvent.click(within(row).getByRole('button', { name: /View details/ }));
    const details = await screen.findByRole('dialog', { name: 'Post details' });
    expect(within(details).getByRole('button', { name: 'Cancel all waiting' })).toBeInTheDocument();
    await userEvent.click(within(details).getByRole('button', { name: 'Change time' }));
    expect(
      await screen.findByRole('dialog', { name: 'Change scheduled time' }),
    ).toBeInTheDocument();
  });
});

describe('scheduling a saved draft', () => {
  it('sends the chosen time with the draft', async () => {
    const mock = setup({
      path: '/w/acme/publishing',
      routes: {
        [`GET ${BASE}/content-packages`]: () =>
          jsonResponse(200, { items: [draft()], nextCursor: null }),
        [`POST ${BASE}/publish-jobs`]: ({ init }) => {
          const body = createPublishJobSchema.parse(JSON.parse(init.body));
          return jsonResponse(201, {
            publishJob: scheduledJob({ scheduledAt: body.scheduledAt }),
            created: true,
          });
        },
      },
    });
    await userEvent.click(await screen.findByRole('button', { name: /Publish a draft/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Publish a draft' });
    await userEvent.click(await within(dialog).findByRole('radio', { name: /Winter collection/ }));
    await userEvent.click(within(dialog).getByRole('radio', { name: /Schedule/ }));
    const day = inHours(72).slice(0, 10);
    const date = within(dialog).getByLabelText('Date');
    await userEvent.clear(date);
    await userEvent.type(date, day);
    const time = within(dialog).getByLabelText('Time');
    await userEvent.clear(time);
    await userEvent.type(time, '07:00');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Schedule simulation' }));

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        expect.stringMatching(/^Simulation scheduled for/),
        expect.objectContaining({
          description: 'Nothing will be posted to Facebook or Instagram.',
        }),
      ),
    );
    const create = mock.calls.find((c) => c.key === `POST ${BASE}/publish-jobs`);
    expect(bodyOf(create).scheduledAt).toBe(`${day}T07:00:00.000Z`);
  });
});
