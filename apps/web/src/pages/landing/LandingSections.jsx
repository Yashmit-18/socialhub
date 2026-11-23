import { ArrowRight, Check, Minus, Sparkles, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router';
import { FacebookIcon, InstagramIcon } from '../../components/ui/Brand.jsx';
import { cn } from '../../lib/utils.js';
import {
  COMPOSER_POINTS,
  FAQ,
  FEATURES,
  META_FACTS,
  META_STEPS,
  PAINS,
  ROADMAP,
  ROLE_COLUMNS,
  ROLE_ROWS,
  SECURITY,
  STATS,
  STEPS,
  TOUR,
} from './landingContent.js';
import {
  ComposeFanout,
  ComposerDemo,
  FollowersMini,
  HealthChecks,
  OrbitGraphic,
  TokenJourney,
  TourScreen,
  WorkspaceSwitcher,
} from './LandingVisuals.jsx';
import { CountUp, Reveal, Words } from './motion.jsx';
import { useInView, useMagnetic, useReducedMotion, useScrollProgress } from './useMotion.js';

export const CONTAINER = 'mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8';

const H2 =
  'text-3xl font-semibold tracking-[-0.035em] text-balance text-(--lp-text) sm:text-5xl sm:leading-[1.06]';

function SectionHeading({ id, kicker, title, body, className }) {
  return (
    <Reveal className={cn('mx-auto max-w-3xl text-center', className)}>
      <p className="lp-kicker">{kicker}</p>
      <h2 id={id} className={cn(H2, 'mt-5')}>
        <Words text={title} />
      </h2>
      {body && (
        <p className="mt-5 text-base leading-relaxed text-pretty text-(--lp-muted) sm:text-lg">
          {body}
        </p>
      )}
    </Reveal>
  );
}

function IconTile({ icon: Icon, className }) {
  return (
    <span className={cn('lp-icon-tile', className)}>
      <Icon className="h-5 w-5" />
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Features                                                            */
/* ------------------------------------------------------------------ */

/** Small animated illustrations for some bento cards, keyed by feature title. */
const FEATURE_VISUALS = {
  'A workspace for every client': WorkspaceSwitcher,
  'Health on every account': HealthChecks,
  'Combined followers': FollowersMini,
  'One composer for every destination': ComposeFanout,
};

export function FeaturesSection() {
  return (
    <section
      id="features"
      aria-labelledby="features-title"
      className="relative scroll-mt-24 py-24 sm:py-32"
    >
      <div className={CONTAINER}>
        <SectionHeading
          id="features-title"
          kicker="Why SocialHub"
          title="Built for the way creators and agencies actually work"
          body="Managing other people’s Facebook Pages and Instagram accounts shouldn’t mean shared passwords, mystery expiries and everyone seeing everything."
        />

        <div className="mt-14 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {PAINS.map(({ pain, fix }, i) => (
            <Reveal key={pain} delay={i * 90} className="lp-card lp-spot group p-5">
              <p className="flex items-start gap-2 text-sm text-(--lp-faint)">
                <X className="mt-0.5 h-4 w-4 shrink-0 text-(--lp-rose)" />
                <span className="line-through decoration-rose-400/50">{pain}</span>
              </p>
              <div className="my-4 h-px bg-gradient-to-r from-transparent via-(--lp-border-strong) to-transparent" />
              <p className="flex items-start gap-2 text-sm leading-relaxed text-(--lp-text)">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-(--lp-mint)" />
                {fix}
              </p>
            </Reveal>
          ))}
        </div>

        <div className="mt-6 grid auto-rows-auto gap-3 [grid-auto-flow:dense] md:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ icon, title, body, where, size }, i) => {
            const Visual = FEATURE_VISUALS[title];
            return (
              <Reveal
                key={title}
                delay={(i % 3) * 90}
                variant="scale"
                className={cn(
                  'lp-card lp-spot lp-lift lp-border-anim flex flex-col p-6 sm:p-7',
                  size === 'wide' && 'lg:col-span-2',
                  size === 'tall' && 'md:row-span-2',
                )}
              >
                <IconTile icon={icon} />
                <h3 className="mt-5 text-lg font-semibold tracking-tight text-(--lp-text)">
                  {title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-(--lp-muted)">{body}</p>
                {Visual && <Visual />}
                {size === 'tall' && (
                  <div className="my-6 flex flex-1 items-center justify-center">
                    <OrbitGraphic className="relative w-full max-w-[17rem]" />
                  </div>
                )}
                <p className="mt-auto pt-5 text-xs text-(--lp-faint)">
                  <span className="rounded-full border border-(--lp-border) bg-(--lp-surface) px-2.5 py-1">
                    In the app: {where}
                  </span>
                </p>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Stats band                                                          */
/* ------------------------------------------------------------------ */

export function StatsBand() {
  return (
    <section aria-label="SocialHub in numbers" className="relative py-10">
      <div className={CONTAINER}>
        <Reveal
          variant="blur"
          className="lp-card relative grid grid-cols-2 divide-(--lp-border) overflow-hidden lg:grid-cols-4 lg:divide-x"
        >
          <span
            aria-hidden="true"
            className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-fuchsia-400/70 to-transparent"
          />
          {STATS.map(({ value, suffix, label, note }) => (
            <div key={label} className="p-5 sm:p-8">
              <CountUp
                value={value}
                suffix={suffix}
                className="lp-grad-text block text-4xl font-semibold tracking-tight tabular-nums sm:text-5xl"
              />
              <p className="mt-3 text-sm font-medium text-(--lp-text)">{label}</p>
              <p className="mt-1 text-xs text-(--lp-faint)">{note}</p>
            </div>
          ))}
        </Reveal>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* How it works                                                        */
/* ------------------------------------------------------------------ */

export function HowItWorksSection() {
  const listRef = useRef(null);
  const fillX = useRef(null);
  const fillY = useRef(null);
  const headX = useRef(null);
  const headY = useRef(null);
  const [reached, setReached] = useState(-1);

  // The connector fills as you scroll through the steps; each step lights up as it is reached.
  useScrollProgress(listRef, (p) => {
    if (fillX.current) fillX.current.style.transform = `scaleX(${p})`;
    if (fillY.current) fillY.current.style.transform = `scaleY(${p})`;
    // The glowing head shows only while the line is filling.
    const headOpacity = p > 0 && p < 1 ? '1' : '0';
    if (headX.current) {
      headX.current.style.left = `${p * 100}%`;
      headX.current.style.opacity = headOpacity;
    }
    if (headY.current) {
      headY.current.style.top = `${p * 100}%`;
      headY.current.style.opacity = headOpacity;
    }
    setReached(p <= 0 ? -1 : Math.floor(p * (STEPS.length - 1) + 0.001));
  });

  return (
    <section
      id="how-it-works"
      aria-labelledby="how-title"
      className="relative scroll-mt-24 py-24 sm:py-32"
    >
      <div aria-hidden="true" className="lp-section-glow top-20" />
      <div className={cn(CONTAINER, 'relative')}>
        <SectionHeading
          id="how-title"
          kicker="How it works"
          title="From sign-up to your first post in four steps"
          body="No passwords to collect and no spreadsheets to keep in sync. Meta handles the sign-in, and SocialHub keeps everything organised after that."
        />

        <ol ref={listRef} className="relative mt-16 grid gap-8 lg:grid-cols-4 lg:gap-5">
          {/* Connector: a faint track, a scroll-linked gradient fill and a glowing head. */}
          <div
            aria-hidden="true"
            className="absolute top-7 right-[12.5%] left-[12.5%] hidden h-px bg-(--lp-border-strong) lg:block"
          >
            <span
              ref={fillX}
              className="lp-fill-x absolute inset-0 bg-gradient-to-r from-indigo-400 via-fuchsia-400 to-orange-300"
            />
            <span
              ref={headX}
              className="absolute top-1/2 left-0 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white opacity-0 shadow-[0_0_14px_4px_rgba(236,72,153,0.7)] transition-opacity duration-300"
            />
          </div>
          <div
            aria-hidden="true"
            className="absolute top-7 bottom-7 left-7 w-px bg-(--lp-border-strong) lg:hidden"
          >
            <span
              ref={fillY}
              className="lp-fill-y absolute inset-0 bg-gradient-to-b from-indigo-400 via-fuchsia-400 to-orange-300"
            />
            <span
              ref={headY}
              className="absolute top-0 left-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white opacity-0 shadow-[0_0_14px_4px_rgba(236,72,153,0.7)] transition-opacity duration-300"
            />
          </div>

          {STEPS.map(({ icon: Icon, title, body, soon }, i) => (
            <Reveal as="li" key={title} delay={i * 140} className="relative flex gap-5 lg:block">
              <span
                data-on={i <= reached}
                className="lp-step-node relative z-10 flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-(--lp-card-solid) ring-1 ring-(--lp-border-strong) lg:mx-auto"
              >
                <span className="lp-step-glow absolute inset-0 rounded-2xl bg-gradient-to-br from-indigo-500/35 to-fuchsia-500/25" />
                <Icon className="relative h-6 w-6 text-(--lp-text)" />
                <span className="absolute -top-2 -right-2 flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-pink-500 to-orange-400 text-[11px] font-bold text-white shadow-lg">
                  {i + 1}
                </span>
              </span>
              <div className="pb-2 lg:mt-6 lg:text-center">
                <h3 className="text-lg font-semibold text-(--lp-text)">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-(--lp-muted)">{body}</p>
                {soon && (
                  <p className="lp-tone lp-tone-pink mt-3 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs">
                    <Sparkles className="h-3 w-3" /> {soon}
                  </p>
                )}
              </div>
            </Reveal>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Product tour                                                        */
/* ------------------------------------------------------------------ */

const TOUR_INTERVAL = 7000;

export function TourSection() {
  const [active, setActive] = useState(0);
  const [autoplay, setAutoplay] = useState(true);
  const [ref, inView] = useInView({ threshold: 0.3 });
  const reduced = useReducedMotion();
  const tabRefs = useRef([]);
  const baseId = useId();
  const playing = autoplay && inView && !reduced;

  useEffect(() => {
    if (!playing) return undefined;
    const id = setTimeout(() => setActive((i) => (i + 1) % TOUR.length), TOUR_INTERVAL);
    return () => clearTimeout(id);
  }, [playing, active]);

  const select = (index, focus = false) => {
    setAutoplay(false);
    setActive(index);
    if (focus) tabRefs.current[index]?.focus();
  };

  const onKeyDown = (event) => {
    const last = TOUR.length - 1;
    const next = {
      ArrowRight: active === last ? 0 : active + 1,
      ArrowLeft: active === 0 ? last : active - 1,
      Home: 0,
      End: last,
    }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    select(next, true);
  };

  const page = TOUR[active];

  return (
    <section
      id="tour"
      aria-labelledby="tour-title"
      className="relative scroll-mt-24 py-24 sm:py-32"
    >
      <div className={CONTAINER}>
        <SectionHeading
          id="tour-title"
          kicker="Product tour"
          title="Every page, explained"
          body="A quick walk through each part of SocialHub: what it shows, who can use it and what it’s for."
        />

        <div ref={ref} className="mt-14">
          <Reveal>
            <div
              role="tablist"
              aria-label="SocialHub pages"
              className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-2 sm:mx-0 sm:flex-wrap sm:justify-center sm:px-0"
              onKeyDown={onKeyDown}
            >
              {TOUR.map(({ id, icon: Icon, label }, i) => {
                const selected = i === active;
                return (
                  <button
                    key={id}
                    ref={(node) => {
                      tabRefs.current[i] = node;
                    }}
                    type="button"
                    role="tab"
                    id={`${baseId}-tab-${id}`}
                    aria-selected={selected}
                    aria-controls={`${baseId}-panel`}
                    tabIndex={selected ? 0 : -1}
                    onClick={() => select(i)}
                    className={cn(
                      'relative inline-flex shrink-0 items-center gap-2 overflow-hidden rounded-full px-4 py-2 text-sm transition-[color,background-color,box-shadow] duration-300',
                      selected
                        ? 'bg-(--lp-card-solid) text-(--lp-text) shadow-(--lp-card-shadow) ring-1 ring-(--lp-border-strong)'
                        : 'text-(--lp-muted) ring-1 ring-(--lp-border) hover:bg-(--lp-hover) hover:text-(--lp-text)',
                    )}
                  >
                    <Icon className={cn('h-4 w-4', selected && 'text-(--lp-accent)')} />
                    {label}
                    {selected && playing && (
                      <span
                        key={`progress-${active}`}
                        aria-hidden="true"
                        className="lp-progress absolute bottom-0 left-0 h-0.5 w-full bg-gradient-to-r from-indigo-400 via-fuchsia-400 to-orange-300"
                        style={{ animationDuration: `${TOUR_INTERVAL}ms` }}
                      />
                    )}
                  </button>
                );
              })}
            </div>
          </Reveal>

          <div
            role="tabpanel"
            id={`${baseId}-panel`}
            aria-labelledby={`${baseId}-tab-${page.id}`}
            className="mt-10 grid items-center gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:gap-14"
          >
            <div key={page.id} className="lp-fade">
              <p className="inline-flex rounded-md bg-(--lp-surface-2) px-2 py-1 font-mono text-xs text-(--lp-faint)">
                {page.path}
              </p>
              <h3 className="mt-4 text-2xl font-semibold tracking-tight text-(--lp-text) sm:text-3xl">
                {page.title}
              </h3>
              <p className="mt-4 leading-relaxed text-(--lp-muted)">{page.body}</p>
              <ul className="mt-6 space-y-3">
                {page.points.map((point, i) => (
                  <li
                    key={point}
                    className="lp-rise flex items-start gap-3 text-sm text-(--lp-text)"
                    style={{ '--lp-delay': `${120 + i * 70}ms` }}
                  >
                    <span className="lp-tone lp-tone-mint mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full">
                      <Check className="h-3 w-3" strokeWidth={3} />
                    </span>
                    {point}
                  </li>
                ))}
              </ul>
              {page.note && (
                <p className="lp-tone lp-tone-pink mt-6 rounded-xl p-3 text-sm">{page.note}</p>
              )}
            </div>
            <TourScreen id={page.id} path={page.path} />
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Composer spotlight                                                  */
/* ------------------------------------------------------------------ */

export function ComposerSection() {
  return (
    <section
      id="composer"
      aria-labelledby="composer-title"
      className="relative scroll-mt-24 py-24 sm:py-32"
    >
      <div aria-hidden="true" className="lp-section-glow top-32" />
      <div
        className={cn(
          CONTAINER,
          'relative grid items-center gap-12 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16',
        )}
      >
        <Reveal variant="left">
          <p className="lp-kicker">Universal composer</p>
          <h2 id="composer-title" className={cn(H2, 'mt-5')}>
            Write once.
            <br />
            <span className="lp-grad-text">Fit every feed.</span>
          </h2>
          <p className="mt-5 text-base leading-relaxed text-(--lp-muted) sm:text-lg">
            Pick the Pages and Instagram accounts, write one caption or tailor it per platform, and
            see exactly how it will look before it goes anywhere.
          </p>
          <ul className="mt-8 space-y-4">
            {COMPOSER_POINTS.map(({ icon: Icon, text }) => (
              <li
                key={text}
                className="flex items-start gap-3 text-sm leading-relaxed text-(--lp-text)"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-(--lp-surface) ring-1 ring-(--lp-border)">
                  <Icon className="h-4 w-4 text-(--lp-fuchsia)" />
                </span>
                <span className="pt-1.5">{text}</span>
              </li>
            ))}
          </ul>
          <p className="mt-8 text-sm text-(--lp-faint)">
            Publishing and scheduling are in development. Until they ship, nothing is sent to
            Facebook or Instagram.
          </p>
        </Reveal>
        <Reveal delay={150} variant="right">
          <ComposerDemo />
        </Reveal>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Roles                                                               */
/* ------------------------------------------------------------------ */

const ROLE_BADGES = [
  'bg-gradient-to-r from-pink-500 to-orange-400 text-white',
  'lp-tone lp-tone-indigo',
  'lp-tone lp-tone-mint',
  'lp-tone lp-tone-slate',
];

function RoleCell({ value }) {
  if (value === true) {
    return (
      <span className="lp-tone lp-tone-mint inline-flex h-6 w-6 items-center justify-center rounded-full">
        <Check className="h-3.5 w-3.5" strokeWidth={3} />
        <span className="sr-only">Yes</span>
      </span>
    );
  }
  if (value === false) {
    return (
      <span className="inline-flex h-6 w-6 items-center justify-center text-(--lp-faint)">
        <Minus className="h-3.5 w-3.5" />
        <span className="sr-only">No</span>
      </span>
    );
  }
  return <span className="text-xs whitespace-nowrap text-(--lp-indigo)">{value}</span>;
}

export function RolesSection() {
  return (
    <section
      id="roles"
      aria-labelledby="roles-title"
      className="relative scroll-mt-24 py-24 sm:py-32"
    >
      <div className={CONTAINER}>
        <SectionHeading
          id="roles-title"
          kicker="Teams & roles"
          title="Everyone gets exactly the access they need"
          body="Four roles with a strict hierarchy. People can only manage teammates below their own rank, and editors and viewers only see the social accounts you assign them."
        />
        <Reveal variant="scale" className="lp-card mx-auto mt-14 max-w-5xl overflow-hidden">
          {/* Phones: one block per capability instead of a sideways-scrolling table. */}
          <ul className="divide-y divide-(--lp-border) sm:hidden">
            {ROLE_ROWS.map(({ label, cells }) => (
              <li key={label} className="p-4">
                <p className="text-sm text-(--lp-text)">{label}</p>
                <ul className="mt-3 flex flex-wrap gap-1.5">
                  {cells.map((value, i) => (
                    <li
                      key={ROLE_COLUMNS[i]}
                      className={cn(
                        'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs',
                        value === true && 'lp-tone lp-tone-mint',
                        typeof value === 'string' && 'lp-tone lp-tone-indigo',
                        value === false &&
                          'text-(--lp-faint) line-through ring-1 ring-(--lp-border) ring-inset',
                      )}
                    >
                      {value !== false && <Check className="h-3 w-3" strokeWidth={3} />}
                      {ROLE_COLUMNS[i]}
                      {typeof value === 'string' && `: ${value.toLowerCase()}`}
                      {value === false && <span className="sr-only"> (no)</span>}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full min-w-[40rem] text-left text-sm">
              <caption className="sr-only">What each workspace role can do</caption>
              <thead>
                <tr className="border-b border-(--lp-border) bg-(--lp-surface)">
                  <th scope="col" className="px-6 py-5 font-medium text-(--lp-muted)">
                    Capability
                  </th>
                  {ROLE_COLUMNS.map((role, i) => (
                    <th key={role} scope="col" className="px-4 py-5 text-center">
                      <span
                        className={cn(
                          'inline-flex rounded-full px-3 py-1 text-xs font-semibold',
                          ROLE_BADGES[i],
                        )}
                      >
                        {role}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ROLE_ROWS.map(({ label, cells }) => (
                  <tr
                    key={label}
                    className="border-b border-(--lp-border) transition-colors last:border-0 hover:bg-(--lp-hover)"
                  >
                    <th scope="row" className="px-6 py-4 font-normal text-(--lp-text)">
                      {label}
                    </th>
                    {cells.map((value, i) => (
                      <td key={ROLE_COLUMNS[i]} className="px-4 py-4 text-center">
                        <RoleCell value={value} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Security                                                            */
/* ------------------------------------------------------------------ */

export function SecuritySection() {
  return (
    <section
      id="security"
      aria-labelledby="security-title"
      className="relative scroll-mt-24 py-24 sm:py-32"
    >
      <div aria-hidden="true" className="lp-section-glow top-24" />
      <div className={cn(CONTAINER, 'relative')}>
        <SectionHeading
          id="security-title"
          kicker="Security & trust"
          title="Your clients trust you with their accounts. We take that seriously."
          body="SocialHub only talks to Meta through official APIs, keeps every token encrypted on the server and checks permissions on every request."
        />
        <Reveal variant="blur" className="mt-14">
          <TokenJourney />
        </Reveal>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {SECURITY.map(({ icon, title, body }, i) => (
            <Reveal
              key={title}
              delay={(i % 3) * 90}
              className="lp-card lp-spot lp-lift lp-border-anim p-6"
            >
              <IconTile icon={icon} className="lp-icon-tile-mint" />
              <h3 className="mt-5 font-semibold text-(--lp-text)">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-(--lp-muted)">{body}</p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Meta setup                                                          */
/* ------------------------------------------------------------------ */

const FLOWS = [
  {
    name: 'Facebook Login for Business',
    icon: FacebookIcon,
    badge: 'bg-[#1877f2]',
    signsIn: 'A person’s Facebook account',
    gives:
      'Every Facebook Page they can work on, plus the Instagram professional account linked to each Page.',
  },
  {
    name: 'Instagram Login',
    icon: InstagramIcon,
    badge: 'bg-gradient-to-br from-[#feda75] via-[#d62976] to-[#4f5bd5]',
    signsIn: 'An Instagram Business or Creator account',
    gives: 'That one Instagram account. No Facebook Page is needed.',
  },
];

export function MetaSection() {
  return (
    <section
      id="meta"
      aria-labelledby="meta-title"
      className="relative scroll-mt-24 py-24 sm:py-32"
    >
      <div className={CONTAINER}>
        <SectionHeading
          id="meta-title"
          kicker="Connecting Meta"
          title="How the Facebook & Instagram connection works, in plain English"
          body="SocialHub supports Meta’s two official sign-in flows. Use one or both, for as many logins as you like in each workspace."
        />

        <div className="mt-14 grid gap-3 md:grid-cols-2">
          {FLOWS.map(({ name, icon: Icon, badge, signsIn, gives }, i) => (
            <Reveal
              key={name}
              delay={i * 120}
              variant={i === 0 ? 'left' : 'right'}
              className="lp-card lp-spot p-6 sm:p-7"
            >
              <div className="flex items-center gap-3">
                <span
                  className={cn(
                    'flex h-11 w-11 items-center justify-center rounded-xl text-white shadow-lg',
                    badge,
                  )}
                >
                  <Icon className="h-5 w-5" />
                </span>
                <h3 className="text-lg font-semibold text-(--lp-text)">{name}</h3>
              </div>
              <dl className="mt-5 space-y-3 text-sm">
                <div>
                  <dt className="text-xs tracking-wider text-(--lp-faint) uppercase">
                    Signs in with
                  </dt>
                  <dd className="mt-1 text-(--lp-text)">{signsIn}</dd>
                </div>
                <div>
                  <dt className="text-xs tracking-wider text-(--lp-faint) uppercase">
                    Gives SocialHub
                  </dt>
                  <dd className="mt-1 text-(--lp-text)">{gives}</dd>
                </div>
              </dl>
            </Reveal>
          ))}
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <Reveal className="lp-card p-6 sm:p-7">
            <h3 className="font-semibold text-(--lp-text)">
              Setting it up (one time, by an admin)
            </h3>
            <ol className="relative mt-5 space-y-4 before:absolute before:top-3 before:bottom-3 before:left-3.5 before:w-px before:bg-(--lp-border-strong)">
              {META_STEPS.map(({ title, body }, i) => (
                <li key={title} className="relative flex gap-4">
                  <span className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-(--lp-card-solid) text-xs font-semibold text-(--lp-text) ring-1 ring-(--lp-border-strong)">
                    {i + 1}
                  </span>
                  <div>
                    <p className="text-sm font-medium text-(--lp-text)">{title}</p>
                    <p className="mt-0.5 text-sm text-(--lp-muted)">{body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </Reveal>
          <div className="grid gap-3 sm:grid-cols-2">
            {META_FACTS.map(({ title, body }, i) => (
              <Reveal key={title} delay={i * 90} className="lp-card lp-spot p-5">
                <p className="text-xs font-semibold tracking-wider text-(--lp-fuchsia) uppercase">
                  Good to know
                </p>
                <h3 className="mt-2 font-semibold text-(--lp-text)">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-(--lp-muted)">{body}</p>
              </Reveal>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Roadmap                                                             */
/* ------------------------------------------------------------------ */

const ROADMAP_TONES = {
  mint: { dot: 'bg-emerald-400', pill: 'lp-tone-mint', bar: 'from-emerald-400' },
  indigo: { dot: 'bg-indigo-400', pill: 'lp-tone-indigo', bar: 'from-indigo-400' },
  pink: { dot: 'bg-pink-400', pill: 'lp-tone-pink', bar: 'from-pink-400' },
  amber: { dot: 'bg-amber-400', pill: 'lp-tone-amber', bar: 'from-amber-400' },
};

export function RoadmapSection() {
  return (
    <section
      id="roadmap"
      aria-labelledby="roadmap-title"
      className="relative scroll-mt-24 py-24 sm:py-32"
    >
      <div className={CONTAINER}>
        <SectionHeading
          id="roadmap-title"
          kicker="Roadmap"
          title="What’s ready, and what’s next"
          body="An honest status for every part of SocialHub. Nothing is called ready until it works."
        />
        <div className="relative mt-14 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {ROADMAP.map(({ status, tone, title, items }, i) => (
            <Reveal
              key={title}
              delay={i * 100}
              className="lp-card lp-spot lp-lift flex flex-col overflow-hidden p-6"
            >
              <span
                aria-hidden="true"
                className={cn(
                  'absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r to-transparent',
                  ROADMAP_TONES[tone].bar,
                )}
              />
              <span
                className={cn(
                  'lp-tone inline-flex w-fit items-center gap-2 rounded-full px-2.5 py-1 text-xs font-medium',
                  ROADMAP_TONES[tone].pill,
                )}
              >
                <span className="relative flex h-2 w-2">
                  {tone !== 'mint' && (
                    <span
                      className={cn(
                        'lp-ping absolute inset-0 rounded-full',
                        ROADMAP_TONES[tone].dot,
                      )}
                    />
                  )}
                  <span className={cn('relative h-2 w-2 rounded-full', ROADMAP_TONES[tone].dot)} />
                </span>
                {status}
              </span>
              <h3 className="mt-5 font-semibold text-(--lp-text)">{title}</h3>
              <ul className="mt-3 space-y-2">
                {items.map((item) => (
                  <li key={item} className="flex gap-2 text-sm text-(--lp-muted)">
                    <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-(--lp-faint)" />
                    {item}
                  </li>
                ))}
              </ul>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* FAQ                                                                 */
/* ------------------------------------------------------------------ */

export function FaqSection() {
  return (
    <section id="faq" aria-labelledby="faq-title" className="relative scroll-mt-24 py-24 sm:py-32">
      <div className={CONTAINER}>
        <SectionHeading id="faq-title" kicker="FAQ" title="Questions, answered" />
        <div className="mx-auto mt-12 max-w-3xl space-y-3">
          {FAQ.map(({ q, a }, i) => (
            <Reveal key={q} delay={Math.min(i, 4) * 60}>
              <details className="lp-faq lp-card px-5 sm:px-6">
                <summary className="flex items-center justify-between gap-4 py-5 text-left font-medium text-(--lp-text)">
                  {q}
                  <span aria-hidden="true" className="lp-faq-icon" />
                </summary>
                <p className="lp-faq-body pr-10 pb-5 text-sm leading-relaxed text-(--lp-muted)">
                  {a}
                </p>
              </details>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Final call to action                                                */
/* ------------------------------------------------------------------ */

export function CtaSection({ signedIn }) {
  const magnetic = useMagnetic();
  return (
    <section aria-labelledby="cta-title" className="relative py-24 sm:py-32">
      <div className={CONTAINER}>
        <Reveal
          variant="scale"
          className="lp-island lp-border-anim is-always relative overflow-hidden rounded-[2rem] border border-(--lp-border) px-6 py-16 sm:px-14 sm:py-20"
        >
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,rgba(99,102,241,0.4),transparent_55%),radial-gradient(ellipse_at_bottom_right,rgba(236,72,153,0.32),transparent_55%)]" />
          <div className="lp-grid opacity-70" aria-hidden="true" />
          <OrbitGraphic className="pointer-events-none absolute top-1/2 -right-24 hidden w-[30rem] -translate-y-1/2 opacity-70 [--lp-ring-bg:var(--lp-bg-2)] lg:block" />
          <div className="relative max-w-2xl">
            <h2 id="cta-title" className={H2}>
              Give every client a calm, <span className="lp-grad-text">organised home.</span>
            </h2>
            <p className="mt-5 text-base leading-relaxed text-(--lp-muted) sm:text-lg">
              Create a workspace, connect your first Facebook Page or Instagram account and invite
              your team in a few minutes.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <span ref={magnetic} className="lp-magnetic">
                {signedIn ? (
                  <Link to="/" className="lp-btn-primary w-full sm:w-auto">
                    Open your dashboard <ArrowRight className="lp-arrow h-4 w-4" />
                  </Link>
                ) : (
                  <Link to="/register" className="lp-btn-primary w-full sm:w-auto">
                    Create your workspace <ArrowRight className="lp-arrow h-4 w-4" />
                  </Link>
                )}
              </span>
              {!signedIn && (
                <Link to="/login" className="lp-btn-ghost">
                  Sign in
                </Link>
              )}
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
