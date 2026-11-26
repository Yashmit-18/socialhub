import { createPublishJobSchema } from '@socialhub/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAccessToken } from '../../lib/api.js';
import { apiError, jsonResponse } from '../../test/fetchMock.js';
import { resumeLocalDrafts } from './services/localStore.js';
import { installObjectUrlMock } from './test/browserMocks.js';
import { setupComposerApi } from './test/fixtures.js';
import { renderComposer } from './test/renderComposer.jsx';

/**
 * The composer's Publish step, with team drafts on. MOCKED FRONTEND TESTS: the SocialHub API
 * is a fetch mock (nothing reaches a server, Redis or Meta). Every publish request body is
 * checked with the same schema the API validates with (packages/shared), and the API's own
 * behaviour is tested in apps/api/test/publishing*.test.js.
 */

vi.mock('./services/mediaInspector.js', () => ({
  INSPECTION_TIMEOUT_MS: 15000,
  inspectMediaFile: vi.fn(async () => ({ width: 1080, height: 1350, durationSec: null })),
}));
vi.setConfig({ testTimeout: 30_000 });

const WS = '/workspaces/w1';
const PACKAGES = `${WS}/content-packages`;
const JOBS = `${WS}/publish-jobs`;
const STATUS = `${WS}/publishing/status`;
const ID = 'a'.repeat(24);
const ACCOUNT = 'b'.repeat(24);
const JOB = 'c'.repeat(24);

const captionBox = () => screen.getByRole('textbox', { name: /^caption/i });
const callsTo = (mock, key) => mock.calls.filter((c) => c.key === key);

const accounts = () => [
  {
    id: ACCOUNT,
    platform: 'FACEBOOK_PAGE',
    name: 'Acme Store',
    connectionStatus: 'ACTIVE',
    publishingStatus: 'READY',
  },
];

const status = (overrides = {}) => ({
  mode: 'SIMULATED',
  canPublish: true,
  reason: null,
  message: null,
  queue: { status: 'READY', counts: { waiting: 0, active: 0, delayed: 0 } },
  worker: { status: 'RUNNING', count: 1 },
  storage: { driver: 'local', publicUrls: false },
  ...overrides,
});

const publishJob = (overrides = {}) => ({
  id: JOB,
  status: 'QUEUED',
  mode: 'SIMULATED',
  simulated: true,
  contentPackageId: ID,
  content: { captionPreview: 'Launch day', mediaCount: 0, hasVideo: false },
  counts: { QUEUED: 1 },
  destinationCount: 1,
  hiddenDestinationCount: 0,
  scheduledAt: null,
  createdBy: { id: 'u1', name: 'Ada Lovelace' },
  createdAt: new Date().toISOString(),
  canCancel: true,
  canReschedule: false,
  destinations: [
    {
      id: 'd'.repeat(24),
      socialAccountId: ACCOUNT,
      platform: 'FACEBOOK_PAGE',
      accountName: 'Acme Store',
      state: 'QUEUED',
      simulated: true,
      attemptCount: 0,
      maxAttempts: 3,
      externalPostId: null,
      externalUrl: null,
      error: null,
      warnings: [],
      attempts: [],
      canRetry: false,
      canCancel: true,
    },
  ],
  ...overrides,
});

/** A server that stores one draft and creates jobs, like the real API. */
function server({ statusBody = status(), onCreate } = {}) {
  const state = { version: 0, saved: null, jobs: [] };
  const draft = (code) =>
    jsonResponse(code, {
      contentPackage: {
        id: ID,
        status: 'DRAFT',
        version: state.version,
        ...state.saved,
        media: [],
        updatedAt: new Date().toISOString(),
      },
    });
  return {
    state,
    routes: {
      [`GET ${STATUS}`]: () => jsonResponse(200, statusBody),
      [`POST ${PACKAGES}`]: ({ init }) => {
        state.saved = JSON.parse(init.body);
        state.version = 1;
        return draft(201);
      },
      [`PATCH ${PACKAGES}/${ID}`]: ({ init }) => {
        const { version, ...input } = JSON.parse(init.body);
        state.saved = input;
        state.version = version + 1;
        return draft(200);
      },
      [`GET ${PACKAGES}`]: () => jsonResponse(200, { items: [], nextCursor: null }),
      [`POST ${JOBS}`]: ({ init }) => {
        const body = createPublishJobSchema.parse(JSON.parse(init.body));
        state.jobs.push(body);
        return (
          onCreate?.(body) ??
          jsonResponse(201, {
            publishJob: publishJob({
              scheduledAt: body.scheduledAt ?? null,
              status: body.scheduledAt ? 'SCHEDULED' : 'QUEUED',
            }),
            created: true,
          })
        );
      },
      [`GET ${JOBS}/${JOB}`]: () =>
        jsonResponse(200, {
          publishJob: publishJob({ status: 'PUBLISHED', counts: { PUBLISHED: 1 } }),
        }),
    },
  };
}

