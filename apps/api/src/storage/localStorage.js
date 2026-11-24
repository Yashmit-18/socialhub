import { createHmac } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { copyFile, mkdir, open, rename, rm, stat as fsStat, truncate } from 'node:fs/promises';
import path from 'node:path';
import { Router } from 'express';
import { ERROR_CODES } from '@socialhub/shared';
import { AppError, notFound } from '../lib/errors.js';
import { randomToken, safeEqual } from '../lib/crypto.js';

/**
 * Local-disk storage for development and tests: files live under one directory and are
 * uploaded to, and served by, this API.
 *
 * Links for the BROWSER (upload links, viewUrl) are same-origin paths such as
 * `/api/v1/storage/uploads/…`, so they work however SocialHub was opened: localhost, a tunnel
 * or a domain. An absolute link on API_PUBLIC_URL would be blocked by the page's
 * Content-Security-Policy (connect-src 'self') whenever the page is on another host, which
 * the browser only reports as a failed request. Links for Meta (publicUrl) are absolute, on
 * API_PUBLIC_URL, because Meta downloads the files itself.
 *
 * Stored files are never public by name: every download link is signed for one file and
 * expires (`?expires=…&signature=…`). A wrong, missing or tampered signature is answered like
 * an unknown file (404); an expired one with 403.
 *
 * It follows the same direct-upload flow as S3: the browser PUTs the bytes to a short-lived
 * signed URL that is bound to one key, type and size. It is NOT meant for production:
 * its URLs are only as public as this API is, so Meta can fetch them only when the API itself
 * is reachable from the internet over HTTPS (for example through a tunnel). `publicUrls` says
 * whether API_PUBLIC_URL looks like that (isPublicHttpsUrl); it cannot prove the address is
 * actually reachable, and Meta reports a failed download as an error on the post.
 */

const KEY_PATTERN = /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_.-]+)*$/;
const TYPES = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
};

const storageError = (status, code, message) => new AppError(status, code, message);

/** Default lifetime of a download link when the caller does not choose one. */
export const DOWNLOAD_LINK_TTL_SECONDS = 60 * 60;

/**
 * Whether files served under `baseUrl` can be downloaded by Meta: HTTPS on a host that is not
 * this machine or a private network (for example a tunnel or a real domain pointing at this
 * API). Meta fetches media itself, so `http://localhost:4000` can never work.
 */
export function isPublicHttpsUrl(baseUrl) {
  let url;
  try {
    url = new URL(baseUrl);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    host === 'localhost' ||
    /\.(localhost|local|internal|lan|home\.arpa)$/.test(host) ||
    host === '0.0.0.0' ||
    host === '::1' ||
    /^(fc|fd|fe80)[0-9a-f]*:/.test(host)
  ) {
    return false;
  }
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    if (a === 10 || a === 127 || (a === 169 && b === 254) || (a === 192 && b === 168)) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
  }
  return true;
}

