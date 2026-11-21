import { COMPOSER_LIMITS, MEDIA_MIME_TYPES } from '@socialhub/shared';
import { MEDIA_KINDS, MEDIA_MAX_ITEMS } from './composerState.js';

/**
 * Pure media helpers: which files the composer accepts at all, and formatting.
 *
 * Accepting a file here only means at least one destination can use that kind of file.
 * Per-platform rules (Instagram's JPEG-only images, size and duration limits, …) are
 * validation issues shown per destination (model/validation.js), because the chosen
 * destinations can change after a file is added.
 *
 * Accepted formats are the ones at least one platform accepts AND browsers can preview:
 * Facebook Pages take JPEG/PNG/GIF/BMP/TIFF photos, Instagram takes JPEG only; MP4 for both,
 * MOV for Instagram. BMP/TIFF are left out because most browsers can't preview them, and
 * WebP/HEIC because neither platform accepts them (constants/platformRules.js).
 */

export const ACCEPTED_TYPES = MEDIA_MIME_TYPES;

/** Some systems (notably Windows for .mov) report an empty MIME type; fall back to extensions. */
const EXTENSION_TYPES = Object.freeze({
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
});

const notAccepted = (label, to) => (name) =>
  `${name} is ${label}, which Facebook and Instagram don't accept. Convert it to ${to} first.`;

/** Formats people commonly try that the composer can't take, each with an accurate hint. */
const CONVERT_HINTS = Object.freeze([
  {
    test: (type, ext) => /hei[cf]/i.test(type) || ext === 'heic' || ext === 'heif',
    reason: notAccepted('a HEIC photo', 'JPEG'),
  },
  {
    test: (type, ext) => type === 'image/webp' || ext === 'webp',
    reason: notAccepted('a WebP image', 'JPEG'),
  },
  {
    test: (type, ext) => type === 'image/avif' || ext === 'avif',
    reason: notAccepted('an AVIF image', 'JPEG'),
  },
  {
    // Facebook accepts BMP and TIFF, but Instagram doesn't and most browsers can't preview them.
    test: (type, ext) =>
      ['image/bmp', 'image/tiff'].includes(type) || ['bmp', 'tif', 'tiff'].includes(ext),
    reason: (name) =>
      `${name} is a BMP or TIFF image, which SocialHub can't preview and Instagram doesn't accept. Convert it to JPEG or PNG first.`,
  },
]);

/** `accept` attribute for the file picker. */
export const ACCEPT_ATTRIBUTE = [
  ...ACCEPTED_TYPES[MEDIA_KINDS.IMAGE],
  ...ACCEPTED_TYPES[MEDIA_KINDS.VIDEO],
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.mp4',
  '.m4v',
  '.mov',
].join(',');

/**
 * SocialHub's own upload caps (proposed to the backend in docs/COMPOSER_API_CONTRACT.md §5).
 * They are deliberate product limits for uploading from a browser — Instagram's largest video
 * limit is 300 MB, and Facebook's historical 10 GB applies to chunked server uploads — while
 * per-platform limits are checked per destination. Decimal units (1 MB = 1,000,000 bytes).
 */
export const UPLOAD_LIMITS = Object.freeze({
  [MEDIA_KINDS.IMAGE]: COMPOSER_LIMITS.IMAGE_MAX_BYTES,
  [MEDIA_KINDS.VIDEO]: COMPOSER_LIMITS.VIDEO_MAX_BYTES,
});

export function extensionOf(fileName = '') {
  const match = /\.([a-z0-9]+)$/i.exec(fileName);
  return match ? match[1].toLowerCase() : '';
}

/** Non-standard MIME types some browsers report (e.g. Safari's video/x-m4v for .m4v). */
const MIME_ALIASES = Object.freeze({
  'image/jpg': 'image/jpeg',
  'image/pjpeg': 'image/jpeg',
  'video/x-m4v': 'video/mp4',
});

