import { SOCIAL_PLATFORMS } from '@socialhub/shared';
import { Film, ImageIcon, Play } from 'lucide-react';
import { useState } from 'react';
import { cn } from '../../../../lib/utils.js';
import { MEDIA_KINDS } from '../../model/composerState.js';

/**
 * Building blocks shared by the Facebook and Instagram post previews:
 *  - PreviewText:  caption / comment text with highlighted hashtags, @mentions and links, and the
 *                  platform's "See more" / "more" truncation.
 *  - PreviewMedia: one photo, or a video's first frame, with fallbacks when it can't be shown.
 *  - MediaSummary: a screen-reader summary of the attached media.
 *
 * Everything here approximates how Facebook and Instagram display a post. Nothing in it implies
 * the post exists on either platform.
 */

const FACEBOOK = SOCIAL_PLATFORMS.FACEBOOK_PAGE;
const INSTAGRAM = SOCIAL_PLATFORMS.INSTAGRAM_ACCOUNT;

/** Approximate feed truncation: Facebook ≈ 480 characters or 5 lines, Instagram ≈ 125 or 2. */
const COLLAPSE_DEFAULTS = {
  [FACEBOOK]: { chars: 480, lines: 5 },
  [INSTAGRAM]: { chars: 125, lines: 2 },
};

/** How far back (in characters) a cut may move to end on a whole word. */
const WORD_BACKOFF = 30;

const HIGHLIGHT_CLASSES = {
  [FACEBOOK]: 'text-[#1877F2] dark:text-[#4599FF]',
  [INSTAGRAM]: 'text-[#00376B] dark:text-[#E0F1FF]',
};

const TOGGLE_CLASSES = {
  [FACEBOOK]: 'rounded-sm font-semibold text-[#65676B] hover:underline dark:text-[#B0B3B8]',
  [INSTAGRAM]: 'rounded-sm text-[#737373] hover:text-[#525252] dark:text-[#A8A8A8]',
};

const TOGGLE_LABELS = {
  [FACEBOOK]: { more: 'See more', less: 'See less' },
  [INSTAGRAM]: { more: 'more', less: 'less' },
};

/*
 * Links first (so a "#" or "@" inside a URL is not a tag), then hashtags and @mentions. The
 * hashtag and mention patterns mirror model/text.js (extractHashtags / extractMentions), so what
 * the preview highlights is what the character and hashtag counters count.
 */
