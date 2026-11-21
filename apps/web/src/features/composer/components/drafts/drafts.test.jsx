import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link, RouterProvider, createMemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiError, jsonResponse } from '../../../../test/fetchMock.js';
import { SERVER_DRAFT_CONFLICT_MESSAGE } from '../../hooks/useServerDraft.js';
import { useUnsavedChangesGuard } from '../../hooks/useUnsavedChangesGuard.js';
import { CAPABILITY_MESSAGES } from '../../services/capabilities.js';
import { setupComposerApi } from '../../test/fixtures.js';
import { ComposerActionBar } from './ComposerActionBar.jsx';
import { DraftRestoreBanner } from './DraftRestoreBanner.jsx';
import { DraftStatus } from './DraftStatus.jsx';
import { DraftsPanel } from './DraftsPanel.jsx';
import { UnsavedChangesDialog } from './UnsavedChangesDialog.jsx';

const ago = (ms) => new Date(Date.now() - ms).toISOString();
const MINUTE = 60_000;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

/* ------------------------------------------------------------- DraftStatus */

/** The visible status line (the live region is a separate, visually hidden element). */
const statusLine = (container) => container.querySelector('p').textContent;

describe('DraftStatus', () => {
  describe('in this browser', () => {
    it.each([
      [{ status: 'idle', savedAt: null, reason: null }, 'Not saved yet'],
      [{ status: 'pending', savedAt: null, reason: null }, 'Saving in this browser…'],
      [{ status: 'paused', savedAt: null, reason: null }, 'Autosave paused'],
      [
        { status: 'error', savedAt: null, reason: 'quota' },
        "Couldn't autosave: this browser's storage is full",
      ],
      [{ status: 'error', savedAt: null, reason: 'error' }, "Couldn't autosave in this browser"],
      [
        { status: 'unavailable', savedAt: null, reason: 'unavailable' },
        'Autosave is off: this browser blocks storage',
      ],
    ])('%o reads "%s"', (local, text) => {
      const { container } = render(<DraftStatus local={local} />);
      expect(statusLine(container)).toBe(text);
    });

    it('says when the draft was saved in this browser', () => {
      const savedAt = ago(1000);
      const { container, rerender } = render(<DraftStatus local={{ status: 'saved', savedAt }} />);
      expect(statusLine(container)).toBe('Saved in this browser · just now');
      expect(container.querySelector('time')).toHaveAttribute('datetime', savedAt);

      rerender(<DraftStatus local={{ status: 'saved', savedAt: ago(5 * MINUTE) }} />);
      expect(statusLine(container)).toBe('Saved in this browser · 5 minutes ago');
    });

    it('explains a paused autosave', () => {
      const { container } = render(<DraftStatus local={{ status: 'paused' }} />);
      expect(container.firstChild).toHaveAttribute(
        'title',
        'Restore or discard your earlier draft to turn autosave back on.',
      );
    });

    it('announces outcomes politely without repeating them on every keystroke', () => {
      const { rerender } = render(<DraftStatus local={{ status: 'pending', savedAt: null }} />);
      const live = screen.getByRole('status');
      expect(live).toHaveAttribute('aria-live', 'polite');
      expect(live).toBeEmptyDOMElement();

      const savedAt = ago(0);
      rerender(<DraftStatus local={{ status: 'saved', savedAt }} />);
      expect(live).toHaveTextContent('Saved in this browser');
      // Typing again: the visible text changes, the announcement does not.
      rerender(<DraftStatus local={{ status: 'pending', savedAt }} />);
      expect(live).toHaveTextContent('Saved in this browser');
      expect(live).not.toHaveTextContent('Saving');

      rerender(<DraftStatus local={{ status: 'error', savedAt, reason: 'quota' }} />);
      expect(live).toHaveTextContent("Couldn't autosave: this browser's storage is full");
    });

    it('uses device wording while team drafts are unavailable', () => {
      const { container } = render(
        <DraftStatus
          local={{ status: 'saved', savedAt: ago(0) }}
          server={{ available: false, status: 'unavailable' }}
        />,
      );
      expect(statusLine(container)).toBe('Saved in this browser · just now');
      expect(screen.queryByText(/team drafts/i)).not.toBeInTheDocument();
    });
  });

  describe('team drafts', () => {
    const server = (overrides = {}) => ({
      available: true,
      status: 'idle',
      draft: null,
      error: null,
      dirty: false,
      ...overrides,
    });

    it.each([
      [server({ status: 'saving' }), 'Saving…'],
      [
        server({ status: 'error', error: new Error('The content service is down.') }),
        "Couldn't save",
      ],
      [
        server({ status: 'conflict', error: new Error(SERVER_DRAFT_CONFLICT_MESSAGE) }),
        'Not saved: someone else changed this draft',
      ],
      [server({ dirty: true }), 'Unsaved changes'],
      [server(), 'Not saved yet'],
    ])('%o reads "%s"', (serverDraft, text) => {
      const { container } = render(<DraftStatus server={serverDraft} />);
      expect(statusLine(container)).toBe(text);
    });

    it('shows the time the server saved the draft', () => {
      const { container } = render(
        <DraftStatus
          local={{ status: 'saved', savedAt: ago(0) }}
          server={server({
            status: 'saved',
            draft: { id: 'pkg1', version: 2, savedAt: ago(2 * MINUTE), savedRevision: 3 },
          })}
        />,
      );
      expect(statusLine(container)).toBe('Saved to team drafts · 2 minutes ago');
      expect(screen.getByRole('status')).toHaveTextContent('Saved to team drafts');
    });

    it('mentions the copy kept in this browser while team changes are unsaved', () => {
      const { container } = render(
        <DraftStatus
          local={{ status: 'saved', savedAt: ago(0) }}
          server={server({ dirty: true })}
        />,
      );
      expect(statusLine(container)).toBe('Unsaved changes · kept in this browser');
    });

    it('puts the server error in the tooltip', () => {
      const { container } = render(
        <DraftStatus
          server={server({ status: 'error', error: new Error('The content service is down.') })}
        />,
      );
      expect(container.firstChild).toHaveAttribute('title', 'The content service is down.');
      expect(screen.getByRole('status')).toHaveTextContent("Couldn't save the draft");
    });
  });
});

