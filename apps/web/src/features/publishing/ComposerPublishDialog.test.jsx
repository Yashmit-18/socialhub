// The composer's Publish dialog: checks shown before anything is saved or sent. MOCKED
// FRONTEND TESTS: the SocialHub API is mocked with fetch; nothing contacts a server or Meta.
import { PUBLISHING_LIMITS } from '@socialhub/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setAccessToken } from '../../lib/api.js';
import { apiError, jsonResponse, mockFetch } from '../../test/fetchMock.js';
import { ComposerPublishDialog } from './ComposerPublishDialog.jsx';
import { BASE, WS, job, status } from './fixtures.js';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

const account = (i) => ({
  id: String(i).padStart(24, '0'),
  name: `Page ${i}`,
  platform: 'FACEBOOK_PAGE',
  publishable: true,
});

/** `routes` adds or replaces mocked API routes; the result is the fetch mock plus helpers. */
function renderDialog({ mode = 'SIMULATED', routes = {}, ...props } = {}) {
  const mock = mockFetch({
    [`GET ${BASE}/publishing/status`]: () =>
      jsonResponse(200, status({ mode, workspaceMode: mode === 'LIVE' ? 'LIVE' : 'SIMULATED' })),
    ...routes,
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const dialog = (extra = {}) => (
    <QueryClientProvider client={queryClient}>
      <ComposerPublishDialog
        workspaceId={WS}
        workspaceTimeZone="UTC"
        accounts={[account(1)]}
        prepare={vi.fn()}
        onClose={vi.fn()}
        onCreated={vi.fn()}
        {...props}
        {...extra}
      />
    </QueryClientProvider>
  );
  const { rerender } = render(dialog());
  return Object.assign(mock, {
    queryClient,
    rerenderWith: (extra) => rerender(dialog(extra)),
  });
}

const sendButton = () => screen.getByRole('button', { name: /Start simulation|Publish/ });

beforeEach(() => {
  setAccessToken('test-token');
});

describe('ComposerPublishDialog', () => {
  it(`refuses more than ${PUBLISHING_LIMITS.DESTINATIONS_MAX} accounts before saving anything`, async () => {
    const many = Array.from({ length: PUBLISHING_LIMITS.DESTINATIONS_MAX + 1 }, (_, i) =>
      account(i + 1),
    );
    const prepare = vi.fn();
    const mock = renderDialog({ accounts: many, prepare });
    expect(
      await screen.findByText(
        `A post can go to at most ${PUBLISHING_LIMITS.DESTINATIONS_MAX} accounts at once. ${many.length} are selected.`,
      ),
    ).toBeInTheDocument();
    await waitFor(() => expect(sendButton()).toBeDisabled());
    expect(prepare).not.toHaveBeenCalled();
    expect(mock.count(`POST ${BASE}/publish-jobs`)).toBe(0);
  });

  it('allows exactly the maximum', async () => {
    const most = Array.from({ length: PUBLISHING_LIMITS.DESTINATIONS_MAX }, (_, i) =>
      account(i + 1),
    );
    renderDialog({ accounts: most });
    await waitFor(() => expect(sendButton()).toBeEnabled());
    expect(screen.queryByText(/at most .* accounts at once/)).toBeNull();
  });

  it('warns that hashtags set for the first comment will not be posted, even with no comment', async () => {
    renderDialog({ hashtagsInFirstComment: true });
    expect(
      await screen.findByText(/hashtags are set to go in the first comment.*will not be posted/),
    ).toBeInTheDocument();
    // A warning, not a blocker.
    await waitFor(() => expect(sendButton()).toBeEnabled());
  });

  it('says nothing about hashtags when they go in the caption', async () => {
    renderDialog({ hashtagsInFirstComment: false });
    await waitFor(() => expect(sendButton()).toBeEnabled());
    expect(screen.queryByText(/hashtags are set to go in the first comment/)).toBeNull();
  });
});

describe('ComposerPublishDialog: what is posted, and real posts', () => {
  const image = (id, alt) => ({
    id,
    kind: 'IMAGE',
    fileName: `${id}.png`,
    previewUrl: `blob:preview-${id}`,
    posterUrl: null,
    altText: alt,
  });

  it('shows the images and the exact caption each platform receives', async () => {
    renderDialog({
      media: [image('a', 'Sunset over the bay'), image('b', '')],
      captions: [
        { platform: 'FACEBOOK_PAGE', text: ['Hello Facebook', '', '#news'].join('\n') },
        { platform: 'INSTAGRAM_ACCOUNT', text: 'Hello Instagram' },
      ],
    });
    const preview = await screen.findByRole('region', { name: 'What will be posted' });
    expect(within(preview).getByRole('img', { name: 'Sunset over the bay' })).toHaveAttribute(
      'src',
      'blob:preview-a',
    );
    expect(within(preview).getByRole('img', { name: 'b.png' })).toBeInTheDocument();
    expect(within(preview).getByText(/Hello Facebook/)).toHaveTextContent('#news');
    expect(within(preview).getByText('Hello Instagram')).toBeInTheDocument();
    expect(within(preview).getByText('Facebook Page')).toBeInTheDocument();
  });

  it('shows one caption when every platform receives the same text', async () => {
    renderDialog({
      captions: [
        { platform: 'FACEBOOK_PAGE', text: 'Same text' },
        { platform: 'INSTAGRAM_ACCOUNT', text: 'Same text' },
      ],
    });
    const preview = await screen.findByRole('region', { name: 'What will be posted' });
    expect(within(preview).getAllByText('Same text')).toHaveLength(1);
    expect(within(preview).queryByText('Facebook Page')).toBeNull();
  });

  it('in real publishing, sends nothing until the person confirms a real public post', async () => {
    const prepare = vi.fn();
    const mock = renderDialog({
      mode: 'LIVE',
      accounts: [{ ...account(1), name: 'Yashmit talks' }],
      prepare,
    });
    expect(await screen.findByText('This creates a REAL public post.')).toBeInTheDocument();
    expect(
      screen.getByText(/published on Yashmit talks as soon as you confirm/),
    ).toBeInTheDocument();
    const publish = screen.getByRole('button', { name: 'Publish now' });
    expect(publish).toBeDisabled();
    await userEvent.click(publish);
    expect(prepare).not.toHaveBeenCalled();
    expect(mock.count(`POST ${BASE}/publish-jobs`)).toBe(0);

    await userEvent.click(
      screen.getByRole('checkbox', { name: /publishes a real post on these accounts/ }),
    );
    expect(publish).toBeEnabled();
  });

  it('asks no such confirmation in simulation', async () => {
    renderDialog({ mode: 'SIMULATED' });
    await waitFor(() => expect(sendButton()).toBeEnabled());
    expect(screen.queryByText('This creates a REAL public post.')).toBeNull();
  });
});

describe('ComposerPublishDialog: the confirmation reaches the server', () => {
  const CREATE = `POST ${BASE}/publish-jobs`;
  const DRAFT_ID = 'c00000000000000000000001';
  const created = () => jsonResponse(201, { publishJob: job(), created: true });
  const bodies = (mock) =>
    mock.calls.filter((c) => c.key === CREATE).map((c) => JSON.parse(c.init.body));
  const confirmBox = () =>
    screen.findByRole('checkbox', { name: /publishes a real post on these accounts/ });

  it('sends confirmRealPost: true only after the person ticked it', async () => {
    const mock = renderDialog({
      mode: 'LIVE',
      prepare: vi.fn().mockResolvedValue(DRAFT_ID),
      routes: { [CREATE]: created },
    });
    await userEvent.click(await confirmBox());
    await userEvent.click(screen.getByRole('button', { name: 'Publish now' }));
    await waitFor(() => expect(mock.count(CREATE)).toBe(1));
    expect(bodies(mock)[0]).toEqual({
      contentPackageId: DRAFT_ID,
      socialAccountIds: [account(1).id],
      idempotencyKey: expect.stringMatching(/^[A-Za-z0-9]{16,100}$/),
      confirmRealPost: true,
    });
  });

  it('sends no confirmation for a simulation', async () => {
    const mock = renderDialog({
      mode: 'SIMULATED',
      prepare: vi.fn().mockResolvedValue(DRAFT_ID),
      routes: { [CREATE]: created },
    });
    await waitFor(() => expect(sendButton()).toBeEnabled());
    await userEvent.click(screen.getByRole('button', { name: 'Start simulation' }));
    await waitFor(() => expect(mock.count(CREATE)).toBe(1));
    expect(bodies(mock)[0]).not.toHaveProperty('confirmRealPost');
  });

  it('a change of mode clears the confirmation, also when it comes back to live', async () => {
    let mode = 'LIVE';
    const mock = renderDialog({
      routes: {
        [`GET ${BASE}/publishing/status`]: () => jsonResponse(200, status({ mode })),
      },
    });
    await userEvent.click(await confirmBox());
    expect(screen.getByRole('button', { name: 'Publish now' })).toBeEnabled();

    mode = 'SIMULATED';
    await mock.queryClient.refetchQueries();
    await waitFor(() => expect(screen.queryByText('This creates a REAL public post.')).toBeNull());
    mode = 'LIVE';
    await mock.queryClient.refetchQueries();
    expect(await confirmBox()).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Publish now' })).toBeDisabled();
  });

  it('a change of workspace clears the confirmation', async () => {
    const mock = renderDialog({
      mode: 'LIVE',
      routes: {
        'GET /workspaces/w2/publishing/status': () => jsonResponse(200, status({ mode: 'LIVE' })),
      },
    });
    await userEvent.click(await confirmBox());
    mock.rerenderWith({ workspaceId: 'w2' });
    await waitFor(async () => expect(await confirmBox()).not.toBeChecked());
    expect(screen.getByRole('button', { name: 'Publish now' })).toBeDisabled();
  });

  it('a change of accounts, files or caption clears the confirmation', async () => {
    const captions = [{ platform: 'FACEBOOK_PAGE', text: 'First text' }];
    const mock = renderDialog({ mode: 'LIVE', captions });
    const changes = [
      { captions: [{ platform: 'FACEBOOK_PAGE', text: 'Edited text' }] },
      { captions, accounts: [account(1), account(2)] },
      {
        captions,
        media: [{ id: 'm9', kind: 'IMAGE', previewUrl: 'blob:m9', fileName: 'm9.png' }],
      },
    ];
    for (const change of changes) {
      await userEvent.click(await confirmBox());
      expect(screen.getByRole('button', { name: 'Publish now' })).toBeEnabled();
      mock.rerenderWith(change);
      await waitFor(async () => expect(await confirmBox()).not.toBeChecked());
      expect(screen.getByRole('button', { name: 'Publish now' })).toBeDisabled();
    }
  });

  it('when the server says the post would be real, it asks for the confirmation and keeps the key', async () => {
    let mode = 'SIMULATED';
    const mock = renderDialog({
      prepare: vi.fn().mockResolvedValue(DRAFT_ID),
      routes: {
        [`GET ${BASE}/publishing/status`]: () => jsonResponse(200, status({ mode })),
        [CREATE]: ({ init }) => {
          if (JSON.parse(init.body).confirmRealPost === true) return created();
          // Meanwhile an owner switched the workspace to real publishing.
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
    await waitFor(() => expect(sendButton()).toBeEnabled());
    await userEvent.click(screen.getByRole('button', { name: 'Start simulation' }));
    expect(
      await screen.findByText(/Confirm that you want to publish it for real/),
    ).toBeInTheDocument();
    // The status was read again: the dialog now shows the real-post confirmation.
    const box = await confirmBox();
    expect(box).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Publish now' })).toBeDisabled();

    await userEvent.click(box);
    await userEvent.click(screen.getByRole('button', { name: 'Publish now' }));
    await waitFor(() => expect(mock.count(CREATE)).toBe(2));
    const [first, second] = bodies(mock);
    expect(first).not.toHaveProperty('confirmRealPost');
    expect(second.confirmRealPost).toBe(true);
    expect(second.idempotencyKey).toBe(first.idempotencyKey);
  });
});
