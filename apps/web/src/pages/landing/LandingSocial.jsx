/**
 * Social illustrations for the landing page: sample posts around the hero, post chips in the
 * marquee, a sync history line, a group-sharing board and a feed phone. Sample data only
 * (landingSamples.js), hidden from assistive technology on every root, and honest about the
 * product: only a Facebook Page post is ever "Published", Instagram stays a preview, and group
 * sharing is done by people, by hand.
 */
import {
  AtSign,
  Check,
  Copy,
  Hash,
  Heart,
  Megaphone,
  MessageCircle,
  MousePointer2,
  RefreshCw,
} from 'lucide-react';
import { cn } from '../../lib/utils.js';
import {
  DrawnCheck,
  Initials,
  Pill,
  PlatformDot,
  PostCard,
  SampleNote,
  SamplePhoto,
} from './LandingKit.jsx';
import { FEED_POSTS, GROUP_TASKS, HERO_POSTS, POST_CHIPS, SYNC_RUNS } from './landingSamples.js';
import { useInView } from './useMotion.js';

/* ------------------------------------------------------------------ */
/* Hero                                                                */
/* ------------------------------------------------------------------ */

// Fills the gutter beside the 848 px headline: 160 px at 1280, 200 px from about 1360.
const HERO_CARD_WIDTH = 'w-[clamp(10rem,calc(50vw-30rem),12.5rem)]';

/** A round glass chip holding one social glyph. Decoration only: never a count. */
function GlyphChip({ icon: Icon, tone, className }) {
  return (
    <span
      className={cn(
        'lp-glass flex h-10 w-10 items-center justify-center rounded-full shadow-(--lp-shadow-md)',
        className,
      )}
    >
      <Icon className={cn('h-4 w-4', tone)} strokeWidth={2} />
    </span>
  );
}

/**
 * One floating piece of the hero scene. Each concern owns its own wrapper, outermost first:
 * position, pointer depth, slow bob, entrance.
 */