/* ------------------------------------------------------ DraftRestoreBanner */

describe('DraftRestoreBanner', () => {
  it('offers the draft found in this browser', async () => {
    const user = userEvent.setup();
    const onRestore = vi.fn();
    const onDiscard = vi.fn();
    render(
      <DraftRestoreBanner
        savedAt={ago(2 * 60 * MINUTE)}
        missingMedia={[]}
        onRestore={onRestore}
        onDiscard={onDiscard}
      />,
    );
    const region = screen.getByRole('region', { name: 'Unsaved draft' });
    expect(region).toHaveTextContent('You have an unsaved draft from 2 hours ago in this browser.');
    expect(region).toHaveTextContent("It's kept on this device only.");
    expect(within(region).queryByRole('list')).not.toBeInTheDocument();

    await user.click(within(region).getByRole('button', { name: 'Restore draft' }));
    expect(onRestore).toHaveBeenCalledTimes(1);
    await user.click(within(region).getByRole('button', { name: 'Discard draft' }));
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });

  it('lists the media files that could not be kept', () => {
    render(
      <DraftRestoreBanner
        savedAt={ago(MINUTE)}
        missingMedia={[
          { fileName: 'beach.jpg', kind: 'IMAGE', altText: '' },
          { fileName: 'promo.mp4', kind: 'VIDEO', altText: '' },
        ]}
        onRestore={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );
    expect(
      screen.getByText("2 media files weren't kept. Add them again after restoring."),
    ).toBeInTheDocument();
    const list = screen.getByRole('list', { name: 'Files to add again' });
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['Image: beach.jpg', 'Video: promo.mp4']);
  });

  it('uses the singular for one file and reads naturally for a fresh draft', () => {
    render(
      <DraftRestoreBanner
        savedAt={ago(0)}
        missingMedia={[{ fileName: 'beach.jpg', kind: 'IMAGE' }]}
        onRestore={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );
    expect(
      screen.getByText("1 media file wasn't kept. Add it again after restoring."),
    ).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Unsaved draft' })).toHaveTextContent(
      'You have an unsaved draft from a moment ago in this browser.',
    );
  });

  it('warns that restoring replaces what is in the composer', () => {
    render(
      <DraftRestoreBanner
        savedAt={ago(MINUTE)}
        hasCurrentContent
        onRestore={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );
    expect(screen.getByText("Restoring replaces what's in the composer now.")).toBeInTheDocument();
  });
});

/* ------------------------------------------------------- ComposerActionBar */

function barProps(overrides = {}) {
  return {
    status: <span>Saved in this browser</span>,
    issueSummary: { errors: 0, warnings: 0 },
    onSaveDraft: vi.fn(),
    canSave: true,
    saveLabel: 'Save draft in this browser',
    onDiscard: vi.fn(),
    ...overrides,
  };
}

describe('ComposerActionBar', () => {
  it('keeps Publish disabled and explains why', () => {
    render(<ComposerActionBar {...barProps()} />);
    const publish = screen.getByRole('button', { name: 'Publish' });
    expect(publish).toBeDisabled();
    expect(publish).toHaveAccessibleDescription("Publishing isn't available yet");
    expect(screen.getByText("Publishing isn't available yet")).toBeVisible();
  });

  it('keeps Publish disabled even when nothing is wrong, with the given message', () => {
    render(
      <ComposerActionBar
        {...barProps({ publishingMessage: 'Publishing isn’t available yet' })}
        issueSummary={{ errors: 0, warnings: 0 }}
      />,
    );
    expect(screen.getByText('No problems found')).toBeInTheDocument();
    const publish = screen.getByRole('button', { name: 'Publish' });
    expect(publish).toBeDisabled();
    expect(publish).toHaveAccessibleDescription('Publishing isn’t available yet');
  });

  it('is a labelled sticky region that shows the save status', () => {
    render(<ComposerActionBar {...barProps()} />);
    const region = screen.getByRole('region', { name: 'Post actions' });
    expect(region).toHaveClass('sticky', 'bottom-0');
    expect(within(region).getByText('Saved in this browser')).toBeInTheDocument();
  });

  it('saves with the Save button', async () => {
    const user = userEvent.setup();
    const props = barProps();
    render(<ComposerActionBar {...props} />);
    await user.click(screen.getByRole('button', { name: 'Save draft in this browser' }));
    expect(props.onSaveDraft).toHaveBeenCalledTimes(1);
    expect(props.onSaveDraft).toHaveBeenCalledWith();
  });

  it('disables Save when there is nothing to save, and while saving', () => {
    const { rerender } = render(<ComposerActionBar {...barProps({ canSave: false })} />);
    expect(screen.getByRole('button', { name: 'Save draft in this browser' })).toBeDisabled();

    rerender(<ComposerActionBar {...barProps({ saving: true })} />);
    const save = screen.getByRole('button', { name: 'Save draft in this browser' });
    expect(save).toBeDisabled();
    expect(save).toHaveAttribute('aria-busy', 'true');
  });

  it('saves with Ctrl+S or ⌘S', async () => {
    const user = userEvent.setup();
    const props = barProps();
    render(<ComposerActionBar {...props} />);
    expect(screen.getByRole('button', { name: 'Save draft in this browser' })).toHaveAttribute(
      'aria-keyshortcuts',
      'Control+S Meta+S',
    );
    await user.keyboard('{Control>}s{/Control}');
    expect(props.onSaveDraft).toHaveBeenCalledTimes(1);
    await user.keyboard('{Meta>}s{/Meta}');
    expect(props.onSaveDraft).toHaveBeenCalledTimes(2);
  });

  it('ignores the shortcut when Save is unavailable, without opening the browser save dialog', () => {
    const props = barProps({ canSave: false });
    render(<ComposerActionBar {...props} />);
    const notPrevented = fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    expect(notPrevented).toBe(false);
    expect(props.onSaveDraft).not.toHaveBeenCalled();
    expect(fireEvent.keyDown(window, { key: 's' })).toBe(true);
  });

  it('asks before discarding the post', async () => {
    const user = userEvent.setup();
    const props = barProps();
    render(<ComposerActionBar {...props} />);

    await user.click(screen.getByRole('button', { name: 'Discard' }));
    const dialog = screen.getByRole('dialog', { name: 'Discard this post?' });
    expect(dialog).toHaveAccessibleDescription(
      'Its caption, settings and attached files are removed from the composer and this browser.',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(props.onDiscard).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Discard' }));
    await user.click(screen.getByRole('button', { name: 'Discard post' }));
    expect(props.onDiscard).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('keeps the dialog open with the error when discarding fails', async () => {
    const user = userEvent.setup();
    const onDiscard = vi.fn(() =>
      Promise.reject(new Error('The team draft could not be deleted.')),
    );
    render(<ComposerActionBar {...barProps({ onDiscard })} />);
    await user.click(screen.getByRole('button', { name: 'Discard' }));
    await user.click(screen.getByRole('button', { name: 'Discard post' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The team draft could not be deleted.',
    );
    expect(screen.getByRole('dialog', { name: 'Discard this post?' })).toBeInTheDocument();
  });

  it('disables Discard when there is nothing to discard', () => {
    render(<ComposerActionBar {...barProps({ discardDisabled: true })} />);
    expect(screen.getByRole('button', { name: 'Discard' })).toBeDisabled();
  });

  it('offers Drafts only when drafts can be opened', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<ComposerActionBar {...barProps()} />);
    expect(screen.queryByRole('button', { name: 'Drafts' })).not.toBeInTheDocument();

    const onOpenDrafts = vi.fn();
    rerender(<ComposerActionBar {...barProps({ onOpenDrafts })} />);
    await user.click(screen.getByRole('button', { name: 'Drafts' }));
    expect(onOpenDrafts).toHaveBeenCalledTimes(1);
  });

  it.each([
    [{ errors: 2, warnings: 1 }, '2 errors · 1 warning'],
    [{ errors: 1, warnings: 0 }, '1 error'],
    [{ errors: 0, warnings: 3 }, '3 warnings'],
    [{ errors: 0, warnings: 0 }, 'No problems found'],
  ])('summarizes the readiness check %o as "%s"', (issueSummary, text) => {
    render(<ComposerActionBar {...barProps({ issueSummary })} />);
    expect(screen.getByText(text)).toBeInTheDocument();
  });

  it('can jump to the readiness check', async () => {
    const user = userEvent.setup();
    const onShowIssues = vi.fn();
    render(
      <ComposerActionBar
        {...barProps({ issueSummary: { errors: 2, warnings: 1 }, onShowIssues })}
      />,
    );
    await user.click(
      screen.getByRole('button', { name: 'Readiness check, 3 issues: 2 errors · 1 warning' }),
    );
    expect(onShowIssues).toHaveBeenCalledTimes(1);
  });

  it('shortens the readiness summary on small screens and keeps that text in the name', () => {
    render(<ComposerActionBar {...barProps({ issueSummary: { errors: 2, warnings: 1 } })} />);
    const short = screen.getByText('3 issues');
    expect(short).toHaveAttribute('aria-hidden', 'true');
    expect(short).toHaveClass('sm:hidden');
    expect(screen.getByText('2 errors · 1 warning')).toHaveClass('max-sm:sr-only');
    // WCAG 2.5.3: what phones show ("3 issues") is also part of what is announced.
    expect(screen.getByText('Readiness check, 3 issues:')).toHaveClass('sr-only');
  });

  it('makes saving the primary action and Publish visibly unavailable', () => {
    render(<ComposerActionBar {...barProps()} />);
    expect(screen.getByRole('button', { name: /save draft/i })).toHaveClass('bg-brand-600');
    const publish = screen.getByRole('button', { name: 'Publish' });
    expect(publish).toBeDisabled();
    expect(publish).not.toHaveClass('bg-brand-600');
  });
});

/* -------------------------------------------------------------- DraftsPanel */

const DRAFTS = 'GET /workspaces/w1/content-packages';

const draftItem = (overrides = {}) => ({
  id: 'd1',
  status: 'DRAFT',
  version: 3,
  caption: 'Spring launch\nEverything new this season',
  targetAccountIds: ['acc-fb-1', 'acc-fb-2', 'acc-ig-1'],
  media: [
    {
      mediaId: 'srv-1',
      altText: '',
      media: { id: 'srv-1', kind: 'IMAGE', thumbnailUrl: 'https://cdn.example.com/t1.jpg' },
    },
    { mediaId: 'srv-2', altText: '', media: { id: 'srv-2', kind: 'VIDEO', thumbnailUrl: null } },
  ],
  updatedAt: ago(5 * MINUTE),
  updatedBy: { id: 'u2', name: 'Grace Hopper' },
  ...overrides,
});

const untitled = () =>
  draftItem({ id: 'd2', caption: '', targetAccountIds: [], media: [], updatedBy: null });

function renderPanel(props = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onClose = vi.fn();
  const onOpen = props.onOpen ?? vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <DraftsPanel open workspaceId="w1" onClose={onClose} onOpen={onOpen} {...props} />
    </QueryClientProvider>,
  );
  return { onClose, onOpen, queryClient };
}

describe('DraftsPanel', () => {
  it('explains that team drafts are not available yet and sends no request', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    renderPanel();
    expect(screen.getByRole('dialog', { name: 'Team drafts' })).toHaveTextContent(
      CAPABILITY_MESSAGES.serverDrafts,
    );
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  describe('with team drafts enabled', () => {
    beforeEach(() => {
      vi.stubEnv('VITE_COMPOSER_SERVER_DRAFTS', 'true');
    });

    it('lists the workspace drafts', async () => {
      const mock = setupComposerApi({
        routes: { [DRAFTS]: () => jsonResponse(200, { items: [draftItem(), untitled()] }) },
      });
      renderPanel();
      const dialog = screen.getByRole('dialog', { name: 'Team drafts' });
      expect(within(dialog).getByRole('status')).toHaveTextContent('Loading drafts…');

      const list = await within(dialog).findByRole('list', { name: 'Saved drafts' });
      const [first, second] = within(list).getAllByRole('listitem');
      expect(first).toHaveTextContent('Spring launch');
      expect(first).not.toHaveTextContent('Everything new this season');
      expect(first).toHaveTextContent('Edited by Grace Hopper');
      expect(first).toHaveTextContent('5 minutes ago');
      expect(first).toHaveTextContent('3 accounts');
      expect(first).toHaveTextContent('2 files');
      expect(first.querySelector('img')).toHaveAttribute('src', 'https://cdn.example.com/t1.jpg');
      expect(second).toHaveTextContent('Untitled draft');
      expect(second).toHaveTextContent('No accounts');

      const call = mock.calls.find((c) => c.key === DRAFTS);
      expect(call.url.searchParams.get('status')).toBe('DRAFT');
      expect(call.url.searchParams.get('limit')).toBe('20');
      expect(call.url.searchParams.has('cursor')).toBe(false);
    });

    it('shows progress while a draft opens', async () => {
      const user = userEvent.setup();
      setupComposerApi({
        routes: { [DRAFTS]: () => jsonResponse(200, { items: [draftItem(), untitled()] }) },
      });
      let finish;
      const onOpen = vi.fn(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      renderPanel({ onOpen });

      await user.click(await screen.findByRole('button', { name: 'Open Spring launch' }));
      expect(onOpen).toHaveBeenCalledWith('d1');
      expect(screen.getByRole('button', { name: 'Open Spring launch' })).toHaveAttribute(
        'aria-busy',
        'true',
      );
      expect(screen.getByRole('button', { name: 'Open Untitled draft' })).toBeDisabled();

      await act(async () => finish());
      expect(screen.getByRole('button', { name: 'Open Spring launch' })).not.toHaveAttribute(
        'aria-busy',
      );
      expect(screen.getByRole('button', { name: 'Open Untitled draft' })).toBeEnabled();
    });

    it('shows why a draft could not be opened', async () => {
      const user = userEvent.setup();
      setupComposerApi({ routes: { [DRAFTS]: () => jsonResponse(200, { items: [draftItem()] }) } });
      const onOpen = vi.fn(() => Promise.reject(new Error('This draft no longer exists.')));
      renderPanel({ onOpen });
      await user.click(await screen.findByRole('button', { name: 'Open Spring launch' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('This draft no longer exists.');
    });

    it('marks the draft that is already in the composer', async () => {
      setupComposerApi({
        routes: { [DRAFTS]: () => jsonResponse(200, { items: [draftItem(), untitled()] }) },
      });
      renderPanel({ currentDraftId: 'd1' });
      const reload = await screen.findByRole('button', { name: 'Reload Spring launch' });
      expect(reload.closest('li')).toHaveTextContent('In composer');
      expect(screen.getByRole('button', { name: 'Open Untitled draft' })).toBeInTheDocument();
    });

    it('warns that opening a draft replaces unsaved changes', async () => {
      setupComposerApi({ routes: { [DRAFTS]: () => jsonResponse(200, { items: [draftItem()] }) } });
      renderPanel({ hasUnsavedChanges: true });
      expect(
        await screen.findByText(/Opening a draft replaces what's in the composer/),
      ).toBeInTheDocument();
    });

    it('loads more drafts with the cursor from the previous page', async () => {
      const user = userEvent.setup();
      const mock = setupComposerApi({
        routes: {
          [DRAFTS]: ({ url }) =>
            url.searchParams.get('cursor') === 'c2'
              ? jsonResponse(200, {
                  items: [draftItem({ id: 'd3', caption: 'Summer teaser' })],
                  nextCursor: null,
                })
              : jsonResponse(200, { items: [draftItem(), untitled()], nextCursor: 'c2' }),
        },
      });
      renderPanel();
      await user.click(await screen.findByRole('button', { name: 'Load more' }));

      expect(await screen.findByRole('button', { name: 'Open Summer teaser' })).toBeInTheDocument();
      expect(
        within(screen.getByRole('list', { name: 'Saved drafts' })).getAllByRole('listitem'),
      ).toHaveLength(3);
      expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
      expect(mock.calls.filter((c) => c.key === DRAFTS)[1].url.searchParams.get('cursor')).toBe(
        'c2',
      );
    });

    it('shows a load error with a retry', async () => {
      const user = userEvent.setup();
      let fail = true;
      setupComposerApi({
        routes: {
          [DRAFTS]: () =>
            fail
              ? apiError(500, 'INTERNAL', 'Drafts are unavailable right now.')
              : jsonResponse(200, { items: [draftItem()] }),
        },
      });
      renderPanel();
      expect(await screen.findByText("Couldn't load drafts")).toBeInTheDocument();
      expect(screen.getByText('Drafts are unavailable right now.')).toBeInTheDocument();

      fail = false;
      await user.click(screen.getByRole('button', { name: 'Try again' }));
      expect(await screen.findByRole('button', { name: 'Open Spring launch' })).toBeInTheDocument();
    });

    it('shows an empty state when there are no drafts', async () => {
      setupComposerApi({ routes: { [DRAFTS]: () => jsonResponse(200, { items: [] }) } });
      renderPanel();
      expect(await screen.findByText('No drafts yet')).toBeInTheDocument();
    });

    it('does not fetch while closed', () => {
      const mock = setupComposerApi({
        routes: { [DRAFTS]: () => jsonResponse(200, { items: [draftItem()] }) },
      });
      renderPanel({ open: false });
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(mock.count(DRAFTS)).toBe(0);
    });

    it('closes from the close button and with Escape', async () => {
      const user = userEvent.setup();
      setupComposerApi({ routes: { [DRAFTS]: () => jsonResponse(200, { items: [] }) } });
      const { onClose } = renderPanel();
      await user.click(screen.getByRole('button', { name: 'Close dialog' }));
      expect(onClose).toHaveBeenCalledTimes(1);
      await user.keyboard('{Escape}');
      expect(onClose).toHaveBeenCalledTimes(2);
    });
  });
});

/* ----------------------------------------------------- UnsavedChangesDialog */

function GuardedComposer({ when }) {
  const { blocker } = useUnsavedChangesGuard({ when });
  return (
    <>
      <h1>Composer</h1>
      <Link to="/w/acme/accounts">Social accounts</Link>
      <Link to="/w/acme/compose?draft=d1">Open team draft</Link>
      <UnsavedChangesDialog
        blocker={blocker}
        description="Attached files only exist in this tab and will be lost."
      />
    </>
  );
}

function renderGuarded(when) {
  const router = createMemoryRouter(
    [
      { path: '/w/acme/compose', element: <GuardedComposer when={when} /> },
      { path: '/w/acme/accounts', element: <h1>Social accounts page</h1> },
    ],
    { initialEntries: ['/w/acme/compose'] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

describe('UnsavedChangesDialog', () => {
  it('asks before leaving with unsaved work, and Stay keeps the page', async () => {
    const user = userEvent.setup();
    const router = renderGuarded(true);
    await user.click(screen.getByRole('link', { name: 'Social accounts' }));

    const dialog = await screen.findByRole('dialog', { name: 'Leave this page?' });
    expect(dialog).toHaveAccessibleDescription(
      'Attached files only exist in this tab and will be lost.',
    );
    const stay = within(dialog).getByRole('button', { name: 'Stay' });
    expect(stay).toHaveFocus();

    await user.click(stay);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(router.state.location.pathname).toBe('/w/acme/compose');
    expect(screen.getByRole('heading', { name: 'Composer' })).toBeInTheDocument();
  });

  it('Leave continues to the requested page', async () => {
    const user = userEvent.setup();
    const router = renderGuarded(true);
    await user.click(screen.getByRole('link', { name: 'Social accounts' }));
    await user.click(await screen.findByRole('button', { name: 'Leave' }));

    expect(
      await screen.findByRole('heading', { name: 'Social accounts page' }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/w/acme/accounts');
  });

  it('Escape keeps the page too', async () => {
    const user = userEvent.setup();
    const router = renderGuarded(true);
    await user.click(screen.getByRole('link', { name: 'Social accounts' }));
    await screen.findByRole('dialog', { name: 'Leave this page?' });
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(router.state.location.pathname).toBe('/w/acme/compose');
  });

  it('does not ask when nothing is unsaved', async () => {
    const user = userEvent.setup();
    renderGuarded(false);
    await user.click(screen.getByRole('link', { name: 'Social accounts' }));
    expect(
      await screen.findByRole('heading', { name: 'Social accounts page' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('lets the composer change its own URL without asking', async () => {
    const user = userEvent.setup();
    const router = renderGuarded(true);
    await user.click(screen.getByRole('link', { name: 'Open team draft' }));
    await waitFor(() => expect(router.state.location.search).toBe('?draft=d1'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders nothing while no navigation is blocked', () => {
    render(<UnsavedChangesDialog blocker={{ state: 'unblocked' }} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
