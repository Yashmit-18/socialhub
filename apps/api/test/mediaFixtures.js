import { AppError } from '../src/lib/errors.js';
import { presignUrl } from '../src/storage/sigv4.js';
import { getStorage } from '../src/storage/index.js';
import { api, as } from './helpers.js';

/**
 * Test fixtures for media: the smallest byte sequences that are genuinely a PNG, JPEG, GIF
 * and MP4/MOV (enough structure for type sniffing and dimension parsing), plus an in-memory
 * storage driver.
 *
 * NOTE: `createMemoryStorage` is a SIMULATION of a storage provider, used to test how the API
 * reacts to provider behaviour (missing objects, wrong sizes, outages). It proves nothing
 * about a real S3 bucket. The local-disk driver used by most tests is the real development
 * driver, exercised end to end over HTTP.
 */

const u32 = (n) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
};
const u16 = (n) => {
  const b = Buffer.alloc(2);
  b.writeUInt16BE(n);
  return b;
};

export function pngBytes(width = 1080, height = 1350) {
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    u32(13),
    Buffer.from('IHDR'),
    u32(width),
    u32(height),
    Buffer.from([8, 6, 0, 0, 0, 0, 0, 0, 0]),
  ]);
}

export function jpegBytes(width = 1080, height = 1350) {
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    Buffer.from([0xff, 0xe0]),
    u16(16),
    Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0', 'latin1'),
    Buffer.from([0xff, 0xc0]),
    u16(17),
    Buffer.from([8]),
    u16(height),
    u16(width),
    Buffer.from([3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]),
    Buffer.from([0xff, 0xd9]),
  ]);
}

export function gifBytes(width = 320, height = 240) {
  const b = Buffer.alloc(14);
  b.write('GIF89a', 'latin1');
  b.writeUInt16LE(width, 6);
  b.writeUInt16LE(height, 8);
  return b;
}

const box = (type, ...parts) => {
  const payload = Buffer.concat(parts);
  return Buffer.concat([u32(payload.length + 8), Buffer.from(type, 'latin1'), payload]);
};

/** An ISO media file: ftyp, optional media data, then moov (after the data, like many phones). */
export function mp4Bytes({
  width = 1080,
  height = 1920,
  durationSec = 12.5,
  brand = 'isom',
  padding = 0,
} = {}) {
  const timescale = 1000;
  const mvhd = Buffer.alloc(100);
  mvhd.writeUInt32BE(timescale, 12);
  mvhd.writeUInt32BE(Math.round(durationSec * timescale), 16);
  const tkhd = (w, h) => {
    const b = Buffer.alloc(84);
    b.writeUInt32BE(w * 65536, 76);
    b.writeUInt32BE(h * 65536, 80);
    return b;
  };
  return Buffer.concat([
    box('ftyp', Buffer.from(brand, 'latin1'), u32(0), Buffer.from('isommp42', 'latin1')),
    box('mdat', Buffer.alloc(padding)),
    box(
      'moov',
      box('mvhd', mvhd),
      box('trak', box('tkhd', tkhd(0, 0))), // audio track
      box('trak', box('tkhd', tkhd(width, height))),
    ),
  ]);
}

/** SIMULATED storage provider (see the note at the top of this file). */
export function createMemoryStorage({ name = 'memory' } = {}) {
  const objects = new Map();
  const state = { failing: false, removed: [] };
  const guard = () => {
    if (state.failing) {
      // The same error the S3 driver raises when the provider is unreachable.
      throw new AppError(
        502,
        'STORAGE_UNAVAILABLE',
        'Media storage could not be reached. Try again in a moment.',
      );
    }
  };
  return {
    name,
    publicUrls: true,
    uploadOrigin: 'https://uploads.storage.test',
    objects,
    state,
    createUpload({ key, contentType, expiresInSeconds, now = new Date() }) {
      guard();
      return {
        url: `https://uploads.storage.test/${key}?signature=test`,
        method: 'PUT',
        headers: { 'Content-Type': contentType },
        expiresAt: new Date(now.getTime() + expiresInSeconds * 1000).toISOString(),
      };
    },
    async stat(key) {
      guard();
      return objects.has(key) ? { sizeBytes: objects.get(key).length } : null;
    },
    async read(key, start, length) {
      guard();
      return objects.get(key).subarray(start, start + length);
    },
    async copy(fromKey, toKey) {
      guard();
      if (!objects.has(fromKey)) return false;
      objects.set(toKey, Buffer.from(objects.get(fromKey)));
      return true;
    },
    async retireUpload(key) {
      guard();
      objects.delete(key);
    },
    async remove(key) {
      guard();
      state.removed.push(key);
      objects.delete(key);
    },
    publicUrl: (key) => `https://cdn.storage.test/${key}`,
  };
}

/**
 * SIMULATED S3 provider: a `fetch` that behaves like an S3-compatible bucket for the calls
 * the real driver (src/storage/s3Storage.js) makes. It is stricter than a plain map:
 *  - every request must carry a valid SigV4 query signature for its method, path and signed
 *    headers (recomputed here with the secret), so a tampered or re-targeted link is refused;
 *  - links stop working after X-Amz-Expires;
 *  - PUT overwrites an existing object, exactly like S3 does.
 * It shows how the API behaves against S3 semantics. It is NOT evidence about a real bucket.
 */
