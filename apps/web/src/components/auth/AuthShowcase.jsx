import {
  Bookmark,
  CalendarClock,
  Forward,
  Hash,
  Heart,
  MessageCircle,
  Plug,
  Send,
  SquarePen,
  ThumbsUp,
  Users,
} from 'lucide-react';
import { cn } from '../../lib/utils.js';
import { FacebookIcon, InstagramIcon } from '../ui/Brand.jsx';

/*
 * The sign-in panel: a headline, three product facts and a sample scene. Every sentence here is
 * a claim the landing page already makes (pages/landing/landingContent.js). The scene uses the
 * landing page's sample bakery; the Facebook post is "Scheduled" (Page publishing is verified)
 * and Instagram stays a "Preview" (not verified with a real account).
 */
const HIGHLIGHTS = [
  {
    icon: Plug,
    tone: 'from-indigo-400 to-indigo-600',
    title: 'Connect with official Meta login',
    body: 'Clients sign in on Meta’s own screen. SocialHub receives an access token, never a password.',
  },
  {
    icon: SquarePen,
    tone: 'from-violet-400 to-purple-600',
    title: 'One composer for every destination',
    body: 'Write one caption or tailor it per platform, then preview it as Facebook and Instagram would show it.',
  },
  {
    icon: Users,
    tone: 'from-fuchsia-400 to-pink-600',
    title: 'Least-privilege team access',
    body: 'Give every teammate a role and only the accounts they need.',
  },
];

/** Entrance delay of the nth piece of the scene, after the headline and the list. */
const step = (n) => ({ animationDelay: `${420 + n * 140}ms` });

/** A latte with a heart poured in, on a warm backdrop (the Facebook post's photo). */
function LattePhoto() {
  return (
    <svg
      viewBox="0 0 120 56"
      preserveAspectRatio="xMidYMid slice"
      className="h-full w-full bg-gradient-to-br from-[#fed7aa] via-[#fdba74] to-[#fb923c]"
    >
      <circle cx="18" cy="12" r="16" fill="#fff7ed" opacity="0.35" />
      <circle cx="63" cy="31" r="22" fill="#9a3412" opacity="0.2" />
      <circle cx="60" cy="28" r="22" fill="#fff7ed" />
      <rect x="77" y="24" width="13" height="8" rx="4" fill="#ffffff" />
      <circle cx="60" cy="28" r="16" fill="#ffffff" />
      <circle cx="60" cy="28" r="12.5" fill="#a16207" />
      <path
        d="M60 35c-5-3.3-7.2-5.9-7.2-8.3a3.8 3.8 0 0 1 7.2-1.7 3.8 3.8 0 0 1 7.2 1.7c0 2.4-2.2 5-7.2 8.3Z"
        fill="#fde7c7"
      />
      <ellipse cx="96" cy="44" rx="9" ry="5" fill="#7c2d12" opacity="0.35" />
      <ellipse cx="25" cy="44" rx="7" ry="4" fill="#7c2d12" opacity="0.3" />
    </svg>
  );
}

/** Two glazed donuts on a plate, in the logo's pink and violet: [cx, cy, size, glaze, sprinkles]. */
const DONUTS = [
  [
    80,
    52,
    20,
    '#a78bfa',
    [
      [74, 42, 30, '#ffffff'],
      [88, 45, -40, '#f9a8d4'],
      [91, 57, 60, '#ffffff'],
      [79, 65, -10, '#f9a8d4'],
      [69, 58, 45, '#ffffff'],
    ],
  ],
  [
    48,
    42,
    24,
    '#f472b6',
    [
      [40, 30, 30, '#ffffff'],
      [55, 29, -20, '#fde68a'],
      [61, 40, 70, '#818cf8'],
      [58, 53, 20, '#ffffff'],
      [44, 56, -40, '#fde68a'],
      [34, 47, 80, '#818cf8'],
      [35, 36, -60, '#ffffff'],
    ],
  ],
];

/** The Instagram preview's photo. */
function DonutPhoto() {
  return (
    <svg
      viewBox="0 0 120 90"
      preserveAspectRatio="xMidYMid slice"
      className="h-full w-full bg-gradient-to-br from-[#fce7f3] via-[#f5f3ff] to-[#e0e7ff]"
    >
      <circle cx="63" cy="49" r="40" fill="#6366f1" opacity="0.12" />
      <circle cx="60" cy="46" r="40" fill="#ffffff" />
      {DONUTS.map(([cx, cy, size, glaze, sprinkles]) => (
        <g key={glaze}>
          <circle cx={cx + 1.5} cy={cy + 2} r={size} fill="#9a3412" opacity="0.14" />
          <circle cx={cx} cy={cy} r={size} fill="#f5c08a" />
          <circle cx={cx} cy={cy} r={size * 0.83} fill={glaze} />
          <circle cx={cx} cy={cy} r={size * 0.4} fill="#f5c08a" />
          <circle cx={cx} cy={cy} r={size * 0.29} fill="#ffffff" />
          {sprinkles.map(([x, y, angle, colour]) => (
            <rect
              key={`${x}-${y}`}
              x={x - 2.5}
              y={y - 0.8}
              width="5"
              height="1.6"
              rx="0.8"
              fill={colour}
              transform={`rotate(${angle} ${x} ${y})`}
            />
          ))}
        </g>
      ))}
    </svg>
  );
}

