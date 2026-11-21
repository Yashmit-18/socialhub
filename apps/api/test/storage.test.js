import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config/env.js';
import { probeMedia } from '../src/storage/mediaProbe.js';
import { createS3Storage } from '../src/storage/s3Storage.js';
import { presignUrl } from '../src/storage/sigv4.js';
import { gifBytes, jpegBytes, mp4Bytes, pngBytes } from './mediaFixtures.js';

const reader = (bytes) => async (start, length) => bytes.subarray(start, start + length);
const probe = (bytes) => probeMedia(reader(bytes), bytes.length);

describe('SigV4 presigned URLs', () => {
  it('matches the worked example in the Amazon S3 documentation', () => {
    // "Authenticating Requests: Using Query Parameters (AWS Signature Version 4)" example.
    const url = presignUrl({
      method: 'GET',
      url: 'https://examplebucket.s3.amazonaws.com/test.txt',
      region: 'us-east-1',
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      expiresInSeconds: 86400,
      now: new Date('2013-05-24T00:00:00Z'),
    });
    expect(url).toContain(
      'X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404',
    );
    expect(url).toContain(
      'X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request',
    );
    expect(url).toContain('X-Amz-SignedHeaders=host');
  });
});

/**
 * SIMULATION: these tests drive the S3 driver against a fake `fetch`. They check the requests
 * it builds and how it reacts to answers; they do not prove a real bucket accepts them.
 */
