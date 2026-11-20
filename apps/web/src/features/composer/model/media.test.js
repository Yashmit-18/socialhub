import { describe, expect, it } from 'vitest';
import { PLATFORM_RULES } from '../constants/platformRules.js';
import { makeFile } from '../test/browserMocks.js';
import { COMPOSER_PLATFORMS, MEDIA_KINDS, MEDIA_MAX_ITEMS } from './composerState.js';
import {
  ACCEPTED_TYPES,
  ACCEPT_ATTRIBUTE,
  UPLOAD_LIMITS,
  aspectRatio,
  checkFileAcceptable,
  describeAspectRatio,
  extensionOf,
  formatBytes,
  formatDuration,
  formatLabel,
  kindOfMimeType,
  mimeTypeOf,
} from './media.js';

const { IMAGE, VIDEO } = MEDIA_KINDS;
const RULE_KEY = { [IMAGE]: 'image', [VIDEO]: 'video' };
const allRules = COMPOSER_PLATFORMS.map((platform) => PLATFORM_RULES[platform]);

describe('ACCEPTED_TYPES / ACCEPT_ATTRIBUTE', () => {
  it('lists image and video MIME types under the matching kind', () => {
    expect(Object.isFrozen(ACCEPTED_TYPES)).toBe(true);
    expect(ACCEPTED_TYPES[IMAGE].length).toBeGreaterThan(0);
    expect(ACCEPTED_TYPES[VIDEO].length).toBeGreaterThan(0);
    for (const type of ACCEPTED_TYPES[IMAGE]) expect(type).toMatch(/^image\//);
    for (const type of ACCEPTED_TYPES[VIDEO]) expect(type).toMatch(/^video\//);
  });

  it('only accepts formats that at least one platform can publish', () => {
    for (const kind of [IMAGE, VIDEO]) {
      for (const type of ACCEPTED_TYPES[kind]) {
        const takers = allRules.filter((rules) =>
          rules.media[RULE_KEY[kind]].mimeTypes.includes(type),
        );
        expect(takers.length, `${type} is accepted by no platform`).toBeGreaterThan(0);
      }
    }
  });

  it('offers every accepted MIME type in the file picker', () => {
    const entries = ACCEPT_ATTRIBUTE.split(',');
    for (const type of [...ACCEPTED_TYPES[IMAGE], ...ACCEPTED_TYPES[VIDEO]]) {
      expect(entries).toContain(type);
    }
  });

  it('only offers extensions the composer then accepts (even with no browser MIME type)', () => {
    const extensions = ACCEPT_ATTRIBUTE.split(',').filter((entry) => entry.startsWith('.'));
    expect(extensions.length).toBeGreaterThan(0);
    for (const ext of extensions) {
      const result = checkFileAcceptable(makeFile(`file${ext}`, ''));
      expect(result.ok, `${ext} is offered but rejected`).toBe(true);
    }
  });
});

describe('UPLOAD_LIMITS', () => {
  it('sets a positive size cap for each kind', () => {
    expect(Object.isFrozen(UPLOAD_LIMITS)).toBe(true);
    expect(UPLOAD_LIMITS[IMAGE]).toBeGreaterThan(0);
    expect(UPLOAD_LIMITS[VIDEO]).toBeGreaterThan(0);
  });

  it('allows images up to the largest platform image limit', () => {
    const largest = Math.max(...allRules.map((rules) => rules.media.image.maxBytes ?? 0));
    expect(UPLOAD_LIMITS[IMAGE]).toBeGreaterThanOrEqual(largest);
  });

  // The 1 GB video cap is a deliberate SocialHub limit for browser uploads (contract §5): it
  // covers every VERIFIED platform video limit (Instagram Reels 300 MB), while Facebook's
  // historical 10 GB (unverified, chunked server uploads) is intentionally not offered.
  it('keeps the video cap above every verified platform video limit', () => {
    const verified = allRules.flatMap((rules) =>
      [
        ['media.video.maxBytes', rules.media.video.maxBytes],
        ['media.carouselVideo.maxBytes', rules.media.carouselVideo?.maxBytes],
      ]
        .filter(([key, value]) => value && !rules.unverified.includes(key))
        .map(([, value]) => value),
    );
    expect(UPLOAD_LIMITS[VIDEO]).toBeGreaterThanOrEqual(Math.max(...verified));
  });

  it('explains that the video cap is SocialHub’s own limit', () => {
    const result = checkFileAcceptable({ name: 'huge.mp4', type: 'video/mp4', size: 2e9 });
    expect(result).toEqual({
      ok: false,
      reason: 'huge.mp4 is 2 GB. SocialHub accepts videos up to 1 GB.',
    });
  });
});

describe('extensionOf', () => {
  it.each([
    ['photo.JPG', 'jpg'],
    ['archive.tar.gz', 'gz'],
    ['.mov', 'mov'],
    ['noext', ''],
    ['file.', ''],
    ['', ''],
    [undefined, ''],
    [null, ''],
  ])('reads the extension of %j as %j', (name, ext) => {
    expect(extensionOf(name)).toBe(ext);
  });
});

describe('mimeTypeOf', () => {
  it('uses the browser type, lowercased', () => {
    expect(mimeTypeOf({ name: 'a.png', type: 'IMAGE/PNG' })).toBe('image/png');
  });

  it('normalizes the non-standard image/jpg type', () => {
    expect(mimeTypeOf({ name: 'a.jpg', type: 'image/jpg' })).toBe('image/jpeg');
  });

  it('prefers the browser type over the extension', () => {
    expect(mimeTypeOf({ name: 'clip.mp4', type: 'video/quicktime' })).toBe('video/quicktime');
  });

  it.each([
    ['clip.MOV', 'video/quicktime'],
    ['clip.m4v', 'video/mp4'],
    ['clip.mp4', 'video/mp4'],
    ['photo.JPEG', 'image/jpeg'],
    ['photo.jpg', 'image/jpeg'],
    ['photo.png', 'image/png'],
    ['anim.gif', 'image/gif'],
  ])('derives %j from the extension when the browser reports no type', (name, type) => {
    expect(mimeTypeOf({ name, type: '' })).toBe(type);
  });

  it('returns "" when the type cannot be determined', () => {
    expect(mimeTypeOf({ name: 'notes.pdf', type: '' })).toBe('');
    expect(mimeTypeOf({ name: 'README', type: '' })).toBe('');
    expect(mimeTypeOf(null)).toBe('');
    expect(mimeTypeOf(undefined)).toBe('');
  });
});

describe('kindOfMimeType', () => {
  it('classifies every accepted type', () => {
    for (const type of ACCEPTED_TYPES[IMAGE]) expect(kindOfMimeType(type)).toBe(IMAGE);
    for (const type of ACCEPTED_TYPES[VIDEO]) expect(kindOfMimeType(type)).toBe(VIDEO);
  });

  it.each(['image/heic', 'image/svg+xml', 'video/webm', 'application/pdf', '', undefined])(
    'returns null for %j',
    (type) => {
      expect(kindOfMimeType(type)).toBeNull();
    },
  );
});

describe('formatLabel', () => {
  it.each([
    ['image/jpeg', 'JPEG'],
    ['image/png', 'PNG'],
    ['image/gif', 'GIF'],
    ['image/webp', 'WebP'],
    ['video/mp4', 'MP4'],
    ['video/quicktime', 'MOV'],
    ['image/heic', 'HEIC'],
    ['image/bmp', 'BMP'],
    ['application/x-foo', 'X-FOO'],
    ['', 'Unknown'],
    [undefined, 'Unknown'],
  ])('labels %j as %j', (type, label) => {
    expect(formatLabel(type)).toBe(label);
  });
});

describe('formatBytes', () => {
  it.each([
    [0, '0 B'],
    [999, '999 B'],
    [1000, '1 KB'],
    [1500, '1.5 KB'],
    [9_950, '10 KB'],
    [999_499, '999 KB'],
    [999_500, '1 MB'],
    [1_234_567, '1.2 MB'],
    [12_345_678, '12 MB'],
    [8_000_000, '8 MB'],
    [1_000_000_000, '1 GB'],
    [1_500_000_000, '1.5 GB'],
    [2_500_000_000_000, '2500 GB'],
  ])('formats %d bytes as %j (decimal units)', (bytes, label) => {
    expect(formatBytes(bytes)).toBe(label);
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY, '100', null, undefined])(
    'shows a dash for %j',
    (bytes) => {
      expect(formatBytes(bytes)).toBe('—');
    },
  );
});

describe('formatDuration', () => {
  it.each([
    [0, '0:00'],
    [5, '0:05'],
    [59.4, '0:59'],
    [59.6, '1:00'],
    [65, '1:05'],
    [900, '15:00'],
    [3600, '1:00:00'],
    [3725, '1:02:05'],
  ])('formats %d seconds as %j', (seconds, label) => {
    expect(formatDuration(seconds)).toBe(label);
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY, null, undefined])(
    'shows a dash for %j',
    (seconds) => {
      expect(formatDuration(seconds)).toBe('—');
    },
  );
});

describe('aspectRatio / describeAspectRatio', () => {
  it('computes width / height, or null when a side is unknown', () => {
    expect(aspectRatio(1080, 1350)).toBeCloseTo(0.8);
    expect(aspectRatio(1920, 1080)).toBeCloseTo(16 / 9);
    expect(aspectRatio(0, 100)).toBeNull();
    expect(aspectRatio(100, 0)).toBeNull();
    expect(aspectRatio(null, null)).toBeNull();
  });

  it.each([
    [1080, 1080, '1:1'],
    [1080, 1350, '4:5'],
    [1350, 1080, '5:4'],
    [1080, 1920, '9:16'],
    [1920, 1080, '16:9'],
    [750, 1000, '3:4'],
    [1000, 750, '4:3'],
    [1000, 1500, '2:3'],
    [1500, 1000, '3:2'],
    [1200, 628, '1.91:1'],
    [1000, 1003, '1:1'],
  ])('describes %d×%d as %j (within 1%)', (width, height, label) => {
    expect(describeAspectRatio(width, height)).toBe(label);
  });

  it('falls back to a decimal ratio', () => {
    expect(describeAspectRatio(4000, 1000)).toBe('4:1');
    expect(describeAspectRatio(1000, 300)).toBe('3.33:1');
  });

  it('returns null when the dimensions are unknown', () => {
    expect(describeAspectRatio(0, 1080)).toBeNull();
    expect(describeAspectRatio(null, undefined)).toBeNull();
  });
});

describe('checkFileAcceptable', () => {
  it.each([
    ['photo.jpg', 'image/jpeg', IMAGE],
    ['photo.png', 'image/png', IMAGE],
    ['anim.gif', 'image/gif', IMAGE],
    ['clip.mp4', 'video/mp4', VIDEO],
    ['clip.mov', 'video/quicktime', VIDEO],
  ])('accepts %s', (name, type, kind) => {
    expect(checkFileAcceptable(makeFile(name, type))).toEqual({ ok: true, kind, mimeType: type });
  });

  it('accepts a .mov file whose browser reports no type (Windows)', () => {
    expect(checkFileAcceptable(makeFile('Clip.MOV', ''))).toEqual({
      ok: true,
      kind: VIDEO,
      mimeType: 'video/quicktime',
    });
  });

  it(`refuses more than ${MEDIA_MAX_ITEMS} files before looking at the file`, () => {
    const file = makeFile('photo.jpg', 'image/jpeg');
    expect(checkFileAcceptable(file, { existingCount: MEDIA_MAX_ITEMS - 1 }).ok).toBe(true);
    expect(checkFileAcceptable(file, { existingCount: MEDIA_MAX_ITEMS })).toEqual({
      ok: false,
      reason: `You can attach up to ${MEDIA_MAX_ITEMS} files to one post.`,
    });
    expect(
      checkFileAcceptable(makeFile('x.pdf', 'application/pdf'), { existingCount: 99 }),
    ).toEqual({ ok: false, reason: `You can attach up to ${MEDIA_MAX_ITEMS} files to one post.` });
  });

  it.each([
    ['IMG_0001.HEIC', 'image/heic', /^IMG_0001\.HEIC is a HEIC photo\b.*Convert it to JPEG/],
    ['IMG_0002.heif', 'image/heif', /^IMG_0002\.heif is a HEIC photo\b/],
    ['IMG_0003.HEIC', '', /^IMG_0003\.HEIC is a HEIC photo\b/],
    ['banner.webp', 'image/webp', /^banner\.webp is a WebP image\b.*Convert it to JPEG/],
    ['banner.webp', '', /^banner\.webp is a WebP image\b/],
    ['art.avif', 'image/avif', /^art\.avif is an AVIF image\b.*Convert it to JPEG/],
    ['scan.bmp', 'image/bmp', /^scan\.bmp is a BMP or TIFF image\b.*Convert it to JPEG or PNG/],
    ['scan.tif', '', /^scan\.tif is a BMP or TIFF image\b/],
    ['scan.tiff', 'image/tiff', /^scan\.tiff is a BMP or TIFF image\b/],
  ])('explains how to convert %s (%j)', (name, type, reason) => {
    const result = checkFileAcceptable(makeFile(name, type));
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(reason);
  });

  it('rejects other files with a message that lists every accepted format', () => {
    for (const [name, type] of [
      ['notes.pdf', 'application/pdf'],
      ['clip.webm', 'video/webm'],
      ['mystery', ''],
    ]) {
      const result = checkFileAcceptable(makeFile(name, type));
      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(
        new RegExp(`^${name.replace('.', '\\.')} isn't a supported file`),
      );
      for (const accepted of [...ACCEPTED_TYPES[IMAGE], ...ACCEPTED_TYPES[VIDEO]]) {
        expect(result.reason).toContain(formatLabel(accepted));
      }
    }
  });

  it('rejects empty files', () => {
    expect(checkFileAcceptable(makeFile('empty.jpg', 'image/jpeg', 0))).toEqual({
      ok: false,
      reason: 'empty.jpg is empty.',
    });
  });

  it.each([
    [IMAGE, 'huge.jpg', 'image/jpeg', 'images'],
    [VIDEO, 'huge.mp4', 'video/mp4', 'videos'],
  ])('enforces the %s upload cap', (kind, name, type, noun) => {
    const cap = UPLOAD_LIMITS[kind];
    expect(checkFileAcceptable(makeFile(name, type, cap)).ok).toBe(true);
    expect(checkFileAcceptable(makeFile(name, type, cap + 1_000_000))).toEqual({
      ok: false,
      reason: `${name} is ${formatBytes(cap + 1_000_000)}. SocialHub accepts ${noun} up to ${formatBytes(cap)}.`,
    });
  });

  it('calls a nameless file "This file"', () => {
    expect(checkFileAcceptable({ type: 'image/jpeg', size: 0 }).reason).toBe('This file is empty.');
    expect(checkFileAcceptable(null).reason).toMatch(/^This file isn't a supported file/);
  });
});
