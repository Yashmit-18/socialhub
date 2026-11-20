import { SOCIAL_PLATFORMS } from '@socialhub/shared';
import { PLATFORM_RULES } from '../constants/platformRules.js';
import { accountBlocker } from './accounts.js';
import { INSPECTION_STATUS, MEDIA_KINDS, captionForPlatform } from './composerState.js';
import { aspectRatio, formatBytes, formatDuration, formatLabel } from './media.js';
import {
  HASHTAG_PLACEMENTS,
  composeCaption,
  composeFirstComment,
  countChars,
  extractHashtags,
  extractMentions,
} from './text.js';

/**
 * Pure readiness check for the composer.
 *
 * Severity:
 *  - error:   the destination would reject the post, or there is nothing to post. Errors never
 *             block saving drafts. They would block publishing once it exists.
 *  - warning: a likely problem, a limit SocialHub could not verify in Meta's API docs
 *             (`rules.unverified`), or an advisory limit from Meta's Help Center that the API
 *             reference does not state.
 *  - info:    a suggestion (alt text, recommended formats).
 *
 * Issue: { id, severity, scope: 'global'|'platform'|'account'|'media', field?, platform?,
 *          accountId?, mediaId?, message }
 */

export const SEVERITY = Object.freeze({ ERROR: 'error', WARNING: 'warning', INFO: 'info' });

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const num = (n) => n.toLocaleString('en-US');

/**
 * "{size}" for a file next to a limit, precise enough that the two never read the same
 * ("8.04 MB is over the 8 MB limit", not "8 MB is over the 8 MB limit").
 */
function sizeAgainst(bytes, limitText) {
  const rounded = formatBytes(bytes);
  if (rounded !== limitText) return rounded;
  const precise = formatBytes(bytes, { precise: true });
  return precise !== limitText ? precise : `${num(bytes)} bytes`;
}

/** Like sizeAgainst for durations: adds tenths of a second when whole seconds would collide. */
function durationAgainst(seconds, limitSeconds) {
  const rounded = formatDuration(seconds);
  if (rounded !== formatDuration(limitSeconds)) return rounded;
  const whole = Math.trunc(seconds);
  const tenths = Math.round((seconds - whole) * 10);
  const m = Math.floor(whole / 60);
  const s = whole % 60;
  return `${m}:${String(s).padStart(2, '0')}.${Math.min(tenths, 9)}`;
}

export const UNVERIFIED_NOTE = "(Not confirmed in Meta's documentation.)";

/**
 * Severity for a platform limit: error when Meta's docs confirm it, warning when they don't
 * (`rules.unverified`). Unverified issues carry `unverified: true` and say so in their message.
 */
function limit(rules, key) {
  const unverified = Boolean(rules.unverified?.includes(key));
  return { severity: unverified ? SEVERITY.WARNING : SEVERITY.ERROR, ruleKey: key, unverified };
}

const finalize = (issue) =>
  issue.unverified ? { ...issue, message: `${issue.message} ${UNVERIFIED_NOTE}` } : issue;

/**
 * The text a platform would receive (caption + first comment) and its counts. Hashtags and
 * mentions are counted per occurrence: Meta does not say how repeats count, and counting
 * each one is the conservative reading.
 */
export function platformOutput(state, platform) {
  const caption = composeCaption({
    caption: captionForPlatform(state, platform),
    hashtags: state.hashtags,
    hashtagPlacement: state.hashtagPlacement,
  });
  const firstComment = composeFirstComment({
    firstComment: state.firstComment,
    hashtags: state.hashtags,
    hashtagPlacement: state.hashtagPlacement,
  });
  return {
    caption,
    firstComment,
    captionLength: countChars(caption),
    firstCommentLength: countChars(firstComment),
    captionHashtags: extractHashtags(caption).length,
    captionMentions: extractMentions(caption).length,
    firstCommentHashtags: extractHashtags(firstComment).length,
    firstCommentMentions: extractMentions(firstComment).length,
  };
}