async function compose(caption = 'Launch day') {
  await userEvent.click(await screen.findByRole('checkbox', { name: /Acme Store/ }));
  await userEvent.type(captionBox(), caption);
}

const publishButton = () => screen.getByRole('button', { name: /^publish$/i });

async function openPublish() {
  await waitFor(() => expect(publishButton()).toBeEnabled());
  await userEvent.click(publishButton());
  return screen.findByRole('dialog', { name: /publish/i });
}

let objectUrls;
beforeEach(() => {
  setAccessToken(null);
  resumeLocalDrafts('u1');
  objectUrls = installObjectUrlMock();
  vi.stubEnv('VITE_COMPOSER_SERVER_DRAFTS', 'true');
});
afterEach(() => {
  objectUrls.restore();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('what the composer says Publish will do', () => {
  it('says real publishing is on in a live workspace (never "not available")', async () => {
    const api = server({ statusBody: status({ mode: 'LIVE', storage: { publicUrls: true } }) });
    setupComposerApi({ accounts: accounts(), routes: api.routes });
    renderComposer();
    await compose();
    const note = await screen.findByText('Real publishing is on.');
    expect(note.closest('[role="note"]')).toHaveTextContent(
      /sends a real post to the accounts you select, after you check the preview and confirm it/,
    );
    expect(screen.queryByText(/isn.t available/)).toBeNull();
    expect(screen.queryByText(/Simulation mode\./)).toBeNull();
  });

  it('in simulation, says nothing is posted and how real publishing is switched on', async () => {
    const api = server();
    setupComposerApi({ accounts: accounts(), routes: api.routes });
    renderComposer();
    await compose();
    const note = await screen.findByText('Simulation mode.');
    expect(note.closest('[role="note"]')).toHaveTextContent(/nothing is posted to Facebook/);
    expect(note.closest('[role="note"]')).toHaveTextContent(/switch on real publishing/);
  });
});

describe('publishing from the composer (simulation mode)', () => {
  it('says it is a simulation, saves the draft, then creates the job for the chosen account', async () => {
    const api = server();
    const mock = setupComposerApi({ accounts: accounts(), routes: api.routes });
    renderComposer();
    await compose();

    expect(publishButton()).toHaveAccessibleDescription('Simulation only: nothing is posted');
    const dialog = await openPublish();
    expect(dialog).toHaveTextContent(
      'Simulation mode: nothing will be posted to Facebook or Instagram.',
    );
    expect(within(dialog).getByRole('region', { name: 'Accounts' })).toHaveTextContent(
      'Acme Store',
    );

    await userEvent.click(within(dialog).getByRole('button', { name: 'Start simulation' }));
    await waitFor(() => expect(api.state.jobs).toHaveLength(1));
    // The draft is saved first, so the server publishes exactly what is on screen.
    const order = mock.calls.map((c) => c.key).filter((k) => k.startsWith('POST /workspaces'));
    expect(order).toEqual([`POST ${PACKAGES}`, `POST ${JOBS}`]);
    expect(api.state.saved).toMatchObject({ caption: 'Launch day', targetAccountIds: [ACCOUNT] });
    expect(api.state.jobs[0]).toMatchObject({ contentPackageId: ID, socialAccountIds: [ACCOUNT] });
    expect(api.state.jobs[0].scheduledAt).toBeUndefined();

    // The result: the job with its per-account status, never called "published" for real.
    const details = await screen.findByRole('dialog', { name: 'Post details' });
    expect(details).toHaveTextContent('Simulated');
    expect(await screen.findByText('Simulation started')).toBeInTheDocument();
    expect(screen.queryByText(/^Published$/)).toBeNull();
    expect(within(details).getByRole('link', { name: 'Open Publishing' })).toHaveAttribute(
      'href',
      '/w/acme/publishing',
    );
  });

  it('schedules for a chosen time in the workspace time zone', async () => {
    const api = server();
    setupComposerApi({ accounts: accounts(), routes: api.routes });
    renderComposer();
    await compose();
    const dialog = await openPublish();

    await userEvent.click(within(dialog).getByRole('radio', { name: /Schedule/ }));
    const date = within(dialog).getByLabelText('Date');
    const time = within(dialog).getByLabelText('Time');
    const future = new Date(Date.now() + 3 * 24 * 3600_000);
    const day = future.toISOString().slice(0, 10);
    await userEvent.clear(date);
    await userEvent.type(date, day);
    await userEvent.clear(time);
    await userEvent.type(time, '09:30');
    expect(within(dialog).getByLabelText('Time zone')).toHaveValue('UTC');
    expect(dialog).toHaveTextContent('Goes out on');

    await userEvent.click(within(dialog).getByRole('button', { name: 'Schedule simulation' }));
    await waitFor(() => expect(api.state.jobs).toHaveLength(1));
    expect(api.state.jobs[0].scheduledAt).toBe(`${day}T09:30:00.000Z`);
    expect(await screen.findByText(/^Simulation scheduled for/)).toBeInTheDocument();
  });

  it('refuses a time in the past without sending anything', async () => {
    const api = server();
    const mock = setupComposerApi({ accounts: accounts(), routes: api.routes });
    renderComposer();
    await compose();
    const dialog = await openPublish();
    await userEvent.click(within(dialog).getByRole('radio', { name: /Schedule/ }));
    const date = within(dialog).getByLabelText('Date');
    await userEvent.clear(date);
    await userEvent.type(date, '2020-01-01');
    expect(within(dialog).getByRole('alert')).toHaveTextContent(/already passed/);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Schedule simulation' }));
    expect(callsTo(mock, `POST ${JOBS}`)).toHaveLength(0);
    expect(callsTo(mock, `POST ${PACKAGES}`)).toHaveLength(0);
  });

  it('lists what must be fixed and sends nothing while the post breaks a platform rule', async () => {
    const api = server();
    const mock = setupComposerApi({
      accounts: [
        ...accounts(),
        {
          id: 'e'.repeat(24),
          platform: 'INSTAGRAM_ACCOUNT',
          name: 'Acme Instagram',
          connectionStatus: 'ACTIVE',
          publishingStatus: 'READY',
        },
      ],
      routes: api.routes,
    });
    renderComposer();
    await userEvent.click(await screen.findByRole('checkbox', { name: /Acme Instagram/ }));
    await userEvent.type(captionBox(), 'No photo');
    const dialog = await openPublish();
    expect(dialog).toHaveTextContent('Fix these before publishing');
    expect(dialog).toHaveTextContent(/Instagram posts need at least one photo or video/);
    expect(within(dialog).getByRole('button', { name: 'Start simulation' })).toBeDisabled();
    expect(callsTo(mock, `POST ${JOBS}`)).toHaveLength(0);
  });

  it('shows the server’s answer when it refuses, and nothing as sent', async () => {
    const success = vi.spyOn(toast, 'success');
    const api = server({
      onCreate: () =>
        apiError(422, 'VALIDATION_ERROR', 'Some fields are invalid', {
          fields: { socialAccountIds: 'These accounts cannot receive posts right now: Acme Store' },
        }),
    });
    setupComposerApi({ accounts: accounts(), routes: api.routes });
    renderComposer();
    await compose();
    const dialog = await openPublish();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Start simulation' }));
    expect(await within(dialog).findByText(/cannot receive posts right now/)).toBeInTheDocument();
    expect(success).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: 'Post details' })).toBeNull();
  });

  it('reuses the same request key when the same publish is retried after a failure', async () => {
    let fail = true;
    const api = server({
      onCreate: () =>
        fail
          ? apiError(
              503,
              'QUEUE_UNAVAILABLE',
              'The publishing queue (Redis) cannot be reached right now.',
            )
          : undefined,
    });
    setupComposerApi({ accounts: accounts(), routes: api.routes });
    renderComposer();
    await compose();
    const dialog = await openPublish();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Start simulation' }));
    expect(await within(dialog).findByText(/cannot be reached right now/)).toBeInTheDocument();
    fail = false;
    await userEvent.click(within(dialog).getByRole('button', { name: 'Start simulation' }));
    await waitFor(() => expect(api.state.jobs).toHaveLength(2));
    expect(api.state.jobs[1].idempotencyKey).toBe(api.state.jobs[0].idempotencyKey);
  });
});

