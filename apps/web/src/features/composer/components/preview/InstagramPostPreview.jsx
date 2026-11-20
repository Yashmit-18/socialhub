import { SOCIAL_PLATFORMS } from '@socialhub/shared';
import {
  Bookmark,
  ChevronLeft,
  ChevronRight,
  Ellipsis,
  Heart,
  ImagePlus,
  MessageCircle,
  Send,
} from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { cn } from '../../../../lib/utils.js';
import { PLATFORM_RULES } from '../../constants/platformRules.js';
import { displayHandle } from '../../model/accounts.js';
import { MEDIA_KINDS } from '../../model/composerState.js';
import { aspectRatio } from '../../model/media.js';
import { AccountAvatar } from '../shared/AccountAvatar.jsx';
import { MediaSummary, PreviewMedia, PreviewText } from './PreviewText.jsx';

const INSTAGRAM = SOCIAL_PLATFORMS.INSTAGRAM_ACCOUNT;
const IMAGE_RULES = PLATFORM_RULES[INSTAGRAM].media.image;

/** Stands in for an Instagram account when no account is chosen yet. */
const SAMPLE_ACCOUNT = Object.freeze({
  id: 'sample-instagram-account',
  platform: INSTAGRAM,
  name: 'your_account',
  username: 'your_account',
  pictureUrl: null,
});

const SECONDARY_TEXT = 'text-[#737373] dark:text-[#A8A8A8]';
const SWIPE_THRESHOLD_PX = 40;

const ratioValue = (ratio) => `${Number(ratio.toFixed(4))} / 1`;

/**
 * Instagram shows every slide in the first item's shape (1:1 when unknown), kept within the
 * feed's image range (4:5 … 1.91:1 in PLATFORM_RULES).
 */
function feedRatio(first) {
  const ratio = aspectRatio(first?.width, first?.height) ?? 1;
  return Math.min(IMAGE_RULES.maxAspectRatio, Math.max(IMAGE_RULES.minAspectRatio, ratio));
}

function CarouselButton({ direction, disabled, onClick }) {
  const previous = direction === 'previous';
  const Icon = previous ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      aria-label={previous ? 'Previous slide' : 'Next slide'}
      // aria-disabled (not disabled) keeps keyboard focus in place at either end.
      aria-disabled={disabled || undefined}
      onClick={disabled ? undefined : onClick}
      className={cn(
        'absolute top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-slate-900 shadow-md transition hover:bg-white',
        'aria-disabled:cursor-default aria-disabled:opacity-0 focus-visible:aria-disabled:opacity-50',
        previous ? 'left-2' : 'right-2',
      )}
    >
      <Icon className="h-4 w-4" strokeWidth={2.5} aria-hidden="true" />
    </button>
  );
}

function InstagramMedia({ media, current, onChange }) {
  const pointerStart = useRef(null);
  const count = media.length;
  const [first] = media;

  // A single video is shown like a Reel: full 9:16 frame, letterboxed rather than cropped.
  if (count === 1 && first.kind === MEDIA_KINDS.VIDEO) {
    return (
      <div className="bg-black">
        <div
          data-preview-frame=""
          className="relative mx-auto w-full max-w-[315px] overflow-hidden"
          style={{ aspectRatio: '9 / 16' }}
        >
          <MediaSummary media={media} />
          <PreviewMedia item={first} fit="contain" className="absolute inset-0 h-full w-full" />
        </div>
      </div>
    );
  }

  const isCarousel = count > 1;
  const go = (index) => onChange(Math.min(count - 1, Math.max(0, index)));
  const resetSwipe = () => {
    pointerStart.current = null;
  };
  const carouselProps = isCarousel
    ? {
        role: 'group',
        'aria-roledescription': 'carousel',
        'aria-label': 'Post media',
        onPointerDown: (event) => {
          pointerStart.current = event.clientX;
        },
        onPointerUp: (event) => {
          const start = pointerStart.current;
          pointerStart.current = null;
          if (start === null) return;
          const delta = event.clientX - start;
          if (delta <= -SWIPE_THRESHOLD_PX) go(current + 1);
          else if (delta >= SWIPE_THRESHOLD_PX) go(current - 1);
        },
        onPointerCancel: resetSwipe,
        onPointerLeave: resetSwipe,
      }
    : {};

  return (
    <div
      data-preview-frame=""
      className="relative w-full touch-pan-y overflow-hidden bg-[#EFEFEF] select-none dark:bg-[#262626]"
      style={{ aspectRatio: ratioValue(feedRatio(first)) }}
      {...carouselProps}
    >
      <MediaSummary media={media} />
      <div
        data-slide-track=""
        className="flex h-full transition-transform duration-300 ease-out motion-reduce:transition-none"
        style={{ transform: `translateX(-${current * 100}%)` }}
      >
        {media.map((item, index) => (
          <div
            key={item.id}
            className="relative h-full w-full shrink-0"
            {...(isCarousel
              ? {
                  role: 'group',
                  'aria-roledescription': 'slide',
                  'aria-label': `${index + 1} of ${count}`,
                  'aria-hidden': index !== current || undefined,
                }
              : {})}
          >
            <PreviewMedia item={item} className="absolute inset-0 h-full w-full" />
          </div>
        ))}
      </div>
      {isCarousel && (
        <>
          <span
            aria-hidden="true"
            className="absolute right-3 top-3 rounded-full bg-[#121212]/70 px-2 py-0.5 text-xs font-medium tabular-nums text-white"
          >
            {`${current + 1}/${count}`}
          </span>
          <CarouselButton
            direction="previous"
            disabled={current === 0}
            onClick={() => go(current - 1)}
          />
          <CarouselButton
            direction="next"
            disabled={current === count - 1}
            onClick={() => go(current + 1)}
          />
          <span className="sr-only" aria-live="polite">
            {`Slide ${current + 1} of ${count}`}
          </span>
        </>
      )}
    </div>
  );
}