const CARD =
  'overflow-hidden rounded-2xl border border-white/60 bg-white text-left shadow-[0_24px_48px_-20px_rgb(0_0_0/0.65)] dark:border-white/10 dark:bg-slate-900';

function Bar({ className }) {
  return (
    <span className={cn('block h-1.5 rounded-full bg-slate-200 dark:bg-white/10', className)} />
  );
}

function FacebookPost() {
  return (
    <div className={cn(CARD, 'w-[14.5rem]')}>
      <div className="flex items-center gap-2 px-3 py-2.5">
        <span className="relative shrink-0">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-amber-400 to-orange-500 text-[10px] font-bold text-white">
            BB
          </span>
          <span className="absolute -right-1 -bottom-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-white ring-1 ring-white dark:bg-slate-900 dark:ring-slate-900">
            <FacebookIcon className="h-3.5 w-3.5 text-[#1877f2]" />
          </span>
        </span>
        <span className="min-w-0 leading-tight">
          <span className="block truncate text-[12px] font-semibold text-slate-900 dark:text-white">
            Bloom Bakery
          </span>
          <span className="block text-[10px] text-slate-500 dark:text-slate-400">
            Facebook Page
          </span>
        </span>
      </div>
      <div className="space-y-1.5 px-3 pb-2.5">
        <Bar className="w-11/12" />
        <Bar className="w-3/5" />
      </div>
      <div className="h-[6.5rem]">
        <LattePhoto />
      </div>
      <div className="flex items-center justify-between gap-2 px-3 py-2.5">
        <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-semibold text-brand-700 dark:bg-brand-500/15 dark:text-brand-200">
          <CalendarClock className="h-3 w-3" />
          Scheduled · Tue 10:00
        </span>
        <span className="flex items-center gap-2 text-slate-400 dark:text-slate-500">
          <ThumbsUp className="h-3.5 w-3.5" />
          <MessageCircle className="h-3.5 w-3.5" />
          <Forward className="h-3.5 w-3.5" />
        </span>
      </div>
    </div>
  );
}

function InstagramPreview() {
  return (
    <div className={cn(CARD, 'w-[10.5rem]')}>
      <div className="flex items-center gap-1.5 px-2.5 py-2">
        <span className="shrink-0 rounded-full bg-gradient-to-br from-[#feda75] via-[#d62976] to-[#4f5bd5] p-[1.5px]">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white text-[7px] font-bold text-slate-900 dark:bg-slate-900 dark:text-white">
            BB
          </span>
        </span>
        <span className="min-w-0 leading-tight">
          <span className="block truncate text-[11px] font-semibold text-slate-900 dark:text-white">
            bloom.bakes
          </span>
          <span className="block text-[9px] text-slate-500 dark:text-slate-400">Instagram</span>
        </span>
      </div>
      <div className="relative h-32">
        <DonutPhoto />
        <span className="absolute top-2 left-2 rounded-full bg-white/90 px-1.5 py-px text-[9px] font-semibold text-slate-700 shadow-sm">
          Preview
        </span>
      </div>
      <div className="flex items-center gap-2 px-2.5 py-2 text-slate-500 dark:text-slate-400">
        <Heart className="h-3.5 w-3.5" />
        <MessageCircle className="h-3.5 w-3.5" />
        <Send className="h-3.5 w-3.5" />
        <Bookmark className="ml-auto h-3.5 w-3.5" />
      </div>
    </div>
  );
}

/** A round decorative social glyph. No numbers, attached to nothing that looks like a metric. */
function Glyph({ icon: Icon, tone, className, style }) {
  return (
    <span
      className={cn(
        'absolute z-30 flex h-8 w-8 animate-pop-in items-center justify-center rounded-full bg-gradient-to-br text-white shadow-[0_10px_20px_-8px_rgb(0_0_0/0.6)] ring-2 ring-white/90 dark:ring-slate-900',
        tone,
        className,
      )}
      style={style}
    >
      <Icon className="h-3.5 w-3.5" strokeWidth={2.5} />
    </span>
  );
}

