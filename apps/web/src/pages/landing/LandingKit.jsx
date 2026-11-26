/**
 * Shared pieces of the landing illustrations: status pills, avatars, platform marks, the
 * sample "photos" and the sample post card. Sample data only; each illustration that uses
 * them hides itself from assistive technology on its own root.
 */
import { Bookmark, Forward, Heart, MessageCircle, Send, ThumbsUp } from 'lucide-react';
import { FacebookIcon, InstagramIcon } from '../../components/ui/Brand.jsx';
import { cn } from '../../lib/utils.js';

export function Pill({ tone = 'slate', className, children }) {
  return (
    <span
      className={cn(
        'lp-tone inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium whitespace-nowrap',
        `lp-tone-${tone}`,
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Initials({ text, className }) {
  return (
    <span
      className={cn(
        'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white',
        className,
      )}
    >
      {text}
    </span>
  );
}

export function Line({ w = 'w-24', className }) {
  return <span className={cn('block h-2 rounded-full bg-(--lp-line)', w, className)} />;
}

export function PlatformBadge({ kind, className }) {
  return kind === 'facebook' ? (
    <span
      className={cn(
        'flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#1877f2] text-white',
        className,
      )}
    >
      <FacebookIcon className="h-4 w-4" />
    </span>
  ) : (
    <span
      className={cn(
        'flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#feda75] via-[#d62976] to-[#4f5bd5] text-white',
        className,
      )}
    >
      <InstagramIcon className="h-3.5 w-3.5" />
    </span>
  );
}

/** A 14 px platform mark for the corner of a thumbnail (PlatformBadge stops at 20 px). */
export function PlatformDot({ kind, className }) {
  return kind === 'facebook' ? (
    <span className={cn('flex rounded-full bg-white', className)}>
      <FacebookIcon className="h-3.5 w-3.5 text-[#1877f2]" />
    </span>
  ) : (
    <span
      className={cn(
        'flex h-3.5 w-3.5 items-center justify-center rounded-full bg-gradient-to-br from-[#feda75] via-[#d62976] to-[#4f5bd5] text-white',
        className,
      )}
    >
      <InstagramIcon className="h-2.5 w-2.5" />
    </span>
  );
}

/** The visible label every illustration with names or numbers carries. */
export function SampleNote({ className, children = 'Sample data for illustration' }) {
  return <p className={cn('text-[10px] text-(--lp-muted)', className)}>{children}</p>;
}

/** A check that draws itself when it mounts (`.lp-draw`); complete at once under reduced motion. */
export function DrawnCheck({ delay = 0, className }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn('h-3 w-3 shrink-0', className)}
    >
      <path
        d="M3.5 8.5l3 3 6-6.5"
        pathLength="1"
        className="lp-draw"
        style={{ animationDuration: '420ms', animationDelay: `${delay}ms` }}
      />
    </svg>
  );
}

const BUN_CENTRES = [
  [44, 33],
  [76, 33],
  [44, 57],
  [76, 57],
];

/** A tray of cinnamon buns seen from above. */
function BunsArt() {
  return (
    <>
      <rect x="25" y="17" width="76" height="64" rx="9" fill="#9a3412" opacity="0.22" />
      <rect x="22" y="13" width="76" height="64" rx="9" fill="#fffbeb" />
      {BUN_CENTRES.map(([cx, cy]) => (
        <g key={`${cx}-${cy}`}>
          <circle cx={cx} cy={cy} r="11.5" fill="#d97706" />
          <circle cx={cx} cy={cy} r="7.5" fill="#fbbf24" />
          <circle cx={cx} cy={cy} r="4" fill="#b45309" />
          <circle cx={cx} cy={cy} r="1.5" fill="#fef3c7" />
        </g>
      ))}
    </>
  );
}

/** A latte on its saucer seen from above, with a heart poured into it. */
function LatteArt() {
  return (
    <>
      <circle cx="63" cy="49" r="31" fill="#312e81" opacity="0.22" />
      <circle cx="60" cy="45" r="31" fill="#eef2ff" />
      <rect x="80" y="40.5" width="14" height="9" rx="4.5" fill="#ffffff" />
      <circle cx="60" cy="45" r="22" fill="#ffffff" />
      <circle cx="60" cy="45" r="18" fill="#a16207" />
      <path
        d="M60 54c-7-4.6-10-8.2-10-11.6a5.3 5.3 0 0 1 10-2.4 5.3 5.3 0 0 1 10 2.4c0 3.4-3 7-10 11.6Z"
        fill="#fde7c7"
      />
    </>
  );
}

/** A sunset over two hills, drawn so the sun stays round in every frame. */
function SunsetArt() {
  return (
    <>
      <circle cx="60" cy="40" r="23" fill="#fde68a" opacity="0.3" />
      <circle cx="60" cy="40" r="14" fill="#fde68a" />
      <ellipse cx="26" cy="96" rx="54" ry="32" fill="#431407" />
      <ellipse cx="98" cy="100" rx="58" ry="36" fill="#2a0d05" />
    </>
  );
}

const PHOTOS = {
  buns: ['bg-gradient-to-br from-[#fed7aa] via-[#fdba74] to-[#ea580c]', BunsArt],
  latte: ['bg-gradient-to-br from-[#ddd6fe] via-[#a5b4fc] to-[#6366f1]', LatteArt],
  sunset: ['bg-gradient-to-b from-[#f9a8d4] via-[#fb923c] to-[#7c2d12]', SunsetArt],
};

/**
 * A CSS-and-SVG stand-in for a photo. The art is cropped (never squashed) to fill whatever
 * frame it is given; every subject is centred on (60, 45) of its 120 x 90 view box.
 */
export function SamplePhoto({ kind, className }) {
  const [backdrop, Art] = PHOTOS[kind];
  return (
    <div className={cn('relative overflow-hidden', backdrop, className)}>
      <svg
        viewBox="0 0 120 90"
        preserveAspectRatio="xMidYMid slice"
        className="absolute inset-0 h-full w-full"
      >
        <Art />
      </svg>
    </div>
  );
}

const POST_ACTIONS = {
  facebook: [ThumbsUp, MessageCircle, Forward],
  instagram: [Heart, MessageCircle, Send],
};

/** Text colour of the status sticker, by tone (full class names so Tailwind sees them). */
const STATUS_INK = {
  mint: 'text-(--lp-mint)',
  indigo: 'text-(--lp-indigo)',
  slate: 'text-(--lp-slate)',
};

/**
 * A sample post in the look of the app's own previews: account header, photo and the
 * platform's action row (decorative, never a count). `status` is `[tone, label]`, shown as a
 * sticker on the photo; `lines` adds caption lines where each platform puts them.
 */
export function PostCard({
  kind,
  name,
  sub,
  photo,
  status,
  lines = false,
  drawDelay = 0,
  className,
}) {
  const facebook = kind === 'facebook';
  const caption = lines && (
    <div className="space-y-1.5 px-2.5 pb-2">
      <Line w="w-full" />
      <Line w="w-3/5" />
    </div>
  );
  return (
    <div
      className={cn(
        'overflow-hidden rounded-2xl border border-(--lp-border-strong) bg-(--lp-card-solid) text-left shadow-(--lp-shadow-md)',
        className,
      )}
    >
      <div className="flex items-center gap-2 px-2.5 py-2">
        {facebook ? (
          <PlatformBadge kind="facebook" className="h-6 w-6" />
        ) : (
          <span className="shrink-0 rounded-full bg-gradient-to-br from-[#feda75] via-[#d62976] to-[#4f5bd5] p-[1.5px]">
            <Initials text="BB" className="h-[21px] w-[21px] bg-[#1a1530] text-[8px]" />
          </span>
        )}
        <div className="min-w-0 leading-tight">
          <p className="truncate text-[11px] font-semibold text-(--lp-text)">{name}</p>
          <p className="truncate text-[9px] text-(--lp-muted)">{sub}</p>
        </div>
      </div>
      {facebook && caption}
      <div className="relative">
        <SamplePhoto
          kind={photo}
          className={cn('w-full', facebook ? 'aspect-[4/3]' : 'aspect-square')}
        />
        {status && (
          <span
            className={cn(
              'absolute top-2 left-2 inline-flex items-center gap-1 rounded-full bg-(--lp-card-solid) px-2 py-0.5 text-[10px] font-medium shadow-sm',
              STATUS_INK[status[0]],
            )}
          >
            {status[1] === 'Published' && <DrawnCheck delay={drawDelay} />}
            {status[1]}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2.5 px-2.5 py-2 text-(--lp-muted)">
        {POST_ACTIONS[kind].map((Icon, i) => (
          <Icon key={i} className="h-3.5 w-3.5" strokeWidth={1.75} />
        ))}
        {!facebook && <Bookmark className="ml-auto h-3.5 w-3.5" strokeWidth={1.75} />}
      </div>
      {!facebook && caption}
    </div>
  );
}
