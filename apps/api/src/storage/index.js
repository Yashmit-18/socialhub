import { createHmac } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ERROR_CODES } from '@socialhub/shared';
import { config } from '../config/env.js';
import { logger } from '../config/logger.js';
import { AppError } from '../lib/errors.js';
import { createLocalStorage } from './localStorage.js';
import { createS3Storage } from './s3Storage.js';

/**
 * Media storage abstraction. One driver is active per process, chosen by STORAGE_DRIVER:
 *   s3     S3-compatible object storage (production)
 *   local  files on this server's disk (development and tests)
 *   unset  no storage: media endpoints answer 503 STORAGE_NOT_CONFIGURED
 *
 * Every driver offers: createUpload, stat, read, remove, publicUrl, `publicUrls` (whether
 * its URLs are reachable from the internet, which Instagram needs) and `uploadOrigin`.
 */

const apiDir = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));

export function buildStorage(settings = config.storage) {
  if (!settings?.driver) return null;
  if (settings.driver === 's3') return createS3Storage(settings.s3);
  if (config.isProduction) {
    logger.warn(
      'STORAGE_DRIVER=local in production: media is kept on this server only, is lost if its disk is, and Instagram can fetch it only if this API is public over HTTPS. Use STORAGE_DRIVER=s3.',
    );
  }
  // Absolute paths (another drive, spaces in the name) are used as they are; relative ones
  // are resolved against apps/api.
  const directory = path.resolve(apiDir, settings.local.directory);
  try {
    // Unverified uploads and verified files live in separate folders.
    for (const area of ['uploads', 'workspaces']) {
      mkdirSync(path.join(directory, area), { recursive: true });
    }
  } catch (err) {
    throw new Error(
      `STORAGE_LOCAL_DIR "${directory}" cannot be created or written to: ${err.message}`,
      { cause: err },
    );
  }
  return createLocalStorage({
    directory,
    baseUrl: `${config.publicApiUrl}/api/v1`,
    // Derived, so upload links can't be forged with any other secret this server holds.
    secret: createHmac('sha256', config.auth.accessSecret).update('storage-upload').digest(),
  });
}

let active;

/** The active driver, or null when storage is not configured. */
export function getStorage() {
  if (active === undefined) active = buildStorage();
  return active;
}

/** The active driver; throws 503 when storage is not configured. */
export function requireStorage() {
  const storage = getStorage();
  if (!storage) {
    throw new AppError(
      503,
      ERROR_CODES.STORAGE_NOT_CONFIGURED,
      'Media storage is not configured on this server, so files cannot be uploaded yet.',
    );
  }
  return storage;
}

/** Test hook: replace the driver (pass undefined to rebuild from configuration). */
export function setStorageForTests(storage) {
  if (!config.isTest) throw new Error('setStorageForTests is only available in tests');
  active = storage;
}
