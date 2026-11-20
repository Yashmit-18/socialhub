import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useReducer, useState } from 'react';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiError, jsonResponse } from '../../../test/fetchMock.js';
import {
  MEDIA_KINDS,
  UPLOAD_STATUS,
  composerActions,
  composerReducer,
  createInitialComposerState,
  createMediaItem,
} from '../model/composerState.js';
import { toLocalDraft } from '../model/serialize.js';
import { CapabilityUnavailableError } from '../services/capabilities.js';
import { localDraftKey, writeLocalDraft } from '../services/localStore.js';
import { setupComposerApi } from '../test/fixtures.js';
import { LOCAL_AUTOSAVE_DELAY_MS, useLocalAutosave } from './useLocalAutosave.js';
import { NOW_INTERVAL_MS, relativeTime, useNow } from './useNow.js';
import {
  SERVER_DRAFT_CONFLICT_MESSAGE,
  composerDraftsQueryKey,
  useServerDraft,
} from './useServerDraft.js';
import { useUnsavedChangesGuard } from './useUnsavedChangesGuard.js';

const KEY = 'sh-composer-draft:v1:u1:w1';
const DELAY = LOCAL_AUTOSAVE_DELAY_MS;

const reduce = (state, ...actions) => actions.reduce(composerReducer, state);
const initial = () => createInitialComposerState();
const withCaption = (caption) => reduce(initial(), composerActions.setCaption(caption));
const photo = (id = 'm1', fileName = 'beach.jpg') =>
  createMediaItem({
    id,
    kind: MEDIA_KINDS.IMAGE,
    fileName,
    mimeType: 'image/jpeg',
    sizeBytes: 2048,
  });

const stored = () => JSON.parse(localStorage.getItem(KEY));
const writesTo = (spy, key = KEY) => spy.mock.calls.filter(([k]) => k === key).length;

/** Renders useLocalAutosave and lets tests evolve the composer state with real actions. */
function setupAutosave(state = initial(), extra = {}) {
  let props = { state, userId: 'u1', workspaceId: 'w1', ...extra };
  const view = renderHook((p) => useLocalAutosave(p), { initialProps: props });
  return {
    ...view,
    apply(...actions) {
      props = { ...props, state: reduce(props.state, ...actions) };
      view.rerender(props);
    },
  };
}

function storeEarlierDraft(state, savedAt = '2026-11-20T08:00:00.000Z', user = 'u1') {
  writeLocalDraft(user, 'w1', toLocalDraft(state), savedAt);
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

/* ------------------------------------------------------------------ useNow */

describe('useNow', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-20T10:00:00.000Z'));
  });

  it('refreshes on an interval and stops when unmounted', () => {
    const start = Date.parse('2026-11-20T10:00:00.000Z');
    const { result, unmount } = renderHook(() => useNow());
    expect(result.current).toBe(start);

    act(() => vi.advanceTimersByTime(NOW_INTERVAL_MS - 1));
    expect(result.current).toBe(start);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe(start + NOW_INTERVAL_MS);

    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('catches up when the tab becomes visible again', () => {
    const { result } = renderHook(() => useNow(60_000));
    vi.setSystemTime(new Date('2026-11-20T12:00:00.000Z'));
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(result.current).toBe(Date.parse('2026-11-20T12:00:00.000Z'));
  });
});

describe('relativeTime', () => {
  const now = Date.parse('2026-11-20T10:00:00.000Z');

  it('describes past dates', () => {
    expect(relativeTime('2026-11-20T09:55:00.000Z', now)).toBe('5 minutes ago');
    expect(relativeTime(now - 2 * 3_600_000, now)).toBe('2 hours ago');
  });

  it('never describes a fresh save as being in the future', () => {
    expect(relativeTime('2026-11-20T10:00:20.000Z', now)).toBe('just now');
    expect(relativeTime('2026-11-20T10:05:00.000Z', now)).toBe('just now');
  });

  it('returns null for missing or invalid dates', () => {
    expect(relativeTime(null, now)).toBeNull();
    expect(relativeTime('', now)).toBeNull();
    expect(relativeTime('not a date', now)).toBeNull();
  });
});

