import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode, useReducer, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAccessToken } from '../../../lib/api.js';
import { apiError, jsonResponse, mockFetch } from '../../../test/fetchMock.js';
import { MediaDropzone } from '../components/media/MediaDropzone.jsx';
import { MediaGrid } from '../components/media/MediaGrid.jsx';
import { MediaPreviewDialog } from '../components/media/MediaPreviewDialog.jsx';
import {
  INSPECTION_STATUS,
  MEDIA_KINDS,
  MEDIA_MAX_ITEMS,
  UPLOAD_STATUS,
  composerActions,
  composerReducer,
  createInitialComposerState,
  createMediaItem,
} from '../model/composerState.js';
import { inspectMediaFile } from '../services/mediaInspector.js';
import { dataTransferWith, installObjectUrlMock, makeFile } from '../test/browserMocks.js';
import {
  MAX_REJECTIONS,
  UPLOAD_MAX_POLLS,
  UPLOAD_POLL_INTERVAL_MS,
  UPLOAD_SLOW_POLL_INTERVAL_MS,
  useMediaManager,
} from './useMediaManager.js';

vi.mock('../services/mediaInspector.js', () => ({
  INSPECTION_TIMEOUT_MS: 15000,
  inspectMediaFile: vi.fn(),
}));

const sessionUser = { id: 'u1', name: 'Ada Lovelace', email: 'ada@example.com' };

/* -------------------------------------------------------------- helpers */

function renderManager({ initial, strict = false } = {}) {
  return renderHook(
    () => {
      const [state, dispatch] = useReducer(composerReducer, initial, (init) => ({
        ...createInitialComposerState(),
        ...(init ?? {}),
      }));
      const manager = useMediaManager({ media: state.media, dispatch, workspaceId: 'w1' });
      return { state, dispatch, manager };
    },
    strict ? { wrapper: StrictMode } : undefined,
  );
}

async function add(result, files) {
  let outcome;
  await act(async () => {
    outcome = result.current.manager.addFiles(files);
  });
  return outcome;
}

const jpeg = (name = 'photo.jpg', size = 2048) => makeFile(name, 'image/jpeg', size);
const mp4 = (name = 'clip.mp4', size = 4096) => makeFile(name, 'video/mp4', size);

/** Stand-in for XMLHttpRequest (jsdom's would try to reach the network). */
function installFakeXhr() {
  const instances = [];
  class FakeXhr {
    constructor() {
      this.upload = { onprogress: null };
      this.headers = {};
      this.status = 0;
      this.aborted = false;
      instances.push(this);
    }
    open(method, url) {
      this.method = method;
      this.url = url;
    }
    setRequestHeader(name, value) {
      this.headers[name] = value;
    }
    send(body) {
      this.body = body;
    }
    abort() {
      this.aborted = true;
      this.onabort?.();
    }
    progress(loaded, total) {
      this.upload.onprogress?.({ lengthComputable: true, loaded, total });
    }
    respond(status) {
      this.status = status;
      this.onload?.();
    }
  }
  vi.stubGlobal('XMLHttpRequest', FakeXhr);
  return instances;
}

const asset = (status, overrides = {}) => ({
  media: {
    id: 'm1',
    kind: 'IMAGE',
    mimeType: 'image/jpeg',
    sizeBytes: 2048,
    width: 1080,
    height: 1080,
    durationSec: null,
    status,
    url: status === 'READY' ? 'https://cdn.example.test/m1.jpg' : null,
    thumbnailUrl: null,
    failureReason: null,
    ...overrides,
  },
});

function mediaApi(routes = {}) {
  return mockFetch({
    'POST /auth/refresh': () => jsonResponse(200, { user: sessionUser, accessToken: 'access' }),
    'POST /workspaces/w1/media/uploads': () =>
      jsonResponse(201, {
        media: { id: 'm1', status: 'PENDING_UPLOAD' },
        upload: {
          url: 'https://storage.example.test/m1?signature=abc',
          method: 'PUT',
          headers: { 'Content-Type': 'image/jpeg' },
          expiresAt: '2026-11-20T13:00:00.000Z',
        },
      }),
    'POST /workspaces/w1/media/m1/complete': () => jsonResponse(200, asset('READY')),
    ...routes,
  });
}