function NoMediaFrame() {
  return (
    <div className="px-3">
      <div className="flex aspect-[4/3] flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 px-6 text-center dark:border-white/15 dark:bg-white/[0.03]">
        <ImagePlus className="h-7 w-7 text-slate-400 dark:text-slate-500" aria-hidden="true" />
        <p className="text-sm font-medium text-slate-600 dark:text-slate-300">
          Instagram posts need a photo or video
        </p>
      </div>
    </div>
  );
}

function SlideDots({ media, current }) {
  return (
    <span className="pointer-events-none absolute left-1/2 top-3 flex h-6 -translate-x-1/2 items-center gap-1">
      {media.map((item, index) => (
        <span
          key={item.id}
          className={cn(
            'h-1.5 w-1.5 rounded-full transition-colors',
            index === current ? 'bg-[#0095F6]' : 'bg-[#A8A8A8]/60',
          )}
        />
      ))}
    </span>
  );
}

/**
 * Approximate Instagram feed post: profile header, media framed the way Instagram crops it (a
 * real, navigable carousel when there are several items), a decorative action row, the caption
 * after the username, the first comment behind "View 1 comment", and "Preview" where Instagram
 * shows the time. `caption` / `firstComment` are the exact composed texts
 * (`platformOutput(state, 'INSTAGRAM_ACCOUNT')`). Without `account` a sample account is shown.
 */
export function InstagramPostPreview({ account, caption, firstComment, media, className }) {
  const profile = account ?? SAMPLE_ACCOUNT;
  const handle = displayHandle(profile);
  const items = media ?? [];
  const text = caption?.trim() ? caption : '';
  const comment = firstComment?.trim() ? firstComment : '';
  const [slide, setSlide] = useState(0);
  const [commentOpen, setCommentOpen] = useState(false);
  const commentId = useId();
  // Kept in range when media is removed (derived, never reset in an effect).
  const current = Math.min(slide, Math.max(0, items.length - 1));

  return (
    <article
      aria-label={`Instagram post preview for ${handle}`}
      className={cn(
        'overflow-hidden rounded-xl border border-slate-200/80 bg-white text-[#0C1014] shadow-sm dark:border-white/10 dark:bg-black dark:text-[#F5F5F5]',
        className,
      )}
    >
      <header className="flex items-center gap-2.5 px-3 py-2.5">
        <span className="flex shrink-0 rounded-full bg-gradient-to-tr from-amber-400 via-rose-500 to-fuchsia-600 p-[2px]">
          <span className="flex rounded-full bg-white p-[2px] dark:bg-black">
            <AccountAvatar account={profile} size="sm" showPlatform={false} />
          </span>
        </span>
        <p className="min-w-0 flex-1 truncate text-sm font-semibold">{handle}</p>
        <Ellipsis className="h-5 w-5 shrink-0" aria-hidden="true" />
      </header>

      {items.length === 0 ? (
        <NoMediaFrame />
      ) : (
        <InstagramMedia media={items} current={current} onChange={setSlide} />
      )}

      <div aria-hidden="true" className="relative flex items-center gap-4 px-3 pt-3">
        <Heart className="h-6 w-6" strokeWidth={1.75} />
        <MessageCircle className="h-6 w-6 -scale-x-100" strokeWidth={1.75} />
        <Send className="h-6 w-6" strokeWidth={1.75} />
        {items.length > 1 && <SlideDots media={items} current={current} />}
        <Bookmark className="ml-auto h-6 w-6" strokeWidth={1.75} />
      </div>

      {text && (
        <p className="break-words px-3 pt-2 text-sm leading-[18px]">
          <span className="font-semibold">{handle}</span>{' '}
          <PreviewText text={text} platform={INSTAGRAM} collapsedChars={125} subject="caption" />
        </p>
      )}

      {comment && (
        <div className="px-3 pt-1.5">
          <button
            type="button"
            aria-expanded={commentOpen}
            aria-controls={commentId}
            onClick={() => setCommentOpen((open) => !open)}
            className={cn('rounded-sm text-sm', SECONDARY_TEXT)}
          >
            View 1 comment
          </button>
          <p
            id={commentId}
            hidden={!commentOpen}
            className="mt-1 break-words text-sm leading-[18px]"
          >
            <span className="font-semibold">{handle}</span>{' '}
            <PreviewText
              text={comment}
              platform={INSTAGRAM}
              collapsedChars={125}
              subject="comment"
            />
          </p>
        </div>
      )}

      <p className={cn('px-3 pb-3 pt-2 text-[10px] uppercase tracking-wide', SECONDARY_TEXT)}>
        Preview
      </p>
    </article>
  );
}