function textIssues(state, platform, rules, push) {
  const out = platformOutput(state, platform);
  const label = rules.label;
  const field = state.platformCaptions[platform] === null ? 'caption' : 'platformCaption';
  const tagsAppended =
    state.hashtags.length > 0 && state.hashtagPlacement === HASHTAG_PLACEMENTS.CAPTION;
  const add = (key, issue) =>
    push({ id: `${platform}:${key}`, scope: 'platform', platform, ...issue });

  const { caption, firstComment } = rules;
  if (caption.maxChars && out.captionLength > caption.maxChars) {
    add('caption-length', {
      ...limit(rules, 'caption.maxChars'),
      field,
      message: `${label} captions can be up to ${num(caption.maxChars)} characters. This one is ${num(
        out.captionLength,
      )}${tagsAppended ? ' including hashtags' : ''}.`,
    });
  }
  if (caption.maxHashtags && out.captionHashtags > caption.maxHashtags) {
    add('caption-hashtags', {
      ...limit(rules, 'caption.maxHashtags'),
      field: 'hashtags',
      message: `${label} allows up to ${caption.maxHashtags} hashtags in a caption. This caption has ${out.captionHashtags}.`,
    });
  } else if (caption.advisoryMaxHashtags && out.captionHashtags > caption.advisoryMaxHashtags) {
    add('caption-hashtags-advisory', {
      severity: SEVERITY.WARNING,
      field: 'hashtags',
      message: `${label} now says posts can use up to ${caption.advisoryMaxHashtags} hashtags${
        caption.advisoryNote ? ` (${caption.advisoryNote})` : ''
      }. This caption has ${out.captionHashtags}, so some may not work.`,
    });
  }
  if (caption.maxMentions && out.captionMentions > caption.maxMentions) {
    add('caption-mentions', {
      ...limit(rules, 'caption.maxMentions'),
      field,
      message: `${label} allows up to ${caption.maxMentions} @mentions in a caption. This caption has ${out.captionMentions}.`,
    });
  }

  if (out.firstCommentLength === 0) return;
  if (firstComment.maxChars && out.firstCommentLength > firstComment.maxChars) {
    add('comment-length', {
      ...limit(rules, 'firstComment.maxChars'),
      field: 'firstComment',
      message: `${label} comments can be up to ${num(firstComment.maxChars)} characters. The first comment is ${num(
        out.firstCommentLength,
      )}.`,
    });
  }
  if (firstComment.maxHashtags && out.firstCommentHashtags > firstComment.maxHashtags) {
    add('comment-hashtags', {
      ...limit(rules, 'firstComment.maxHashtags'),
      field: 'firstComment',
      message: `${label} comments with more than ${firstComment.maxHashtags} hashtags may not post. The first comment has ${out.firstCommentHashtags}.`,
    });
  }
  if (firstComment.maxMentions && out.firstCommentMentions > firstComment.maxMentions) {
    add('comment-mentions', {
      ...limit(rules, 'firstComment.maxMentions'),
      field: 'firstComment',
      message: `${label} comments with more than ${firstComment.maxMentions} @mentions may not post. The first comment has ${out.firstCommentMentions}.`,
    });
  }
}

function itemSpec(item, rules, inCarousel) {
  const m = rules.media;
  if (item.kind === MEDIA_KINDS.IMAGE) return { spec: m.image, base: 'media.image' };
  if (inCarousel && m.carouselVideo) {
    return { spec: { ...m.video, ...m.carouselVideo }, base: 'media.carouselVideo' };
  }
  return { spec: m.video, base: 'media.video' };
}

