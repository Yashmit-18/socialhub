import { ERROR_CODES } from '@socialhub/shared';
import { AppError } from '../lib/errors.js';
import { encodeKeyPath, presignUrl } from './sigv4.js';

/**
 * S3-compatible object storage (AWS S3, Cloudflare R2, MinIO, …).
 *
 * Browsers upload straight to the bucket with a short-lived presigned PUT that is bound to
 * one object key, one Content-Type and one Content-Length. The API's own calls (stat, read,
 * remove) use presigned URLs too, so credentials never leave this process and are never sent
 * to the browser. Objects are read by Meta and by browsers through `publicBaseUrl` (a public
 * bucket or CDN in front of it).
 *
 * An upload link can be reused until it expires, and S3 overwrites on PUT. Uploads therefore
 * go to a separate "upload" key; the media service copies the object to its final key before
 * verifying it (see modules/media/media.service.js), so a link can never touch a verified file.
 */

const unavailable = (message) => new AppError(502, ERROR_CODES.STORAGE_UNAVAILABLE, message);

export function createS3Storage({
  bucket,
  region,
  endpoint,
  accessKeyId,
  secretAccessKey,
  forcePathStyle,
  publicBaseUrl,
  fetchImpl = fetch,
  timeoutMs = 15_000,
}) {
  const base = endpoint ? new URL(endpoint) : new URL(`https://s3.${region}.amazonaws.com`);
  const pathStyle = forcePathStyle ?? Boolean(endpoint);
  const origin = pathStyle ? base.origin : `${base.protocol}//${bucket}.${base.host}`;
  const prefix = pathStyle ? `/${bucket}` : '';
  const objectUrl = (key) => `${origin}${prefix}/${encodeKeyPath(key)}`;

  const sign = (method, key, { headers, expiresInSeconds = 60, now } = {}) =>
    presignUrl({
      method,
      url: objectUrl(key),
      region,
      accessKeyId,
      secretAccessKey,
      expiresInSeconds,
      headers,
      now,
    });

  /** `signed`: headers that are part of the signature and are sent with the request. */
  async function call(method, key, { signed, ...init } = {}) {
    try {
      return await fetchImpl(sign(method, key, { headers: signed }), {
        method,
        ...init,
        headers: { ...signed, ...init.headers },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw unavailable('Media storage could not be reached. Try again in a moment.');
    }
  }

  return {
    name: 's3',
    publicUrls: true,
    /** Origin the browser uploads to (for the Content-Security-Policy connect-src). */
    uploadOrigin: origin,

    createUpload({ key, contentType, sizeBytes, expiresInSeconds, now = new Date() }) {
      const headers = { 'Content-Type': contentType };
      return {
        // content-length is signed, so storage rejects a body of any other size.
        url: sign('PUT', key, {
          headers: { ...headers, 'content-length': sizeBytes },
          expiresInSeconds,
          now,
        }),
        method: 'PUT',
        headers,
        expiresAt: new Date(now.getTime() + expiresInSeconds * 1000).toISOString(),
      };
    },

    /** `{ sizeBytes }`, or null when the object does not exist. */
    async stat(key) {
      const res = await call('HEAD', key);
      if (res.status === 404) return null;
      if (res.status === 403) {
        // S3 answers 403 instead of 404 for a missing object when the key may not list the
        // bucket, so "not uploaded yet" cannot be told apart from "not allowed".
        throw unavailable(
          'Media storage refused the request (403). The storage key needs s3:ListBucket on the bucket, as well as s3:GetObject, s3:PutObject and s3:DeleteObject on its objects.',
        );
      }
      if (!res.ok) throw unavailable(`Media storage answered ${res.status}.`);
      return { sizeBytes: Number(res.headers.get('content-length')) };
    },

    async read(key, start, length) {
      const res = await call('GET', key, {
        headers: { Range: `bytes=${start}-${start + length - 1}` },
      });
      if (res.status === 416) return Buffer.alloc(0);
      if (!res.ok) throw unavailable(`Media storage answered ${res.status}.`);
      return Buffer.from(await res.arrayBuffer()).subarray(0, length);
    },

    /**
     * Server-side copy inside the bucket. The destination key is never part of any upload
     * link, so what is copied there can only be changed by this API.
     */
    async copy(fromKey, toKey) {
      const res = await call('PUT', toKey, {
        signed: { 'x-amz-copy-source': `/${bucket}/${encodeKeyPath(fromKey)}` },
      });
      const body = await res.text().catch(() => '');
      if (res.status === 404) return false;
      // S3 can answer 200 and still report a failed copy in the body.
      if (!res.ok || /<Error>/i.test(body)) {
        throw unavailable(`Media storage could not copy the file (${res.status}).`);
      }
      return true;
    },

    /** The upload object is no longer needed once its content has been copied. */
    async retireUpload(key) {
      await this.remove(key);
    },

    async remove(key) {
      const res = await call('DELETE', key);
      if (!res.ok && res.status !== 404) throw unavailable(`Media storage answered ${res.status}.`);
    },

    publicUrl: (key) => `${publicBaseUrl.replace(/\/+$/, '')}/${encodeKeyPath(key)}`,
  };
}