export function createLocalStorage({ directory, baseUrl, secret }) {
  const root = path.resolve(directory);
  const sign = (payload) => createHmac('sha256', secret).update(payload).digest('base64url');
  // The path part of the API's address (normally "/api/v1"): links for the browser use only
  // this, so they stay on whatever host the page was loaded from.
  const basePath = new URL(baseUrl).pathname.replace(/\/+$/, '');
  const downloadSignature = (key, expires) => sign(`download:${key}:${expires}`);
  function downloadPath(
    key,
    { expiresInSeconds = DOWNLOAD_LINK_TTL_SECONDS, now = Date.now() } = {},
  ) {
    const expires = Math.floor(Number(now) / 1000) + expiresInSeconds;
    return `/storage/objects/${key}?expires=${expires}&signature=${downloadSignature(key, expires)}`;
  }

  function filePath(key) {
    if (!KEY_PATTERN.test(key) || key.includes('..')) throw notFound('File not found');
    const resolved = path.resolve(root, ...key.split('/'));
    if (!resolved.startsWith(root + path.sep)) throw notFound('File not found');
    return resolved;
  }

  function readToken(token) {
    const [payload, signature] = String(token).split('.');
    if (!payload || !signature || !safeEqual(sign(payload), signature)) return null;
    try {
      return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    } catch {
      return null;
    }
  }

  const storage = {
    name: 'local',
    // Reachable by Meta only when this API itself is public over HTTPS (API_PUBLIC_URL).
    publicUrls: isPublicHttpsUrl(baseUrl),
    uploadOrigin: null,

    createUpload({ key, contentType, sizeBytes, expiresInSeconds, now = new Date() }) {
      const expires = now.getTime() + expiresInSeconds * 1000;
      const payload = Buffer.from(
        JSON.stringify({ k: key, t: contentType, s: sizeBytes, e: expires }),
      ).toString('base64url');
      return {
        // Same-origin path: see the note at the top of this file.
        url: `${basePath}/storage/uploads/${payload}.${sign(payload)}`,
        method: 'PUT',
        headers: { 'Content-Type': contentType },
        expiresAt: new Date(expires).toISOString(),
      };
    },

    async stat(key) {
      try {
        const info = await fsStat(filePath(key));
        return info.isFile() ? { sizeBytes: info.size } : null;
      } catch (err) {
        if (err?.code === 'ENOENT') return null;
        throw err;
      }
    },

    async read(key, start, length) {
      const handle = await open(filePath(key), 'r');
      try {
        const buffer = Buffer.alloc(length);
        const { bytesRead } = await handle.read(buffer, 0, length, start);
        return buffer.subarray(0, bytesRead);
      } finally {
        await handle.close();
      }
    },

    /** Copies a file to a key that no upload link was issued for. False if it is missing. */
    async copy(fromKey, toKey) {
      const target = filePath(toKey);
      await mkdir(path.dirname(target), { recursive: true });
      try {
        await copyFile(filePath(fromKey), target);
        return true;
      } catch (err) {
        if (err?.code === 'ENOENT') return false;
        throw err;
      }
    },

    /**
     * Empties the upload file but keeps it, so its link stays "already used" (409) until the
     * clean-up removes it after the link has expired.
     */
    async retireUpload(key) {
      await truncate(filePath(key), 0).catch((err) => {
        if (err?.code !== 'ENOENT') throw err;
      });
    },

    async remove(key) {
      await rm(filePath(key), { force: true });
    },

    /** Signed, expiring download link on API_PUBLIC_URL, for Meta to fetch. */
    publicUrl: (key, options) => `${baseUrl}${downloadPath(key, options)}`,
    /** Signed, expiring same-origin link, for showing the file in SocialHub itself. */
    viewUrl: (key, options) => `${basePath}${downloadPath(key, options)}`,

    /** Routes the API mounts at /storage while this driver is active. */
    router() {
      const router = Router();

      // Direct upload target. No SocialHub session: the signed token is the authorization,
      // exactly like a presigned storage URL.
      router.put('/uploads/:token', async (req, res) => {
        const grant = readToken(req.params.token);
        if (!grant)
          throw storageError(403, ERROR_CODES.FORBIDDEN, 'This upload link is not valid.');
        if (Date.now() > grant.e) {
          throw storageError(403, ERROR_CODES.FORBIDDEN, 'This upload link has expired.');
        }
        const type = String(req.get('content-type') ?? '')
          .split(';')[0]
          .trim()
          .toLowerCase();
        // A proxy (for example a Cloudflare tunnel) may forward the body chunked, without a
        // Content-Length. The byte count below is checked either way.
        const declared = req.get('content-length');
        if (type !== grant.t || (declared !== undefined && Number(declared) !== grant.s)) {
          throw storageError(
            400,
            ERROR_CODES.BAD_REQUEST,
            'The file does not match the upload that was requested.',
          );
        }
        const target = filePath(grant.k);
        // One link writes one file, once. Otherwise a file could be swapped for other bytes
        // of the same size after the API had verified it.
        if (await storage.stat(grant.k)) {
          throw storageError(409, ERROR_CODES.CONFLICT, 'This file has already been uploaded.');
        }
        const partial = `${target}.${randomToken(6)}.part`;
        await mkdir(path.dirname(target), { recursive: true });

        let received = 0;
        try {
          await new Promise((resolve, reject) => {
            const out = createWriteStream(partial);
            req.on('data', (chunk) => {
              received += chunk.length;
              if (received > grant.s) req.destroy(new Error('too large'));
            });
            req.on('error', reject);
            req.on('aborted', () => reject(new Error('aborted')));
            out.on('error', reject);
            out.on('finish', resolve);
            req.pipe(out);
          });
          if (received !== grant.s) throw new Error('incomplete');
          // An interrupted upload never becomes the object: only a complete file is renamed.
          await rename(partial, target);
        } catch {
          await rm(partial, { force: true });
          throw storageError(400, ERROR_CODES.BAD_REQUEST, 'The upload was interrupted.');
        }
        res.status(200).end();
      });

      // Downloads need a link signed for this exact file. Without a valid signature the file
      // "does not exist" (404), so file names can neither be guessed nor confirmed.
      router.get('/objects/*key', async (req, res) => {
        const key = [].concat(req.params.key).join('/');
        const expires = Number(req.query.expires);
        const signature = typeof req.query.signature === 'string' ? req.query.signature : '';
        if (
          !Number.isInteger(expires) ||
          !signature ||
          !safeEqual(downloadSignature(key, expires), signature)
        ) {
          throw notFound('File not found');
        }
        const remaining = expires - Math.floor(Date.now() / 1000);
        if (remaining <= 0) {
          throw storageError(403, ERROR_CODES.FORBIDDEN, 'This file link has expired.');
        }
        const file = filePath(key);
        if (!(await storage.stat(key))) throw notFound('File not found');
        res.setHeader(
          'Content-Type',
          TYPES[path.extname(file).slice(1)] ?? 'application/octet-stream',
        );
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
        res.setHeader('Cache-Control', `private, max-age=${Math.min(3600, remaining)}`);
        res.sendFile(file);
      });

      return router;
    },
  };
  return storage;
}
