import { SOCIAL_PLATFORMS } from '@socialhub/shared';
import { Ellipsis, Forward, Globe, MessageCircle, ThumbsUp } from 'lucide-react';
import { cn } from '../../../../lib/utils.js';
import { MEDIA_KINDS } from '../../model/composerState.js';
import { aspectRatio } from '../../model/media.js';
import { AccountAvatar } from '../shared/AccountAvatar.jsx';
import { MediaSummary, PreviewMedia, PreviewText } from './PreviewText.jsx';

const FACEBOOK = SOCIAL_PLATFORMS.FACEBOOK_PAGE;

/** Stands in for a Page when no account is chosen yet. */
const SAMPLE_PAGE = Object.freeze({
  id: 'sample-facebook-page',
  platform: FACEBOOK,
  name: 'Your Page',
  pictureUrl: null,
});

const SECONDARY_TEXT = 'text-[#65676B] dark:text-[#B0B3B8]';
const MUTED_SURFACE = 'bg-[#F0F2F5] dark:bg-[#3A3B3C]';
const DIVIDER = 'border-[#CED0D4] dark:border-[#3E4042]';

/** Decorative only: the preview never shows reactions, counts or engagement. */
const ACTIONS = [
  { label: 'Like', icon: ThumbsUp },
  { label: 'Comment', icon: MessageCircle },
  { label: 'Share', icon: Forward },
];

const ratioValue = (ratio) => `${Number(ratio.toFixed(4))} / 1`;

function Tile({ item, className, children }) {
  return (
    <div className={cn('relative min-h-0 overflow-hidden', MUTED_SURFACE, className)}>
      <PreviewMedia item={item} className="absolute inset-0 h-full w-full" playBadge="sm" />
      {children}
    </div>
  );
}

function MoreOverlay({ count }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-2xl font-semibold text-white sm:text-3xl">
      <span aria-hidden="true">{`+${count}`}</span>
      <span className="sr-only">{`${count} more`}</span>
    </div>
  );
}

/**
 * Facebook's feed layouts: 1 item full width (its own shape, up to ~420 px tall), 2 side by
 * side, 3 as one large + two, 4 or more as a 2×2 grid whose last tile shows "+N".
 */
function FacebookMedia({ media }) {
  const [first] = media;

  if (media.length === 1) {
    const isVideo = first.kind === MEDIA_KINDS.VIDEO;
    const ratio = aspectRatio(first.width, first.height) ?? (isVideo ? 16 / 9 : 1);
    return (
      <div
        data-layout="single"
        className={cn(
          'relative max-h-[420px] w-full overflow-hidden',
          isVideo ? 'bg-black' : MUTED_SURFACE,
        )}
        style={{ aspectRatio: ratioValue(ratio) }}
      >
        <MediaSummary media={media} />
        <PreviewMedia
          item={first}
          fit={isVideo ? 'contain' : 'cover'}
          className="absolute inset-0 h-full w-full"
        />
      </div>
    );
  }

  let layout;
  let tiles;
  if (media.length === 2) {
    layout = 'pair';
    tiles = (
      <div className="grid grid-cols-2 gap-0.5">
        {media.map((item) => (
          <Tile key={item.id} item={item} className="aspect-square" />
        ))}
      </div>
    );
  } else if (media.length === 3) {
    layout = 'trio';
    const portrait = (aspectRatio(first.width, first.height) ?? 1) < 1;
    tiles = portrait ? (
      <div className="grid aspect-square grid-cols-2 grid-rows-2 gap-0.5">
        <Tile item={media[0]} className="row-span-2" />
        <Tile item={media[1]} />
        <Tile item={media[2]} />
      </div>
    ) : (
      <div className="grid grid-cols-2 gap-0.5">
        <Tile item={media[0]} className="col-span-2 aspect-[16/9]" />
        <Tile item={media[1]} className="aspect-square" />
        <Tile item={media[2]} className="aspect-square" />
      </div>
    );
  } else {
    layout = 'grid';
    // The fourth tile is dimmed under "+N", so N counts it together with the hidden items.
    const more = media.length > 4 ? media.length - 3 : 0;
    tiles = (
      <div className="grid grid-cols-2 gap-0.5">
        {media.slice(0, 4).map((item, index) => (
          <Tile key={item.id} item={item} className="aspect-square">
            {index === 3 && more > 0 && <MoreOverlay count={more} />}
          </Tile>
        ))}
      </div>
    );
  }

  return (
    <div data-layout={layout} className="relative">
      <MediaSummary media={media} />
      {tiles}
    </div>
  );
}

