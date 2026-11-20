import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, setAccessToken } from '../../../lib/api.js';
import { apiError, jsonResponse, mockFetch } from '../../../test/fetchMock.js';
import { makeFile } from '../test/browserMocks.js';
import { CapabilityUnavailableError } from './capabilities.js';
import * as composerApi from './composerApi.js';
import {
  completeMediaUpload,
  createAccountPreset,
  createDraft,
  createMediaUpload,
  deleteAccountPreset,
  deleteDraft,
  deleteMedia,
  getDraft,
  getMedia,
  listAccountPresets,
  listDrafts,
  submitPost,
  updateDraft,
  uploadFileToStorage,
} from './composerApi.js';

const FLAG = {
  mediaUpload: 'VITE_COMPOSER_MEDIA_UPLOAD',
  serverDrafts: 'VITE_COMPOSER_SERVER_DRAFTS',
  serverPresets: 'VITE_COMPOSER_SERVER_PRESETS',
};

const UPLOAD_SLOT = {
  url: 'https://storage.example/bucket/med_1?X-Signature=abc',
  method: 'PUT',
  headers: { 'Content-Type': 'image/jpeg', 'x-amz-meta-workspace': 'w1' },
  expiresAt: '2026-11-20T12:00:00.000Z',
};

/** Every client function, called with representative arguments, and the capability it needs. */
const CALLS = [
  [
    'createMediaUpload',
    'mediaUpload',
    () =>
      createMediaUpload('w1', {
        fileName: 'a.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 10,
        kind: 'IMAGE',
      }),
  ],
  [
    'uploadFileToStorage',
    'mediaUpload',
    () => uploadFileToStorage(UPLOAD_SLOT, makeFile('a.jpg', 'image/jpeg')),
  ],
  ['completeMediaUpload', 'mediaUpload', () => completeMediaUpload('w1', 'med_1')],
  ['getMedia', 'mediaUpload', () => getMedia('w1', 'med_1')],
  ['deleteMedia', 'mediaUpload', () => deleteMedia('w1', 'med_1')],
  ['listDrafts', 'serverDrafts', () => listDrafts('w1')],
  ['getDraft', 'serverDrafts', () => getDraft('w1', 'cp_1')],
  ['createDraft', 'serverDrafts', () => createDraft('w1', { caption: 'x' })],
  ['updateDraft', 'serverDrafts', () => updateDraft('w1', 'cp_1', { caption: 'x' }, 2)],
  ['deleteDraft', 'serverDrafts', () => deleteDraft('w1', 'cp_1')],
  ['listAccountPresets', 'serverPresets', () => listAccountPresets('w1')],
  [
    'createAccountPreset',
    'serverPresets',
    () => createAccountPreset('w1', { name: 'Stores', socialAccountIds: ['acc-1'] }),
  ],
  ['deleteAccountPreset', 'serverPresets', () => deleteAccountPreset('w1', 'p_1')],
  [
    'submitPost',
    'publishing',
    () => submitPost('w1', { contentPackageId: 'cp_1', destinations: [{ socialAccountId: 'a' }] }),
  ],
];

/** Runs `fn` so that a synchronous throw and a rejected promise both become a rejection. */
const attempt = (fn) => Promise.resolve().then(fn);

/** Stand-in for XMLHttpRequest that records the request and lets the test drive its events. */
function installFakeXhr() {
  const requests = [];
  class FakeXhr {
    constructor() {
      this.upload = {};
      this.requestHeaders = {};
      this.status = 0;
      this.withCredentials = false;
      this.aborted = false;
      requests.push(this);
    }

    open(method, url) {
      this.method = method;
      this.url = url;
    }

    setRequestHeader(name, value) {
      this.requestHeaders[name] = value;
    }

    send(body) {
      this.body = body;
    }

    abort() {
      this.aborted = true;
      this.onabort?.();
    }

    progress(loaded, total, lengthComputable = true) {
      this.upload.onprogress?.({ loaded, total, lengthComputable });
    }

    respond(status) {
      this.status = status;
      this.onload?.();
    }

    failNetwork() {
      this.onerror?.();
    }
  }
  vi.stubGlobal('XMLHttpRequest', FakeXhr);
  return requests;
}

