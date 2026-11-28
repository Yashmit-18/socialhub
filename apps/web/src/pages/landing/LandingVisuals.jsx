/**
 * Decorative product illustrations and motion graphics for the landing page. They use sample
 * data only and are hidden from assistive technology. The only thing ever shown as published
 * is a sample Facebook Page post; Instagram stays a preview. Colours come from the `--lp-*`
 * theme tokens in landing.css, so they follow light/dark mode.
 */
import {
  Activity,
  ArrowRight,
  Bookmark,
  Check,
  CircleAlert,
  Forward,
  Hash,
  Heart,
  LayoutDashboard,
  LoaderCircle,
  Lock,
  MailPlus,
  MessageCircle,
  RefreshCw,
  Send,
  Server,
  Settings,
  Share2,
  ShieldCheck,
  SquarePen,
  ThumbsUp,
  UserRound,
  Users,
} from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { LogoMark } from '../../components/ui/Brand.jsx';
import { cn } from '../../lib/utils.js';
import {
  DrawnCheck,
  Initials,
  Line,
  Pill,
  PlatformBadge,
  PlatformDot,
  SampleNote,
  SamplePhoto,
} from './LandingKit.jsx';
import { CountUp } from './motion.jsx';
import { useInView, useOnScreen, useReducedMotion, useScramble } from './useMotion.js';

const APP_NAV = [
  { id: 'overview', icon: LayoutDashboard, label: 'Overview' },
  { id: 'compose', icon: SquarePen, label: 'Create post' },
  { id: 'accounts', icon: Share2, label: 'Social accounts' },
  { id: 'team', icon: Users, label: 'Team' },
  { id: 'activity', icon: Activity, label: 'Activity' },
  { id: 'settings', icon: Settings, label: 'Settings' },
];

function WindowChrome({ path }) {
  return (
    <div className="flex items-center gap-3 border-b border-(--lp-border) bg-(--lp-surface) px-4 py-3">
      <div className="flex gap-1.5">
        <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]/85" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]/85" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]/85" />
      </div>
      <div className="mx-auto flex min-w-0 items-center gap-2 rounded-full bg-(--lp-surface-2) px-3 py-1 text-[11px] text-(--lp-faint)">
        <Lock className="h-3 w-3 shrink-0" />
        <span className="truncate">{path}</span>
      </div>
      <span className="hidden w-[46px] sm:block" />
    </div>
  );
}

