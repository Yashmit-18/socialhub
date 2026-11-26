// One-video draft copies for "one post per video". MOCKED: the content API calls are mocked;
// nothing reaches a server.
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MEDIA_KINDS,
  UPLOAD_STATUS,
  createInitialComposerState,
  createMediaItem,
} from '../model/composerState.js';
import { createDraft, deleteDraft } from '../services/composerApi.js';
import { useVideoPosts } from './useVideoPosts.js';

vi.mock('../services/composerApi.js', () => ({
  createDraft: vi.fn(),
  deleteDraft: vi.fn(),
}));

const WS = 'w1';
const ACCOUNT = 'b'.repeat(24);

function file(name, kind = MEDIA_KINDS.VIDEO, { uploaded = true } = {}) {
  return {
    ...createMediaItem({
      id: `local-${name}`,
      kind,
      fileName: `${name}.mp4`,
      mimeType: 'video/mp4',
      sizeBytes: 1,
    }),
    altText: '',
    upload: uploaded
      ? { status: UPLOAD_STATUS.UPLOADED, progress: 1, mediaId: `media-${name}`, error: null }
      : { status: UPLOAD_STATUS.UPLOADING, progress: 0.5, mediaId: null, error: null },
  };
}

const composer = (patch) => ({
  ...createInitialComposerState(),
  caption: 'Three clips',
  selectedAccountIds: [ACCOUNT],
  ...patch,
});

let made = 0;
beforeEach(() => {
  made = 0;
  vi.mocked(createDraft).mockReset();
  vi.mocked(deleteDraft).mockReset();
  vi.mocked(createDraft).mockImplementation(async () => {
    made += 1;
    return { contentPackage: { id: `copy-${made}` } };
  });
  vi.mocked(deleteDraft).mockResolvedValue(undefined);
});

function render(state) {
  return renderHook((props) => useVideoPosts({ workspaceId: WS, ...props }), {
    initialProps: { state, availableAccountIds: [ACCOUNT] },
  });
}

describe('useVideoPosts', () => {
  it('makes one draft copy per video, with the same text and accounts', async () => {
    const { result } = render(composer({ media: [file('a'), file('b')] }));
    expect(result.current.pending).toBe(2);
    let posts;
    await act(async () => {
      posts = await result.current.prepare();
    });
    expect(posts).toEqual([
      { key: expect.any(String), label: 'a.mp4', contentPackageId: 'copy-1' },
      { key: expect.any(String), label: 'b.mp4', contentPackageId: 'copy-2' },
    ]);
    expect(createDraft).toHaveBeenNthCalledWith(
      1,
      WS,
      expect.objectContaining({
        caption: 'Three clips',
        targetAccountIds: [ACCOUNT],
        media: [{ mediaId: 'media-a', altText: '' }],
      }),
    );
    expect(vi.mocked(createDraft).mock.calls[1][1].media).toEqual([
      { mediaId: 'media-b', altText: '' },
    ]);
  });

  it('reuses a copy until its post exists, then deletes it and skips that video', async () => {
    const { result } = render(composer({ media: [file('a'), file('b')] }));
    let posts;
    await act(async () => {
      posts = await result.current.prepare();
    });
    act(() => result.current.markSent(posts[0].key));
    expect(deleteDraft).toHaveBeenCalledWith(WS, 'copy-1');
    expect(result.current.pending).toBe(1);

    let again;
    await act(async () => {
      again = await result.current.prepare();
    });
    // Only the video not sent yet, with the copy made for it before.
    expect(again).toEqual([posts[1]]);
    expect(createDraft).toHaveBeenCalledTimes(2);

    // "Publish again anyway": every video, with new copies for the ones already sent.
    let all;
    await act(async () => {
      all = await result.current.prepare({ again: true });
    });
    expect(all.map((post) => post.contentPackageId)).toEqual(['copy-3', 'copy-2']);
  });

  it('deletes copies made for content that changed, and those left when the composer closes', async () => {
    const { result, rerender, unmount } = render(composer({ media: [file('a'), file('b')] }));
    await act(async () => {
      await result.current.prepare();
    });
    rerender({
      state: composer({ caption: 'Edited', media: [file('a'), file('b')] }),
      availableAccountIds: [ACCOUNT],
    });
    expect(result.current.pending).toBe(2);
    await act(async () => {
      await result.current.prepare();
    });
    expect(vi.mocked(deleteDraft).mock.calls.map(([, id]) => id)).toEqual(['copy-1', 'copy-2']);
    unmount();
    expect(vi.mocked(deleteDraft).mock.calls.map(([, id]) => id)).toEqual([
      'copy-1',
      'copy-2',
      'copy-3',
      'copy-4',
    ]);
  });

  it('leaves out photos and files that are not uploaded', () => {
    const { result } = render(
      composer({
        media: [
          file('a'),
          file('p', MEDIA_KINDS.IMAGE),
          file('b', MEDIA_KINDS.VIDEO, { uploaded: false }),
        ],
      }),
    );
    expect(result.current.pending).toBe(1);
  });

  it('says so, and sends nothing more, when the server returns no draft', async () => {
    vi.mocked(createDraft).mockResolvedValueOnce({});
    const { result } = render(composer({ media: [file('a'), file('b')] }));
    await expect(result.current.prepare()).rejects.toThrow(/did not return the draft/);
    expect(createDraft).toHaveBeenCalledTimes(1);
  });
});