/**
 * A sample of what SocialHub handles: a scheduled Facebook Page post, an Instagram preview and
 * a saved draft. Decorative (`aria-hidden`), labelled "Sample" on the scene itself. Pieces rise
 * in once, then two of them bob slowly; under reduced motion it is one still frame.
 */
function SampleScene() {
  return (
    <div className="relative h-[17.5rem] w-full max-w-[27rem]" aria-hidden="true">
      <div className="absolute top-0 right-0 animate-rise" style={step(1)}>
        <div className="relative animate-float [animation-delay:-3.5s]">
          <div className="rotate-[4deg]">
            <InstagramPreview />
          </div>
          <Glyph
            icon={Hash}
            tone="from-indigo-400 to-violet-500"
            className="-top-1.5 -right-2.5"
            style={step(4)}
          />
        </div>
      </div>
      <div className="absolute top-7 left-0 z-10 animate-rise" style={step(0)}>
        <FacebookPost />
      </div>
      <div className="absolute right-3 bottom-1 z-20 animate-rise" style={step(2)}>
        <div className="flex animate-float items-center gap-2.5 rounded-xl border border-white/60 bg-white py-2 pr-3.5 pl-2 shadow-[0_20px_40px_-18px_rgb(0_0_0/0.7)] dark:border-white/10 dark:bg-slate-900">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-400 to-violet-500 text-white">
            <SquarePen className="h-3.5 w-3.5" />
          </span>
          <span className="leading-tight">
            <span className="block text-[12px] font-semibold text-slate-900 dark:text-white">
              Draft saved
            </span>
            <span className="block text-[10px] text-slate-500 dark:text-slate-400">
              Autumn menu · version 4
            </span>
          </span>
        </div>
      </div>
      <Glyph
        icon={Heart}
        tone="from-pink-400 to-rose-500"
        className="top-3.5 left-[13.25rem]"
        style={step(3)}
      />
      <span
        className="absolute bottom-0 left-0 animate-rise rounded-full border border-white/15 bg-white/[0.08] px-2.5 py-0.5 text-[11px] font-medium text-white/80"
        style={step(3)}
      >
        Sample
      </span>
    </div>
  );
}

/** The two platform marks, as the platforms colour them. Decorative. */
export function PlatformMarks({ className }) {
  return (
    <span className={cn('flex shrink-0 -space-x-1.5', className)} aria-hidden="true">
      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#1877f2] text-white ring-2 ring-[#19154f]">
        <FacebookIcon className="h-4 w-4" />
      </span>
      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-[#feda75] via-[#d62976] to-[#4f5bd5] text-white ring-2 ring-[#19154f]">
        <InstagramIcon className="h-3.5 w-3.5" />
      </span>
    </span>
  );
}

/** The left half of the sign-in screens (large screens only). */
export function AuthShowcase() {
  return (
    <>
      <h2 className="max-w-md animate-rise text-[2rem] leading-[1.12] font-semibold tracking-[-0.03em] text-white xl:text-[2.4rem] [@media(max-height:720px)]:text-[1.75rem]">
        One home for your team&apos;s{' '}
        <span className="bg-gradient-to-r from-indigo-300 via-violet-300 to-pink-300 bg-clip-text text-transparent">
          social presence.
        </span>
      </h2>
      <ul className="mt-7 max-w-md space-y-4 [@media(max-height:820px)]:space-y-2.5">
        {HIGHLIGHTS.map(({ icon: Icon, tone, title, body }, i) => (
          <li
            key={title}
            className="flex animate-rise items-start gap-3.5"
            style={{ animationDelay: `${120 + i * 80}ms` }}
          >
            <span
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${tone} text-white shadow-lg shadow-black/25 ring-1 ring-white/20 ring-inset [@media(max-height:820px)]:h-7 [@media(max-height:820px)]:w-7 [@media(max-height:820px)]:rounded-lg`}
            >
              <Icon
                className="h-[18px] w-[18px] [@media(max-height:820px)]:h-3.5 [@media(max-height:820px)]:w-3.5"
                aria-hidden="true"
              />
            </span>
            <span className="min-w-0">
              <span className="block text-[15px] font-medium text-white [@media(max-height:820px)]:pt-1 [@media(max-height:820px)]:text-sm">
                {title}
              </span>
              <span className="mt-0.5 block text-[13px] leading-relaxed text-indigo-100/75 [@media(max-height:820px)]:hidden">
                {body}
              </span>
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-10 [@media(max-height:640px)]:hidden [@media(max-height:820px)]:mt-7">
        <SampleScene />
      </div>
    </>
  );
}