/* -------------------------------------------------------- useLocalAutosave */

describe('useLocalAutosave', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-20T10:00:00.000Z'));
  });

  it('saves the draft in this browser once typing pauses', () => {
    const autosave = setupAutosave();
    expect(autosave.result.current).toMatchObject({
      status: 'idle',
      savedAt: null,
      reason: null,
      available: true,
      restorable: null,
    });

    autosave.apply(composerActions.setCaption('Hello'));
    expect(autosave.result.current.status).toBe('pending');

    act(() => vi.advanceTimersByTime(DELAY - 1));
    expect(localStorage.getItem(KEY)).toBeNull();

    act(() => vi.advanceTimersByTime(1));
    expect(localDraftKey('u1', 'w1')).toBe(KEY);
    expect(stored()).toMatchObject({ version: 1, data: { caption: 'Hello' } });
    expect(autosave.result.current.status).toBe('saved');
    expect(autosave.result.current.savedAt).toBe(stored().savedAt);
  });

  it('restarts the countdown on every change and writes only the latest content', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const autosave = setupAutosave();

    autosave.apply(composerActions.setCaption('H'));
    act(() => vi.advanceTimersByTime(500));
    autosave.apply(composerActions.setCaption('He'));
    act(() => vi.advanceTimersByTime(500));
    autosave.apply(composerActions.setCaption('Hey'));
    act(() => vi.advanceTimersByTime(DELAY - 1));
    expect(writesTo(setItem)).toBe(0);

    act(() => vi.advanceTimersByTime(1));
    expect(writesTo(setItem)).toBe(1);
    expect(stored().data.caption).toBe('Hey');
  });

  it('keeps everything a device draft can hold, and only file names for media', () => {
    const autosave = setupAutosave();
    autosave.apply(
      composerActions.setCaption('Summer sale'),
      composerActions.addHashtags(['summer']),
      composerActions.addKeywords(['beach wear']),
      composerActions.setFirstComment('Link in bio'),
      composerActions.selectAccounts(['acc-fb-1']),
      composerActions.addMedia([photo('m1', 'beach.jpg')]),
      composerActions.setMediaAltText('m1', 'People on a beach'),
    );
    act(() => vi.advanceTimersByTime(DELAY));
    expect(stored().data).toEqual({
      caption: 'Summer sale',
      platformCaptions: { FACEBOOK_PAGE: null, INSTAGRAM_ACCOUNT: null },
      hashtags: ['summer'],
      hashtagPlacement: 'CAPTION',
      keywords: ['beach wear'],
      firstComment: 'Link in bio',
      selectedAccountIds: ['acc-fb-1'],
      missingMedia: [{ fileName: 'beach.jpg', kind: 'IMAGE', altText: 'People on a beach' }],
    });
  });

  it('does not write anything while the composer is empty', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const autosave = setupAutosave();
    autosave.apply(composerActions.setCaption('   '));
    expect(autosave.result.current.status).toBe('idle');
    act(() => vi.advanceTimersByTime(DELAY * 3));
    expect(writesTo(setItem)).toBe(0);
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(autosave.result.current.status).toBe('idle');
  });

  it('removes the device draft when the content is cleared', () => {
    const autosave = setupAutosave();
    autosave.apply(composerActions.setCaption('Hello'));
    act(() => vi.advanceTimersByTime(DELAY));
    expect(stored().data.caption).toBe('Hello');

    autosave.apply(composerActions.setCaption(''));
    act(() => vi.advanceTimersByTime(DELAY));
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(autosave.result.current).toMatchObject({ status: 'idle', savedAt: null });
  });

  it('ignores changes a device draft does not keep, so uploads never delay or repeat writes', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const autosave = setupAutosave();
    autosave.apply(composerActions.addMedia([photo('m1')]));

    // Progress ticks arrive faster than the debounce; the save must still happen on time.
    act(() => vi.advanceTimersByTime(300));
    autosave.apply(composerActions.mediaUploadProgress('m1', 0.2));
    act(() => vi.advanceTimersByTime(300));
    autosave.apply(composerActions.mediaUploadProgress('m1', 0.4));
    act(() => vi.advanceTimersByTime(DELAY - 600));
    expect(writesTo(setItem)).toBe(1);
    expect(autosave.result.current.status).toBe('saved');

    autosave.apply(
      composerActions.updateMedia('m1', { width: 1080, height: 1080, inspection: 'DONE' }),
      composerActions.updateMedia('m1', { upload: { status: UPLOAD_STATUS.UPLOADING } }),
    );
    expect(autosave.result.current.status).toBe('saved');
    act(() => vi.advanceTimersByTime(DELAY * 2));
    expect(writesTo(setItem)).toBe(1);
  });

  it('writes waiting changes at once when the page is hidden or closed', () => {
    const autosave = setupAutosave();
    autosave.apply(composerActions.setCaption('Closing the tab'));
    act(() => window.dispatchEvent(new Event('pagehide')));
    expect(stored().data.caption).toBe('Closing the tab');
    expect(autosave.result.current.status).toBe('saved');

    vi.spyOn(Document.prototype, 'visibilityState', 'get').mockReturnValue('hidden');
    autosave.apply(composerActions.setCaption('Switching apps'));
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(stored().data.caption).toBe('Switching apps');
  });

  it('writes waiting changes when the composer unmounts (in-app navigation)', () => {
    const autosave = setupAutosave();
    autosave.apply(composerActions.setCaption('Navigating away'));
    expect(localStorage.getItem(KEY)).toBeNull();
    autosave.unmount();
    expect(stored().data.caption).toBe('Navigating away');
  });

  it('saves immediately with flush() and reports when there is nothing to save', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const autosave = setupAutosave();

    let result;
    act(() => {
      result = autosave.result.current.flush();
    });
    expect(result).toEqual({ ok: false, reason: 'empty' });
    expect(localStorage.getItem(KEY)).toBeNull();

    autosave.apply(composerActions.setCaption('Save me now'));
    act(() => {
      result = autosave.result.current.flush();
    });
    expect(result).toEqual({ ok: true, savedAt: '2026-11-20T10:00:00.000Z' });
    expect(stored().data.caption).toBe('Save me now');
    expect(autosave.result.current.status).toBe('saved');

    act(() => vi.advanceTimersByTime(DELAY * 2));
    expect(writesTo(setItem)).toBe(1);
  });

  it('clear() removes the device draft (Discard)', () => {
    const autosave = setupAutosave();
    autosave.apply(composerActions.setCaption('Discard me'));
    act(() => {
      autosave.result.current.flush();
    });
    expect(localStorage.getItem(KEY)).not.toBeNull();

    act(() => autosave.result.current.clear());
    autosave.apply(composerActions.reset());
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(autosave.result.current).toMatchObject({ status: 'idle', savedAt: null });
    act(() => vi.advanceTimersByTime(DELAY * 2));
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('does not write discarded content back when the composer unmounts right away', () => {
    const autosave = setupAutosave();
    autosave.apply(composerActions.setCaption('Discard, then leave'));
    act(() => {
      autosave.result.current.clear();
      autosave.unmount();
    });
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  describe('an earlier draft in this browser', () => {
    const earlier = () =>
      reduce(
        initial(),
        composerActions.setCaption('Earlier draft'),
        composerActions.addHashtags(['autumn']),
        composerActions.addMedia([photo('m1', 'beach.jpg'), photo('m2', 'city.jpg')]),
      );

    it('is offered for restoring and pauses autosave instead of overwriting it', () => {
      storeEarlierDraft(earlier());
      const before = localStorage.getItem(KEY);
      const autosave = setupAutosave();

      expect(autosave.result.current.status).toBe('paused');
      expect(autosave.result.current.restorable).toMatchObject({
        savedAt: '2026-11-20T08:00:00.000Z',
        state: { caption: 'Earlier draft', hashtags: ['autumn'] },
        missingMedia: [
          { fileName: 'beach.jpg', kind: 'IMAGE', altText: '' },
          { fileName: 'city.jpg', kind: 'IMAGE', altText: '' },
        ],
      });

      autosave.apply(composerActions.setCaption('Something new'));
      act(() => vi.advanceTimersByTime(DELAY * 3));
      act(() => window.dispatchEvent(new Event('pagehide')));
      let result;
      act(() => {
        result = autosave.result.current.flush();
      });
      expect(result).toEqual({ ok: false, reason: 'paused' });
      expect(autosave.result.current.status).toBe('paused');
      autosave.unmount();
      expect(localStorage.getItem(KEY)).toBe(before);
    });

    it('restore() returns its content and resumes autosave from it', () => {
      storeEarlierDraft(earlier());
      const setItem = vi.spyOn(Storage.prototype, 'setItem');
      const autosave = setupAutosave();

      let restored;
      act(() => {
        restored = autosave.result.current.restore();
      });
      expect(restored).toMatchObject({ caption: 'Earlier draft', hashtags: ['autumn'], media: [] });
      autosave.apply(composerActions.load(restored));

      expect(autosave.result.current).toMatchObject({
        status: 'saved',
        savedAt: '2026-11-20T08:00:00.000Z',
        restorable: null,
      });
      act(() => vi.advanceTimersByTime(DELAY * 2));
      expect(writesTo(setItem)).toBe(0);

      autosave.apply(composerActions.setCaption('Earlier draft, edited'));
      act(() => vi.advanceTimersByTime(DELAY));
      expect(stored().data.caption).toBe('Earlier draft, edited');
      expect(autosave.result.current.restore()).toBeNull();
    });

    it('discardRestorable() deletes it and saves the current content instead', () => {
      storeEarlierDraft(earlier());
      const autosave = setupAutosave();
      autosave.apply(composerActions.setCaption('Fresh start'));

      act(() => autosave.result.current.discardRestorable());
      expect(localStorage.getItem(KEY)).toBeNull();
      expect(autosave.result.current).toMatchObject({ status: 'pending', restorable: null });

      act(() => vi.advanceTimersByTime(DELAY));
      expect(stored().data.caption).toBe('Fresh start');
      expect(autosave.result.current.status).toBe('saved');
    });

    it('is not offered when it holds nothing worth keeping', () => {
      storeEarlierDraft(initial());
      const autosave = setupAutosave();
      expect(autosave.result.current).toMatchObject({ status: 'idle', restorable: null });
    });

    it('is never offered to another person on the same browser', () => {
      storeEarlierDraft(earlier(), '2026-11-20T08:00:00.000Z', 'u2');
      const autosave = setupAutosave();
      expect(autosave.result.current.restorable).toBeNull();
      expect(autosave.result.current.status).toBe('idle');
    });
  });

  describe('when the browser cannot store the draft', () => {
    it('says autosave is off when storage is blocked', () => {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new DOMException('Blocked', 'SecurityError');
      });
      const autosave = setupAutosave();
      expect(autosave.result.current).toMatchObject({
        status: 'unavailable',
        reason: 'unavailable',
        available: false,
      });

      autosave.apply(composerActions.setCaption('Private window'));
      act(() => vi.advanceTimersByTime(DELAY));
      expect(autosave.result.current.status).toBe('unavailable');
      let result;
      act(() => {
        result = autosave.result.current.flush();
      });
      expect(result).toEqual({ ok: false, reason: 'unavailable' });
    });

    it('reports a full storage quota and tries again on the next change', () => {
      const original = Storage.prototype.setItem;
      let full = true;
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function setItem(key, value) {
        if (full && key !== '__sh_probe__') throw new DOMException('Full', 'QuotaExceededError');
        return original.call(this, key, value);
      });
      const autosave = setupAutosave();
      expect(autosave.result.current.status).toBe('idle');

      autosave.apply(composerActions.setCaption('A long caption'));
      act(() => vi.advanceTimersByTime(DELAY));
      expect(autosave.result.current).toMatchObject({ status: 'error', reason: 'quota' });
      expect(localStorage.getItem(KEY)).toBeNull();

      full = false;
      autosave.apply(composerActions.setCaption('A shorter caption'));
      expect(autosave.result.current.status).toBe('pending');
      act(() => vi.advanceTimersByTime(DELAY));
      expect(autosave.result.current).toMatchObject({ status: 'saved', reason: null });
      expect(stored().data.caption).toBe('A shorter caption');
    });

    it('reports other write failures as an error', () => {
      const original = Storage.prototype.setItem;
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function setItem(key, value) {
        if (key !== '__sh_probe__') throw new TypeError('Something broke');
        return original.call(this, key, value);
      });
      const autosave = setupAutosave();
      autosave.apply(composerActions.setCaption('Hello'));
      act(() => vi.advanceTimersByTime(DELAY));
      expect(autosave.result.current).toMatchObject({ status: 'error', reason: 'error' });
    });
  });
});