export function createFakeS3({
  bucket = 'media',
  region = 'eu-west-1',
  accessKeyId = 'TESTKEY',
  secretAccessKey = 'TESTSECRET',
  endpoint = 'https://s3.storage.test',
} = {}) {
  const objects = new Map();
  const log = [];
  const state = { now: null, failing: false, beforeRequest: null };
  const xml = (status, code) => new Response(`<Error><Code>${code}</Code></Error>`, { status });

  async function fetchImpl(input, init = {}) {
    const url = new URL(String(input));
    const method = (init.method ?? 'GET').toUpperCase();
    const headers = Object.fromEntries(
      Object.entries(init.headers ?? {}).map(([k, v]) => [k.toLowerCase(), String(v)]),
    );
    const body = init.body === undefined || init.body === null ? null : Buffer.from(init.body);
    if (body && headers['content-length'] === undefined) {
      headers['content-length'] = String(body.length); // what a browser or fetch adds
    }
    const key = decodeURIComponent(url.pathname.replace(`/${bucket}/`, ''));
    log.push({ method, key });
    if (state.failing) throw new Error('ECONNRESET');
    await state.beforeRequest?.({ method, key });

    // --- authentication, as S3 does it for presigned URLs ---
    const q = url.searchParams;
    const stamp = q.get('X-Amz-Date') ?? '';
    const signedAt = new Date(
      `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T${stamp.slice(9, 11)}:${stamp.slice(11, 13)}:${stamp.slice(13, 15)}Z`,
    );
    const now = state.now ?? new Date();
    if (now.getTime() > signedAt.getTime() + Number(q.get('X-Amz-Expires')) * 1000) {
      return xml(403, 'AccessDenied'); // "Request has expired"
    }
    const signedNames = (q.get('X-Amz-SignedHeaders') ?? '').split(';').filter((n) => n !== 'host');
    const signedHeaders = {};
    for (const name of signedNames) {
      if (headers[name] === undefined) return xml(403, 'AccessDenied'); // a signed header is missing
      signedHeaders[name] = headers[name];
    }
    const expected = presignUrl({
      method,
      url: `${url.origin}${url.pathname}`,
      region,
      accessKeyId,
      secretAccessKey,
      expiresInSeconds: Number(q.get('X-Amz-Expires')),
      headers: signedHeaders,
      now: signedAt,
    });
    if (new URL(expected).searchParams.get('X-Amz-Signature') !== q.get('X-Amz-Signature')) {
      return xml(403, 'SignatureDoesNotMatch');
    }

    // --- object operations ---
    if (method === 'PUT' && headers['x-amz-copy-source']) {
      const source = decodeURIComponent(headers['x-amz-copy-source'].replace(`/${bucket}/`, ''));
      if (!objects.has(source)) return xml(404, 'NoSuchKey');
      objects.set(key, {
        bytes: Buffer.from(objects.get(source).bytes),
        type: objects.get(source).type,
      });
      return new Response('<CopyObjectResult/>', { status: 200 });
    }
    if (method === 'PUT') {
      objects.set(key, { bytes: body ?? Buffer.alloc(0), type: headers['content-type'] });
      return new Response(null, { status: 200 });
    }
    const object = objects.get(key);
    if (method === 'DELETE') {
      objects.delete(key);
      return new Response(null, { status: 204 });
    }
    if (!object) return xml(404, 'NoSuchKey');
    if (method === 'HEAD') {
      return new Response(null, {
        status: 200,
        headers: { 'content-length': String(object.bytes.length) },
      });
    }
    const range = /bytes=(\d+)-(\d+)/.exec(headers.range ?? '');
    const bytes = range
      ? object.bytes.subarray(Number(range[1]), Number(range[2]) + 1)
      : object.bytes;
    return new Response(bytes, { status: range ? 206 : 200 });
  }

  const settings = { bucket, region, endpoint, accessKeyId, secretAccessKey };
  return {
    fetch: fetchImpl,
    objects,
    log,
    state,
    settings,
    /** The object's bytes, or null. */
    bytesAt: (key) => objects.get(key)?.bytes ?? null,
    /** What a browser does with an upload link: PUT the bytes with the given headers. */
    browserPut: (upload, bytes, headers = upload.headers) =>
      fetchImpl(upload.url, { method: 'PUT', headers, body: bytes }),
  };
}

export const mediaUrl = (workspaceId, suffix = '') =>
  `/api/v1/workspaces/${workspaceId}/media${suffix}`;

/** Asks for an upload slot. Returns the supertest response. */
export function requestSlot(token, workspaceId, body) {
  return as(token).post(mediaUrl(workspaceId, '/uploads')).send(body);
}

/** PUTs bytes to a slot issued by the local-disk driver (a same-origin path). */
export function putToSlot(upload, bytes, headers = upload.headers) {
  const path = new URL(upload.url, 'http://socialhub.test').pathname;
  let req = api().put(path);
  for (const [name, value] of Object.entries(headers)) req = req.set(name, value);
  return req.send(bytes);
}

/** Full flow through the real local driver: slot → PUT → complete. Returns the READY asset. */
export async function uploadMedia(
  token,
  workspaceId,
  { bytes = jpegBytes(), fileName = 'photo.jpg', mimeType = 'image/jpeg', kind = 'IMAGE' } = {},
) {
  const slot = await requestSlot(token, workspaceId, {
    fileName,
    mimeType,
    kind,
    sizeBytes: bytes.length,
  });
  if (slot.status !== 201)
    throw new Error(`slot failed: ${slot.status} ${JSON.stringify(slot.body)}`);
  const put = await putToSlot(slot.body.upload, bytes);
  if (put.status !== 200) throw new Error(`put failed: ${put.status} ${JSON.stringify(put.body)}`);
  const done = await as(token).post(mediaUrl(workspaceId, `/${slot.body.media.id}/complete`));
  if (done.status !== 200) throw new Error(`complete failed: ${done.status}`);
  return done.body.media;
}

export const activeStorage = () => getStorage();
