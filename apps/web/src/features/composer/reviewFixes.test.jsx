import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DraftStatus } from './components/drafts/DraftStatus.jsx';
import { useLocalAutosave } from './hooks/useLocalAutosave.js';
import { MEDIA_KINDS, createInitialComposerState, createMediaItem } from './model/composerState.js';
import { toContentPackageInput, toLocalDraft } from './model/serialize.js';
import {
  composeCaption,
  composeFirstComment,
  extractHashtags,
  extractMentions,
} from './model/text.js';
import {
  clearLocalDraftsForUser,
  localDraftKey,
  readLocalDraft,
  readLocalPresets,
  resumeLocalDrafts,
  writeLocalDraft,
  writeLocalPresets,
} from './services/localStore.js';

/**
 * Regression tests for problems found in the composer's code review: drafts shared between
 * browser tabs, drafts left behind after sign-out, and server-draft details.
 */

const stateWith = (overrides = {}) => ({ ...createInitialComposerState(), ...overrides });
const draftOf = (overrides) => toLocalDraft(stateWith(overrides));
const SLOT = localDraftKey('u1', 'w1');

/** What another tab's write looks like from this tab: the slot changes, then a storage event. */
function fromAnotherTab(change) {
  act(() => {
    change();
    window.dispatchEvent(new StorageEvent('storage', { key: SLOT }));
  });
}

const autosave = (state, delayMs = 5) =>
  renderHook((props) => useLocalAutosave({ userId: 'u1', workspaceId: 'w1', delayMs, ...props }), {
    initialProps: { state },
  });

