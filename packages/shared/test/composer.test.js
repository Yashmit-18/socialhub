import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_ACTIONS,
  COMPOSER_LIMITS,
  ERROR_CODES,
  accountPresetSchema,
  contentPackageInputSchema,
  contentPackageQuerySchema,
  contentPackageUpdateSchema,
  mediaMaxBytes,
  mediaUploadRequestSchema,
} from '../src/index.js';

const id = (char) => char.repeat(24);
const fields = (result) => result.error.issues.map((issue) => issue.path.join('.'));

describe('contentPackageInputSchema', () => {
  it('fills in defaults, so an empty draft is valid', () => {
    expect(contentPackageInputSchema.parse({})).toEqual({
      caption: '',
      platformCaptions: {},
      hashtags: [],
      hashtagPlacement: 'CAPTION',
      keywords: [],
      firstComment: '',
      media: [],
      targetAccountIds: [],
    });
  });

  it('accepts a full draft', () => {
    const draft = {
      caption: 'Hello',
      platformCaptions: { FACEBOOK_PAGE: 'FB', INSTAGRAM_ACCOUNT: '' },
      hashtags: ['summer', 'भारत', 'a_b1'],
      hashtagPlacement: 'FIRST_COMMENT',
      keywords: ['summer campaign'],
      firstComment: 'Hi',
      media: [{ mediaId: id('a'), altText: 'A beach' }],
      targetAccountIds: [id('b'), id('c')],
    };
    expect(contentPackageInputSchema.parse(draft)).toEqual(draft);
  });

  it('counts characters as code points', () => {
    const atLimit = '😀'.repeat(COMPOSER_LIMITS.CAPTION_MAX);
    expect(contentPackageInputSchema.safeParse({ caption: atLimit }).success).toBe(true);
    expect(contentPackageInputSchema.safeParse({ caption: `${atLimit}x` }).success).toBe(false);
    expect(contentPackageInputSchema.safeParse({ hashtags: ['😀'.repeat(5)] }).success).toBe(false); // emoji are not hashtag characters
  });

  it.each([
    [{ hashtags: ['#tag'] }, 'hashtags.0'],
    [{ hashtags: ['two words'] }, 'hashtags.0'],
    [{ hashtags: ['Sale', 'sale'] }, 'hashtags'],
    [{ keywords: ['   '] }, 'keywords.0'],
    [{ keywords: ['SEO', 'seo'] }, 'keywords'],
    [{ platformCaptions: { TIKTOK: 'x' } }, 'platformCaptions'],
    [{ media: [{ mediaId: 'nope' }] }, 'media.0.mediaId'],
    [{ media: [{ mediaId: id('a') }, { mediaId: id('A') }] }, 'media'],
    [{ targetAccountIds: [id('a'), id('a')] }, 'targetAccountIds'],
    [{ firstComment: 'x'.repeat(COMPOSER_LIMITS.FIRST_COMMENT_MAX + 1) }, 'firstComment'],
    [{ caption: { $gt: '' } }, 'caption'],
    [{ workspace: id('a') }, ''],
  ])('rejects %o', (input, field) => {
    const result = contentPackageInputSchema.safeParse(input);
    expect(result.success).toBe(false);
    expect(fields(result)).toContain(field);
  });

  it('caps list sizes', () => {
    const many = (n, make) => Array.from({ length: n }, (_, i) => make(i));
    const over = (input) => contentPackageInputSchema.safeParse(input).success;
    expect(over({ hashtags: many(COMPOSER_LIMITS.HASHTAGS_MAX, (i) => `t${i}`) })).toBe(true);
    expect(over({ hashtags: many(COMPOSER_LIMITS.HASHTAGS_MAX + 1, (i) => `t${i}`) })).toBe(false);
    expect(over({ keywords: many(COMPOSER_LIMITS.KEYWORDS_MAX + 1, (i) => `k${i}`) })).toBe(false);
    const media = (n) => many(n, (i) => ({ mediaId: i.toString(16).padStart(24, '0') }));
    expect(over({ media: media(COMPOSER_LIMITS.MEDIA_MAX_ITEMS) })).toBe(true);
    expect(over({ media: media(COMPOSER_LIMITS.MEDIA_MAX_ITEMS + 1) })).toBe(false);
  });
});

describe('contentPackageUpdateSchema', () => {
  it('requires a positive integer version', () => {
    expect(contentPackageUpdateSchema.safeParse({ caption: 'x' }).success).toBe(false);
    for (const version of [0, 1.5, '1', null]) {
      expect(contentPackageUpdateSchema.safeParse({ version }).success).toBe(false);
    }
    expect(contentPackageUpdateSchema.parse({ version: 3 }).version).toBe(3);
  });
});