/* ---------------------------------------------------------- useServerDraft */

const UPDATED_AT = '2026-11-20T09:30:00.000Z';
const contentPackage = (overrides = {}) => ({
  id: 'pkg1',
  status: 'DRAFT',
  version: 1,
  caption: '',
  platformCaptions: {},
  hashtags: [],
  hashtagPlacement: 'CAPTION',
  keywords: [],
  firstComment: '',
  media: [],
  targetAccountIds: [],
  createdBy: { id: 'u1', name: 'Ada Lovelace' },
  updatedBy: { id: 'u1', name: 'Ada Lovelace' },
  createdAt: UPDATED_AT,
  updatedAt: UPDATED_AT,
  ...overrides,
});

const PACKAGES = 'POST /workspaces/w1/content-packages';
const PATCH_PKG1 = 'PATCH /workspaces/w1/content-packages/pkg1';
const bodyOf = (mock, key) => JSON.parse(mock.calls.find((c) => c.key === key).init.body);

function useComposerWithServerDraft(initialState) {
  const [state, dispatch] = useReducer(composerReducer, initialState);
  const server = useServerDraft({ workspaceId: 'w1', state, dispatch });
  return { state, dispatch, server };
}

function renderServerDraft(initialState = initial()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const view = renderHook(() => useComposerWithServerDraft(initialState), { wrapper });
  return { ...view, queryClient };
}