function mediaItemIssues(item, platform, rules, inCarousel, push) {
  const label = rules.label;
  const { spec, base } = itemSpec(item, rules, inCarousel);
  if (!spec) return;
  const where = `${item.fileName} (${label})`;
  const add = (key, message, severity) =>
    push({
      id: `${platform}:${item.id}:${key}`,
      ...(severity ? { severity } : limit(rules, `${base}.${key}`)),
      scope: 'media',
      field: 'media',
      platform,
      mediaId: item.id,
      message,
    });
  const isVideo = item.kind === MEDIA_KINDS.VIDEO;

  if (spec.mimeTypes && !spec.mimeTypes.includes(item.mimeType)) {
    add(
      'mimeTypes',
      `${where}: ${label} accepts ${spec.mimeTypes.map(formatLabel).join(' or ')} ${
        isVideo ? 'videos' : 'images'
      }, not ${formatLabel(item.mimeType)}.`,
    );
  }
  if (spec.maxBytes && item.sizeBytes > spec.maxBytes) {
    add(
      'maxBytes',
      `${where}: ${sizeAgainst(item.sizeBytes, spec.maxBytesLabel ?? formatBytes(spec.maxBytes))} is over the ${
        spec.maxBytesLabel ?? formatBytes(spec.maxBytes)
      } limit${isVideo && inCarousel && rules.media.carouselVideo ? ' for videos in a carousel' : ''}.`,
    );
  } else if (
    spec.recommendedMaxBytesByType?.[item.mimeType] &&
    item.sizeBytes > spec.recommendedMaxBytesByType[item.mimeType]
  ) {
    add(
      'recommendedMaxBytes',
      `${where}: ${label} recommends ${formatLabel(item.mimeType)} files under ${
        spec.recommendedMaxBytesLabel ?? formatBytes(spec.recommendedMaxBytesByType[item.mimeType])
      }, or the image may look pixelated.`,
      SEVERITY.INFO,
    );
  }
  if (spec.staticOnlyMimeTypes?.includes(item.mimeType)) {
    add(
      'staticOnly',
      `${where}: ${label} publishes ${formatLabel(item.mimeType)} files as still images. Animation isn't supported.`,
      SEVERITY.INFO,
    );
  }
  if (item.inspection === INSPECTION_STATUS.FAILED) {
    add(
      'inspection',
      `${where}: SocialHub couldn't read this file's ${
        isVideo ? 'length and dimensions' : 'dimensions'
      } in this browser, so ${label}'s limits can't be checked.`,
      SEVERITY.WARNING,
    );
    return;
  }
  if (item.inspection !== INSPECTION_STATUS.DONE) return;

  const ratio = aspectRatio(item.width, item.height);
  if (ratio && spec.minAspectRatio && ratio < spec.minAspectRatio - 0.005) {
    add(
      'minAspectRatio',
      `${where}: too tall for ${label}. The aspect ratio must be at least ${
        spec.minAspectRatioLabel ?? spec.minAspectRatio
      }.`,
    );
  }
  if (ratio && spec.maxAspectRatio && ratio > spec.maxAspectRatio + 0.005) {
    add(
      'maxAspectRatio',
      `${where}: too wide for ${label}. The aspect ratio must be at most ${
        spec.maxAspectRatioLabel ?? spec.maxAspectRatio
      }.`,
    );
  }
  if (spec.minWidth && item.width && item.width < spec.minWidth) {
    add(
      'minWidth',
      `${where}: ${label} scales images narrower than ${spec.minWidth} px up, which can look blurry.`,
      SEVERITY.INFO,
    );
  }
  if (
    isVideo &&
    !inCarousel &&
    ratio &&
    spec.recommendedAspectRatio &&
    Math.abs(ratio - spec.recommendedAspectRatio) / spec.recommendedAspectRatio > 0.02
  ) {
    add(
      'recommendedAspectRatio',
      `${where}: ${label} recommends ${spec.recommendedAspectRatioLabel} videos to avoid cropping or blank space.`,
      SEVERITY.INFO,
    );
  }
  if (isVideo && Number.isFinite(item.durationSec)) {
    if (spec.minDurationSec && item.durationSec < spec.minDurationSec) {
      add(
        'minDurationSec',
        `${where}: ${durationAgainst(item.durationSec, spec.minDurationSec)} is shorter than the ${formatDuration(
          spec.minDurationSec,
        )} minimum.`,
      );
    }
    if (spec.maxDurationSec && item.durationSec > spec.maxDurationSec) {
      add(
        'maxDurationSec',
        `${where}: ${durationAgainst(item.durationSec, spec.maxDurationSec)} is longer than the ${formatDuration(
          spec.maxDurationSec,
        )} limit${inCarousel && rules.media.carouselVideo ? ' for videos in a carousel' : ''}.`,
      );
    }
  }
}

function mediaIssues(state, platform, rules, push) {
  const { media } = state;
  const label = rules.label;
  const m = rules.media;
  const images = media.filter((item) => item.kind === MEDIA_KINDS.IMAGE);
  const videos = media.filter((item) => item.kind === MEDIA_KINDS.VIDEO);
  const add = (key, issue) =>
    push({ id: `${platform}:${key}`, scope: 'platform', field: 'media', platform, ...issue });

  if (media.length === 0) {
    if (m.required) {
      add('media-required', {
        severity: SEVERITY.ERROR,
        message: `${label} posts need at least one photo or video.`,
      });
    } else if (!platformOutput(state, platform).caption) {
      add('empty', {
        severity: SEVERITY.ERROR,
        field: 'caption',
        message: `Add a caption or a photo or video for ${label}.`,
      });
    }
    return;
  }

  if (m.maxItems && media.length > m.maxItems) {
    add('media-count', {
      ...limit(rules, 'media.maxItems'),
      message: `${label} posts can include up to ${plural(m.maxItems, 'file')}. This post has ${media.length}.`,
    });
  }
  if (!m.allowMixed && images.length > 0 && videos.length > 0) {
    add('media-mixed', {
      ...limit(rules, 'media.allowMixed'),
      message: `${label} posts can include photos or a video, not both.`,
    });
  }
  if (m.maxVideos !== null && m.maxVideos !== undefined && videos.length > m.maxVideos) {
    add('video-count', {
      ...limit(rules, 'media.maxVideos'),
      message: `${label} posts can include ${plural(m.maxVideos, 'video')}. This post has ${videos.length}.`,
    });
  }

  const inCarousel = media.length > 1;
  for (const item of media) mediaItemIssues(item, platform, rules, inCarousel, push);
}