describe('contentPackageQuerySchema', () => {
  it('defaults to the first page of drafts and coerces the limit', () => {
    expect(contentPackageQuerySchema.parse({})).toEqual({ status: 'DRAFT', limit: 20 });
    expect(contentPackageQuerySchema.parse({ limit: '50' }).limit).toBe(50);
    expect(contentPackageQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
    expect(contentPackageQuerySchema.safeParse({ status: 'PUBLISHED' }).success).toBe(false);
  });
});

describe('mediaUploadRequestSchema', () => {
  const image = { fileName: 'a.jpg', kind: 'IMAGE', mimeType: 'image/jpeg', sizeBytes: 1000 };
  const video = { fileName: 'a.mp4', kind: 'VIDEO', mimeType: 'video/mp4', sizeBytes: 1000 };

  it('accepts the supported image and video types', () => {
    for (const mimeType of ['image/jpeg', 'image/png', 'image/gif']) {
      expect(mediaUploadRequestSchema.safeParse({ ...image, mimeType }).success).toBe(true);
    }
    for (const mimeType of ['video/mp4', 'video/quicktime']) {
      expect(mediaUploadRequestSchema.safeParse({ ...video, mimeType }).success).toBe(true);
    }
    expect(mediaUploadRequestSchema.parse({ ...image, mimeType: 'IMAGE/JPEG' }).mimeType).toBe(
      'image/jpeg',
    );
  });

  it('rejects other types, and a type that does not fit the kind', () => {
    for (const mimeType of ['image/webp', 'image/svg+xml', 'text/html', 'video/mp4']) {
      expect(fields(mediaUploadRequestSchema.safeParse({ ...image, mimeType }))).toContain(
        'mimeType',
      );
    }
    expect(mediaUploadRequestSchema.safeParse({ ...video, mimeType: 'image/png' }).success).toBe(
      false,
    );
  });

  it('enforces the size limit of each kind', () => {
    expect(mediaMaxBytes('IMAGE')).toBe(30_000_000);
    expect(mediaMaxBytes('VIDEO')).toBe(1_000_000_000);
    const size = (base, sizeBytes) =>
      mediaUploadRequestSchema.safeParse({ ...base, sizeBytes }).success;
    expect(size(image, 30_000_000)).toBe(true);
    expect(size(image, 30_000_001)).toBe(false);
    expect(size(video, 1_000_000_000)).toBe(true);
    expect(size(video, 1_000_000_001)).toBe(false);
    expect(size(image, 0)).toBe(false);
    expect(size(image, 1.5)).toBe(false);
  });

  it('rejects file names with path separators or control characters, and unknown fields', () => {
    for (const fileName of ['../x.jpg', 'a\\b.jpg', 'a\u0000.jpg', '', 'x'.repeat(256)]) {
      expect(mediaUploadRequestSchema.safeParse({ ...image, fileName }).success).toBe(false);
    }
    expect(
      mediaUploadRequestSchema.safeParse({ ...image, url: 'https://evil.example' }).success,
    ).toBe(false);
  });
});

describe('accountPresetSchema', () => {
  it('cleans the name and requires unique accounts', () => {
    expect(
      accountPresetSchema.parse({ name: '  All   Pages ', socialAccountIds: [id('a')] }),
    ).toEqual({
      name: 'All Pages',
      socialAccountIds: [id('a')],
    });
    for (const input of [
      { name: '   ', socialAccountIds: [id('a')] },
      { name: 'x'.repeat(41), socialAccountIds: [id('a')] },
      { name: 'Empty', socialAccountIds: [] },
      { name: 'Twice', socialAccountIds: [id('a'), id('a')] },
      { socialAccountIds: [id('a')] },
    ]) {
      expect(accountPresetSchema.safeParse(input).success).toBe(false);
    }
  });
});

describe('composer enums', () => {
  it('defines the activity actions and error codes the API uses', () => {
    expect(ACTIVITY_ACTIONS).toMatchObject({
      CONTENT_PACKAGE_CREATED: 'content_package.created',
      CONTENT_PACKAGE_UPDATED: 'content_package.updated',
      CONTENT_PACKAGE_DELETED: 'content_package.deleted',
      MEDIA_UPLOADED: 'media.uploaded',
      MEDIA_DELETED: 'media.deleted',
      ACCOUNT_PRESET_CREATED: 'account_preset.created',
      ACCOUNT_PRESET_DELETED: 'account_preset.deleted',
    });
    expect(new Set(Object.values(ACTIVITY_ACTIONS)).size).toBe(
      Object.keys(ACTIVITY_ACTIONS).length,
    );
    expect(ERROR_CODES).toMatchObject({
      STORAGE_NOT_CONFIGURED: 'STORAGE_NOT_CONFIGURED',
      STORAGE_UNAVAILABLE: 'STORAGE_UNAVAILABLE',
      UPLOAD_INCOMPLETE: 'UPLOAD_INCOMPLETE',
    });
  });
});
