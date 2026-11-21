import {
  COMPOSER_LIMITS,
  HASHTAG_PLACEMENTS as SHARED_HASHTAG_PLACEMENTS,
} from '@socialhub/shared';

/**
 * Pure text rules for the composer: character counting, hashtag / mention / keyword parsing
 * and the caption composition algorithm.
 *
 * `composeCaption` and `composeFirstComment` define exactly what text a destination will
 * receive. The backend publishing engine must apply the same algorithm (see
 * docs/COMPOSER_API_CONTRACT.md → "Caption composition"), so the preview never diverges
 * from what is published.
 */

/**
 * CAPTION: hashtags are appended to the end of the caption.
 * FIRST_COMMENT: they are appended to the first comment instead.
 */
export const HASHTAG_PLACEMENTS = SHARED_HASHTAG_PLACEMENTS;

/**
 * SocialHub's own input limits (not Meta's). They come from packages/shared, where the API
 * enforces the same numbers.
 */
export const TEXT_LIMITS = Object.freeze({
  HASHTAG_MAX_LENGTH: COMPOSER_LIMITS.HASHTAG_MAX_LENGTH,
  HASHTAGS_MAX: COMPOSER_LIMITS.HASHTAGS_MAX,
  KEYWORD_MAX_LENGTH: COMPOSER_LIMITS.KEYWORD_MAX_LENGTH,
  KEYWORDS_MAX: COMPOSER_LIMITS.KEYWORDS_MAX,
});

/**
 * Characters as Unicode code points, so an emoji counts once rather than as two UTF-16
 * units. Meta does not document its counting method; the backend should count the same way.
 */
export function countChars(value) {
  if (!value) return 0;
  let count = 0;
  for (const _codePoint of value) count += 1;
  return count;
}