/** The effective MIME type: the browser's, or one derived from the extension. */
export function mimeTypeOf(file) {
  const type = String(file?.type ?? '').toLowerCase();
  if (type) return MIME_ALIASES[type] ?? type;
  return EXTENSION_TYPES[extensionOf(file?.name)] ?? '';
}

export function kindOfMimeType(mimeType) {
  if (ACCEPTED_TYPES[MEDIA_KINDS.IMAGE].includes(mimeType)) return MEDIA_KINDS.IMAGE;
  if (ACCEPTED_TYPES[MEDIA_KINDS.VIDEO].includes(mimeType)) return MEDIA_KINDS.VIDEO;
  return null;
}

/** Human file-type name for messages ("JPEG", "MP4", …). */
export function formatLabel(mimeType) {
  return (
    {
      'image/jpeg': 'JPEG',
      'image/png': 'PNG',
      'image/gif': 'GIF',
      'image/webp': 'WebP',
      'video/mp4': 'MP4',
      'video/quicktime': 'MOV',
    }[mimeType] ?? (mimeType ? mimeType.split('/').pop().toUpperCase() : 'Unknown')
  );
}

/**
 * Decimal (SI) sizes — 1 MB = 1,000,000 bytes — so values compare directly with Meta's
 * documented limits ("8 MB", "300 MB").
 */
export function formatBytes(bytes, { precise = false } = {}) {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1000) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1000;
  let unit = 0;
  while (value >= 999.5 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  // precise: two decimals (trailing zeros dropped) for messages next to a limit.
  const digits = precise ? 100 : value >= 10 ? 1 : 10;
  return `${Math.round(value * digits) / digits} ${units[unit]}`;
}

export function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** width / height, or null when unknown. */
export function aspectRatio(width, height) {
  if (!width || !height) return null;
  return width / height;
}

const COMMON_RATIOS = [
  [1, 1, '1:1'],
  [4, 5, '4:5'],
  [5, 4, '5:4'],
  [9, 16, '9:16'],
  [16, 9, '16:9'],
  [3, 4, '3:4'],
  [4, 3, '4:3'],
  [2, 3, '2:3'],
  [3, 2, '3:2'],
  [1.91, 1, '1.91:1'],
];

/** "4:5", "16:9", or a decimal ("1.33:1") when no common ratio is within 1%. */
export function describeAspectRatio(width, height) {
  const ratio = aspectRatio(width, height);
  if (!ratio) return null;
  for (const [w, h, label] of COMMON_RATIOS) {
    if (Math.abs(ratio - w / h) / (w / h) < 0.01) return label;
  }
  return `${Math.round(ratio * 100) / 100}:1`;
}

/**
 * Decides whether a dropped/picked file can be added at all.
 * Returns `{ ok: true, kind, mimeType }` or `{ ok: false, reason }` (a sentence for people).
 */
export function checkFileAcceptable(file, { existingCount = 0 } = {}) {
  const name = file?.name || 'This file';
  if (existingCount >= MEDIA_MAX_ITEMS) {
    return { ok: false, reason: `You can attach up to ${MEDIA_MAX_ITEMS} files to one post.` };
  }
  const mimeType = mimeTypeOf(file);
  const kind = kindOfMimeType(mimeType);
  if (!kind) {
    const ext = extensionOf(file?.name);
    const hint = CONVERT_HINTS.find((h) => h.test(mimeType, ext));
    return {
      ok: false,
      reason: hint
        ? hint.reason(name)
        : `${name} isn't a supported file. Use JPEG, PNG or GIF images, or MP4 or MOV videos.`,
    };
  }
  if (!file.size) return { ok: false, reason: `${name} is empty.` };
  if (file.size > UPLOAD_LIMITS[kind]) {
    return {
      ok: false,
      reason: `${name} is ${formatBytes(file.size)}. SocialHub accepts ${
        kind === MEDIA_KINDS.IMAGE ? 'images' : 'videos'
      } up to ${formatBytes(UPLOAD_LIMITS[kind])}.`,
    };
  }
  return { ok: true, kind, mimeType };
}