describe('useServerDraft', () => {
  it('is unavailable while the content API flag is off, and never sends a request', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const { result } = renderServerDraft(withCaption('Hello'));

    expect(result.current.server).toMatchObject({
      available: false,
      status: 'unavailable',
      draft: null,
      error: null,
      dirty: false,
      omittedMedia: [],
    });
    await expect(result.current.server.save()).rejects.toMatchObject({
      code: 'CAPABILITY_UNAVAILABLE',
      capability: 'serverDrafts',
    });
    await expect(result.current.server.open('pkg1')).rejects.toBeInstanceOf(
      CapabilityUnavailableError,
    );
    await expect(result.current.server.remove()).rejects.toBeInstanceOf(CapabilityUnavailableError);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.current.server.status).toBe('unavailable');
  });

  describe('with the content API enabled', () => {
    beforeEach(() => {
      vi.stubEnv('VITE_COMPOSER_SERVER_DRAFTS', 'true');
    });

    it('creates the draft first, then updates it with the version it got back', async () => {
      const mock = setupComposerApi({
        routes: {
          [PACKAGES]: ({ init }) =>
            jsonResponse(201, { contentPackage: contentPackage(JSON.parse(init.body)) }),
          [PATCH_PKG1]: ({ init }) =>
            jsonResponse(200, {
              contentPackage: contentPackage({
                version: JSON.parse(init.body).version + 1,
                updatedAt: '2026-11-20T09:45:00.000Z',
              }),
            }),
        },
      });
      const { result } = renderServerDraft(withCaption('Launch day'));
      expect(result.current.server).toMatchObject({
        available: true,
        status: 'idle',
        dirty: true,
      });

      await act(async () => {
        await result.current.server.save();
      });
      expect(bodyOf(mock, PACKAGES)).toEqual({
        caption: 'Launch day',
        platformCaptions: {},
        hashtags: [],
        hashtagPlacement: 'CAPTION',
        keywords: [],
        firstComment: '',
        media: [],
        targetAccountIds: [],
      });
      expect(result.current.server).toMatchObject({
        status: 'saved',
        dirty: false,
        error: null,
        draft: { id: 'pkg1', version: 1, savedAt: UPDATED_AT, savedRevision: 1 },
      });

      act(() => result.current.dispatch(composerActions.setCaption('Launch day!')));
      expect(result.current.server).toMatchObject({ status: 'idle', dirty: true });

      await act(async () => {
        await result.current.server.save();
      });
      expect(bodyOf(mock, PATCH_PKG1)).toMatchObject({ caption: 'Launch day!', version: 1 });
      expect(mock.count(PACKAGES)).toBe(1);
      expect(result.current.server).toMatchObject({
        status: 'saved',
        draft: { id: 'pkg1', version: 2, savedAt: '2026-11-20T09:45:00.000Z', savedRevision: 2 },
      });
    });

    it('reports a version conflict when someone else saved first', async () => {
      setupComposerApi({
        routes: {
          [PACKAGES]: () => jsonResponse(201, { contentPackage: contentPackage() }),
          [PATCH_PKG1]: () => apiError(409, 'CONFLICT', 'Version 1 is out of date.'),
        },
      });
      const { result } = renderServerDraft(withCaption('Team post'));
      await act(async () => {
        await result.current.server.save();
      });
      act(() => result.current.dispatch(composerActions.setCaption('Team post, v2')));

      await act(async () => {
        await expect(result.current.server.save()).rejects.toMatchObject({
          message: SERVER_DRAFT_CONFLICT_MESSAGE,
          code: 'CONFLICT',
        });
      });
      expect(result.current.server.status).toBe('conflict');
      expect(result.current.server.error.message).toBe(
        'Someone else saved this draft. Reload it to see their changes.',
      );
      expect(result.current.server.draft).toMatchObject({ id: 'pkg1', version: 1 });
    });

    it('reports other failures with the message from the API', async () => {
      setupComposerApi({
        routes: { [PACKAGES]: () => apiError(500, 'INTERNAL', 'The content service is down.') },
      });
      const { result } = renderServerDraft(withCaption('Hello'));
      await act(async () => {
        await expect(result.current.server.save()).rejects.toThrow('The content service is down.');
      });
      expect(result.current.server).toMatchObject({ status: 'error', draft: null, dirty: true });
      expect(result.current.server.error.message).toBe('The content service is down.');
    });

    it('never treats a response without a draft as saved', async () => {
      setupComposerApi({ routes: { [PACKAGES]: () => jsonResponse(201, {}) } });
      const { result } = renderServerDraft(withCaption('Hello'));
      await act(async () => {
        await expect(result.current.server.save()).rejects.toThrow(/may not have been saved/);
      });
      expect(result.current.server).toMatchObject({ status: 'error', draft: null });
    });

    it('leaves out files that are not uploaded yet and reports them', async () => {
      const local = photo('m-local', 'beach.jpg');
      const uploaded = {
        ...photo('m-up', 'city.jpg'),
        altText: 'City at night',
        upload: { status: UPLOAD_STATUS.UPLOADED, progress: 1, mediaId: 'srv-1', error: null },
      };
      const mock = setupComposerApi({
        routes: { [PACKAGES]: () => jsonResponse(201, { contentPackage: contentPackage() }) },
      });
      const { result } = renderServerDraft(
        reduce(
          initial(),
          composerActions.addMedia([local, uploaded]),
          composerActions.setCaption('Two photos'),
        ),
      );
      expect(result.current.server.omittedMedia.map((m) => m.id)).toEqual(['m-local']);

      let saved;
      await act(async () => {
        saved = await result.current.server.save();
      });
      expect(bodyOf(mock, PACKAGES).media).toEqual([
        { mediaId: 'srv-1', altText: 'City at night' },
      ]);
      expect(saved.omittedMedia.map((m) => m.fileName)).toEqual(['beach.jpg']);
      expect(saved.contentPackage.id).toBe('pkg1');
    });

    it('open() loads a team draft into the composer', async () => {
      const mock = setupComposerApi({
        routes: {
          'GET /workspaces/w1/content-packages/pkg9': () =>
            jsonResponse(200, {
              contentPackage: contentPackage({
                id: 'pkg9',
                version: 4,
                caption: 'From the team',
                hashtags: ['launch'],
                targetAccountIds: ['acc-fb-1'],
              }),
            }),
          'PATCH /workspaces/w1/content-packages/pkg9': () =>
            jsonResponse(200, { contentPackage: contentPackage({ id: 'pkg9', version: 5 }) }),
        },
      });
      const { result } = renderServerDraft(withCaption('Mine'));

      await act(async () => {
        await result.current.server.open('pkg9');
      });
      expect(result.current.state).toMatchObject({
        caption: 'From the team',
        hashtags: ['launch'],
        selectedAccountIds: ['acc-fb-1'],
        revision: 0,
      });
      expect(result.current.server).toMatchObject({
        status: 'saved',
        dirty: false,
        draft: { id: 'pkg9', version: 4, savedAt: UPDATED_AT, savedRevision: 0 },
      });

      act(() => result.current.dispatch(composerActions.setCaption('From the team, edited')));
      await act(async () => {
        await result.current.server.save();
      });
      expect(bodyOf(mock, 'PATCH /workspaces/w1/content-packages/pkg9')).toMatchObject({
        caption: 'From the team, edited',
        version: 4,
      });
    });

    it('open() failures leave the composer untouched', async () => {
      setupComposerApi({
        routes: {
          'GET /workspaces/w1/content-packages/gone': () =>
            apiError(404, 'NOT_FOUND', 'This draft no longer exists.'),
        },
      });
      const { result } = renderServerDraft(withCaption('Mine'));
      await act(async () => {
        await expect(result.current.server.open('gone')).rejects.toThrow(
          'This draft no longer exists.',
        );
      });
      expect(result.current.state.caption).toBe('Mine');
      expect(result.current.server).toMatchObject({ draft: null, status: 'idle' });
    });

    it('runs saves one at a time, so the second one uses the first one’s version', async () => {
      let respond;
      const mock = setupComposerApi({
        routes: {
          [PACKAGES]: () =>
            new Promise((resolve) => {
              respond = () => resolve(jsonResponse(201, { contentPackage: contentPackage() }));
            }),
          [PATCH_PKG1]: ({ init }) =>
            jsonResponse(200, {
              contentPackage: contentPackage({ version: JSON.parse(init.body).version + 1 }),
            }),
        },
      });
      const { result } = renderServerDraft(withCaption('Quick'));

      let first;
      let second;
      await act(async () => {
        first = result.current.server.save();
        second = result.current.server.save();
      });
      await waitFor(() => expect(respond).toBeTypeOf('function'));
      expect(result.current.server.status).toBe('saving');
      expect(mock.count(PATCH_PKG1)).toBe(0);

      await act(async () => {
        respond();
        await first;
        await second;
      });
      expect(mock.count(PACKAGES)).toBe(1);
      expect(bodyOf(mock, PATCH_PKG1).version).toBe(1);
      expect(result.current.server.draft.version).toBe(2);
    });

    it('reset() unlinks the draft so the next save creates a new one', async () => {
      const mock = setupComposerApi({
        routes: { [PACKAGES]: () => jsonResponse(201, { contentPackage: contentPackage() }) },
      });
      const { result } = renderServerDraft(withCaption('First post'));
      await act(async () => {
        await result.current.server.save();
      });

      act(() => result.current.server.reset());
      expect(result.current.server).toMatchObject({ draft: null, status: 'idle', dirty: true });

      await act(async () => {
        await result.current.server.save();
      });
      expect(mock.count(PACKAGES)).toBe(2);
      expect(mock.count(PATCH_PKG1)).toBe(0);
    });

    it('does not relink a save that finishes after the composer was reset', async () => {
      let respond;
      setupComposerApi({
        routes: {
          [PACKAGES]: () =>
            new Promise((resolve) => {
              respond = () => resolve(jsonResponse(201, { contentPackage: contentPackage() }));
            }),
        },
      });
      const { result } = renderServerDraft(withCaption('Saved, then discarded'));
      let pending;
      await act(async () => {
        pending = result.current.server.save();
      });
      await waitFor(() => expect(respond).toBeTypeOf('function'));

      act(() => {
        result.current.server.reset();
        result.current.dispatch(composerActions.reset());
      });
      await act(async () => {
        respond();
        await expect(pending).resolves.toMatchObject({ contentPackage: { id: 'pkg1' } });
      });
      expect(result.current.server).toMatchObject({ draft: null, status: 'idle', dirty: false });
    });

    it('remove() deletes the linked draft', async () => {
      const mock = setupComposerApi({
        routes: {
          [PACKAGES]: () => jsonResponse(201, { contentPackage: contentPackage() }),
          'DELETE /workspaces/w1/content-packages/pkg1': () => jsonResponse(204),
        },
      });
      const { result } = renderServerDraft(withCaption('Delete me'));
      await act(async () => {
        await result.current.server.save();
      });
      await act(async () => {
        await result.current.server.remove();
      });
      expect(mock.count('DELETE /workspaces/w1/content-packages/pkg1')).toBe(1);
      expect(result.current.server).toMatchObject({ draft: null, status: 'idle' });
    });

    it('refreshes the drafts list after saving', async () => {
      setupComposerApi({
        routes: { [PACKAGES]: () => jsonResponse(201, { contentPackage: contentPackage() }) },
      });
      const { result, queryClient } = renderServerDraft(withCaption('Listed'));
      queryClient.setQueryData(composerDraftsQueryKey('w1'), { pages: [], pageParams: [] });

      await act(async () => {
        await result.current.server.save();
      });
      expect(queryClient.getQueryState(composerDraftsQueryKey('w1')).isInvalidated).toBe(true);
    });
  });
});

