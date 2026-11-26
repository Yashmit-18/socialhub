import { SOCIAL_PLATFORMS } from '@socialhub/shared';

/**
 * Meta publishing constraints the composer validates against, researched from Meta's official
 * developer documentation on 2026-11-20 (sources per section; full notes in
 * docs/COMPOSER_API_CONTRACT.md §8). The backend must enforce the same rules: client-side
 * checks are guidance, and Meta's API response is the final authority.
 *
 * `unverified` lists rule keys that no official Meta page confirmed. Validation reports those
 * as warnings, never as errors.
 *
 * Meta does not say whether "MB" means 10^6 or 2^20 bytes, so decimal megabytes (the smaller
 * value) are used, with Meta's own wording in `*Label`.
 */

const MB = 1000 * 1000;

const SOURCES = Object.freeze({
  igMedia:
    'https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media',
  igPublishing: 'https://developers.facebook.com/docs/instagram-platform/content-publishing/',
  igComments:
    'https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-media/comments',
  igHashtagsHelp: 'https://help.instagram.com/351460621611097',
  igCommentErrorsHelp: 'https://help.instagram.com/161863397286564',
  fbComments: 'https://developers.facebook.com/docs/graph-api/reference/object/comments',
  fbPosts: 'https://developers.facebook.com/docs/pages-api/posts',
  fbPhotos: 'https://developers.facebook.com/docs/graph-api/reference/page/photos/',
  fbVideo: 'https://developers.facebook.com/docs/video-api/guides/publishing',
});

export const RULE_SOURCES = SOURCES;