const HASHTAG_BODY = /^[\p{L}\p{M}\p{N}_]+$/u;
// A "#" that starts a hashtag: not preceded by a word character, "/", "&", "=" or "?" (URL
// paths and queries, HTML entities). components/preview/PreviewText.jsx mirrors this pattern.
const HASHTAG_IN_TEXT = /(?<![\p{L}\p{M}\p{N}_/&#=?])#([\p{L}\p{M}\p{N}_]+)/gu;
// Instagram usernames: up to 30 letters, numbers, periods and underscores, not ending in a
// period (so a sentence's full stop after "@acme." is not part of the name).
const MENTION_IN_TEXT =
  /(?<![\p{L}\p{M}\p{N}_.@])@([A-Za-z0-9_](?:[A-Za-z0-9._]{0,28}[A-Za-z0-9_])?)/gu;
const TAG_SEPARATORS = /[\s,，、;#＃]+/u;

const fold = (value) => value.toLowerCase();

/**
 * Normalizes one hashtag entered by a person. Returns `{ tag }` (without "#") or `{ error }`.
 * An empty input returns `{ tag: null }` so callers can skip it silently.
 */
export function normalizeHashtag(raw) {
  const value = String(raw ?? '')
    .trim()
    .replace(/^[#＃]+/u, '');
  if (!value) return { tag: null };
  if (!HASHTAG_BODY.test(value)) {
    return { error: `#${value} can only contain letters, numbers and underscores.` };
  }
  if (countChars(value) > TEXT_LIMITS.HASHTAG_MAX_LENGTH) {
    return { error: `Hashtags can be at most ${TEXT_LIMITS.HASHTAG_MAX_LENGTH} characters.` };
  }
  return { tag: value };
}

/** Normalizes one internal SEO keyword (phrases with spaces are allowed). */
export function normalizeKeyword(raw) {
  const value = String(raw ?? '')
    .replace(/\s+/gu, ' ')
    .trim();
  if (!value) return { keyword: null };
  if (countChars(value) > TEXT_LIMITS.KEYWORD_MAX_LENGTH) {
    return { error: `Keywords can be at most ${TEXT_LIMITS.KEYWORD_MAX_LENGTH} characters.` };
  }
  return { keyword: value };
}

/**
 * Splits pasted or typed hashtag text ("#summer #sale, deals") into normalized tags.
 * Returns `{ tags, errors }`; tags are de-duplicated case-insensitively in input order.
 */
export function parseHashtagInput(text) {
  const tags = [];
  const errors = [];
  const seen = new Set();
  for (const part of String(text ?? '').split(TAG_SEPARATORS)) {
    const { tag, error } = normalizeHashtag(part);
    if (error) errors.push(error);
    if (!tag || seen.has(fold(tag))) continue;
    seen.add(fold(tag));
    tags.push(tag);
  }
  return { tags, errors };
}

/** Splits keyword input on commas, semicolons and new lines (not spaces: keywords are phrases). */
export function parseKeywordInput(text) {
  const keywords = [];
  const errors = [];
  const seen = new Set();
  for (const part of String(text ?? '').split(/[,;\n，、]+/u)) {
    const { keyword, error } = normalizeKeyword(part);
    if (error) errors.push(error);
    if (!keyword || seen.has(fold(keyword))) continue;
    seen.add(fold(keyword));
    keywords.push(keyword);
  }
  return { keywords, errors };
}

/** Appends `additions` to `list`, skipping case-insensitive duplicates, up to `max` items. */
export function mergeUnique(list, additions, max = Infinity) {
  const seen = new Set(list.map(fold));
  const out = [...list];
  for (const item of additions) {
    if (out.length >= max) break;
    if (seen.has(fold(item))) continue;
    seen.add(fold(item));
    out.push(item);
  }
  return out;
}

export function removeItem(list, item) {
  return list.filter((entry) => fold(entry) !== fold(item));
}

/** Hashtags written inside free text, without "#", in order of appearance (may repeat). */
export function extractHashtags(text) {
  return [...String(text ?? '').matchAll(HASHTAG_IN_TEXT)].map((m) => m[1]);
}

/** @mentions written inside free text, without "@", in order of appearance (may repeat). */
export function extractMentions(text) {
  return [...String(text ?? '').matchAll(MENTION_IN_TEXT)].map((m) => m[1]);
}

/** Distinct values, compared case-insensitively. */
export function uniqueFolded(values) {
  const seen = new Set();
  return values.filter((v) => {
    const key = fold(v);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function appendTags(body, hashtags) {
  const text = String(body ?? '').trim();
  const present = new Set(extractHashtags(text).map(fold));
  const extra = hashtags.filter((tag) => !present.has(fold(tag)));
  if (extra.length === 0) return text;
  const line = extra.map((tag) => `#${tag}`).join(' ');
  return text ? `${text}\n\n${line}` : line;
}

/**
 * The caption a destination receives: the (trimmed) caption text, followed by a blank line
 * and the hashtags that are not already written in the caption — only when the placement is
 * CAPTION.
 */
export function composeCaption({ caption, hashtags = [], hashtagPlacement }) {
  if (hashtagPlacement === HASHTAG_PLACEMENTS.CAPTION) return appendTags(caption, hashtags);
  return String(caption ?? '').trim();
}

/** The first comment a destination receives (hashtags are appended for FIRST_COMMENT placement). */
export function composeFirstComment({ firstComment, hashtags = [], hashtagPlacement }) {
  if (hashtagPlacement === HASHTAG_PLACEMENTS.FIRST_COMMENT) {
    return appendTags(firstComment, hashtags);
  }
  return String(firstComment ?? '').trim();
}

/** First non-empty line of a caption, shortened — used as a draft title. */
export function summarize(text, max = 60) {
  const line =
    String(text ?? '')
      .split('\n')
      .map((l) => l.trim())
      .find(Boolean) ?? '';
  if (countChars(line) <= max) return line;
  return `${[...line].slice(0, max - 1).join('')}…`;
}
