// The composer's Publish dialog: checks shown before anything is saved or sent. MOCKED
// FRONTEND TESTS: the SocialHub API is mocked with fetch; nothing contacts a server or Meta.
import { PUBLISHING_LIMITS } from '@socialhub/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setAccessToken } from '../../lib/api.js';
import { jsonResponse, mockFetch } from '../../test/fetchMock.js';
import { ComposerPublishDialog } from './ComposerPublishDialog.jsx';
import { BASE, WS, status } from './fixtures.js';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

const account = (i) => ({
  id: String(i).padStart(24, '0'),
  name: `Page ${i}`,
  platform: 'FACEBOOK_PAGE',
  publishable: true,
});

function renderDialog(props = {}) {
  const mock = mockFetch({
    [`GET ${BASE}/publishing/status`]: () => jsonResponse(200, status({ mode: 'SIMULATED' })),
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <ComposerPublishDialog
        workspaceId={WS}
        workspaceTimeZone="UTC"
        accounts={[account(1)]}
        prepare={vi.fn()}
        onClose={vi.fn()}
        onCreated={vi.fn()}
        {...props}
      />
    </QueryClientProvider>,
  );
  return mock;
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