/** Runs the poll delay (3 s) immediately while recording that it was requested. */
function skipPollDelay() {
  const realSetTimeout = globalThis.setTimeout;
  return vi
    .spyOn(globalThis, 'setTimeout')
    .mockImplementation((callback, ms, ...args) =>
      realSetTimeout(
        callback,
        ms === UPLOAD_POLL_INTERVAL_MS || ms === UPLOAD_SLOW_POLL_INTERVAL_MS ? 0 : ms,
        ...args,
      ),
    );
}

let urls;

beforeEach(() => {
  urls = installObjectUrlMock();
  setAccessToken(null);
  inspectMediaFile.mockReset();
  inspectMediaFile.mockImplementation((file) =>
    Promise.resolve(
      file.type.startsWith('video/')
        ? { width: 1920, height: 1080, durationSec: 42.5 }
        : { width: 1080, height: 1350, durationSec: null },
    ),
  );
});

afterEach(() => {
  urls.restore();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

/* ------------------------------------------------------- the real inspector */

describe('inspectMediaFile (services/mediaInspector.js)', () => {
  const loadActual = () => vi.importActual('../services/mediaInspector.js');

  function fakeImage({ width = 1080, height = 1350, fail = false, never = false } = {}) {
    const instances = [];
    class FakeImage {
      constructor() {
        this.onload = null;
        this.onerror = null;
        this.removeAttribute = vi.fn();
        instances.push(this);
      }
      set src(value) {
        this.requestedSrc = value;
        if (never) return;
        queueMicrotask(() => {
          if (fail) {
            this.onerror?.(new Event('error'));
            return;
          }
          this.naturalWidth = width;
          this.naturalHeight = height;
          this.onload?.(new Event('load'));
        });
      }
    }
    vi.stubGlobal('Image', FakeImage);
    return instances;
  }

  function fakeVideo({ width = 1080, height = 1920, duration = 12.5, fail = false } = {}) {
    const video = {
      preload: '',
      muted: false,
      onloadedmetadata: null,
      onerror: null,
      removeAttribute: vi.fn(),
      load: vi.fn(),
      set src(value) {
        this.requestedSrc = value;
        queueMicrotask(() => {
          if (fail) {
            this.onerror?.(new Event('error'));
            return;
          }
          this.videoWidth = width;
          this.videoHeight = height;
          this.duration = duration;
          this.onloadedmetadata?.(new Event('loadedmetadata'));
        });
      },
    };
    const createElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag, options) =>
      tag === 'video' ? video : createElement(tag, options),
    );
    return video;
  }

  it('reads an image’s natural size from the given object URL and cleans up', async () => {
    const { inspectMediaFile: inspect } = await loadActual();
    const images = fakeImage({ width: 1080, height: 1350 });

    await expect(inspect(jpeg(), { kind: MEDIA_KINDS.IMAGE, url: 'blob:mock/1' })).resolves.toEqual(
      { width: 1080, height: 1350, durationSec: null },
    );
    expect(images).toHaveLength(1);
    expect(images[0].requestedSrc).toBe('blob:mock/1');
    expect(images[0].onload).toBeNull();
    expect(images[0].onerror).toBeNull();
    // It decodes the caller's URL and never makes or revokes one itself.
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  });

  it('rejects when the image can’t be decoded', async () => {
    const { inspectMediaFile: inspect, MediaInspectionError } = await loadActual();
    fakeImage({ fail: true });

    const promise = inspect(jpeg('broken.jpg'), { kind: MEDIA_KINDS.IMAGE, url: 'blob:mock/2' });
    await expect(promise).rejects.toBeInstanceOf(MediaInspectionError);
    await expect(promise).rejects.toMatchObject({ code: 'UNREADABLE' });
    await expect(promise).rejects.toThrow(/broken\.jpg/);
  });

  it('reads a video’s size and duration from its metadata only', async () => {
    const { inspectMediaFile: inspect } = await loadActual();
    const video = fakeVideo({ width: 1080, height: 1920, duration: 12.5 });

    await expect(inspect(mp4(), { kind: MEDIA_KINDS.VIDEO, url: 'blob:mock/3' })).resolves.toEqual({
      width: 1080,
      height: 1920,
      durationSec: 12.5,
    });
    expect(document.createElement).toHaveBeenCalledWith('video');
    expect(video.preload).toBe('metadata');
    expect(video.muted).toBe(true);
    expect(video.requestedSrc).toBe('blob:mock/3');
    expect(video.onloadedmetadata).toBeNull();
    expect(video.removeAttribute).toHaveBeenCalledWith('src');
    expect(video.load).toHaveBeenCalled();
  });

  it('reports an unknown (non-finite) video duration as null', async () => {
    const { inspectMediaFile: inspect } = await loadActual();
    fakeVideo({ duration: Infinity });

    await expect(
      inspect(mp4(), { kind: MEDIA_KINDS.VIDEO, url: 'blob:mock/4' }),
    ).resolves.toMatchObject({ durationSec: null });
  });

  it('rejects a video whose picture has no readable size (audio-only, undecodable track)', async () => {
    const { inspectMediaFile: inspect } = await loadActual();
    fakeVideo({ width: 0, height: 0, duration: 30 });

    // Resolving with null dimensions would let the aspect-ratio checks pass silently.
    await expect(
      inspect(mp4('audio-only.mp4'), { kind: MEDIA_KINDS.VIDEO, url: 'blob:mock/6' }),
    ).rejects.toMatchObject({ code: 'UNREADABLE' });
  });

  it('rejects when the video can’t be read', async () => {
    const { inspectMediaFile: inspect } = await loadActual();
    fakeVideo({ fail: true });

    await expect(
      inspect(mp4('clip.mov'), { kind: MEDIA_KINDS.VIDEO, url: 'blob:mock/5' }),
    ).rejects.toMatchObject({ code: 'UNREADABLE' });
  });

  it('gives up after the timeout and detaches its handlers', async () => {
    const { inspectMediaFile: inspect, INSPECTION_TIMEOUT_MS } = await loadActual();
    vi.useFakeTimers();
    const images = fakeImage({ never: true });

    const promise = inspect(jpeg(), { kind: MEDIA_KINDS.IMAGE, url: 'blob:mock/6' });
    const outcome = expect(promise).rejects.toMatchObject({ code: 'TIMEOUT' });
    await vi.advanceTimersByTimeAsync(INSPECTION_TIMEOUT_MS - 1);
    expect(images[0].onload).not.toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    await outcome;
    expect(images[0].onload).toBeNull();
    expect(images[0].removeAttribute).toHaveBeenCalledWith('src');
  });

  it('rejects without a preview URL and never starts decoding', async () => {
    const { inspectMediaFile: inspect } = await loadActual();
    const images = fakeImage();

    await expect(inspect(jpeg(), { kind: MEDIA_KINDS.IMAGE, url: null })).rejects.toMatchObject({
      code: 'NO_PREVIEW_URL',
    });
    expect(images).toHaveLength(0);
  });
});