describe('several videos for a Facebook Page', () => {
  const asset = (n) => ({
    id: `${n}`.repeat(24),
    kind: 'VIDEO',
    status: 'READY',
    fileName: `clip-${n}.mp4`,
    mimeType: 'video/mp4',
    sizeBytes: 1000,
    width: 1080,
    height: 1920,
    durationSec: 20,
    url: null,
    thumbnailUrl: null,
  });

  /** A saved team draft with two uploaded videos; copies get their own ids. */
  function videoServer() {
    const saved = {
      id: ID,
      status: 'DRAFT',
      version: 1,
      caption: 'Two clips',
      platformCaptions: {},
      hashtags: [],
      hashtagPlacement: 'CAPTION',
      keywords: [],
      firstComment: '',
      targetAccountIds: [ACCOUNT],
      media: [1, 2].map((n) => ({ mediaId: asset(n).id, altText: '', media: asset(n) })),
      updatedAt: new Date().toISOString(),
    };
    const state = { copies: [], deleted: [], jobs: [] };
    return {
      state,
      routes: {
        [`GET ${STATUS}`]: () => jsonResponse(200, status()),
        [`GET ${PACKAGES}`]: () => jsonResponse(200, { items: [saved], nextCursor: null }),
        [`GET ${PACKAGES}/${ID}`]: () => jsonResponse(200, { contentPackage: saved }),
        [`POST ${PACKAGES}`]: ({ init }) => {
          const input = JSON.parse(init.body);
          const id = `e${state.copies.length + 1}`.padEnd(24, '0');
          state.copies.push({ id, input });
          return jsonResponse(201, {
            contentPackage: { id, status: 'DRAFT', version: 1, ...input },
          });
        },
        ...Object.fromEntries(
          [1, 2].map((n) => {
            const id = `e${n}`.padEnd(24, '0');
            return [
              `DELETE ${PACKAGES}/${id}`,
              () => {
                state.deleted.push(id);
                return jsonResponse(204);
              },
            ];
          }),
        ),
        [`POST ${JOBS}`]: ({ init }) => {
          const body = createPublishJobSchema.parse(JSON.parse(init.body));
          state.jobs.push(body);
          return jsonResponse(201, {
            publishJob: publishJob({ contentPackageId: body.contentPackageId }),
            created: true,
          });
        },
      },
    };
  }

  it('publishes each video as its own post and removes the working copies', async () => {
    const api = videoServer();
    setupComposerApi({ accounts: accounts(), routes: api.routes });
    renderComposer();
    await screen.findByRole('checkbox', { name: /Acme Store/ });
    await userEvent.click(screen.getByRole('button', { name: 'Drafts' }));
    const panel = await screen.findByRole('dialog', { name: 'Team drafts' });
    await userEvent.click(await within(panel).findByRole('button', { name: /^Open/ }));
    await waitFor(() => expect(captionBox()).toHaveValue('Two clips'));

    // The readiness check explains it instead of reporting a problem.
    expect(
      await screen.findByText(/Facebook takes one video per post, so each of the 2 videos/),
    ).toBeInTheDocument();

    const dialog = await openPublish();
    expect(dialog).toHaveTextContent('2 videos, so 2 posts.');
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Simulate 2 posts' }));

    await waitFor(() => expect(api.state.jobs).toHaveLength(2));
    // One one-video copy per post, with the same text and account.
    expect(api.state.copies.map((copy) => copy.input.media)).toEqual([
      [{ mediaId: asset(1).id, altText: '' }],
      [{ mediaId: asset(2).id, altText: '' }],
    ]);
    for (const copy of api.state.copies) {
      expect(copy.input).toMatchObject({ caption: 'Two clips', targetAccountIds: [ACCOUNT] });
    }
    expect(api.state.jobs.map((job) => job.contentPackageId)).toEqual(
      api.state.copies.map((copy) => copy.id),
    );
    expect(api.state.jobs.every((job) => job.socialAccountIds[0] === ACCOUNT)).toBe(true);
    // Once each job exists, its copy is deleted: the Drafts list keeps only the team draft.
    await waitFor(() => expect(api.state.deleted).toEqual(api.state.copies.map((c) => c.id)));
    expect(await screen.findByText('2 simulations started')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: /publish/i })).toBeNull();
  });
});

