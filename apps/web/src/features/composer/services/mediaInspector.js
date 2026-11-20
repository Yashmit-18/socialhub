import { MEDIA_KINDS } from '../model/composerState.js';

/**
 * Reads a picked file's dimensions (and a video's duration) in the browser, so the composer
 * can check platform limits before anything is uploaded.
 *
 * It decodes from the object URL the caller already created for the preview: it never creates
 * (or revokes) URLs of its own. Everything stays in this browser; nothing is sent anywhere.
 */

/** How long the browser may take to read a file's metadata before giving up. */
export const INSPECTION_TIMEOUT_MS = 15000;

export const INSPECTION_ERROR_CODES = Object.freeze({
  NO_PREVIEW_URL: 'NO_PREVIEW_URL',
  UNSUPPORTED_KIND: 'UNSUPPORTED_KIND',
  UNREADABLE: 'UNREADABLE',
  TIMEOUT: 'TIMEOUT',
});

export class MediaInspectionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'MediaInspectionError';
    this.code = code;
  }
}

const positive = (value) => (Number.isFinite(value) && value > 0 ? value : null);
/** Live streams and some containers report Infinity / NaN: unknown, not zero. */
const duration = (value) => (Number.isFinite(value) && value >= 0 ? value : null);

/** Stops a detached media element from loading anything more. */
function release(element) {
  try {
    element.removeAttribute?.('src');
    element.load?.();
  } catch {
    /* jsdom and some browsers do not implement load(); nothing else to release */
  }
}

/**
 * `inspectMediaFile(file, { kind, url, timeoutMs })` resolves with
 * `{ width, height, durationSec }` (numbers, or null when the browser does not report them)
 * and rejects with a `MediaInspectionError` when the file can't be read or takes too long.
 */
export function inspectMediaFile(file, { kind, url, timeoutMs = INSPECTION_TIMEOUT_MS } = {}) {
  const name = file?.name || 'This file';
  return new Promise((resolve, reject) => {
    if (!url) {
      reject(
        new MediaInspectionError(
          INSPECTION_ERROR_CODES.NO_PREVIEW_URL,
          `${name} can't be previewed in this browser, so its details can't be read.`,
        ),
      );
      return;
    }
    if (kind !== MEDIA_KINDS.IMAGE && kind !== MEDIA_KINDS.VIDEO) {
      reject(
        new MediaInspectionError(
          INSPECTION_ERROR_CODES.UNSUPPORTED_KIND,
          `${name} isn't a photo or a video.`,
        ),
      );
      return;
    }

    const isVideo = kind === MEDIA_KINDS.VIDEO;
    const element = isVideo ? document.createElement('video') : new Image();
    let settled = false;
    let timer = null;

    const cleanup = () => {
      clearTimeout(timer);
      element.onload = null;
      element.onloadedmetadata = null;
      element.onerror = null;
      release(element);
    };
    const succeed = (value) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };
    const fail = (code, message) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new MediaInspectionError(code, message));
    };

    element.onerror = () =>
      fail(
        INSPECTION_ERROR_CODES.UNREADABLE,
        `This browser couldn't read ${name}. It may be damaged or use an unsupported format.`,
      );

    if (isVideo) {
      element.preload = 'metadata';
      element.muted = true;
      element.playsInline = true;
      element.onloadedmetadata = () =>
        succeed({
          width: positive(element.videoWidth),
          height: positive(element.videoHeight),
          durationSec: duration(element.duration),
        });
    } else {
      element.decoding = 'async';
      element.onload = () => {
        const width = positive(element.naturalWidth);
        const height = positive(element.naturalHeight);
        if (!width || !height) {
          fail(INSPECTION_ERROR_CODES.UNREADABLE, `${name} has no readable dimensions.`);
          return;
        }
        succeed({ width, height, durationSec: null });
      };
    }

    timer = setTimeout(
      () =>
        fail(
          INSPECTION_ERROR_CODES.TIMEOUT,
          `Reading ${name} took too long, so this browser stopped.`,
        ),
      timeoutMs,
    );
    element.src = url;
  });
}