/* -------------------------------------------------------- adding and removing */

describe('useMediaManager — adding files', () => {
  it('adds accepted files as items that stay in this browser, with object-URL previews', async () => {
    const { result } = renderManager();
    const photo = jpeg('beach.jpg', 2048);
    const clip = mp4('waves.mp4', 4096);

    const outcome = await add(result, [photo, clip]);

    expect(outcome.rejected).toEqual([]);
    expect(outcome.added.map((item) => item.fileName)).toEqual(['beach.jpg', 'waves.mp4']);
    const [first, second] = result.current.state.media;
    expect(first).toMatchObject({
      kind: MEDIA_KINDS.IMAGE,
      fileName: 'beach.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 2048,
      previewUrl: urls.created[0],
      upload: { status: UPLOAD_STATUS.LOCAL, progress: 0, mediaId: null, error: null },
    });
    expect(second).toMatchObject({ kind: MEDIA_KINDS.VIDEO, previewUrl: urls.created[1] });
    expect(first.id).toMatch(/^media_/);
    expect(result.current.manager.getFile(first.id)).toBe(photo);
    expect(result.current.manager.getFile(second.id)).toBe(clip);
  });

  it('applies the inspection results (or marks them failed)', async () => {
    inspectMediaFile.mockImplementation((file) =>
      file.name === 'broken.jpg'
        ? Promise.reject(new Error('unreadable'))
        : Promise.resolve(
            file.type.startsWith('video/')
              ? { width: 1920, height: 1080, durationSec: 42.5 }
              : { width: 1080, height: 1350, durationSec: null },
          ),
    );
    const { result } = renderManager();
    const photo = jpeg('beach.jpg');

    await add(result, [photo, mp4('waves.mp4'), jpeg('broken.jpg')]);

    await waitFor(() =>
      expect(result.current.state.media.map((m) => m.inspection)).toEqual([
        INSPECTION_STATUS.DONE,
        INSPECTION_STATUS.DONE,
        INSPECTION_STATUS.FAILED,
      ]),
    );
    const [image, video, broken] = result.current.state.media;
    expect(image).toMatchObject({ width: 1080, height: 1350, durationSec: null });
    expect(video).toMatchObject({ width: 1920, height: 1080, durationSec: 42.5 });
    expect(broken).toMatchObject({ width: null, height: null });
    expect(inspectMediaFile).toHaveBeenCalledWith(photo, {
      kind: MEDIA_KINDS.IMAGE,
      url: urls.created[0],
    });
  });

  it('marks details unreadable without decoding when object URLs are unavailable', async () => {
    URL.createObjectURL = undefined;
    const { result } = renderManager();

    await add(result, [jpeg()]);

    expect(result.current.state.media[0].previewUrl).toBeNull();
    expect(result.current.state.media[0].inspection).toBe(INSPECTION_STATUS.FAILED);
    expect(inspectMediaFile).not.toHaveBeenCalled();
  });

  it('rejects files no destination can use, with a reason that names the file', async () => {
    const { result } = renderManager();

    const outcome = await add(result, [
      makeFile('notes.pdf', 'application/pdf'),
      makeFile('IMG_0042.heic', 'image/heic'),
      makeFile('empty.png', 'image/png', 0),
      makeFile('huge.mp4', 'video/mp4', 2_000_000_000),
    ]);

    expect(outcome.added).toEqual([]);
    expect(outcome.rejected.map((r) => r.fileName)).toEqual([
      'notes.pdf',
      'IMG_0042.heic',
      'empty.png',
      'huge.mp4',
    ]);
    const reasons = result.current.manager.rejections.map((r) => r.reason);
    expect(reasons[0]).toMatch(/notes\.pdf isn't a supported file/);
    expect(reasons[1]).toMatch(/IMG_0042\.heic is a HEIC photo/);
    expect(reasons[2]).toMatch(/empty\.png is empty/);
    expect(reasons[3]).toMatch(/huge\.mp4 is 2 GB/);
    expect(result.current.state.media).toEqual([]);
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('dismisses one message or all of them', async () => {
    const { result } = renderManager();
    await add(result, [makeFile('a.pdf', 'application/pdf'), makeFile('b.txt', 'text/plain')]);
    const [first, second] = result.current.manager.rejections;
    expect(first).toMatchObject({ fileName: 'a.pdf', id: expect.any(String) });

    act(() => result.current.manager.dismissRejection(first.id));
    expect(result.current.manager.rejections).toEqual([second]);

    act(() => result.current.manager.clearRejections());
    expect(result.current.manager.rejections).toEqual([]);
  });

  it('keeps only the most recent messages', async () => {
    const { result } = renderManager();
    const files = Array.from({ length: 7 }, (_, i) =>
      makeFile(`doc-${i + 1}.pdf`, 'application/pdf'),
    );

    await add(result, files.slice(0, 4));
    await add(result, files.slice(4));

    const names = result.current.manager.rejections.map((r) => r.fileName);
    expect(names).toHaveLength(MAX_REJECTIONS);
    expect(names).toEqual(['doc-3.pdf', 'doc-4.pdf', 'doc-5.pdf', 'doc-6.pdf', 'doc-7.pdf']);
  });

  it('stops at the file limit, counting what is already attached, with one message', async () => {
    const existing = Array.from({ length: MEDIA_MAX_ITEMS - 2 }, (_, i) =>
      createMediaItem({
        id: `existing-${i}`,
        kind: MEDIA_KINDS.IMAGE,
        fileName: `old-${i}.jpg`,
        mimeType: 'image/jpeg',
        sizeBytes: 100,
      }),
    );
    const { result } = renderManager({ initial: { media: existing } });

    const outcome = await add(result, [
      jpeg('new-1.jpg'),
      jpeg('new-2.jpg'),
      jpeg('new-3.jpg'),
      jpeg('new-4.jpg'),
    ]);

    expect(outcome.added.map((m) => m.fileName)).toEqual(['new-1.jpg', 'new-2.jpg']);
    expect(outcome.rejected.map((r) => r.fileName)).toEqual(['new-3.jpg', 'new-4.jpg']);
    expect(result.current.state.media).toHaveLength(MEDIA_MAX_ITEMS);
    expect(result.current.manager.rejections).toHaveLength(1);
    expect(result.current.manager.rejections[0].reason).toBe(
      `new-3.jpg and 1 more file weren't added. You can attach up to ${MEDIA_MAX_ITEMS} files to one post.`,
    );
    // Only accepted files get object URLs.
    expect(urls.created).toHaveLength(2);
  });

  it('counts files added a moment ago even before they reach the state', async () => {
    const existing = Array.from({ length: MEDIA_MAX_ITEMS - 1 }, (_, i) =>
      createMediaItem({
        id: `existing-${i}`,
        kind: MEDIA_KINDS.IMAGE,
        fileName: `old-${i}.jpg`,
        mimeType: 'image/jpeg',
        sizeBytes: 100,
      }),
    );
    const { result } = renderManager({ initial: { media: existing } });
    let first;
    let second;

    await act(async () => {
      const { addFiles } = result.current.manager;
      first = addFiles([jpeg('one.jpg')]);
      second = addFiles([jpeg('two.jpg')]); // same render: `media` hasn't changed yet
    });

    expect(first.added).toHaveLength(1);
    expect(second.added).toHaveLength(0);
    expect(second.rejected[0].fileName).toBe('two.jpg');
    expect(result.current.state.media).toHaveLength(MEDIA_MAX_ITEMS);
    expect(urls.created).toHaveLength(1);
  });
});

describe('useMediaManager — releasing files', () => {
  it('revokes the preview URL when an item is removed, and the rest on unmount', async () => {
    const { result, unmount } = renderManager();
    await add(result, [jpeg('a.jpg'), jpeg('b.jpg')]);
    const [a, b] = result.current.state.media;

    act(() => result.current.manager.removeMedia(a.id));

    expect(result.current.state.media.map((m) => m.id)).toEqual([b.id]);
    expect(urls.revoked).toEqual([a.previewUrl]);
    expect(result.current.manager.getFile(a.id)).toBeNull();

    unmount();
    expect(urls.revoked).toEqual([a.previewUrl, b.previewUrl]);
  });

  it('releases files the composer drops through reset or a loaded draft', async () => {
    const { result } = renderManager();
    await add(result, [jpeg('a.jpg')]);
    const [a] = result.current.state.media;

    act(() => result.current.dispatch(composerActions.reset()));

    expect(urls.revoked).toEqual([a.previewUrl]);
    expect(result.current.manager.getFile(a.id)).toBeNull();
  });

  it('keeps previews alive under StrictMode’s double effects', async () => {
    const { result, unmount } = renderManager({ strict: true });
    await add(result, [jpeg('a.jpg')]);
    await waitFor(() =>
      expect(result.current.state.media[0].inspection).toBe(INSPECTION_STATUS.DONE),
    );

    expect(urls.revoked).toEqual([]);
    unmount();
    expect(urls.revoked).toEqual([urls.created[0]]);
  });
});

/* --------------------------------------------------------------------- uploads */

describe('useMediaManager — uploads while the media API is unavailable', () => {
  it('keeps files local and makes no request of any kind', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const xhr = vi.fn();
    vi.stubGlobal('XMLHttpRequest', xhr);
    const { result } = renderManager();

    expect(result.current.manager.uploadAvailable).toBe(false);
    await add(result, [jpeg('a.jpg')]);
    await waitFor(() =>
      expect(result.current.state.media[0].inspection).toBe(INSPECTION_STATUS.DONE),
    );
    const [item] = result.current.state.media;

    let retried;
    act(() => {
      retried = result.current.manager.retryUpload(item.id);
    });
    expect(retried).toBe(false);
    expect(result.current.state.media[0].upload).toEqual({
      status: UPLOAD_STATUS.LOCAL,
      progress: 0,
      mediaId: null,
      error: null,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(xhr).not.toHaveBeenCalled();
  });
});

describe('useMediaManager — uploads through the media API', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_COMPOSER_MEDIA_UPLOAD', 'true');
  });

  const item = (result) => result.current.state.media[0];

  it('creates a slot, sends the bytes with progress, and is UPLOADED only after READY', async () => {
    const api = mediaApi();
    const xhrs = installFakeXhr();
    const { result } = renderManager();
    const photo = jpeg('a.jpg', 2048);

    expect(result.current.manager.uploadAvailable).toBe(true);
    await add(result, [photo]);
    expect(item(result).upload.status).toBe(UPLOAD_STATUS.UPLOADING);

    await waitFor(() => expect(xhrs).toHaveLength(1));
    const [xhr] = xhrs;
    const slotRequest = api.calls.find((c) => c.key === 'POST /workspaces/w1/media/uploads');
    expect(JSON.parse(slotRequest.init.body)).toEqual({
      fileName: 'a.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 2048,
      kind: 'IMAGE',
    });
    expect(xhr).toMatchObject({
      method: 'PUT',
      url: 'https://storage.example.test/m1?signature=abc',
      headers: { 'Content-Type': 'image/jpeg' },
      body: photo,
    });

    act(() => xhr.progress(512, 2048));
    expect(item(result).upload).toMatchObject({ status: UPLOAD_STATUS.UPLOADING, progress: 0.25 });
    act(() => xhr.progress(1024, 2048));
    expect(item(result).upload.progress).toBe(0.5);
    expect(api.count('POST /workspaces/w1/media/m1/complete')).toBe(0);

    act(() => xhr.respond(200));
    await waitFor(() =>
      expect(item(result).upload).toEqual({
        status: UPLOAD_STATUS.UPLOADED,
        progress: 1,
        mediaId: 'm1',
        error: null,
      }),
    );
    expect(api.count('POST /workspaces/w1/media/m1/complete')).toBe(1);
  });

  it('polls every few seconds while the API reports PROCESSING', async () => {
    const delays = skipPollDelay();
    const answers = ['PROCESSING', 'READY'];
    const api = mediaApi({
      'POST /workspaces/w1/media/m1/complete': () => jsonResponse(200, asset('PROCESSING')),
      'GET /workspaces/w1/media/m1': () => jsonResponse(200, asset(answers.shift())),
    });
    const xhrs = installFakeXhr();
    const { result } = renderManager();
    await add(result, [jpeg()]);
    await waitFor(() => expect(xhrs).toHaveLength(1));

    act(() => xhrs[0].respond(204));

    await waitFor(() => expect(item(result).upload.status).toBe(UPLOAD_STATUS.UPLOADED));
    expect(api.count('GET /workspaces/w1/media/m1')).toBe(2);
    expect(delays).toHaveBeenCalledWith(expect.any(Function), UPLOAD_POLL_INTERVAL_MS);
    expect(item(result).upload.mediaId).toBe('m1');
  });

  it('shows PROCESSING (not uploaded) while the server is still working', async () => {
    mediaApi({
      'POST /workspaces/w1/media/m1/complete': () => jsonResponse(200, asset('PROCESSING')),
      'GET /workspaces/w1/media/m1': () => jsonResponse(200, asset('PROCESSING')),
    });
    const xhrs = installFakeXhr();
    const { result } = renderManager();
    await add(result, [jpeg()]);
    await waitFor(() => expect(xhrs).toHaveLength(1));

    act(() => xhrs[0].respond(200));

    await waitFor(() => expect(item(result).upload.status).toBe(UPLOAD_STATUS.PROCESSING));
    // The bytes are stored, so the server id is kept: a team draft can already reference the
    // file. It is still not "uploaded" until the API says READY.
    expect(item(result).upload.mediaId).toBe('m1');
    expect(item(result).upload.status).not.toBe(UPLOAD_STATUS.UPLOADED);
  });

  it(`keeps waiting past ${UPLOAD_MAX_POLLS} polls, checking less often, until the server is ready`, async () => {
    const delays = skipPollDelay();
    let polls = 0;
    const api = mediaApi({
      'POST /workspaces/w1/media/m1/complete': () => jsonResponse(200, asset('PROCESSING')),
      'GET /workspaces/w1/media/m1': () => {
        polls += 1;
        // Long processing (e.g. a video transcode): ready only after the fast polls ran out.
        return jsonResponse(200, asset(polls > UPLOAD_MAX_POLLS + 2 ? 'READY' : 'PROCESSING'));
      },
    });
    const xhrs = installFakeXhr();
    const { result } = renderManager();
    await add(result, [jpeg()]);
    await waitFor(() => expect(xhrs).toHaveLength(1));

    act(() => xhrs[0].respond(200));

    await waitFor(() => expect(item(result).upload.status).toBe(UPLOAD_STATUS.UPLOADED), {
      timeout: 4500,
    });
    // Never reported as failed, and the server id was never dropped.
    expect(item(result).upload).toMatchObject({ mediaId: 'm1', error: null });
    expect(api.count('GET /workspaces/w1/media/m1')).toBe(UPLOAD_MAX_POLLS + 3);
    expect(delays).toHaveBeenCalledWith(expect.any(Function), UPLOAD_SLOW_POLL_INTERVAL_MS);
  });

  it('reports the server’s processing failure reason', async () => {
    mediaApi({
      'POST /workspaces/w1/media/m1/complete': () =>
        jsonResponse(200, asset('FAILED', { failureReason: 'The video codec is not supported.' })),
    });
    const xhrs = installFakeXhr();
    const { result } = renderManager();
    await add(result, [mp4()]);
    await waitFor(() => expect(xhrs).toHaveLength(1));

    act(() => xhrs[0].respond(200));

    await waitFor(() =>
      expect(item(result).upload).toMatchObject({
        status: UPLOAD_STATUS.FAILED,
        error: 'The video codec is not supported.',
        mediaId: null,
      }),
    );
  });

  it('reports API errors without sending any bytes', async () => {
    mediaApi({
      'POST /workspaces/w1/media/uploads': () =>
        apiError(413, 'PAYLOAD_TOO_LARGE', 'This workspace’s storage is full.'),
    });
    const xhrs = installFakeXhr();
    const { result } = renderManager();

    await add(result, [jpeg()]);

    await waitFor(() =>
      expect(item(result).upload).toMatchObject({
        status: UPLOAD_STATUS.FAILED,
        error: 'This workspace’s storage is full.',
      }),
    );
    expect(xhrs).toHaveLength(0);
  });

  it('reports a storage rejection and retries the whole upload on request', async () => {
    const api = mediaApi();
    const xhrs = installFakeXhr();
    const { result } = renderManager();
    await add(result, [jpeg()]);
    await waitFor(() => expect(xhrs).toHaveLength(1));

    act(() => xhrs[0].respond(403));
    await waitFor(() => expect(item(result).upload.status).toBe(UPLOAD_STATUS.FAILED));
    expect(item(result).upload.error).toMatch(/storage answered 403/);
    expect(api.count('POST /workspaces/w1/media/m1/complete')).toBe(0);

    let restarted;
    act(() => {
      restarted = result.current.manager.retryUpload(item(result).id);
    });
    expect(restarted).toBe(true);
    expect(item(result).upload).toMatchObject({ status: UPLOAD_STATUS.UPLOADING, error: null });
    await waitFor(() => expect(xhrs).toHaveLength(2));
    act(() => xhrs[1].respond(200));
    await waitFor(() => expect(item(result).upload.status).toBe(UPLOAD_STATUS.UPLOADED));
    expect(api.count('POST /workspaces/w1/media/uploads')).toBe(2);
  });

  it('cancels a transfer: the item goes back to this browser and nothing completes', async () => {
    const api = mediaApi();
    const xhrs = installFakeXhr();
    const { result } = renderManager();
    await add(result, [jpeg()]);
    await waitFor(() => expect(xhrs).toHaveLength(1));
    act(() => xhrs[0].progress(1, 4));

    let cancelled;
    act(() => {
      cancelled = result.current.manager.cancelUpload(item(result).id);
    });

    expect(cancelled).toBe(true);
    expect(xhrs[0].aborted).toBe(true);
    expect(item(result).upload).toEqual({
      status: UPLOAD_STATUS.LOCAL,
      progress: 0,
      mediaId: null,
      error: null,
    });
    // A late storage answer for the aborted request changes nothing.
    act(() => xhrs[0].respond(200));
    await act(async () => {});
    expect(item(result).upload.status).toBe(UPLOAD_STATUS.LOCAL);
    expect(api.count('POST /workspaces/w1/media/m1/complete')).toBe(0);
    // Nothing left to cancel.
    expect(result.current.manager.cancelUpload(item(result).id)).toBe(false);
  });

  it('aborts the upload when the item is removed', async () => {
    const api = mediaApi();
    const xhrs = installFakeXhr();
    const { result } = renderManager();
    await add(result, [jpeg()]);
    await waitFor(() => expect(xhrs).toHaveLength(1));
    const { id, previewUrl } = item(result);

    act(() => result.current.manager.removeMedia(id));

    expect(xhrs[0].aborted).toBe(true);
    expect(result.current.state.media).toEqual([]);
    expect(urls.revoked).toEqual([previewUrl]);
    await act(async () => {});
    expect(api.count('POST /workspaces/w1/media/m1/complete')).toBe(0);
  });

  it('aborts uploads in flight on unmount', async () => {
    mediaApi();
    const xhrs = installFakeXhr();
    const { result, unmount } = renderManager();
    await add(result, [jpeg()]);
    await waitFor(() => expect(xhrs).toHaveLength(1));

    unmount();

    expect(xhrs[0].aborted).toBe(true);
  });
});

/* ------------------------------------------- wiring with the media components */

/** The media section as the composer page wires it (preview tracked by id, not index). */
function MediaSection() {
  const [state, dispatch] = useReducer(composerReducer, undefined, createInitialComposerState);
  const manager = useMediaManager({ media: state.media, dispatch, workspaceId: 'w1' });
  const [previewId, setPreviewId] = useState(null);
  const previewIndex = previewId ? state.media.findIndex((m) => m.id === previewId) : null;
  return (
    <>
      <MediaGrid
        media={state.media}
        uploadAvailable={manager.uploadAvailable}
        onRemove={manager.removeMedia}
        onMove={(id, to) => dispatch(composerActions.moveMedia(id, to))}
        onAltTextChange={(id, text) => dispatch(composerActions.setMediaAltText(id, text))}
        onPreview={setPreviewId}
        onRetryUpload={manager.retryUpload}
        onCancelUpload={manager.cancelUpload}
      />
      <MediaDropzone
        compact={state.media.length > 0}
        count={state.media.length}
        max={MEDIA_MAX_ITEMS}
        uploadAvailable={manager.uploadAvailable}
        onFiles={manager.addFiles}
        rejections={manager.rejections}
        onDismissRejection={manager.dismissRejection}
        onClearRejections={manager.clearRejections}
      />
      <MediaPreviewDialog
        media={state.media}
        index={previewIndex}
        onClose={() => setPreviewId(null)}
        onNavigate={(index) => setPreviewId(state.media[index]?.id ?? null)}
      />
      <button type="button" onClick={() => dispatch(composerActions.reset())}>
        Discard
      </button>
    </>
  );
}

describe('media section wiring (dropzone → useMediaManager → grid → preview)', () => {
  it('adds, previews, removes and discards files entirely in this browser', async () => {
    const person = userEvent.setup();
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    render(<MediaSection />);
    const beach = jpeg('beach.jpg');
    const waves = mp4('waves.mp4');

    fireEvent.drop(screen.getByRole('group', { name: 'Drag photos and videos here' }), {
      dataTransfer: dataTransferWith([beach, waves, makeFile('notes.pdf', 'application/pdf')]),
    });

    expect(await screen.findByText('1080×1350')).toBeInTheDocument();
    const tiles = within(screen.getByRole('list', { name: 'Attached media' })).getAllByRole(
      'listitem',
    );
    expect(tiles).toHaveLength(2);
    expect(within(tiles[0]).getByText('Cover')).toBeInTheDocument();
    expect(screen.getAllByText('In this browser')).toHaveLength(2);
    expect(screen.getByText(/notes\.pdf isn't a supported file/)).toBeInTheDocument();
    const bar = screen.getByRole('group', { name: 'Add more' });
    expect(within(bar).getByText(`2 of ${MEDIA_MAX_ITEMS} files`)).toBeInTheDocument();

    await person.click(screen.getByRole('button', { name: 'Preview waves.mp4' }));
    expect(screen.getByRole('dialog', { name: 'waves.mp4' })).toHaveAccessibleDescription('2 of 2');
    await person.keyboard('{ArrowLeft}');
    expect(screen.getByRole('dialog', { name: 'beach.jpg' })).toBeInTheDocument();
    await person.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();

    await person.click(screen.getByRole('button', { name: 'Remove beach.jpg' }));
    expect(urls.revoked).toEqual([urls.created[0]]);
    expect(screen.getByRole('button', { name: 'Preview waves.mp4' })).toHaveFocus();
    expect(screen.getByRole('status')).toHaveTextContent('Removed beach.jpg');

    await person.click(screen.getByRole('button', { name: 'Dismiss message about notes.pdf' }));
    expect(screen.queryByText(/notes\.pdf/)).toBeNull();

    await person.click(screen.getByRole('button', { name: 'Discard' }));
    expect(screen.queryByRole('list', { name: 'Attached media' })).toBeNull();
    expect(urls.revoked).toEqual([urls.created[0], urls.created[1]]);
    expect(screen.getByRole('group', { name: 'Drag photos and videos here' })).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
