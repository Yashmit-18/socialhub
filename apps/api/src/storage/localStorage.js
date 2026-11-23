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
  png: 'image/png',
  gif: 'image/gif',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
};

const storageError = (status, code, message) => new AppError(status, code, message);

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
        url: `${baseUrl}/storage/uploads/${payload}.${sign(payload)}`,
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

    publicUrl: (key) => `${baseUrl}/storage/objects/${key}`,

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
        if (type !== grant.t || Number(req.get('content-length')) !== grant.s) {
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

      router.get('/objects/*key', async (req, res) => {
        const key = [].concat(req.params.key).join('/');
        const file = filePath(key);
        if (!(await storage.stat(key))) throw notFound('File not found');
        res.setHeader(
          'Content-Type',
          TYPES[path.extname(file).slice(1)] ?? 'application/octet-stream',
        );
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
        res.setHeader('Cache-Control', 'private, max-age=3600');
        res.sendFile(file);
      });

      return router;
    },
  };
  return storage;
}