/** The last request seen by the fetch mock, decoded. */
function lastRequest(mock) {
  const call = mock.calls.at(-1);
  return {
    key: call.key,
    query: Object.fromEntries(call.url.searchParams),
    body: call.init.body === undefined ? undefined : JSON.parse(call.init.body),
    headers: call.headers,
    signal: call.init.signal,
  };
}

afterEach(() => {
  setAccessToken(null);
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it('covers every exported client function in these tests', () => {
  expect(CALLS.map(([name]) => name).sort()).toEqual(Object.keys(composerApi).sort());
});

describe('while the backend capabilities are off', () => {
  it.each(CALLS)(
    '%s throws CapabilityUnavailableError without any request',
    async (_name, capability, call) => {
      const fetchSpy = vi.fn();
      vi.stubGlobal('fetch', fetchSpy);
      const xhrs = installFakeXhr();

      const error = await attempt(call).catch((err) => err);
      expect(error).toBeInstanceOf(CapabilityUnavailableError);
      expect(error).toMatchObject({ code: 'CAPABILITY_UNAVAILABLE', capability });
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(xhrs).toHaveLength(0);
    },
  );

  it.each(Object.entries(FLAG))(
    'turning on %s unlocks only its own endpoints',
    async (enabled, flag) => {
      vi.stubEnv(flag, 'true');
      const fetchSpy = vi.fn();
      vi.stubGlobal('fetch', fetchSpy);
      const xhrs = installFakeXhr();

      for (const [, capability, call] of CALLS.filter(([, cap]) => cap !== enabled)) {
        await expect(attempt(call)).rejects.toMatchObject({ capability });
      }
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(xhrs).toHaveLength(0);
    },
  );

  it('never submits posts, even with every flag on', async () => {
    for (const flag of [...Object.values(FLAG), 'VITE_COMPOSER_PUBLISHING']) {
      vi.stubEnv(flag, 'true');
    }
    const mock = mockFetch({ 'POST /workspaces/w1/posts': () => jsonResponse(202, { post: {} }) });
    setAccessToken('access-token');

    await expect(
      attempt(() => submitPost('w1', { contentPackageId: 'cp_1' })),
    ).rejects.toBeInstanceOf(CapabilityUnavailableError);
    expect(mock.fn).not.toHaveBeenCalled();
  });
});

describe('with the backend capabilities on', () => {
  beforeEach(() => {
    for (const flag of Object.values(FLAG)) vi.stubEnv(flag, 'true');
    setAccessToken('access-token');
  });

  describe('media (§3)', () => {
    it('asks for an upload slot with exactly the file description', async () => {
      const slot = { media: { id: 'med_1', status: 'PENDING_UPLOAD' }, upload: UPLOAD_SLOT };
      const mock = mockFetch({
        'POST /workspaces/w1/media/uploads': () => jsonResponse(201, slot),
      });

      await expect(
        createMediaUpload('w1', {
          fileName: 'beach.jpg',
          mimeType: 'image/jpeg',
          sizeBytes: 2048,
          kind: 'IMAGE',
          previewUrl: 'blob:mock/1',
          id: 'media_local',
        }),
      ).resolves.toEqual(slot);
      const request = lastRequest(mock);
      expect(request.key).toBe('POST /workspaces/w1/media/uploads');
      expect(request.body).toEqual({
        fileName: 'beach.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 2048,
        kind: 'IMAGE',
      });
      expect(request.headers.Authorization).toBe('Bearer access-token');
      expect(request.headers['Content-Type']).toBe('application/json');
    });

    it('completes an upload without a request body', async () => {
      const asset = { media: { id: 'med_1', status: 'PROCESSING' } };
      const mock = mockFetch({
        'POST /workspaces/w1/media/med_1/complete': () => jsonResponse(200, asset),
      });
      await expect(completeMediaUpload('w1', 'med_1')).resolves.toEqual(asset);
      const request = lastRequest(mock);
      expect(request.key).toBe('POST /workspaces/w1/media/med_1/complete');
      expect(request.body).toBeUndefined();
      expect(request.headers['Content-Type']).toBeUndefined();
    });

    it('reads and deletes a media asset', async () => {
      const asset = { media: { id: 'med_1', status: 'READY', url: 'https://cdn.example/1.jpg' } };
      const controller = new AbortController();
      const mock = mockFetch({
        'GET /workspaces/w1/media/med_1': () => jsonResponse(200, asset),
        'DELETE /workspaces/w1/media/med_1': () => jsonResponse(204),
      });

      await expect(getMedia('w1', 'med_1', { signal: controller.signal })).resolves.toEqual(asset);
      expect(lastRequest(mock).signal).toBe(controller.signal);

      await expect(deleteMedia('w1', 'med_1')).resolves.toBeNull();
      expect(lastRequest(mock).key).toBe('DELETE /workspaces/w1/media/med_1');
    });

    it('encodes workspace and resource ids in the path', async () => {
      const mock = mockFetch({
        'GET /workspaces/w%201%2Fx/media/med%2F1%3Fq': () => jsonResponse(200, { media: {} }),
      });
      await getMedia('w 1/x', 'med/1?q');
      expect(lastRequest(mock).key).toBe('GET /workspaces/w%201%2Fx/media/med%2F1%3Fq');
    });

    it('passes server errors on as ApiError', async () => {
      mockFetch({
        'POST /workspaces/w1/media/uploads': () =>
          apiError(413, 'PAYLOAD_TOO_LARGE', 'Videos can be at most 1 GB.'),
      });
      const error = await createMediaUpload('w1', {
        fileName: 'huge.mp4',
        mimeType: 'video/mp4',
        sizeBytes: 2e9,
        kind: 'VIDEO',
      }).catch((err) => err);
      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({
        status: 413,
        code: 'PAYLOAD_TOO_LARGE',
        message: 'Videos can be at most 1 GB.',
      });
    });
  });

  describe('drafts (§4)', () => {
    const input = {
      caption: 'Summer sale!',
      platformCaptions: {},
      hashtags: ['summer'],
      hashtagPlacement: 'CAPTION',
      keywords: ['summer sale'],
      firstComment: '',
      media: [{ mediaId: 'med_1', altText: 'Beach' }],
      targetAccountIds: ['acc-fb-1'],
    };
    const saved = { contentPackage: { id: 'cp_1', status: 'DRAFT', version: 3, ...input } };

    it('lists drafts with the default page size and no cursor', async () => {
      const page = { items: [], nextCursor: null };
      const mock = mockFetch({
        'GET /workspaces/w1/content-packages': () => jsonResponse(200, page),
      });
      await expect(listDrafts('w1')).resolves.toEqual(page);
      expect(lastRequest(mock).query).toEqual({ status: 'DRAFT', limit: '20' });
    });

    it('lists the next page with a cursor, a page size and an abort signal', async () => {
      const controller = new AbortController();
      const mock = mockFetch({
        'GET /workspaces/w1/content-packages': () =>
          jsonResponse(200, { items: [], nextCursor: null }),
      });
      await listDrafts('w1', { cursor: 'next-abc', limit: 5, signal: controller.signal });
      const request = lastRequest(mock);
      expect(request.query).toEqual({ status: 'DRAFT', cursor: 'next-abc', limit: '5' });
      expect(request.signal).toBe(controller.signal);
    });

    it('opens one draft', async () => {
      const mock = mockFetch({
        'GET /workspaces/w1/content-packages/cp_1': () => jsonResponse(200, saved),
      });
      await expect(getDraft('w1', 'cp_1')).resolves.toEqual(saved);
      expect(lastRequest(mock).key).toBe('GET /workspaces/w1/content-packages/cp_1');
    });

    it('creates a draft with the ContentPackageInput as the body', async () => {
      const mock = mockFetch({
        'POST /workspaces/w1/content-packages': () => jsonResponse(201, saved),
      });
      await expect(createDraft('w1', input)).resolves.toEqual(saved);
      expect(lastRequest(mock).body).toEqual(input);
    });

    it('updates a draft with the version it was based on', async () => {
      const mock = mockFetch({
        'PATCH /workspaces/w1/content-packages/cp_1': () => jsonResponse(200, saved),
      });
      await expect(updateDraft('w1', 'cp_1', input, 2)).resolves.toEqual(saved);
      expect(lastRequest(mock).body).toEqual({ ...input, version: 2 });
    });

    it('passes a stale-version conflict on to the caller', async () => {
      mockFetch({
        'PATCH /workspaces/w1/content-packages/cp_1': () =>
          apiError(409, 'CONFLICT', 'This draft was changed by someone else.'),
      });
      const error = await updateDraft('w1', 'cp_1', input, 1).catch((err) => err);
      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({ status: 409, code: 'CONFLICT' });
    });

    it('deletes a draft', async () => {
      const mock = mockFetch({
        'DELETE /workspaces/w1/content-packages/cp_1': () => jsonResponse(204),
      });
      await expect(deleteDraft('w1', 'cp_1')).resolves.toBeNull();
      expect(lastRequest(mock).key).toBe('DELETE /workspaces/w1/content-packages/cp_1');
    });
  });

  describe('account presets (§5)', () => {
    it('lists presets', async () => {
      const list = { items: [{ id: 'p_1', name: 'Stores', socialAccountIds: ['acc-1'] }] };
      const mock = mockFetch({
        'GET /workspaces/w1/account-presets': () => jsonResponse(200, list),
      });
      await expect(listAccountPresets('w1')).resolves.toEqual(list);
      expect(lastRequest(mock).key).toBe('GET /workspaces/w1/account-presets');
    });

    it('creates a preset with only its name and account ids', async () => {
      const preset = { preset: { id: 'p_1', name: 'Stores', socialAccountIds: ['acc-1'] } };
      const mock = mockFetch({
        'POST /workspaces/w1/account-presets': () => jsonResponse(201, preset),
      });
      await expect(
        createAccountPreset('w1', {
          name: 'Stores',
          socialAccountIds: ['acc-1'],
          id: 'preset_local',
          createdAt: '2026-11-20T10:00:00.000Z',
        }),
      ).resolves.toEqual(preset);
      expect(lastRequest(mock).body).toEqual({ name: 'Stores', socialAccountIds: ['acc-1'] });
    });

    it('deletes a preset', async () => {
      const mock = mockFetch({
        'DELETE /workspaces/w1/account-presets/p%201': () => jsonResponse(204),
      });
      await expect(deleteAccountPreset('w1', 'p 1')).resolves.toBeNull();
      expect(lastRequest(mock).key).toBe('DELETE /workspaces/w1/account-presets/p%201');
    });
  });
});

describe('uploadFileToStorage (pre-signed storage upload)', () => {
  beforeEach(() => {
    vi.stubEnv(FLAG.mediaUpload, 'true');
    // A SocialHub session exists; its token must never be sent to object storage.
    setAccessToken('access-token');
  });

  it('sends the file with the pre-signed method, URL and headers, and resolves on 2xx', async () => {
    const xhrs = installFakeXhr();
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const file = makeFile('beach.jpg', 'image/jpeg', 4096);

    const upload = uploadFileToStorage(UPLOAD_SLOT, file);
    const [xhr] = xhrs;
    expect(xhr).toMatchObject({ method: 'PUT', url: UPLOAD_SLOT.url, body: file });
    expect(xhr.requestHeaders).toEqual(UPLOAD_SLOT.headers);
    xhr.respond(200);
    await expect(upload).resolves.toBeUndefined();

    expect(xhr.requestHeaders).not.toHaveProperty('Authorization');
    expect(xhr.withCredentials).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('defaults to PUT and copes with a slot that has no headers', async () => {
    const xhrs = installFakeXhr();
    const upload = uploadFileToStorage(
      { url: 'https://storage.example/x' },
      makeFile('a.jpg', 'image/jpeg'),
    );
    expect(xhrs[0].method).toBe('PUT');
    expect(xhrs[0].url).toBe('https://storage.example/x');
    expect(xhrs[0].requestHeaders).toEqual({});
    xhrs[0].respond(204);
    await expect(upload).resolves.toBeUndefined();
  });

  it('uses the method the slot asks for', async () => {
    const xhrs = installFakeXhr();
    const upload = uploadFileToStorage(
      { ...UPLOAD_SLOT, method: 'POST' },
      makeFile('a.jpg', 'image/jpeg'),
    );
    expect(xhrs[0].method).toBe('POST');
    xhrs[0].respond(201);
    await upload;
  });

  it('reports progress as a fraction, only when the size is known', async () => {
    const xhrs = installFakeXhr();
    const onProgress = vi.fn();
    const upload = uploadFileToStorage(UPLOAD_SLOT, makeFile('a.jpg', 'image/jpeg'), {
      onProgress,
    });
    const [xhr] = xhrs;

    xhr.progress(25, 100);
    xhr.progress(50, 0);
    xhr.progress(60, 100, false);
    xhr.progress(100, 100);
    xhr.respond(200);
    await upload;

    expect(onProgress.mock.calls).toEqual([[0.25], [1]]);
  });

  it('does not need a progress callback', async () => {
    const xhrs = installFakeXhr();
    const upload = uploadFileToStorage(UPLOAD_SLOT, makeFile('a.jpg', 'image/jpeg'));
    expect(() => xhrs[0].progress(10, 100)).not.toThrow();
    xhrs[0].respond(200);
    await expect(upload).resolves.toBeUndefined();
  });

  it.each([403, 500])('rejects with UPLOAD_FAILED when storage answers %d', async (status) => {
    const xhrs = installFakeXhr();
    const upload = uploadFileToStorage(UPLOAD_SLOT, makeFile('a.jpg', 'image/jpeg'));
    xhrs[0].respond(status);
    const error = await upload.catch((err) => err);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status,
      code: 'UPLOAD_FAILED',
      message: `The file could not be uploaded (storage answered ${status}).`,
    });
  });

  it('rejects with NETWORK_ERROR when the connection drops', async () => {
    const xhrs = installFakeXhr();
    const upload = uploadFileToStorage(UPLOAD_SLOT, makeFile('a.jpg', 'image/jpeg'));
    xhrs[0].failNetwork();
    const error = await upload.catch((err) => err);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 0, code: 'NETWORK_ERROR' });
  });

  it('aborts the request when the signal is aborted', async () => {
    const xhrs = installFakeXhr();
    const controller = new AbortController();
    const upload = uploadFileToStorage(UPLOAD_SLOT, makeFile('a.jpg', 'image/jpeg'), {
      signal: controller.signal,
    });
    controller.abort();
    expect(xhrs[0].aborted).toBe(true);
    await expect(upload).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('rejects at once, without a request, when the signal is already aborted', async () => {
    const xhrs = installFakeXhr();
    const controller = new AbortController();
    controller.abort();
    await expect(
      uploadFileToStorage(UPLOAD_SLOT, makeFile('a.jpg', 'image/jpeg'), {
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(xhrs).toHaveLength(0);
  });

  it.each([
    ['success', (xhr) => xhr.respond(200)],
    ['a storage error', (xhr) => xhr.respond(500)],
    ['a network error', (xhr) => xhr.failNetwork()],
  ])('stops listening to the signal after %s', async (_label, finish) => {
    const xhrs = installFakeXhr();
    const controller = new AbortController();
    const upload = uploadFileToStorage(UPLOAD_SLOT, makeFile('a.jpg', 'image/jpeg'), {
      signal: controller.signal,
    });
    finish(xhrs[0]);
    await upload.catch(() => {});
    controller.abort();
    expect(xhrs[0].aborted).toBe(false);
  });
});