function Floating({ className, depth, bob, bobDelay, enter, children }) {
  return (
    <div className={cn('absolute', className)}>
      <div className="lp-social-depth" style={{ '--depth': depth }}>
        <div
          className="lp-float"
          style={{ '--lp-delay': `${bobDelay}ms`, animationDuration: `${bob}s` }}
        >
          <div className="lp-rise" style={{ '--lp-delay': `${enter}ms` }}>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

/** A large outline glyph drifting very slowly in a gutter of the ink band. */
function DriftGlyph({ icon: Icon, className, delay }) {
  return (
    <div className={cn('absolute', className)}>
      <div className="lp-glyph-drift h-full" style={{ '--lp-delay': `${delay}ms` }}>
        <div className="lp-fade h-full" style={{ animationDelay: `${delay}ms` }}>
          <span className="flex h-full w-full items-center justify-center rounded-[2rem] border border-white/10 text-white/15">
            <Icon className="h-1/3 w-1/3" strokeWidth={1.25} />
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * The hero scene from 1280 px: the same sample post as a published Facebook Page post (left)
 * and an Instagram preview (right) beside the headline, two glyph chips and two outline
 * glyphs. It sits on the ink band, leans with the pointer and recedes as the page scrolls.
 */
export function HeroSocial() {
  return (
    <div
      aria-hidden="true"
      className="lp-hero-social pointer-events-none absolute inset-x-0 top-0 hidden h-[52rem] xl:block"
    >
      <DriftGlyph
        icon={Hash}
        className="top-[39rem] right-[calc(50%+33rem)] h-32 w-32"
        delay={2300}
      />
      <DriftGlyph
        icon={AtSign}
        className="top-[36.5rem] left-[calc(50%+33.5rem)] h-28 w-28"
        delay={2500}
      />

      <Floating
        className="top-[14rem] right-[calc(50%+28.5rem)]"
        depth={22}
        bob={9}
        bobDelay={0}
        enter={1500}
      >
        <PostCard
          {...HERO_POSTS[0]}
          drawDelay={2300}
          className={cn(HERO_CARD_WIDTH, '-rotate-6')}
        />
        <SampleNote className="lp-on-ink mt-4 text-center">Sample post</SampleNote>
      </Floating>
      <Floating
        className="top-[8.5rem] left-[calc(50%+28.5rem)]"
        depth={30}
        bob={10}
        bobDelay={1600}
        enter={1700}
      >
        <PostCard {...HERO_POSTS[1]} className={cn(HERO_CARD_WIDTH, 'rotate-[4deg]')} />
        <SampleNote className="lp-on-ink mt-4 text-center">Sample post</SampleNote>
      </Floating>

      <Floating
        className="lp-on-ink top-[10.25rem] right-[calc(50%+31.25rem)]"
        depth={40}
        bob={8}
        bobDelay={900}
        enter={2000}
      >
        <GlyphChip icon={Heart} tone="text-(--lp-pink)" />
      </Floating>
      <Floating
        className="lp-on-ink top-[29rem] left-[calc(50%+31.5rem)]"
        depth={36}
        bob={8.5}
        bobDelay={2400}
        enter={2150}
      >
        <GlyphChip icon={MessageCircle} tone="text-(--lp-indigo)" />
      </Floating>
    </div>
  );
}

/** Below 1280 px the two sample posts sit as a pair between the hero copy and the dashboard. */
export function HeroPostPair({ className }) {
  return (
    <div aria-hidden="true" className={cn('xl:hidden', className)}>
      <div className="relative mx-auto flex w-fit items-start justify-center">
        <div className="lp-float" style={{ animationDuration: '9s' }}>
          <div className="lp-rise" style={{ '--lp-delay': '1400ms' }}>
            <PostCard {...HERO_POSTS[0]} drawDelay={2200} className="w-36 -rotate-3 sm:w-44" />
          </div>
        </div>
        <div
          className="lp-float mt-8 -ml-3"
          style={{ '--lp-delay': '1500ms', animationDuration: '10s' }}
        >
          <div className="lp-rise" style={{ '--lp-delay': '1550ms' }}>
            <PostCard {...HERO_POSTS[1]} className="w-36 rotate-3 sm:w-44" />
          </div>
        </div>
        <div className="lp-on-ink absolute -top-4 -left-9">
          <div className="lp-float" style={{ '--lp-delay': '700ms', animationDuration: '8s' }}>
            <div className="lp-rise" style={{ '--lp-delay': '1800ms' }}>
              <GlyphChip icon={Heart} tone="text-(--lp-pink)" className="h-9 w-9" />
            </div>
          </div>
        </div>
        <div className="lp-on-ink absolute -right-9 bottom-16">
          <div className="lp-float" style={{ '--lp-delay': '2100ms', animationDuration: '8.5s' }}>
            <div className="lp-rise" style={{ '--lp-delay': '1900ms' }}>
              <GlyphChip icon={MessageCircle} tone="text-(--lp-indigo)" className="h-9 w-9" />
            </div>
          </div>
        </div>
      </div>
      <SampleNote className="lp-on-ink mt-3 text-center">Sample posts</SampleNote>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Marquee                                                             */
/* ------------------------------------------------------------------ */

/** The marquee's second row: sample posts with their real status words, moving the other way. */
export function PostChipRow() {
  return (
    <div aria-hidden="true" className="lp-marquee-track is-reverse">
      {[0, 1].map((copy) => (
        <div key={copy} className="flex shrink-0 gap-3 pr-3">
          {POST_CHIPS.map(({ title, kind, photo, status: [tone, label] }) => (
            <span
              key={title}
              className="inline-flex items-center gap-2.5 rounded-2xl border border-(--lp-border) bg-(--lp-card-solid) py-1.5 pr-3 pl-1.5 shadow-(--lp-card-shadow)"
            >
              <span className="relative shrink-0">
                <SamplePhoto kind={photo} className="h-9 w-9 rounded-xl" />
                <PlatformDot
                  kind={kind}
                  className="absolute -right-1 -bottom-1 ring-2 ring-(--lp-card-solid)"
                />
              </span>
              <span className="text-[13px] font-medium whitespace-nowrap text-(--lp-text)">
                {title}
              </span>
              <Pill tone={tone}>{label}</Pill>
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Features: sync history                                              */
/* ------------------------------------------------------------------ */

const SYNC_STEP = 330;

/**
 * A login's sync history: the line fills, five recorded attempts pop in (the third met a
 * temporary Meta failure and the next one went through), and the latest gets a drawn check.
 * No names, numbers or dates.
 */
export function SyncHistory() {
  const [ref, inView] = useInView({ threshold: 0.6 });
  const last = SYNC_RUNS.length - 1;
  return (
    <div
      ref={ref}
      aria-hidden="true"
      className="mt-5 rounded-xl border border-(--lp-border) bg-(--lp-surface) p-3"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-medium text-(--lp-text)">Sync history</p>
        <RefreshCw className="h-3 w-3 text-(--lp-faint)" />
      </div>
      <div className="relative mt-3 h-5">
        <span className="absolute inset-x-2.5 top-[9px] h-0.5 rounded-full bg-(--lp-border-strong)" />
        {inView && (
          <span
            className="lp-progress absolute inset-x-2.5 top-[9px] h-0.5 rounded-full bg-gradient-to-r from-indigo-400 via-fuchsia-400 to-emerald-400"
            style={{ animationDuration: `${SYNC_STEP * last}ms`, animationDelay: '150ms' }}
          />
        )}
        <div className="relative flex h-full items-center justify-between">
          {SYNC_RUNS.map((run, i) => (
            // A fixed slot per attempt, so nothing moves when the dots appear.
            <span key={i} className="flex h-5 w-5 items-center justify-center">
              {inView && (
                <span
                  className={cn(
                    'lp-pop flex h-5 w-5 items-center justify-center rounded-full',
                    run === 'ok' ? 'bg-emerald-400 text-[#052e1c]' : 'bg-amber-400 text-[#451a03]',
                  )}
                  style={{ animationDelay: `${150 + i * SYNC_STEP}ms` }}
                >
                  {i === last ? (
                    <DrawnCheck delay={350 + i * SYNC_STEP} className="h-3 w-3" />
                  ) : run === 'ok' ? (
                    <Check className="h-2.5 w-2.5" strokeWidth={3.5} />
                  ) : (
                    <RefreshCw className="h-2.5 w-2.5" strokeWidth={3} />
                  )}
                </span>
              )}
            </span>
          ))}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-(--lp-muted)">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-emerald-400" />
          Synced
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-amber-400" />
          Meta temporarily unavailable
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Roadmap: group sharing                                              */
/* ------------------------------------------------------------------ */

/** When the pointer presses "Mark as shared" on a row, counted from the board's start. */
const PRESS_AT = (i) => 1500 + i * 1100;

/** Two states in one grid cell, so the cell keeps its size when the second fades in. */
function Swap({ at, before, after, className }) {
  return (
    <span className={cn('grid justify-items-end', className)} style={{ '--at': `${at}ms` }}>
      <span className="lp-swap-out [grid-area:1/1]">{before}</span>
      <span className="lp-swap-in [grid-area:1/1]">{after}</span>
    </span>
  );
}

function TaskButtons({ at }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-flex items-center gap-1 rounded-full bg-(--lp-card-solid) px-2.5 py-1 text-[10px] font-medium text-(--lp-text) ring-1 ring-(--lp-border-strong)">
        <Copy className="h-3 w-3" /> Copy text
      </span>
      <span className="relative inline-flex">
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-indigo-500 to-violet-500 px-2.5 py-1 text-[10px] font-medium text-white',
            at && 'lp-share-press',
          )}
          style={at ? { animationDelay: `${at - 80}ms` } : undefined}
        >
          <Check className="h-3 w-3" strokeWidth={3} /> Mark as shared
        </span>
        {at && (
          <MousePointer2
            className="lp-share-pointer absolute top-3 right-3 h-4 w-4 fill-white text-slate-900"
            style={{ animationDelay: `${at - 600}ms` }}
          />
        )}
      </span>
    </span>
  );
}

function TaskRow({ task: { group, initials, tint, by }, index }) {
  const at = by ? PRESS_AT(index) : null;
  const toShare = <Pill tone="indigo">To share</Pill>;
  return (
    <li
      className="lp-tick flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-(--lp-border) bg-(--lp-card-solid) px-3 py-2.5"
      style={{ '--i': index }}
    >
      <Initials text={initials} className={cn('h-8 w-8 rounded-lg bg-gradient-to-br', tint)} />
      <div className="min-w-0 flex-1 leading-tight">
        <p className="truncate text-[12px] font-semibold text-(--lp-text)">{group}</p>
        <p className="truncate text-[10px] text-(--lp-muted)">Post as Bloom Bakery</p>
      </div>
      {by ? <Swap at={at} before={toShare} after={<Pill tone="mint">Shared</Pill>} /> : toShare}
      {by ? (
        <Swap
          at={at}
          className="ml-auto"
          before={<TaskButtons at={at} />}
          after={
            <span className="inline-flex items-center gap-1.5 py-0.5 text-[11px] text-(--lp-muted)">
              <Initials
                text={by.initials}
                className={cn('h-5 w-5 bg-gradient-to-br text-[8px]', by.tint)}
              />
              Shared by {by.name}
            </span>
          }
        />
      ) : (
        <span className="ml-auto">
          <TaskButtons />
        </span>
      )}
    </li>
  );
}

/**
 * Group sharing as it really works: a published Page post becomes one task per group, and
 * teammates post it by hand and mark it as shared. Plays once when the board comes into view.
 */
export function GroupShareBoard() {
  const [ref, inView] = useInView({ threshold: 0.45 });
  return (
    <div
      ref={ref}
      aria-hidden="true"
      className={cn(
        'lp-card grid gap-6 p-5 sm:p-6 md:grid-cols-[12rem_minmax(0,1fr)] md:gap-8 lg:grid-cols-[13rem_minmax(0,1fr)]',
        inView && 'is-on',
      )}
    >
      <PostCard
        kind="facebook"
        name="Bloom Bakery"
        sub="Facebook Page"
        photo="buns"
        status={['mint', 'Published']}
        lines
        className="hidden w-full self-start shadow-(--lp-card-shadow) md:block"
      />
      <div className="min-w-0">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-pink-500 text-white">
            <Megaphone className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-(--lp-text)">Group sharing</p>
            <p className="mt-0.5 text-xs text-(--lp-muted)">
              One task per group. Each is posted by hand on Facebook.
            </p>
          </div>
        </div>
        <ul className="mt-4 space-y-2">
          {GROUP_TASKS.map((task, i) => (
            <TaskRow key={task.group} task={task} index={i} />
          ))}
        </ul>
        <SampleNote className="mt-3 text-right" />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Closing card: feed phone                                            */
/* ------------------------------------------------------------------ */

/**
 * A phone rising from the bottom edge of the closing card, its feed of sample previews
 * drifting upward. The caller sizes it; the phone fills the height it is given.
 */
export function FeedPhone({ className }) {
  return (
    <div aria-hidden="true" className={cn('flex flex-col items-center', className)}>
      <SampleNote className="mb-3">Sample posts</SampleNote>
      <div className="lp-phone flex w-60 min-h-0 flex-1 flex-col">
        <div className="flex justify-center pt-2 pb-1">
          <span className="h-1.5 w-14 rounded-full bg-(--lp-border-strong)" />
        </div>
        <div className="flex items-center justify-between gap-2 px-3.5 py-2">
          <span className="text-[11px] font-semibold text-(--lp-text)">Preview</span>
          <Pill tone="slate">Not published</Pill>
        </div>
        <div className="relative min-h-0 flex-1 overflow-hidden">
          <div className="lp-feed">
            {[0, 1].map((copy) => (
              <div key={copy} className="space-y-3 px-3 pb-3">
                {FEED_POSTS.map((post) => (
                  <PostCard key={post.name} {...post} lines className="shadow-none" />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