export const PLATFORM_RULES = Object.freeze({
  [SOCIAL_PLATFORMS.FACEBOOK_PAGE]: {
    platform: SOCIAL_PLATFORMS.FACEBOOK_PAGE,
    label: 'Facebook',
    caption: {
      // POST /{page-id}/feed documents `message` with no maximum length. 63,206 is the widely
      // cited figure (third parties, not Meta), so it is unverified and warns only.
      maxChars: 63206,
      maxHashtags: null,
      maxMentions: null,
    },
    firstComment: {
      // Meta documents no maximum length for comment text (third-party tools use 8,000).
      maxChars: 8000,
      maxHashtags: null,
      maxMentions: null,
      /**
       * Commenting as the Page (POST /{page-post-id}/comments) with a Page access token. The
       * Object Comments reference requires pages_manage_engagement + the MODERATE task; the
       * Pages comments guide also lists pages_read_engagement, CREATE_CONTENT and
       * "pages_read_user_engagement" (a typo — the permission is pages_read_user_content).
       */
      permissions: [
        'pages_manage_engagement',
        'pages_read_engagement',
        'pages_read_user_content',
        'pages_show_list',
      ],
      pageTask: 'MODERATE',
      editable: true,
      note: 'Posted as the Page right after the post is published, once publishing is available. It needs the pages_manage_engagement permission and the Page MODERATE task, which SocialHub does not request yet.',
    },
    media: {
      required: false,
      // Meta documents no maximum number of photos for one multi-photo post (attached_media).
      maxItems: null,
      // No documented way to combine photos and a video in one feed post: photos attach to
      // /feed, videos publish through /videos as their own post.
      allowMixed: false,
      maxVideos: 1,
      // So several videos (and no photos) are published as one post per video, each with the
      // same text (features/publishing/videoPosts.js); the composer only says so.
      separateVideoPosts: true,
      image: {
        // Page Photos reference: ".jpeg, .bmp, .png, .gif, .tiff"; "Files can not exceed 10MB".
        mimeTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/bmp', 'image/tiff'],
        maxBytes: 10 * MB,
        maxBytesLabel: '10 MB',
        // Photo node: "Animated photos are not supported."
        staticOnlyMimeTypes: ['image/gif'],
        // "For .png files, we recommend not exceeding 1MB or the image may appear pixelated."
        recommendedMaxBytesByType: { 'image/png': 1 * MB },
        recommendedMaxBytesLabel: '1 MB',
      },
      video: {
        // The documented upload path (Resumable Upload API) accepts video/mp4 only; the legacy
        // `source` upload lists more containers. Unverified for MOV → warning.
        mimeTypes: ['video/mp4'],
        // Historical Video API guide: resumable uploads up to 10GB and 4 hours. The current docs
        // state no limit, so these are unverified.
        maxBytes: 10 * 1000 * MB,
        maxBytesLabel: '10 GB',
        maxDurationSec: 4 * 3600,
        // Video API reference: "Aspect Ratio: 9x16, 16x9".
        minAspectRatio: 9 / 16,
        minAspectRatioLabel: '9:16',
        maxAspectRatio: 16 / 9,
        maxAspectRatioLabel: '16:9',
      },
      carouselVideo: null,
    },
    // Page Photos `alt_text_custom` (set at upload; photos can't be updated later).
    altText: { supported: true, maxChars: null },
    unverified: [
      'caption.maxChars',
      'firstComment.maxChars',
      'media.allowMixed',
      'media.maxVideos',
      'media.video.mimeTypes',
      'media.video.maxBytes',
      'media.video.maxDurationSec',
      'media.video.minAspectRatio',
      'media.video.maxAspectRatio',
    ],
  },

  [SOCIAL_PLATFORMS.INSTAGRAM_ACCOUNT]: {
    platform: SOCIAL_PLATFORMS.INSTAGRAM_ACCOUNT,
    label: 'Instagram',
    caption: {
      // IG User Media reference: "Maximum 2200 characters, 30 hashtags, and 20 @ tags."
      maxChars: 2200,
      maxHashtags: 30,
      maxMentions: 20,
      // Instagram Help Center: "You can use up to 5 tags on a post." The API reference above
      // still says 30, so more than 5 is a warning rather than an error.
      advisoryMaxHashtags: 5,
      advisoryNote: 'Instagram Help Center',
    },
    firstComment: {
      // POST /{ig-media-id}/comments documents no length limit; 2,200 is the industry figure.
      maxChars: 2200,
      // Instagram Help Center: comments with more than 5 hashtags or 5 @mentions won't post.
      maxHashtags: 5,
      maxMentions: 5,
      permissions: {
        FACEBOOK_LOGIN: [
          'instagram_basic',
          'instagram_manage_comments',
          'pages_read_engagement',
          'pages_show_list',
        ],
        INSTAGRAM_LOGIN: ['instagram_business_basic', 'instagram_business_manage_comments'],
        INSTAGRAM_UNIFIED_LOGIN: ['instagram_basic', 'instagram_manage_comments'],
      },
      pageTask: 'PROFILE_PLUS_MODERATE',
      editable: false,
      note: 'Posted from the same account right after the post is published, once publishing is available. It needs a comment permission that SocialHub does not request yet. Instagram comments cannot be edited afterwards.',
    },
    media: {
      // Instagram has no text-only posts.
      required: true,
      // Content publishing guide: "Carousels are limited to 20 images, videos, or a mix of the two."
      maxItems: 20,
      allowMixed: true,
      maxVideos: null,
      image: {
        mimeTypes: ['image/jpeg'],
        maxBytes: 8 * MB,
        maxBytesLabel: '8 MB',
        minAspectRatio: 4 / 5,
        minAspectRatioLabel: '4:5',
        maxAspectRatio: 1.91,
        maxAspectRatioLabel: '1.91:1',
        // Narrower images are scaled up (not rejected); wider than 1440 px are scaled down.
        minWidth: 320,
      },
      // A single video is published as a Reel.
      video: {
        mimeTypes: ['video/mp4', 'video/quicktime'],
        maxBytes: 300 * MB,
        maxBytesLabel: '300 MB',
        minDurationSec: 3,
        maxDurationSec: 15 * 60,
        minAspectRatio: 0.01,
        minAspectRatioLabel: '0.01:1',
        maxAspectRatio: 10,
        maxAspectRatioLabel: '10:1',
        recommendedAspectRatio: 9 / 16,
        recommendedAspectRatioLabel: '9:16',
      },
      // Videos inside a carousel: Meta's current docs publish no limits. These are the legacy
      // feed-video values, so they are unverified (warnings only).
      carouselVideo: {
        maxBytes: 100 * MB,
        maxBytesLabel: '100 MB',
        minDurationSec: 3,
        maxDurationSec: 60,
        minAspectRatio: 4 / 5,
        minAspectRatioLabel: '4:5',
        maxAspectRatio: 16 / 9,
        maxAspectRatioLabel: '16:9',
        recommendedAspectRatio: null,
      },
      /** Carousel images are cropped to the first item's aspect ratio (default 1:1). */
      carouselCropsToFirst: true,
    },
    // IG User Media `alt_text`: "Alternative text, up to 1000 character, for an image." Images only.
    altText: { supported: true, maxChars: 1000 },
    unverified: [
      'firstComment.maxChars',
      'firstComment.maxHashtags',
      'firstComment.maxMentions',
      'media.carouselVideo.mimeTypes',
      'media.carouselVideo.maxBytes',
      'media.carouselVideo.minDurationSec',
      'media.carouselVideo.maxDurationSec',
      'media.carouselVideo.minAspectRatio',
      'media.carouselVideo.maxAspectRatio',
    ],
  },
});

export const platformLabel = (platform) => PLATFORM_RULES[platform]?.label ?? platform;