describe('S3 storage driver (simulated provider)', () => {
  const make = (fetchImpl) =>
    createS3Storage({
      bucket: 'media',
      region: 'eu-west-1',
      endpoint: 'https://s3.storage.test',
      accessKeyId: 'KEY',
      secretAccessKey: 'SECRET',
      publicBaseUrl: 'https://cdn.example.com/',
      fetchImpl,
    });

  it('issues an upload bound to the key, type and size, without exposing the secret', () => {
    const storage = make(vi.fn());
    const upload = storage.createUpload({
      key: 'workspaces/w1/media/m1/abc.jpg',
      contentType: 'image/jpeg',
      sizeBytes: 1234,
      expiresInSeconds: 900,
      now: new Date('2026-11-21T10:00:00Z'),
    });
    expect(upload.method).toBe('PUT');
    expect(upload.headers).toEqual({ 'Content-Type': 'image/jpeg' });
    expect(upload.expiresAt).toBe('2026-11-21T10:15:00.000Z');
    const url = new URL(upload.url);
    expect(url.origin + url.pathname).toBe(
      'https://s3.storage.test/media/workspaces/w1/media/m1/abc.jpg',
    );
    expect(url.searchParams.get('X-Amz-Expires')).toBe('900');
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('content-length;content-type;host');
    expect(upload.url).not.toContain('SECRET');
    expect(storage.uploadOrigin).toBe('https://s3.storage.test');
  });

  it('uses virtual-hosted URLs on AWS and serves files from the public base URL', () => {
    const storage = createS3Storage({
      bucket: 'media',
      region: 'eu-west-1',
      accessKeyId: 'KEY',
      secretAccessKey: 'SECRET',
      publicBaseUrl: 'https://cdn.example.com',
      fetchImpl: vi.fn(),
    });
    expect(storage.uploadOrigin).toBe('https://media.s3.eu-west-1.amazonaws.com');
    expect(storage.publicUrl('a/b c.jpg')).toBe('https://cdn.example.com/a/b%20c.jpg');
  });

  it('reports a missing object as null and an existing one with its size', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(
        new Response(null, { status: 200, headers: { 'content-length': '77' } }),
      );
    const storage = make(fetchImpl);
    expect(await storage.stat('k')).toBeNull();
    expect(await storage.stat('k')).toEqual({ sizeBytes: 77 });
    expect(fetchImpl.mock.calls[0][1].method).toBe('HEAD');
  });

  it('reads a byte range and deletes objects', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(Buffer.from('abcdef'), { status: 206 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const storage = make(fetchImpl);
    expect((await storage.read('k', 10, 4)).toString()).toBe('abcd');
    expect(fetchImpl.mock.calls[0][1].headers.Range).toBe('bytes=10-13');
    await storage.remove('k');
    expect(fetchImpl.mock.calls[1][1].method).toBe('DELETE');
  });

  it('explains a 403 on a missing object: the key lacks permission to list the bucket', async () => {
    // Real S3 answers 403 (not 404) for a missing object without s3:ListBucket.
    const storage = make(vi.fn().mockResolvedValue(new Response(null, { status: 403 })));
    await expect(storage.stat('k')).rejects.toMatchObject({
      code: 'STORAGE_UNAVAILABLE',
      message: expect.stringContaining('s3:ListBucket'),
    });
  });

  it('turns provider errors and outages into STORAGE_UNAVAILABLE', async () => {
    const down = make(vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    await expect(down.stat('k')).rejects.toMatchObject({
      status: 502,
      code: 'STORAGE_UNAVAILABLE',
    });
    const broken = make(vi.fn().mockResolvedValue(new Response(null, { status: 500 })));
    await expect(broken.stat('k')).rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE' });
    await expect(broken.remove('k')).rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE' });
  });
});

describe('reading what a file really is', () => {
  it('recognises images and reads their dimensions', async () => {
    expect(await probe(pngBytes(800, 600))).toMatchObject({
      mimeType: 'image/png',
      width: 800,
      height: 600,
    });
    expect(await probe(jpegBytes(1080, 1350))).toMatchObject({
      mimeType: 'image/jpeg',
      width: 1080,
      height: 1350,
    });
    expect(await probe(gifBytes(320, 240))).toMatchObject({
      mimeType: 'image/gif',
      width: 320,
      height: 240,
    });
  });

  it('reads video size and duration even when the index follows the media data', async () => {
    const bytes = mp4Bytes({ width: 1080, height: 1920, durationSec: 12.5, padding: 200_000 });
    expect(await probe(bytes)).toEqual({
      mimeType: 'video/mp4',
      width: 1080,
      height: 1920,
      durationSec: 12.5,
    });
    expect((await probe(mp4Bytes({ brand: 'qt  ' }))).mimeType).toBe('video/quicktime');
  });

  it('does not recognise other content, whatever it is called', async () => {
    expect(
      (await probe(Buffer.from('<html><script>alert(1)</script></html>'))).mimeType,
    ).toBeNull();
    expect((await probe(Buffer.from('MZ' + 'x'.repeat(40)))).mimeType).toBeNull();
    expect((await probe(Buffer.alloc(4))).mimeType).toBeNull();
  });

  it('reports unknown dimensions for a truncated image instead of guessing', async () => {
    expect(await probe(jpegBytes().subarray(0, 14))).toMatchObject({
      mimeType: 'image/jpeg',
      width: null,
    });
  });
});

describe('storage configuration', () => {
  const base = {
    JWT_ACCESS_SECRET: 'x'.repeat(40),
    TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
  };

  it('leaves storage off unless a driver is chosen', () => {
    expect(loadConfig(base).storage.driver).toBeNull();
  });

  it('requires every S3 setting, including a public base URL', () => {
    expect(() => loadConfig({ ...base, STORAGE_DRIVER: 's3', STORAGE_S3_BUCKET: 'b' })).toThrow(
      /STORAGE_S3_ACCESS_KEY_ID, STORAGE_S3_SECRET_ACCESS_KEY, STORAGE_PUBLIC_BASE_URL/,
    );
  });

  it('requires an https public URL in production', () => {
    const s3 = {
      ...base,
      NODE_ENV: 'production',
      STORAGE_DRIVER: 's3',
      STORAGE_S3_BUCKET: 'b',
      STORAGE_S3_ACCESS_KEY_ID: 'k',
      STORAGE_S3_SECRET_ACCESS_KEY: 's',
    };
    expect(() => loadConfig({ ...s3, STORAGE_PUBLIC_BASE_URL: 'http://cdn.example.com' })).toThrow(
      /https/,
    );
    expect(
      loadConfig({ ...s3, STORAGE_PUBLIC_BASE_URL: 'https://cdn.example.com' }).storage.s3.bucket,
    ).toBe('b');
  });
});