/**
 * Validates the composer for the selected accounts.
 * `accounts` is the normalized list of accounts available to the person (model/accounts.js).
 * Pass `{ accountsReady: false }` while that list is still loading, so selected ids are not
 * reported as "no longer available" before the accounts arrive.
 * Returns { issues, errors, warnings, infos, byPlatform, byAccount, selected, missingAccountIds,
 *           platforms, isReady }.
 */
export function validateComposer(
  state,
  accounts,
  rulesByPlatform = PLATFORM_RULES,
  { accountsReady = true } = {},
) {
  const issues = [];
  const push = (issue) => issues.push(finalize(issue));
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const selected = state.selectedAccountIds.map((id) => byId.get(id)).filter(Boolean);
  const missingAccountIds = accountsReady
    ? state.selectedAccountIds.filter((id) => !byId.has(id))
    : [];
  const platforms = [SOCIAL_PLATFORMS.FACEBOOK_PAGE, SOCIAL_PLATFORMS.INSTAGRAM_ACCOUNT].filter(
    (p) => selected.some((a) => a.platform === p),
  );

  if (selected.length === 0 && (accountsReady || state.selectedAccountIds.length === 0)) {
    push({
      id: 'accounts-required',
      severity: SEVERITY.ERROR,
      scope: 'global',
      field: 'accounts',
      message: 'Choose at least one account to post to.',
    });
  }
  if (missingAccountIds.length > 0) {
    push({
      id: 'accounts-missing',
      severity: SEVERITY.WARNING,
      scope: 'global',
      field: 'accounts',
      message: `${plural(missingAccountIds.length, 'selected account')} ${
        missingAccountIds.length === 1 ? 'is' : 'are'
      } no longer available to you and will be left out.`,
    });
  }
  if (!state.caption.trim() && state.media.length === 0 && platforms.length === 0) {
    push({
      id: 'content-required',
      severity: SEVERITY.ERROR,
      scope: 'global',
      field: 'caption',
      message: 'Write a caption or add a photo or video.',
    });
  }

  for (const account of selected) {
    const blocker = accountBlocker(account);
    if (blocker) {
      push({
        id: `account:${account.id}`,
        severity: SEVERITY.ERROR,
        scope: 'account',
        field: 'accounts',
        platform: account.platform,
        accountId: account.id,
        message: `${account.name}: ${blocker}`,
      });
    }
  }

  for (const platform of platforms) {
    const rules = rulesByPlatform[platform];
    if (!rules) continue;
    textIssues(state, platform, rules, push);
    mediaIssues(state, platform, rules, push);
  }

  const images = state.media.filter((m) => m.kind === MEDIA_KINDS.IMAGE);
  const missingAlt = images.filter((m) => !m.altText.trim());
  if (missingAlt.length > 0) {
    push({
      id: 'alt-text',
      severity: SEVERITY.INFO,
      scope: 'global',
      field: 'altText',
      message: `Add alt text to ${plural(missingAlt.length, 'image')} so people using screen readers know what ${
        missingAlt.length === 1 ? 'it shows' : 'they show'
      }.`,
    });
  }

  const errors = issues.filter((i) => i.severity === SEVERITY.ERROR);
  const warnings = issues.filter((i) => i.severity === SEVERITY.WARNING);
  const infos = issues.filter((i) => i.severity === SEVERITY.INFO);
  const byPlatform = {};
  for (const platform of platforms) {
    byPlatform[platform] = issues.filter((i) => i.platform === platform && !i.accountId);
  }
  const byAccount = {};
  for (const account of selected) {
    byAccount[account.id] = issues.filter(
      (i) => i.accountId === account.id || (i.platform === account.platform && !i.accountId),
    );
  }

  return {
    issues,
    errors,
    warnings,
    infos,
    byPlatform,
    byAccount,
    selected,
    missingAccountIds,
    platforms,
    isReady: errors.length === 0,
  };
}