describe('when publishing is not available', () => {
  it.each([
    [
      'switched off',
      status({ mode: 'DISABLED', canPublish: false, reason: 'PUBLISHING_DISABLED' }),
      'Publishing is switched off',
      'Publishing is switched off on this server.',
    ],
    [
      'without Redis',
      status({
        canPublish: false,
        reason: 'QUEUE_UNAVAILABLE',
        message:
          'The publishing queue has not been set up on this server yet (REDIS_URL is not set).',
        queue: { status: 'NOT_CONFIGURED', counts: null },
      }),
      'Publishing queue not available',
      'The publishing queue has not been set up on this server yet (REDIS_URL is not set).',
    ],
  ])('keeps Publish disabled and says why (%s)', async (_label, statusBody, short, full) => {
    const api = server({ statusBody });
    const mock = setupComposerApi({ accounts: accounts(), routes: api.routes });
    renderComposer();
    await compose();
    await waitFor(() => expect(publishButton()).toHaveAccessibleDescription(short));
    expect(publishButton()).toBeDisabled();
    // The full reason, from the server, is in the note above the composer.
    expect(screen.getByRole('note')).toHaveTextContent(full);
    expect(callsTo(mock, `POST ${JOBS}`)).toHaveLength(0);
  });

  it('lets an editor publish: editors hold content:publish for their own accounts', async () => {
    const api = server();
    setupComposerApi({ role: 'EDITOR', accounts: accounts(), routes: api.routes });
    renderComposer();
    await compose();
    await waitFor(() => expect(publishButton()).toBeEnabled());
  });
});