const TOKEN_PATTERN =
  /(?<url>\b(?:https?:\/\/|www\.)[^\s<>"]+)|(?<hashtag>(?<![\p{L}\p{M}\p{N}_/&#=?])#[\p{L}\p{M}\p{N}_]+)|(?<mention>(?<![\p{L}\p{M}\p{N}_.@])@[A-Za-z0-9_](?:[A-Za-z0-9._]{0,28}[A-Za-z0-9_])?)/giu;

const LINK_PREFIX_ONLY = /^(?:https?:\/\/|www\.)$/i;
const TRAILING_PUNCTUATION = new Set(['.', ',', ';', ':', '!', '?', "'", '"', '’', '”', '»', '…']);
const CLOSING_BRACKETS = { ')': '(', ']': '[', '}': '{' };

const countOf = (text, char) => text.split(char).length - 1;

/** Drops punctuation that ends the sentence rather than the link ("see https://acme.com."). */
function trimLink(raw) {
  let end = raw.length;
  while (end > 0) {
    const char = raw[end - 1];
    const opening = CLOSING_BRACKETS[char];
    const head = raw.slice(0, end);
    const unbalanced = Boolean(opening) && countOf(head, opening) < countOf(head, char);
    if (!TRAILING_PUNCTUATION.has(char) && !unbalanced) break;
    end -= 1;
  }
  return raw.slice(0, end);
}

/** Splits text into `{ type: 'text' | 'url' | 'hashtag' | 'mention', value }` tokens. */
function tokenize(text) {
  const tokens = [];
  const pushText = (value) => {
    if (!value) return;
    const last = tokens.at(-1);
    if (last?.type === 'text') last.value += value;
    else tokens.push({ type: 'text', value });
  };
  let cursor = 0;
  for (const match of text.matchAll(TOKEN_PATTERN)) {
    pushText(text.slice(cursor, match.index));
    const type = match.groups.url ? 'url' : match.groups.hashtag ? 'hashtag' : 'mention';
    let value = match[0];
    if (type === 'url') value = trimLink(value);
    // Instagram usernames never end with a period: "@acme." mentions "acme".
    if (type === 'mention') value = value.replace(/\.+$/u, '');
    const meaningful = type === 'url' ? !LINK_PREFIX_ONLY.test(value) : value.length > 1;
    if (meaningful) tokens.push({ type, value });
    else pushText(value);
    pushText(match[0].slice(value.length));
    cursor = match.index + match[0].length;
  }
  pushText(text.slice(cursor));
  return tokens;
}

function renderTokens(text, platform) {
  const highlight = HIGHLIGHT_CLASSES[platform] ?? HIGHLIGHT_CLASSES[FACEBOOK];
  return tokenize(text).map((token, index) => {
    // Instagram doesn't turn links in captions into links, so they stay plain text there.
    if (token.type === 'text' || (token.type === 'url' && platform === INSTAGRAM)) {
      return token.value;
    }
    return (
      <span key={index} data-token={token.type} className={highlight}>
        {token.value}
      </span>
    );
  });
}

const SEGMENTER =
  typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null;

/** User-perceived characters, so a cut never splits an emoji (code points as a fallback). */
function* graphemes(text) {
  if (!SEGMENTER) {
    yield* text;
    return;
  }
  for (const { segment } of SEGMENTER.segment(text)) yield segment;
}

const isSpace = (value) => /^\s+$/u.test(value);

/**
 * The visible start of `text` when it is longer than `maxChars` characters or `maxLines` lines,
 * ending on a whole word where possible. Returns null when the text fits.
 */
function collapseText(text, maxChars, maxLines) {
  const charLimit = maxChars > 0 ? maxChars : Infinity;
  const lineLimit = maxLines > 0 ? maxLines : Infinity;
  if (charLimit === Infinity && lineLimit === Infinity) return null;

  const kept = [];
  let lines = 1;
  let next = null;
  for (const grapheme of graphemes(text)) {
    const newline = grapheme.includes('\n');
    if (kept.length >= charLimit || (newline && lines >= lineLimit)) {
      next = grapheme;
      break;
    }
    if (newline) lines += 1;
    kept.push(grapheme);
  }
  if (next === null) return null;

  let end = kept.length;
  if (!isSpace(next)) {
    let start = end;
    while (start > 0 && end - start < WORD_BACKOFF && !isSpace(kept[start - 1])) start -= 1;
    if (start > 0 && isSpace(kept[start - 1])) end = start;
  }
  // The toggle adds its own "…", so a trailing "." or "…" would read as "word.… See more".
  return kept
    .slice(0, end)
    .join('')
    .replace(/[\s.…]+$/u, '');
}

/**
 * Post text as Facebook or Instagram would show it: line breaks kept, hashtags / @mentions (and,
 * on Facebook, links) highlighted, and long text collapsed behind "See more" (Facebook) or
 * "more" (Instagram). Text is split into React nodes; it is never injected as HTML.
 *
 * `collapsedChars` / `collapsedLines` default to the platform's typical feed truncation; pass
 * `null` to never collapse. `subject` ("caption", "comment") completes the toggle's accessible
 * name ("See more of the caption") when several toggles can be on screen.
 */
export function PreviewText({
  text,
  platform = FACEBOOK,
  collapsedChars,
  collapsedLines,
  subject,
  className,
}) {
  const [expanded, setExpanded] = useState(false);
  const value = typeof text === 'string' ? text : '';
  if (!value) return null;

  const defaults = COLLAPSE_DEFAULTS[platform] ?? COLLAPSE_DEFAULTS[FACEBOOK];
  const collapsed = collapseText(
    value,
    collapsedChars === undefined ? defaults.chars : collapsedChars,
    collapsedLines === undefined ? defaults.lines : collapsedLines,
  );
  const collapsible = collapsed !== null;
  const labels = TOGGLE_LABELS[platform] ?? TOGGLE_LABELS[FACEBOOK];
  const label = expanded ? labels.less : labels.more;

  return (
    <span className={cn('whitespace-pre-wrap break-words', className)}>
      {renderTokens(collapsible && !expanded ? collapsed : value, platform)}
      {collapsible && (
        <>
          {expanded ? ' ' : '… '}
          <button
            type="button"
            aria-expanded={expanded}
            // Starts with the visible label, so speech input ("click See more") still works.
            aria-label={subject ? `${label} of the ${subject}` : undefined}
            onClick={() => setExpanded((open) => !open)}
            className={TOGGLE_CLASSES[platform] ?? TOGGLE_CLASSES[FACEBOOK]}
          >
            {label}
          </button>
        </>
      )}
    </span>
  );
}

/** What to show when a file has no preview URL, or the browser can't display it. */
function MediaPlaceholder({ item, className }) {
  const Icon = item.kind === MEDIA_KINDS.VIDEO ? Film : ImageIcon;
  return (
    <div
      data-media-placeholder=""
      className={cn(
        'flex flex-col items-center justify-center gap-1.5 bg-slate-200/80 p-3 text-center text-slate-500 dark:bg-white/[0.06] dark:text-slate-400',
        className,
      )}
    >
      <Icon className="h-6 w-6 shrink-0" aria-hidden="true" />
      <span className="w-full truncate text-xs font-medium">{item.fileName}</span>
      <span className="text-[11px] leading-tight opacity-80">No preview available</span>
    </div>
  );
}

function PlayBadge({ size }) {
  const small = size === 'sm';
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 flex items-center justify-center"
    >
      <span
        className={cn(
          'flex items-center justify-center rounded-full bg-black/55 text-white shadow-lg ring-1 ring-white/25 backdrop-blur-[2px]',
          small ? 'h-9 w-9' : 'h-12 w-12',
        )}
      >
        <Play className={cn('translate-x-px fill-current', small ? 'h-4 w-4' : 'h-5 w-5')} />
      </span>
    </span>
  );
}

/** Fallback order: a video's own frame → the preview URL as an image (a poster) → placeholder. */
const FALLBACK = Object.freeze({ PRIMARY: 0, IMAGE: 1, NONE: 2 });

/**
 * One media item for a preview: an `<img>`, or a muted `<video preload="metadata">` showing its
 * first frame with a play badge. Absolutely positioned overlays need a `relative` parent.
 * `fit`: 'cover' (crop to the frame) | 'contain' (letterbox). `playBadge`: 'md' | 'sm' | false.
 */
export function PreviewMedia({ item, fit = 'cover', className, playBadge = 'md' }) {
  const [failure, setFailure] = useState({ url: null, stage: FALLBACK.PRIMARY });
  const url = item.previewUrl;
  // Derived rather than reset in an effect: a new URL starts again from its primary form.
  const stage = url && failure.url === url ? failure.stage : FALLBACK.PRIMARY;
  const isVideo = item.kind === MEDIA_KINDS.VIDEO;
  const mediaClass = cn(fit === 'contain' ? 'object-contain' : 'object-cover', className);
  const failTo = (next) => () => setFailure({ url, stage: next });

  if (!url || stage === FALLBACK.NONE)
    return <MediaPlaceholder item={item} className={className} />;
  const badge = isVideo && playBadge ? <PlayBadge size={playBadge} /> : null;

  if (isVideo && stage === FALLBACK.PRIMARY) {
    return (
      <>
        <video
          src={url}
          muted
          playsInline
          preload="metadata"
          aria-hidden="true"
          className={mediaClass}
          onError={failTo(FALLBACK.IMAGE)}
        />
        {badge}
      </>
    );
  }
  return (
    <>
      <img
        src={url}
        alt={item.altText || ''}
        draggable={false}
        decoding="async"
        className={mediaClass}
        onError={failTo(FALLBACK.NONE)}
      />
      {badge}
    </>
  );
}

const plural = (n, one) => `${n} ${n === 1 ? one : `${one}s`}`;

/** Visually hidden summary of the attached media ("Media: 2 photos and 1 video"). */
export function MediaSummary({ media }) {
  const list = media ?? [];
  if (list.length === 0) return null;
  const videos = list.filter((item) => item.kind === MEDIA_KINDS.VIDEO).length;
  const photos = list.length - videos;
  const parts = [];
  if (photos) parts.push(plural(photos, 'photo'));
  if (videos) parts.push(plural(videos, 'video'));
  return <span className="sr-only">{`Media: ${parts.join(' and ')}`}</span>;
}