/* -------------------------------------------------- useUnsavedChangesGuard */

function GuardProbe({ initialWhen }) {
  const [when, setWhen] = useState(initialWhen);
  useUnsavedChangesGuard({ when });
  return (
    <button type="button" onClick={() => setWhen((value) => !value)}>
      {when ? 'Has unsaved changes' : 'All saved'}
    </button>
  );
}

function renderGuardProbe(initialWhen) {
  const router = createMemoryRouter(
    [{ path: '/compose', element: <GuardProbe initialWhen={initialWhen} /> }],
    { initialEntries: ['/compose'] },
  );
  return render(<RouterProvider router={router} />);
}

const leaveTab = () => {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return event;
};

describe('useUnsavedChangesGuard', () => {
  it('asks the browser to confirm closing the tab only while something is unsaved', async () => {
    const user = userEvent.setup();
    const { unmount } = renderGuardProbe(true);
    expect(leaveTab().defaultPrevented).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Has unsaved changes' }));
    expect(screen.getByRole('button', { name: 'All saved' })).toBeInTheDocument();
    expect(leaveTab().defaultPrevented).toBe(false);

    await user.click(screen.getByRole('button', { name: 'All saved' }));
    expect(leaveTab().defaultPrevented).toBe(true);

    unmount();
    expect(leaveTab().defaultPrevented).toBe(false);
  });

  it('leaves the tab alone when there is nothing to lose', () => {
    renderGuardProbe(false);
    expect(leaveTab().defaultPrevented).toBe(false);
  });
});