function MiniSidebar({ active }) {
  return (
    <aside className="hidden w-48 shrink-0 border-r border-(--lp-border) p-3 md:block">
      <div className="mb-4 flex items-center gap-2 rounded-xl bg-(--lp-surface) p-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-pink-500 to-orange-400 text-[11px] font-bold text-white">
          BS
        </span>
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold text-(--lp-text)">Bloom Studio</p>
          <p className="text-[10px] text-(--lp-faint)">Workspace</p>
        </div>
      </div>
      <nav className="space-y-0.5">
        {APP_NAV.map(({ id, icon: Icon, label }) => (
          <div
            key={id}
            className={cn(
              'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs',
              id === active
                ? 'bg-gradient-to-r from-indigo-500/20 to-fuchsia-500/10 text-(--lp-text) ring-1 ring-(--lp-border)'
                : 'text-(--lp-muted)',
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </div>
        ))}
      </nav>
    </aside>
  );
}

/* ------------------------------------------------------------------ */
/* Hero dashboard                                                      */
/* ------------------------------------------------------------------ */

const HERO_ACCOUNTS = [
  { name: 'Bloom Bakery', kind: 'facebook', status: ['mint', 'Ready'] },
  { name: '@bloom.bakes', kind: 'instagram', status: ['mint', 'Ready'] },
  { name: 'Northwind Coffee', kind: 'facebook', status: ['amber', 'Reconnect'] },
  { name: '@northwind.co', kind: 'instagram', status: ['indigo', 'Syncing'] },
];

/** Sample follower totals per platform; they add up to the combined figure shown above them. */
const FOLLOWERS_TOTAL = 128420;
const FOLLOWER_SPLIT = [
  {
    kind: 'facebook',
    label: 'All Facebook Pages',
    short: 'Facebook',
    followers: 79860,
    accounts: '6 Pages',
    share: 62,
    bar: 'bg-[#1877f2]',
  },
  {
    kind: 'instagram',
    label: 'All Instagram accounts',
    short: 'Instagram',
    followers: 48560,
    accounts: '5 accounts',
    share: 38,
    bar: 'bg-[#d62976]',
  },
];

const grouped = new Intl.NumberFormat('en-US');

/** Facebook vs Instagram share of the combined followers, as one split bar. */
function FollowerSplitBar({ className, delay = 0 }) {
  return (
    <div className={cn('flex h-2 gap-1', className)}>
      {FOLLOWER_SPLIT.map(({ kind, share, bar }, i) => (
        <span
          key={kind}
          className={cn('lp-progress h-full rounded-full', bar)}
          style={{
            width: `${share}%`,
            animationDuration: '1.2s',
            animationDelay: `${delay + i * 250}ms`,
            animationTimingFunction: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
          }}
        />
      ))}
    </div>
  );
}

function FloatingChip({ className, delay, depth, icon, title, detail }) {
  return (
    <div className={cn('absolute z-20 hidden sm:block', className)}>
      <div className="lp-depth" style={{ '--depth': depth }}>
        <div className="lp-float" style={{ '--lp-delay': `${delay}ms` }}>
          <div
            className="lp-rise lp-glass flex items-center gap-3 rounded-2xl px-3.5 py-2.5 shadow-(--lp-shadow-md)"
            style={{ '--lp-delay': `${delay + 1400}ms` }}
          >
            {icon}
            <div className="text-left leading-tight">
              <p className="text-xs font-semibold text-(--lp-text)">{title}</p>
              <p className="text-[11px] text-(--lp-muted)">{detail}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const HERO_TILES = [
  ['Facebook Pages', 6, <PlatformBadge key="f" kind="facebook" className="h-6 w-6" />],
  ['Instagram', 5, <PlatformBadge key="i" kind="instagram" className="h-6 w-6" />],
  [
    'Team members',
    4,
    <span
      key="t"
      className="lp-tone lp-tone-indigo flex h-6 w-6 items-center justify-center rounded-full"
    >
      <Users className="h-3.5 w-3.5" />
    </span>,
  ],
  [
    'Need attention',
    1,
    <span
      key="a"
      className="lp-tone lp-tone-amber flex h-6 w-6 items-center justify-center rounded-full"
    >
      <CircleAlert className="h-3.5 w-3.5" />
    </span>,
  ],
];

/** The hero's product shot. Place it inside a `.lp-stage` for the pointer parallax. */
export function HeroDashboard() {
  return (
    <div className="relative mx-auto w-full max-w-5xl" aria-hidden="true">
      <div className="lp-hero-glow" />
      <div className="lp-halo absolute -inset-x-6 top-16 -bottom-8 rounded-[3rem]" />

      <FloatingChip
        className="-top-9 left-16 lg:left-24"
        delay={0}
        depth={26}
        icon={
          <span className="lp-tone lp-tone-mint flex h-8 w-8 items-center justify-center rounded-full">
            <RefreshCw className="h-4 w-4" />
          </span>
        }
        title="Instagram token refreshed"
        detail="@bloom.bakes · daily sync"
      />
      <FloatingChip
        className="-top-6 -right-3 xl:-right-12"
        delay={1200}
        depth={34}
        icon={
          <span className="lp-tone lp-tone-indigo flex h-8 w-8 items-center justify-center rounded-full">
            <SquarePen className="h-4 w-4" />
          </span>
        }
        title="Draft saved"
        detail="Autumn menu · version 4"
      />
      <FloatingChip
        className="-bottom-6 left-6 lg:-left-8"
        delay={2400}
        depth={42}
        icon={
          <Initials text="PR" className="h-8 w-8 bg-gradient-to-br from-amber-400 to-pink-500" />
        }
        title="Priya joined as Editor"
        detail="Access: 2 accounts"
      />

      <div className="lp-parallax relative">
        <div className="lp-tilt-in relative">
          <div className="lp-gradient-border lp-window relative overflow-hidden rounded-[1.75rem] text-left shadow-(--lp-shadow-xl)">
            <div className="lp-beam-border" />
            <WindowChrome path="/w/bloom-studio" />
            <div className="flex">
              <MiniSidebar active="overview" />
              <div className="min-w-0 flex-1 p-4 sm:p-6">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[11px] text-(--lp-faint)">Overview</p>
                    <p className="truncate text-base font-semibold text-(--lp-text) sm:text-lg">
                      Bloom Studio
                    </p>
                  </div>
                  <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-gradient-to-r from-indigo-500 to-pink-500 px-3 py-1.5 text-[11px] font-semibold text-white shadow-[0_8px_20px_-8px_rgba(236,72,153,0.7)]">
                    <SquarePen className="h-3 w-3" /> Create post
                  </span>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                  {HERO_TILES.map(([label, value, icon], i) => (
                    <div
                      key={label}
                      className="rounded-xl border border-(--lp-border) bg-(--lp-surface) p-3"
                    >
                      <div className="flex items-center justify-between">
                        {icon}
                        <CountUp
                          value={value}
                          delay={1500 + i * 120}
                          duration={900}
                          className="text-lg font-semibold text-(--lp-text) tabular-nums"
                        />
                      </div>
                      <p className="mt-2 truncate text-[11px] text-(--lp-muted)">{label}</p>
                    </div>
                  ))}
                </div>

                <div className="mt-3 grid gap-3 lg:grid-cols-5">
                  <div className="rounded-xl border border-(--lp-border) bg-(--lp-surface) p-4 lg:col-span-3">
                    <div className="flex items-end justify-between gap-3">
                      <div>
                        <p className="text-[11px] text-(--lp-muted)">Combined followers</p>
                        <CountUp
                          value={FOLLOWERS_TOTAL}
                          group
                          delay={1600}
                          duration={1800}
                          className="mt-1 block text-2xl font-semibold tracking-tight text-(--lp-text) tabular-nums"
                        />
                      </div>
                      <Pill tone="mint">11 accounts</Pill>
                    </div>
                    <FollowerSplitBar className="mt-4" delay={1700} />
                    <div className="mt-3 grid grid-cols-2 gap-2.5">
                      {FOLLOWER_SPLIT.map(({ kind, label, followers, accounts }) => (
                        <div
                          key={kind}
                          className="flex min-w-0 items-start gap-2.5 rounded-lg border border-(--lp-border) bg-(--lp-surface) p-2.5"
                        >
                          <PlatformBadge kind={kind} />
                          <div className="min-w-0">
                            <p className="truncate text-[11px] text-(--lp-muted)">{label}</p>
                            <p className="text-base font-semibold text-(--lp-text) tabular-nums">
                              {grouped.format(followers)}
                            </p>
                            <p className="text-[10px] text-(--lp-faint)">{accounts}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="rounded-xl border border-(--lp-border) bg-(--lp-surface) p-3 lg:col-span-2">
                    <p className="px-1 pb-2 text-[11px] text-(--lp-muted)">Social accounts</p>
                    <ul className="space-y-1">
                      {HERO_ACCOUNTS.map(({ name, kind, status: [tone, label] }, i) => (
                        <li
                          key={name}
                          className="lp-rise flex items-center gap-2.5 rounded-lg px-1.5 py-1.5"
                          style={{ '--lp-delay': `${1700 + i * 140}ms` }}
                        >
                          <PlatformBadge kind={kind} />
                          <span className="min-w-0 flex-1 truncate text-xs text-(--lp-text)">
                            {name}
                          </span>
                          <Pill tone={tone}>
                            {label === 'Syncing' && (
                              <RefreshCw className="h-2.5 w-2.5 animate-spin" />
                            )}
                            {label}
                          </Pill>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
                <SampleNote className="mt-3 text-right" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Orbit graphic                                                       */
/* ------------------------------------------------------------------ */

/**
 * A satellite on a rotating ring. It spins the opposite way at the ring's speed (inherited
 * through --lp-orbit-speed) so its content stays upright.
 */
function OrbitItem({ angle, ringReversed = false, children }) {
  const rad = (angle * Math.PI) / 180;
  return (
    <span
      className="absolute"
      style={{
        left: `${50 + 50 * Math.cos(rad)}%`,
        top: `${50 + 50 * Math.sin(rad)}%`,
        transform: 'translate(-50%, -50%)',
      }}
    >
      <span className={cn('block', ringReversed ? 'lp-orbit' : 'lp-orbit-reverse')}>
        {children}
      </span>
    </span>
  );
}

const ORBIT_PAGES = [
  ['BB', 'from-pink-500 to-orange-400'],
  ['NW', 'from-sky-500 to-indigo-500'],
  ['LS', 'from-emerald-400 to-teal-500'],
  ['KC', 'from-violet-500 to-fuchsia-500'],
];

export function OrbitGraphic({ className }) {
  return (
    // The caller positions it (`relative` in flow, `absolute` as a backdrop); both anchor
    // the rings. Adding `relative` here would override a caller's `absolute`.
    <div className={cn('aspect-square', className)} aria-hidden="true">
      <div className="absolute inset-[30%] rounded-full bg-fuchsia-500/20 blur-2xl" />

      <div
        className="lp-orbit absolute inset-0 rounded-full border border-dashed border-(--lp-border-strong)"
        style={{ '--lp-orbit-speed': '60s' }}
      >
        {ORBIT_PAGES.map(([text, gradient], i) => (
          <OrbitItem key={text} angle={i * 90 + 20}>
            <Initials
              text={text}
              className={cn('lp-ring-cut h-9 w-9 bg-gradient-to-br', gradient)}
            />
          </OrbitItem>
        ))}
      </div>

      <div
        className="lp-orbit-reverse absolute inset-[17%] rounded-full border border-(--lp-border-strong)"
        style={{ '--lp-orbit-speed': '36s' }}
      >
        <OrbitItem angle={-30} ringReversed>
          <PlatformBadge kind="facebook" className="lp-ring-cut h-10 w-10" />
        </OrbitItem>
        <OrbitItem angle={150} ringReversed>
          <PlatformBadge kind="instagram" className="lp-ring-cut h-10 w-10" />
        </OrbitItem>
        <OrbitItem angle={60} ringReversed>
          <span className="lp-ring-cut flex h-8 w-8 items-center justify-center rounded-full bg-emerald-400 text-[#052e1c]">
            <ShieldCheck className="h-4 w-4" />
          </span>
        </OrbitItem>
      </div>

      <div className="absolute inset-[34%] rounded-full border border-(--lp-border-strong) bg-(--lp-surface)" />

      <div className="absolute inset-0 flex items-center justify-center">
        <span className="relative flex">
          <span className="lp-ping absolute inset-0 rounded-[22%] bg-fuchsia-500/40" />
          <LogoMark className="relative h-14 w-14 drop-shadow-[0_10px_30px_rgba(217,70,239,0.55)]" />
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Feature micro-visuals                                               */
/* ------------------------------------------------------------------ */

const WORKSPACES = ['Bloom Bakery', 'Northwind', 'Lumen Studio'];

/** A workspace switcher whose selection moves from client to client. */
export function WorkspaceSwitcher() {
  return (
    <div
      aria-hidden="true"
      className="relative mt-6 grid grid-cols-3 rounded-full border border-(--lp-border) bg-(--lp-surface) p-1 text-[11px] font-medium"
    >
      <span className="lp-switcher-thumb absolute top-1 bottom-1 left-1 w-[calc((100%-0.5rem)/3)] rounded-full bg-gradient-to-r from-indigo-500 to-pink-500 shadow-[0_8px_20px_-8px_rgba(236,72,153,0.7)]" />
      {WORKSPACES.map((name, i) => (
        <span
          key={name}
          className="lp-switcher-label relative truncate px-2 py-1.5 text-center"
          style={{ animationDelay: `${i * 2.5}s` }}
        >
          {name}
        </span>
      ))}
    </div>
  );
}

const HEALTH_ROWS = ['Token valid', 'Permissions granted', 'Page reachable'];

/** Health checks ticking green one after another once visible. */
export function HealthChecks() {
  const [ref, inView] = useInView({ threshold: 0.5 });
  return (
    <ul ref={ref} aria-hidden="true" className={cn('mt-5 space-y-1.5', inView && 'is-on')}>
      {HEALTH_ROWS.map((row, i) => (
        <li
          key={row}
          className="lp-tick flex items-center gap-2 rounded-lg border border-(--lp-border) bg-(--lp-surface) px-2.5 py-1.5 text-[11px] text-(--lp-text)"
          style={{ '--i': i }}
        >
          <span className="lp-tick-dot flex h-4 w-4 items-center justify-center rounded-full bg-emerald-400 text-[#052e1c]">
            <Check className="h-2.5 w-2.5" strokeWidth={3.5} />
          </span>
          {row}
        </li>
      ))}
    </ul>
  );
}

/** Facebook and Instagram shares growing into one combined bar (no numbers). */
export function FollowersMini() {
  const [ref, inView] = useInView({ threshold: 0.5 });
  return (
    <div ref={ref} aria-hidden="true" className="mt-5">
      {inView && <FollowerSplitBar className="h-2.5" delay={150} />}
      <div className="mt-2.5 flex justify-between text-[11px] text-(--lp-muted)">
        {FOLLOWER_SPLIT.map(({ kind, short, bar }) => (
          <span key={kind} className="flex items-center gap-1.5">
            <span className={cn('h-2 w-2 rounded-full', bar)} />
            {short}
          </span>
        ))}
      </div>
    </div>
  );
}

/** One caption flowing out to a Facebook Page and an Instagram account. */
export function ComposeFanout() {
  const id = useId();
  const paths = ['M0 48 C 55 48, 45 16, 100 16', 'M0 48 C 55 48, 45 80, 100 80'];
  return (
    <div
      aria-hidden="true"
      className="mt-6 grid grid-cols-[auto_1fr_auto] items-center gap-0 sm:max-w-md"
    >
      <div className="w-28 rounded-xl border border-(--lp-border) bg-(--lp-surface) p-2.5">
        <div className="flex items-center gap-1.5 text-[10px] font-medium text-(--lp-muted)">
          <SquarePen className="h-3 w-3" /> Caption
        </div>
        <div className="mt-2 space-y-1.5">
          <Line w="w-full" />
          <Line w="w-4/5" />
        </div>
        <span className="lp-tone lp-tone-pink mt-2 inline-flex items-center gap-0.5 rounded-full px-1.5 text-[9px]">
          <Hash className="h-2.5 w-2.5" />
          tags
        </span>
      </div>
      <svg viewBox="0 0 100 96" preserveAspectRatio="none" className="h-24 w-full">
        <defs>
          <linearGradient id={`${id}-flow`} x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor="#818cf8" />
            <stop offset="0.6" stopColor="#e879f9" />
            <stop offset="1" stopColor="#fb923c" />
          </linearGradient>
        </defs>
        {paths.map((d) => (
          <g key={d}>
            <path
              d={d}
              fill="none"
              className="stroke-(--lp-border-strong)"
              strokeWidth="1.5"
              vectorEffect="non-scaling-stroke"
            />
            <path
              d={d}
              fill="none"
              stroke={`url(#${id}-flow)`}
              strokeWidth="2"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
              className="lp-flow"
            />
          </g>
        ))}
      </svg>
      <div className="flex h-24 flex-col justify-between">
        {[
          ['facebook', 'Page'],
          ['instagram', 'Instagram'],
        ].map(([kind, label]) => (
          <span
            key={kind}
            className="inline-flex h-8 items-center gap-1.5 rounded-full border border-(--lp-border) bg-(--lp-card-solid) py-1 pr-2.5 pl-1 text-[10px] font-medium text-(--lp-text) shadow-(--lp-card-shadow)"
          >
            <PlatformBadge kind={kind} className="h-6 w-6" />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Token journey (security)                                            */
/* ------------------------------------------------------------------ */

const CIPHER_SEED = '9f3ac1e7·04bd5a2f·e81c6d93·7b2f';

function JourneyStage({ step, icon: Icon, title, body, children }) {
  return (
    <div className="relative flex min-w-0 flex-col rounded-2xl border border-(--lp-border) bg-(--lp-surface) p-4">
      <div className="flex items-center gap-2.5">
        <span className="lp-icon-tile h-9 w-9 rounded-xl">
          <Icon className="h-4 w-4" />
        </span>
        <span className="font-mono text-[10px] tracking-wider text-(--lp-faint)">STEP {step}</span>
      </div>
      <p className="mt-3 text-sm font-semibold text-(--lp-text)">{title}</p>
      <p className="mt-1 text-xs leading-relaxed text-(--lp-muted)">{body}</p>
      <div className="mt-auto pt-4">{children}</div>
    </div>
  );
}

function JourneyLink({ delay = 0 }) {
  return (
    <div className="relative flex h-10 items-center justify-center lg:h-auto">
      <div className="relative h-full w-px overflow-hidden bg-gradient-to-b from-indigo-400/50 to-pink-400/50 lg:h-px lg:w-full lg:bg-gradient-to-r">
        <span className="lp-beam top-0 hidden lg:block" style={{ animationDelay: `${delay}ms` }} />
        <span className="lp-beam-v left-0 lg:hidden" style={{ animationDelay: `${delay}ms` }} />
      </div>
      <span className="absolute flex h-7 w-7 items-center justify-center rounded-full border border-(--lp-border-strong) bg-(--lp-card-solid) text-(--lp-muted)">
        <ArrowRight className="h-3.5 w-3.5 rotate-90 lg:rotate-0" />
      </span>
    </div>
  );
}

/**
 * How a Meta token travels: Meta's own sign-in → exchanged server-side → encrypted at rest.
 * The ciphertext keeps "re-encrypting" while the graphic is on screen.
 */
export function TokenJourney() {
  const [ref, inView] = useInView({ threshold: 0.3 });
  const onScreen = useOnScreen(ref);
  const reduced = useReducedMotion();
  const cipher = useScramble(CIPHER_SEED, inView && onScreen && !reduced);

  return (
    <div ref={ref} aria-hidden="true" className="lp-card overflow-hidden p-4 sm:p-6">
      <div className="grid gap-0 lg:grid-cols-[1fr_3.5rem_1fr_3.5rem_1fr]">
        <JourneyStage
          step="01"
          icon={UserRound}
          title="Sign in on Meta’s own screen"
          body="Your client chooses which Pages and accounts to share. No password reaches SocialHub."
        >
          <div className="rounded-xl border border-(--lp-border) bg-(--lp-window-inset) p-3">
            <div className="flex items-center gap-1.5">
              <PlatformBadge kind="facebook" className="h-6 w-6" />
              <PlatformBadge kind="instagram" className="h-6 w-6" />
              <span className="ml-auto text-[10px] text-(--lp-faint)">Consent</span>
            </div>
            <div className="mt-3 space-y-1.5">
              <Line w="w-4/5" />
              <Line w="w-3/5" />
            </div>
            <span className="mt-3 flex h-7 items-center justify-center rounded-md bg-[#1877f2] text-[11px] font-semibold text-white">
              Continue as Maya
            </span>
          </div>
        </JourneyStage>

        <JourneyLink />

        <JourneyStage
          step="02"
          icon={Server}
          title="Exchanged on the server"
          body="The short-lived token is swapped for a long-lived one, server to server."
        >
          <div className="space-y-1.5 font-mono text-[11px]">
            <div className="flex items-center gap-2 rounded-lg border border-(--lp-border) bg-(--lp-window-inset) px-2.5 py-2">
              <Pill tone="amber">short</Pill>
              <span className="truncate text-(--lp-muted)">EAAGm0PX…q8Zd</span>
            </div>
            <div className="flex justify-center text-(--lp-faint)">
              <ArrowRight className="h-3.5 w-3.5 rotate-90" />
            </div>
            <div className="flex items-center gap-2 rounded-lg border border-(--lp-border) bg-(--lp-window-inset) px-2.5 py-2">
              <Pill tone="mint">long</Pill>
              <span className="truncate text-(--lp-muted)">EAAGzK2r…V4wA</span>
            </div>
          </div>
        </JourneyStage>

        <JourneyLink delay={1200} />

        <JourneyStage
          step="03"
          icon={Lock}
          title="Encrypted at rest"
          body="Stored AES-256-GCM encrypted. Never returned to the browser or written to logs."
        >
          <div className="rounded-xl border border-(--lp-border) bg-(--lp-window-inset) p-3">
            <div className="flex items-center gap-2">
              <span className="lp-lock-pulse flex h-6 w-6 items-center justify-center rounded-full bg-emerald-400 text-[#052e1c]">
                <Lock className="h-3 w-3" strokeWidth={2.5} />
              </span>
              <span className="font-mono text-[10px] tracking-wider text-(--lp-faint) uppercase">
                aes-256-gcm
              </span>
            </div>
            <p className="mt-2.5 font-mono text-[11px] leading-5 break-all text-(--lp-mint)">
              {cipher}
            </p>
          </div>
        </JourneyStage>
      </div>
      <SampleNote className="mt-4 text-right">Illustration · sample values</SampleNote>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Composer demo                                                       */
/* ------------------------------------------------------------------ */

const CAPTION =
  'Our autumn menu lands this Friday 🍂 Cinnamon buns, pumpkin lattes and a cosy corner seat waiting for you.';
const TAGS = ['#autumnmenu', '#bakerylove', '#localeats'];
const CHECKS = [
  'Caption fits Instagram’s 2,200 characters',
  '3 of 30 hashtags used',
  'Instagram post has a photo',
  'Alt text on every image',
  'Both accounts have publishing permissions',
];
const CHARS = Array.from(CAPTION);
const TYPE_END = CHARS.length;
const TAG_AT = (i) => TYPE_END + 8 + i * 7;
const CHECK_AT = (i) => TYPE_END + 34 + i * 9;
// The publish beat: the real-post confirmation is ticked, the button is pressed, and the
// Facebook Page post goes live. Instagram stays a preview (not yet verified with a real account).
const CONFIRM_AT = CHECK_AT(4) + 14;
const PRESS_AT = CONFIRM_AT + 12;
const PUBLISHED_AT = PRESS_AT + 28;
const LOOP_END = TYPE_END + 195;

const IG_ACTIONS = [Heart, MessageCircle, Send];
const FB_ACTIONS = [
  [ThumbsUp, 'Like'],
  [MessageCircle, 'Comment'],
  [Forward, 'Share'],
];

function PublishButton({ t }) {
  const published = t >= PUBLISHED_AT;
  const publishing = t >= PRESS_AT && !published;
  const armed = t >= CONFIRM_AT && !published;
  return (
    <span
      className={cn(
        'inline-flex min-w-[10.5rem] items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-medium transition-[scale] duration-200',
        published
          ? 'lp-tone lp-tone-mint'
          : armed
            ? 'bg-gradient-to-r from-indigo-500 to-pink-500 text-white shadow-[0_8px_20px_-8px_rgba(236,72,153,0.7)]'
            : 'bg-(--lp-surface-2) text-(--lp-muted)',
        t >= PRESS_AT && t < PRESS_AT + 4 && 'scale-95',
      )}
    >
      {published ? (
        // Only the Facebook Page post goes live; the mark says so.
        <>
          <PlatformDot kind="facebook" /> Published <DrawnCheck />
        </>
      ) : publishing ? (
        <>
          <LoaderCircle className="h-3 w-3 animate-spin" /> Publishing…
        </>
      ) : (
        <>
          <ShieldCheck className="h-3 w-3" /> Publish · confirm first
        </>
      )}
    </span>
  );
}

export function ComposerDemo() {
  const [ref, inView] = useInView({ threshold: 0.3 });
  const onScreen = useOnScreen(ref);
  const reduced = useReducedMotion();
  const [tick, setTick] = useState(0);
  // Under reduced motion the demo rests on its last frame: the Facebook Page post published.
  const t = reduced ? LOOP_END - 1 : tick;
  const running = inView && onScreen && !reduced;

  useEffect(() => {
    if (!running) return undefined;
    const id = setInterval(() => setTick((v) => (v >= LOOP_END ? 0 : v + 1)), 42);
    return () => clearInterval(id);
  }, [running]);

  const typed = CHARS.slice(0, Math.min(t, TYPE_END)).join('');
  const typing = t < TYPE_END;
  const tags = TAGS.filter((_, i) => t >= TAG_AT(i));
  const confirmed = t >= CONFIRM_AT;
  const published = t >= PUBLISHED_AT;

  return (
    <div ref={ref} className="relative" aria-hidden="true">
      <div className="lp-halo absolute -inset-6 rounded-[3rem] opacity-80" />
      <div className="lp-gradient-border lp-window relative grid gap-4 rounded-[1.75rem] p-4 shadow-(--lp-shadow-xl) sm:p-5 lg:grid-cols-2">
        {/* Compose side */}
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] text-(--lp-muted)">Post to</span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-(--lp-surface) py-1 pr-2.5 pl-1 text-[11px] text-(--lp-text) ring-1 ring-(--lp-border)">
              <PlatformBadge kind="facebook" className="h-5 w-5" /> Bloom Bakery
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-(--lp-surface) py-1 pr-2.5 pl-1 text-[11px] text-(--lp-text) ring-1 ring-(--lp-border)">
              <PlatformBadge kind="instagram" className="h-5 w-5" /> @bloom.bakes
            </span>
          </div>

          <div className="rounded-xl border border-(--lp-border) bg-(--lp-surface) p-3">
            <p className="mb-1.5 text-[10px] font-medium tracking-wider text-(--lp-faint) uppercase">
              Caption
            </p>
            <p className="min-h-[4.5rem] text-[13px] leading-relaxed text-(--lp-text)">
              {typed}
              {typing && <span className="lp-caret" />}
            </p>
            <div className="mt-2 flex min-h-6 flex-wrap gap-1.5">
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="lp-pop lp-tone lp-tone-pink rounded-full px-2 py-0.5 text-[11px]"
                >
                  {tag}
                </span>
              ))}
            </div>
            <div className="mt-2 flex items-center justify-between border-t border-(--lp-border) pt-2 text-[10px] text-(--lp-faint)">
              <span>Shared caption · customize per platform</span>
              <span className="tabular-nums">{typed.length} / 2,200</span>
            </div>
          </div>

          <div className="flex gap-2">
            <SamplePhoto kind="buns" className="h-14 w-14 shrink-0 rounded-lg" />
            <div className="flex h-14 flex-1 items-center rounded-lg border border-dashed border-(--lp-border-strong) px-3 text-[11px] text-(--lp-faint)">
              Alt text: “Cinnamon buns on a table at sunset”
            </div>
          </div>

          <div className="rounded-xl border border-(--lp-border) bg-(--lp-surface) p-3">
            <p className="mb-2 text-[10px] font-medium tracking-wider text-(--lp-faint) uppercase">
              Readiness
            </p>
            <ul className="space-y-1.5">
              {CHECKS.map((check, i) => {
                const done = t >= CHECK_AT(i);
                return (
                  <li key={check} className="flex items-center gap-2 text-[12px]">
                    <span
                      className={cn(
                        'flex h-4 w-4 shrink-0 items-center justify-center rounded-full transition-[background-color,color,scale] duration-300',
                        done
                          ? 'scale-100 bg-emerald-400 text-[#052e1c]'
                          : 'scale-90 bg-(--lp-surface-2) text-transparent',
                      )}
                    >
                      <Check className="h-2.5 w-2.5" strokeWidth={3.5} />
                    </span>
                    <span
                      className={cn(
                        'transition-colors duration-300',
                        done ? 'text-(--lp-text)' : 'text-(--lp-faint)',
                      )}
                    >
                      {check}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>

          {/* The real-post confirmation, always in place so nothing shifts when it is ticked. */}
          <div className="lp-tone lp-tone-amber flex items-start gap-2 rounded-xl px-3 py-2.5">
            <span
              className={cn(
                'mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors duration-300',
                confirmed
                  ? 'border-transparent bg-indigo-500 text-white'
                  : 'border-(--lp-border-strong) bg-(--lp-card-solid) text-transparent',
              )}
            >
              {confirmed && <Check className="lp-pop h-3 w-3" strokeWidth={3.5} />}
            </span>
            <span className="text-[11px] leading-snug text-(--lp-text)">
              I understand that this publishes a real post on these accounts.
            </span>
          </div>

          <div className="flex items-center justify-end gap-2">
            <span className="rounded-full px-3 py-1.5 text-[11px] text-(--lp-muted) ring-1 ring-(--lp-border)">
              Save draft
            </span>
            <PublishButton t={t} />
          </div>
        </div>

        {/* Preview side: the shapes of the app's own previews, never a count */}
        <div className="min-w-0 space-y-3">
          <div className="overflow-hidden rounded-xl border border-(--lp-border) bg-(--lp-window-inset)">
            <div className="flex items-center gap-2 px-3 py-2">
              <span className="rounded-full bg-gradient-to-br from-[#feda75] via-[#d62976] to-[#4f5bd5] p-[2px]">
                <Initials text="BB" className="h-6 w-6 bg-[#1a1530]" />
              </span>
              <span className="text-[12px] font-semibold text-(--lp-text)">bloom.bakes</span>
              <Pill tone="slate" className="ml-auto">
                Not published
              </Pill>
            </div>
            <SamplePhoto kind="buns" className="aspect-[4/3] w-full" />
            <div className="flex items-center gap-3 px-3 pt-2.5 text-(--lp-muted)">
              {IG_ACTIONS.map((Icon, i) => (
                <Icon key={i} className="h-4 w-4" strokeWidth={1.75} />
              ))}
              <Bookmark className="ml-auto h-4 w-4" strokeWidth={1.75} />
            </div>
            {/* Padding lives on the wrapper: on the clamped element it would reveal a 3rd line. */}
            <div className="px-3 pt-1.5 pb-2.5">
              <p className="line-clamp-2 min-h-10 text-[12px] leading-5 text-(--lp-muted)">
                <span className="font-semibold text-(--lp-text)">bloom.bakes</span> {typed}{' '}
                <span className="text-(--lp-link)">{tags.join(' ')}</span>
              </p>
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-(--lp-border) bg-(--lp-window-inset)">
            <div className="flex items-center gap-2 px-3 py-2">
              <PlatformBadge kind="facebook" className="h-7 w-7" />
              <div className="leading-tight">
                <p className="text-[12px] font-semibold text-(--lp-text)">Bloom Bakery</p>
                <p className="text-[10px] text-(--lp-faint)">Facebook Page</p>
              </div>
              {published ? (
                <Pill tone="mint" className="ml-auto">
                  <DrawnCheck className="h-2.5 w-2.5" /> Published
                </Pill>
              ) : (
                <Pill tone="slate" className="ml-auto">
                  Not published
                </Pill>
              )}
            </div>
            <div className="px-3 pb-2">
              <p className="line-clamp-2 min-h-10 text-[12px] leading-5 text-(--lp-muted)">
                {typed} <span className="text-(--lp-link)">{tags.join(' ')}</span>
              </p>
            </div>
            <SamplePhoto kind="buns" className="h-24 w-full" />
            <div className="flex items-center justify-around border-t border-(--lp-border) px-3 py-2 text-[11px] text-(--lp-muted)">
              {FB_ACTIONS.map(([Icon, label]) => (
                <span key={label} className="inline-flex items-center gap-1.5">
                  <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
                  {label}
                </span>
              ))}
            </div>
          </div>
        </div>
        <SampleNote className="-mt-1 text-right lg:col-span-2" />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Product tour mini screens                                           */
/* ------------------------------------------------------------------ */

function Row({ children, className, style }) {
  return (
    <div
      style={style}
      className={cn(
        'flex items-center gap-2.5 rounded-lg border border-(--lp-border) bg-(--lp-surface) px-3 py-2',
        className,
      )}
    >
      {children}
    </div>
  );
}

function TourOverview() {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ['Members', '4'],
          ['Invitations', '1'],
          ['Pages', '6'],
          ['Instagram', '5'],
        ].map(([l, v]) => (
          <div key={l} className="rounded-lg border border-(--lp-border) bg-(--lp-surface) p-2.5">
            <p className="text-lg font-semibold text-(--lp-text)">{v}</p>
            <p className="text-[10px] text-(--lp-muted)">{l}</p>
          </div>
        ))}
      </div>
      <div className="rounded-lg border border-(--lp-border) bg-(--lp-surface) p-3">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-[10px] text-(--lp-muted)">Combined followers</p>
          <p className="text-sm font-semibold text-(--lp-text) tabular-nums">
            {grouped.format(FOLLOWERS_TOTAL)}
          </p>
        </div>
        <FollowerSplitBar className="mt-2.5" delay={150} />
        <div className="mt-2.5 flex flex-wrap justify-between gap-x-3 gap-y-1">
          {FOLLOWER_SPLIT.map(({ kind, short, followers, bar }) => (
            <span key={kind} className="flex items-center gap-1.5 text-[10px]">
              <span className={cn('h-2 w-2 shrink-0 rounded-full', bar)} />
              <span className="text-(--lp-muted)">{short}</span>
              <span className="font-semibold text-(--lp-text) tabular-nums">
                {grouped.format(followers)}
              </span>
            </span>
          ))}
        </div>
      </div>
      <Row>
        <Check className="h-3.5 w-3.5 text-(--lp-mint)" />
        <span className="text-[11px] text-(--lp-text)">
          Getting started: connect your first account
        </span>
      </Row>
    </div>
  );
}

function TourAccounts() {
  return (
    <div className="space-y-2">
      <div className="flex gap-1 overflow-hidden">
        {['Overview', 'Logins', 'Pages', 'Instagram', 'Access'].map((tab, i) => (
          <span
            key={tab}
            className={cn(
              'rounded-md px-2 py-1 text-[10px] whitespace-nowrap',
              i === 2 ? 'bg-(--lp-surface-2) text-(--lp-text)' : 'text-(--lp-muted)',
            )}
          >
            {tab}
          </span>
        ))}
      </div>
      {HERO_ACCOUNTS.map(({ name, kind, status: [tone, label] }, i) => (
        <Row key={name} className="lp-fade" style={{ animationDelay: `${i * 70}ms` }}>
          <PlatformBadge kind={kind} className="h-6 w-6" />
          <span className="min-w-0 flex-1 truncate text-[11px] text-(--lp-text)">{name}</span>
          <Pill tone={tone}>{label}</Pill>
        </Row>
      ))}
    </div>
  );
}

function TourCompose() {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <div className="space-y-2">
        <Row className="flex-col items-start gap-2">
          <Line w="w-full" />
          <Line w="w-4/5" />
          <Line w="w-2/3" />
          <div className="flex gap-1">
            {TAGS.map((t) => (
              <span key={t} className="lp-tone lp-tone-pink rounded-full px-1.5 text-[9px]">
                {t}
              </span>
            ))}
          </div>
        </Row>
        <div className="flex gap-2">
          <SamplePhoto kind="buns" className="h-10 w-10 rounded-md" />
          <SamplePhoto kind="latte" className="h-10 w-10 rounded-md opacity-70" />
        </div>
      </div>
      <div className="overflow-hidden rounded-lg border border-(--lp-border)">
        <SamplePhoto kind="buns" className="h-20 w-full" />
        <div className="space-y-1.5 p-2">
          <Line w="w-full" />
          <Line w="w-1/2" />
          <Pill tone="slate">Not published</Pill>
        </div>
      </div>
    </div>
  );
}

const TEAM = [
  ['MA', 'Maya', 'Owner', 'from-pink-500 to-orange-400', 'pink'],
  ['DS', 'Dev', 'Admin', 'from-indigo-500 to-violet-500', 'indigo'],
  ['PR', 'Priya', 'Editor', 'from-amber-400 to-pink-500', 'mint'],
  ['LK', 'Leo', 'Viewer', 'from-sky-500 to-cyan-400', 'slate'],
];

function TourTeam() {
  return (
    <div className="space-y-2">
      {TEAM.map(([ini, name, role, grad, tone]) => (
        <Row key={name}>
          <Initials text={ini} className={cn('h-6 w-6 bg-gradient-to-br', grad)} />
          <span className="flex-1 text-[11px] text-(--lp-text)">{name}</span>
          <Pill tone={tone}>{role}</Pill>
        </Row>
      ))}
      <Row className="border-dashed">
        <MailPlus className="h-3.5 w-3.5 text-(--lp-muted)" />
        <span className="text-[11px] text-(--lp-muted)">Invite a teammate</span>
      </Row>
    </div>
  );
}

function TourActivity() {
  const items = [
    ['Maya', 'connected a Facebook login', 'from-pink-500 to-orange-400'],
    ['Dev', 'gave Priya access to 2 accounts', 'from-indigo-500 to-violet-500'],
    ['Priya', 'updated the draft “Autumn menu”', 'from-amber-400 to-pink-500'],
    ['Daily sync', 'refreshed @bloom.bakes', 'from-emerald-400 to-teal-500'],
  ];
  return (
    <ol className="relative space-y-3 pl-4 before:absolute before:top-1 before:bottom-1 before:left-[5px] before:w-px before:bg-(--lp-border-strong)">
      {items.map(([who, what, grad]) => (
        <li key={what} className="relative flex items-center gap-2">
          <span
            className={cn('absolute -left-4 h-2.5 w-2.5 rounded-full bg-gradient-to-br', grad)}
          />
          <span className="text-[11px] text-(--lp-muted)">
            <span className="font-semibold text-(--lp-text)">{who}</span> {what}
          </span>
        </li>
      ))}
    </ol>
  );
}

function TourSettings() {
  return (
    <div className="space-y-2">
      {['Workspace name', 'Workspace URL', 'Time zone'].map((l) => (
        <div key={l}>
          <p className="mb-1 text-[10px] text-(--lp-muted)">{l}</p>
          <div className="h-7 rounded-md border border-(--lp-border) bg-(--lp-surface)" />
        </div>
      ))}
      <Row className="border-(--lp-rose-ring) bg-(--lp-rose-bg) text-(--lp-rose)">
        <CircleAlert className="h-3.5 w-3.5" />
        <span className="text-[11px]">Danger zone · asks for your password</span>
      </Row>
    </div>
  );
}

function TourAccount() {
  return (
    <div className="space-y-2">
      <Row>
        <Initials text="MA" className="h-8 w-8 bg-gradient-to-br from-pink-500 to-orange-400" />
        <div className="space-y-1">
          <Line w="w-20" />
          <Line w="w-28" className="opacity-60" />
        </div>
      </Row>
      <Row>
        <Lock className="h-3.5 w-3.5 text-(--lp-muted)" />
        <span className="text-[11px] text-(--lp-text)">Change password</span>
      </Row>
      <Row>
        <UserRound className="h-3.5 w-3.5 text-(--lp-muted)" />
        <span className="text-[11px] text-(--lp-text)">Sign out of all devices</span>
      </Row>
    </div>
  );
}

const TOUR_SCREENS = {
  overview: TourOverview,
  accounts: TourAccounts,
  compose: TourCompose,
  team: TourTeam,
  activity: TourActivity,
  settings: TourSettings,
  account: TourAccount,
};

export function TourScreen({ id, path }) {
  const Screen = TOUR_SCREENS[id];
  return (
    <div className="relative" aria-hidden="true">
      <div className="lp-halo absolute -inset-4 rounded-[2.5rem] opacity-60" />
      <div className="lp-gradient-border lp-window relative overflow-hidden rounded-2xl shadow-(--lp-shadow-xl)">
        <WindowChrome path={path} />
        <div className="flex min-h-[17rem]">
          <MiniSidebar active={id} />
          <div key={id} className="lp-fade min-w-0 flex-1 p-4">
            <Screen />
          </div>
        </div>
        <SampleNote className="border-t border-(--lp-border) px-4 py-2 text-right" />
      </div>
    </div>
  );
}
