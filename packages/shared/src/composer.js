/**
 * Composer domain: limits and request schemas shared by the API (authoritative) and the web
 * composer (instant feedback). See docs/COMPOSER_API_CONTRACT.md.
 *
 * These validate shape and SocialHub's own limits only. A draft may be incomplete, so no
 * platform rule (Instagram needs media, caption lengths per platform, …) blocks saving.
 */
import { z } from 'zod';
import { SOCIAL_PLATFORMS } from './enums.js';
import { objectIdSchema } from './schemas.js';

export const MEDIA_KINDS = Object.freeze({ IMAGE: 'IMAGE', VIDEO: 'VIDEO' });

/** Lifecycle of a stored media asset. Only READY means the bytes are verified in storage. */
export const MEDIA_STATUS = Object.freeze({
  PENDING_UPLOAD: 'PENDING_UPLOAD',
  PROCESSING: 'PROCESSING',
  READY: 'READY',
  FAILED: 'FAILED',
});

export const CONTENT_PACKAGE_STATUS = Object.freeze({ DRAFT: 'DRAFT' });

export const HASHTAG_PLACEMENTS = Object.freeze({
  CAPTION: 'CAPTION',
  FIRST_COMMENT: 'FIRST_COMMENT',
});

/** MIME types SocialHub stores, per kind. */
export const MEDIA_MIME_TYPES = Object.freeze({
  [MEDIA_KINDS.IMAGE]: Object.freeze(['image/jpeg', 'image/png', 'image/gif']),
  [MEDIA_KINDS.VIDEO]: Object.freeze(['video/mp4', 'video/quicktime']),
});

export const COMPOSER_LIMITS = Object.freeze({
  /** Unicode code points. The largest platform caption figure (Facebook). */
  CAPTION_MAX: 63206,
  FIRST_COMMENT_MAX: 8000,
  HASHTAG_MAX_LENGTH: 100,
  HASHTAGS_MAX: 60,
  KEYWORD_MAX_LENGTH: 60,
  KEYWORDS_MAX: 25,
  ALT_TEXT_MAX: 1000,
  MEDIA_MAX_ITEMS: 20,
  TARGET_ACCOUNTS_MAX: 500,
  FILE_NAME_MAX: 255,
  /** Decimal units (1 MB = 1,000,000 bytes), like Meta's documented limits. */
  IMAGE_MAX_BYTES: 30 * 1000 * 1000,
  VIDEO_MAX_BYTES: 1000 * 1000 * 1000,
  /** Sanity bound on either side of a stored image or video, in pixels. */
  DIMENSION_MAX: 20000,
  PRESET_NAME_MAX: 40,
  PRESET_ACCOUNTS_MAX: 500,
  DRAFTS_PAGE_MAX: 100,
});

const L = COMPOSER_LIMITS;
const codePoints = (value) => [...value].length;
const folded = (value) => value.toLowerCase();
const uniqueBy = (key) => (list) => new Set(list.map(key)).size === list.length;

const text = (max, label) =>
  z.string({ error: `${label} must be text` }).refine((v) => codePoints(v) <= max, {
    error: `${label} can be at most ${max.toLocaleString('en-US')} characters`,
  });

export const hashtagSchema = z
  .string()
  .regex(/^[\p{L}\p{M}\p{N}_]+$/u, {
    error: 'Hashtags can only contain letters, numbers and underscores (without #)',
  })
  .refine((v) => codePoints(v) <= L.HASHTAG_MAX_LENGTH, {
    error: `Hashtags can be at most ${L.HASHTAG_MAX_LENGTH} characters`,
  });

export const keywordSchema = z
  .string()
  .trim()
  .min(1, { error: 'Keywords cannot be empty' })
  .refine((v) => codePoints(v) <= L.KEYWORD_MAX_LENGTH, {
    error: `Keywords can be at most ${L.KEYWORD_MAX_LENGTH} characters`,
  });

const platformCaptionsSchema = z
  .strictObject({
    [SOCIAL_PLATFORMS.FACEBOOK_PAGE]: text(L.CAPTION_MAX, 'Caption').optional(),
    [SOCIAL_PLATFORMS.INSTAGRAM_ACCOUNT]: text(L.CAPTION_MAX, 'Caption').optional(),
  })
  .default({});

/** Destinations: unique social account ids. Access is checked by the API. */
export const destinationIdsSchema = (max) =>
  z
    .array(objectIdSchema)
    .max(max)
    .refine(uniqueBy(folded), { error: 'Each account can only be listed once' });