beforeEach(() => {
  resumeLocalDrafts('u1');
  resumeLocalDrafts('u2');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('browser drafts shared between tabs', () => {
  it('stops claiming "saved" when another tab overwrites the draft, without rewriting it', async () => {
    const { result } = autosave(stateWith({ caption: 'Post A' }));
    await waitFor(() => expect(result.current.status).toBe('saved'));

    fromAnotherTab(() =>
      writeLocalDraft('u1', 'w1', draftOf({ caption: 'Post B' }), '2030-01-01T00:00:00.000Z'),
    );

    expect(result.current.status).toBe('error');
    expect(result.current.reason).toBe('replaced');
    // Two tabs must not overwrite each other in a loop: nothing is written until the person acts.
    expect(readLocalDraft('u1', 'w1').data.caption).toBe('Post B');
  });

  it('saves this tab’s version again when the person asks to', async () => {
    const { result } = autosave(stateWith({ caption: 'Post A' }));
    await waitFor(() => expect(result.current.status).toBe('saved'));
    fromAnotherTab(() =>
      writeLocalDraft('u1', 'w1', draftOf({ caption: 'Post B' }), '2030-01-01T00:00:00.000Z'),
    );

    let outcome;
    act(() => {
      outcome = result.current.flush();
    });

    expect(outcome.ok).toBe(true);
    expect(readLocalDraft('u1', 'w1').data.caption).toBe('Post A');
    expect(result.current.status).toBe('saved');
    expect(result.current.reason).toBeNull();
  });

  it('notices when another tab discards the draft', async () => {
    const { result } = autosave(stateWith({ caption: 'Post A' }));
    await waitFor(() => expect(result.current.status).toBe('saved'));

    fromAnotherTab(() => localStorage.removeItem(SLOT));

    expect(result.current.status).toBe('error');
    expect(result.current.reason).toBe('replaced');
  });

  it('re-checks the draft when the tab becomes visible again', async () => {
    const { result } = autosave(stateWith({ caption: 'Post A' }));
    await waitFor(() => expect(result.current.status).toBe('saved'));

    act(() => {
      // No storage event this time (some browsers don't deliver them to background tabs).
      writeLocalDraft('u1', 'w1', draftOf({ caption: 'Post B' }), '2030-01-01T00:00:00.000Z');
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(result.current.reason).toBe('replaced');
  });

  it('keeps the draft offered by a waiting tab in step with the other tab', () => {
    writeLocalDraft('u1', 'w1', draftOf({ caption: 'First' }), '2026-11-20T10:00:00.000Z');
    const { result } = autosave(stateWith());
    expect(result.current.status).toBe('paused');
    expect(result.current.restorable.state.caption).toBe('First');

    fromAnotherTab(() =>
      writeLocalDraft('u1', 'w1', draftOf({ caption: 'Second' }), '2026-11-20T10:05:00.000Z'),
    );
    expect(result.current.restorable.state.caption).toBe('Second');

    fromAnotherTab(() => localStorage.removeItem(SLOT));
    expect(result.current.restorable).toBeNull();
    expect(result.current.status).toBe('idle');
  });

  it('keeps reporting a failed write while the next attempt is pending', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    const { result, rerender } = autosave(stateWith({ caption: 'Post A' }));
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.reason).toBe('quota');

    rerender({ state: stateWith({ caption: 'Post A, edited' }) });

    // "pending" must not look safe: the leave-page guard keys off `reason`.
    expect(result.current.status).toBe('pending');
    expect(result.current.reason).toBe('quota');
  });

  it('removes a draft that only listed files once it has been restored', () => {
    const photo = createMediaItem({
      id: 'm1',
      kind: MEDIA_KINDS.IMAGE,
      fileName: 'beach.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 10,
    });
    writeLocalDraft('u1', 'w1', draftOf({ media: [photo] }), '2026-11-20T10:00:00.000Z');
    const { result } = autosave(stateWith());
    expect(result.current.restorable.missingMedia).toEqual([
      { fileName: 'beach.jpg', kind: MEDIA_KINDS.IMAGE, altText: '' },
    ]);

    act(() => {
      result.current.restore();
    });

    // Nothing is left to save, so it must not be offered again on every visit.
    expect(localStorage.getItem(SLOT)).toBeNull();
    expect(result.current.restorable).toBeNull();
    expect(result.current.status).toBe('idle');
  });
});

describe('browser drafts and sign-out', () => {
  it('removes every draft of the person who signs out, and nothing else', () => {
    writeLocalDraft('u1', 'w1', draftOf({ caption: 'One' }));
    writeLocalDraft('u1', 'w2', draftOf({ caption: 'Two' }));
    writeLocalDraft('u2', 'w1', draftOf({ caption: 'Someone else' }));
    writeLocalPresets('u1', 'w1', [{ id: 'p1', name: 'Pages', socialAccountIds: ['a'] }]);

    expect(clearLocalDraftsForUser('u1')).toBe(2);

    expect(readLocalDraft('u1', 'w1')).toBeNull();
    expect(readLocalDraft('u1', 'w2')).toBeNull();
    expect(readLocalDraft('u2', 'w1').data.caption).toBe('Someone else');
    // Presets hold no post content and are kept.
    expect(readLocalPresets('u1', 'w1')).toHaveLength(1);
  });

  it('refuses late writes after sign-out until a composer is opened again', () => {
    clearLocalDraftsForUser('u1');

    // e.g. the composer flushing a pending change while it unmounts during sign-out
    expect(writeLocalDraft('u1', 'w1', draftOf({ caption: 'Late' }))).toEqual({
      ok: false,
      reason: 'unavailable',
    });
    expect(readLocalDraft('u1', 'w1')).toBeNull();
    expect(writeLocalDraft('u2', 'w1', draftOf({ caption: 'Other person' })).ok).toBe(true);

    resumeLocalDrafts('u1');
    expect(writeLocalDraft('u1', 'w1', draftOf({ caption: 'Back' })).ok).toBe(true);
  });

  it('lets drafts be written again when the composer mounts', async () => {
    clearLocalDraftsForUser('u1');
    const { result } = autosave(stateWith({ caption: 'Signed in again' }));
    await waitFor(() => expect(result.current.status).toBe('saved'));
    expect(readLocalDraft('u1', 'w1').data.caption).toBe('Signed in again');
  });
});

describe('draft status wording', () => {
  it('says the draft was changed in another tab', () => {
    render(<DraftStatus local={{ status: 'error', reason: 'replaced', savedAt: null }} />);
    expect(screen.getAllByText('Changed in another tab: not saved here').length).toBeGreaterThan(0);
  });

  it('does not promise that only the person can see a browser draft', () => {
    const { container } = render(
      <DraftStatus local={{ status: 'saved', reason: null, savedAt: new Date().toISOString() }} />,
    );
    expect(container.firstChild).toHaveAttribute(
      'title',
      expect.stringMatching(/until you discard it or sign out/),
    );
    expect(container.firstChild.getAttribute('title')).not.toMatch(/only you can see/i);
  });

  it('says which files a team draft does not include', () => {
    render(
      <DraftStatus
        local={{ status: 'saved', reason: null, savedAt: null }}
        server={{
          available: true,
          status: 'saved',
          draft: { id: 'cp1', savedAt: null },
          omittedMedia: [{ id: 'm1' }, { id: 'm2' }],
        }}
      />,
    );
    expect(screen.getAllByText('Saved to team drafts without 2 files').length).toBeGreaterThan(0);
    expect(screen.queryByText('Saved to team drafts')).not.toBeInTheDocument();
  });
});

describe('team draft contents', () => {
  const state = stateWith({ caption: 'Hi', selectedAccountIds: ['a', 'gone', 'b'] });

  it('leaves out selected accounts that are no longer available, as the readiness check says', () => {
    const { input } = toContentPackageInput(state, { availableAccountIds: ['b', 'a', 'c'] });
    expect(input.targetAccountIds).toEqual(['a', 'b']);
  });

  it('sends the selection as it is while the account list is unknown', () => {
    expect(toContentPackageInput(state).input.targetAccountIds).toEqual(['a', 'gone', 'b']);
    expect(
      toContentPackageInput(state, { availableAccountIds: null }).input.targetAccountIds,
    ).toEqual(['a', 'gone', 'b']);
  });
});

describe('caption composition matches docs/COMPOSER_API_CONTRACT.md §7.3', () => {
  const hashtags = ['sale', 'summer'];

  it.each([
    {
      name: 'caption placement skips tags already written in the caption (any case)',
      hashtagPlacement: 'CAPTION',
      caption: 'Big #Sale today',
      firstComment: '',
      expected: ['Big #Sale today\n\n#summer', ''],
    },
    {
      name: 'first-comment placement only looks at the first comment, with no blank line when it is empty',
      hashtagPlacement: 'FIRST_COMMENT',
      caption: 'Big #sale today',
      firstComment: '',
      expected: ['Big #sale today', '#sale #summer'],
    },
    {
      name: 'first-comment placement appends after a blank line',
      hashtagPlacement: 'FIRST_COMMENT',
      caption: 'Hello',
      firstComment: 'Shop now',
      expected: ['Hello', 'Shop now\n\n#sale #summer'],
    },
  ])('$name', ({ hashtagPlacement, caption, firstComment, expected }) => {
    expect([
      composeCaption({ caption, hashtags, hashtagPlacement }),
      composeFirstComment({ firstComment, hashtags, hashtagPlacement }),
    ]).toEqual(expected);
  });

  it('does not treat a "#" inside a URL path or query as a hashtag', () => {
    expect(extractHashtags('shop.example/?#sale shop.example/a=#b shop.example/#c #real')).toEqual([
      'real',
    ]);
    expect(
      composeCaption({
        caption: 'Deals at shop.example/?#sale',
        hashtags: ['sale'],
        hashtagPlacement: 'CAPTION',
      }),
    ).toBe('Deals at shop.example/?#sale\n\n#sale');
  });

  it('does not count a sentence’s full stop as part of an @mention', () => {
    expect(extractMentions('Thanks @acme. And @a.b_c!')).toEqual(['acme', 'a.b_c']);
  });

  it('compares hashtags without depending on the browser’s locale', () => {
    const spy = vi.spyOn(String.prototype, 'toLocaleLowerCase');
    composeCaption({ caption: 'A #TITLE', hashtags: ['title'], hashtagPlacement: 'CAPTION' });
    expect(spy).not.toHaveBeenCalled();
  });
});