function FacebookActions({ divided }) {
  return (
    <div
      aria-hidden="true"
      className={cn('mx-3 mt-2 flex border-t py-1', DIVIDER, divided && 'border-b')}
    >
      {ACTIONS.map(({ label, icon: Icon }) => (
        <span
          key={label}
          className={cn(
            'flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-[13px] font-semibold sm:text-[15px]',
            SECONDARY_TEXT,
          )}
        >
          <Icon className="h-[18px] w-[18px]" />
          {label}
        </span>
      ))}
    </div>
  );
}

function FacebookComment({ page, text }) {
  return (
    <div role="group" aria-label="First comment" className="flex items-start gap-2 px-3 pb-3 pt-2">
      <AccountAvatar account={page} size="sm" showPlatform={false} />
      <div className="min-w-0 flex-1">
        <div className={cn('inline-block max-w-full rounded-2xl px-3 py-2', MUTED_SURFACE)}>
          <p className="truncate text-[13px] font-semibold leading-4">{page.name}</p>
          <p className="mt-0.5 break-words text-[15px] leading-5">
            <PreviewText
              text={text}
              platform={FACEBOOK}
              collapsedChars={300}
              collapsedLines={null}
              subject="comment"
            />
          </p>
        </div>
        <p className={cn('mt-1 flex gap-3 px-3 text-xs', SECONDARY_TEXT)}>
          <span>Preview</span>
          <span aria-hidden="true" className="font-semibold">
            Like
          </span>
          <span aria-hidden="true" className="font-semibold">
            Reply
          </span>
        </p>
      </div>
    </div>
  );
}

/**
 * Approximate Facebook Page post: header with the Page and "Preview" where Facebook shows the
 * time, the caption, Facebook's media layouts, a decorative action row and the first comment
 * posted as the Page. `caption` / `firstComment` are the exact composed texts
 * (`platformOutput(state, 'FACEBOOK_PAGE')`). Without `account` a sample Page is shown.
 */
export function FacebookPostPreview({ account, caption, firstComment, media, className }) {
  const page = account ?? SAMPLE_PAGE;
  const items = media ?? [];
  const text = caption?.trim() ? caption : '';
  const comment = firstComment?.trim() ? firstComment : '';
  const isEmpty = !text && items.length === 0;

  return (
    <article
      aria-label={`Facebook post preview for ${page.name}`}
      className={cn(
        'overflow-hidden rounded-xl border border-slate-200/80 bg-white text-[#050505] shadow-sm dark:border-white/10 dark:bg-[#242526] dark:text-[#E4E6EB]',
        className,
      )}
    >
      <header className="flex items-center gap-2.5 px-4 pt-3">
        <AccountAvatar account={page} size="md" showPlatform={false} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold leading-5">{page.name}</p>
          <p className={cn('flex items-center gap-1 text-[13px] leading-4', SECONDARY_TEXT)}>
            <span>Preview</span>
            <span aria-hidden="true">·</span>
            <Globe className="h-3 w-3" aria-hidden="true" />
          </p>
        </div>
        <Ellipsis className={cn('h-5 w-5 shrink-0', SECONDARY_TEXT)} aria-hidden="true" />
      </header>

      {text ? (
        <div className="px-4 pb-3 pt-2.5 text-[15px] leading-5">
          <PreviewText text={text} platform={FACEBOOK} collapsedChars={480} subject="post" />
        </div>
      ) : (
        <div className="h-3" aria-hidden="true" />
      )}

      {isEmpty && (
        <p className={cn('px-4 pb-3 text-[15px] italic', SECONDARY_TEXT)}>
          Write a caption or add a photo or video to see it here.
        </p>
      )}
      {items.length > 0 && <FacebookMedia media={items} />}
      <FacebookActions divided={Boolean(comment)} />
      {comment && <FacebookComment page={page} text={comment} />}
    </article>
  );
}