/** Create / full-save body of a draft (contract §4.1). Every field may be empty. */
export const contentPackageInputSchema = z.strictObject({
  caption: text(L.CAPTION_MAX, 'Caption').default(''),
  platformCaptions: platformCaptionsSchema,
  hashtags: z
    .array(hashtagSchema)
    .max(L.HASHTAGS_MAX, { error: `Use at most ${L.HASHTAGS_MAX} hashtags` })
    .refine(uniqueBy(folded), { error: 'Each hashtag can only be listed once' })
    .default([]),
  hashtagPlacement: z.enum(Object.values(HASHTAG_PLACEMENTS)).default(HASHTAG_PLACEMENTS.CAPTION),
  keywords: z
    .array(keywordSchema)
    .max(L.KEYWORDS_MAX, { error: `Use at most ${L.KEYWORDS_MAX} keywords` })
    .refine(uniqueBy(folded), { error: 'Each keyword can only be listed once' })
    .default([]),
  firstComment: text(L.FIRST_COMMENT_MAX, 'First comment').default(''),
  media: z
    .array(
      z.strictObject({
        mediaId: objectIdSchema,
        altText: text(L.ALT_TEXT_MAX, 'Alt text').default(''),
      }),
    )
    .max(L.MEDIA_MAX_ITEMS, { error: `Attach at most ${L.MEDIA_MAX_ITEMS} files` })
    .refine(
      uniqueBy((m) => folded(m.mediaId)),
      { error: 'Each file can only be attached once' },
    )
    .default([]),
  targetAccountIds: destinationIdsSchema(L.TARGET_ACCOUNTS_MAX).default([]),
});

/** PATCH body: a full save plus the version the editor last saw (optimistic concurrency). */
export const contentPackageUpdateSchema = contentPackageInputSchema.extend({
  version: z
    .number({ error: 'version is required' })
    .int()
    .min(1, { error: 'version is required' }),
});

export const contentPackageQuerySchema = z.strictObject({
  status: z.enum(Object.values(CONTENT_PACKAGE_STATUS)).default(CONTENT_PACKAGE_STATUS.DRAFT),
  /** Opaque value from a previous page's `nextCursor`. */
  cursor: z.string().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(L.DRAFTS_PAGE_MAX).default(20),
});

/** Largest file SocialHub stores for a kind. */
export function mediaMaxBytes(kind) {
  return kind === MEDIA_KINDS.VIDEO ? L.VIDEO_MAX_BYTES : L.IMAGE_MAX_BYTES;
}

/** Request for an upload slot (contract §5.1). */
export const mediaUploadRequestSchema = z
  .strictObject({
    fileName: z
      .string()
      .trim()
      .min(1, { error: 'File name is required' })
      .max(L.FILE_NAME_MAX, { error: 'File name is too long' })
      // eslint-disable-next-line no-control-regex
      .refine((v) => !/[\u0000-\u001f\u007f/\\]/.test(v), { error: 'File name is not valid' }),
    kind: z.enum(Object.values(MEDIA_KINDS), { error: 'Choose an image or a video' }),
    mimeType: z.string().trim().toLowerCase().max(100),
    sizeBytes: z
      .number({ error: 'File size is required' })
      .int()
      .min(1, { error: 'The file is empty' }),
  })
  .superRefine((value, ctx) => {
    if (!MEDIA_MIME_TYPES[value.kind]?.includes(value.mimeType)) {
      ctx.addIssue({
        code: 'custom',
        path: ['mimeType'],
        message:
          value.kind === MEDIA_KINDS.VIDEO
            ? 'Videos must be MP4 or MOV'
            : 'Images must be JPEG, PNG or GIF',
      });
    }
    const max = mediaMaxBytes(value.kind);
    if (value.sizeBytes > max) {
      ctx.addIssue({
        code: 'custom',
        path: ['sizeBytes'],
        message: `${value.kind === MEDIA_KINDS.VIDEO ? 'Videos' : 'Images'} can be at most ${Math.round(max / 1e6).toLocaleString('en-US')} MB`,
      });
    }
  });

export const accountPresetNameSchema = z
  .string({ error: 'Enter a name for the preset' })
  .transform((v) => v.replace(/\s+/g, ' ').trim())
  .pipe(
    z
      .string()
      .min(1, { error: 'Enter a name for the preset' })
      .max(L.PRESET_NAME_MAX, { error: `Use ${L.PRESET_NAME_MAX} characters or fewer` }),
  );

/** A named set of social accounts (contract §6). */
export const accountPresetSchema = z.strictObject({
  name: accountPresetNameSchema,
  socialAccountIds: destinationIdsSchema(L.PRESET_ACCOUNTS_MAX).min(1, {
    error: 'Select at least one account',
  }),
});
