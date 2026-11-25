/**
 * Public marketing landing page (`/` for signed-out visitors, `/welcome` for everyone).
 * It explains the whole product in plain language; copy lives in landingContent.js.
 * Light and dark themes share the app's preference (see useLandingTheme.js).
 */
import './landing.css';
import {
  ArrowRight,
  ArrowUp,
  Briefcase,
  Building2,
  Lock,
  Menu,
  Moon,
  ShieldCheck,
  Sparkles,
  Sun,
  UserRound,
  Users,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { Logo } from '../../components/ui/Brand.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { cn } from '../../lib/utils.js';
import { LEGAL_LINKS } from '../legal/legalLinks.js';
import { MARQUEE_ITEMS, NAV_LINKS } from './landingContent.js';
import {
  CONTAINER,
  ComposerSection,
  CtaSection,
  FaqSection,
  FeaturesSection,
  HowItWorksSection,
  MetaSection,
  RoadmapSection,
  RolesSection,
  SecuritySection,
  StatsBand,
  TourSection,
} from './LandingSections.jsx';
import { HeroDashboard } from './LandingVisuals.jsx';
import { Reveal, Words } from './motion.jsx';
import { useLandingTheme } from './useLandingTheme.js';
import {
  prefersReducedMotion,
  useActiveSection,
  useMagnetic,
  usePointerParallax,
} from './useMotion.js';

const PAGE_TITLE = 'SocialHub · Facebook & Instagram management for creators and agencies';
const SECTION_IDS = NAV_LINKS.map(({ href }) => href.slice(1));

/** Smooth-scrolls to an in-page section without involving the router. */
function scrollToSection(event, href) {
  const target = document.getElementById(href.slice(1));
  if (!target) return;
  event.preventDefault();
  target.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
  target.focus?.({ preventScroll: true });
}

/** Moves the pointer spotlight of the `.lp-spot` card under the cursor. */
function trackSpotlight(event) {
  const card = event.target.closest?.('.lp-spot');
  if (!card) return;
  const rect = card.getBoundingClientRect();
  card.style.setProperty('--mx', `${event.clientX - rect.left}px`);
  card.style.setProperty('--my', `${event.clientY - rect.top}px`);
}

/**
 * Page-level scroll state: whether the header is condensed, whether "back to top" shows, and
 * the reading progress written straight to the top bar and the back-to-top ring.
 */
function useScrollChrome() {
  const [scrolled, setScrolled] = useState(false);
  const [showTop, setShowTop] = useState(false);
  const barRef = useRef(null);
  const ringRef = useRef(null);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const y = window.scrollY;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const progress = max > 0 ? Math.min(1, Math.max(0, y / max)) : 0;
      setScrolled(y > 12);
      setShowTop(y > 900);
      if (barRef.current) barRef.current.style.transform = `scaleX(${progress})`;
      if (ringRef.current) ringRef.current.style.strokeDashoffset = String(1 - progress);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    schedule();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, []);

  return { scrolled, showTop, barRef, ringRef };
}

function ThemeSwitch({ isDark, onToggle }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={isDark}
      aria-label="Dark mode"
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      onClick={onToggle}
      className="lp-theme-switch"
    >
      <Sun aria-hidden="true" className="lp-theme-switch-mark left-2" />
      <Moon aria-hidden="true" className="lp-theme-switch-mark right-2" />
      <span aria-hidden="true" className="lp-theme-switch-star top-2 left-3" />
      <span
        aria-hidden="true"
        className="lp-theme-switch-star top-5 left-5"
        style={{ animationDelay: '0.8s' }}
      />
      <span aria-hidden="true" className="lp-theme-switch-thumb">
        <Sun className="lp-ts-sun" strokeWidth={2.4} />
        <Moon className="lp-ts-moon" strokeWidth={2.4} />
      </span>
    </button>
  );
}

function Header({ signedIn, scrolled, barRef, isDark, onToggleTheme }) {
  const [open, setOpen] = useState(false);
  const active = useActiveSection(SECTION_IDS);
  const listRef = useRef(null);
  const indicatorRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => event.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // Slides the pill behind the active link (written to the DOM, so it costs no re-render).
  // Placed again once the header has finished condensing and on resize.
  useEffect(() => {
    const place = () => {
      const pill = indicatorRef.current;
      if (!pill) return;
      const link = active && listRef.current?.querySelector(`a[href="#${active}"]`);
      pill.style.opacity = link ? '1' : '0';
      if (!link) return;
      pill.style.translate = `${link.offsetLeft}px 0`;
      pill.style.width = `${link.offsetWidth}px`;
    };
    place();
    const settle = setTimeout(place, 650);
    window.addEventListener('resize', place);
    return () => {
      clearTimeout(settle);
      window.removeEventListener('resize', place);
    };
  }, [active, scrolled]);

  const onNav = (event, href) => {
    setOpen(false);
    scrollToSection(event, href);
  };

  return (
    <header className="fixed inset-x-0 top-0 z-50">
      <div ref={barRef} aria-hidden="true" className="lp-scrollbar" />
      <div className={cn('lp-header', (scrolled || open) && 'is-condensed')}>
        <div className="lp-header-row flex items-center justify-between gap-3 px-4 sm:px-5">
          <Link to={signedIn ? '/welcome' : '/'} aria-label="SocialHub home" className="shrink-0">
            <Logo />
          </Link>

          <nav aria-label="Landing page" className="hidden lg:block">
            <ul ref={listRef} className="relative flex items-center gap-0.5">
              <li ref={indicatorRef} aria-hidden="true" className="lp-nav-indicator" />
              {NAV_LINKS.map(({ href, label }) => (
                <li key={href} className="relative">
                  <a
                    href={href}
                    onClick={(event) => onNav(event, href)}
                    aria-current={active === href.slice(1) ? 'true' : undefined}
                    className={cn(
                      'block rounded-full px-3.5 py-2 text-sm transition-colors',
                      active === href.slice(1)
                        ? 'text-(--lp-text)'
                        : 'text-(--lp-muted) hover:text-(--lp-text)',
                    )}
                  >
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <div className="flex items-center gap-2">
            <ThemeSwitch isDark={isDark} onToggle={onToggleTheme} />
            {signedIn ? (
              <Link to="/" className="lp-btn-primary h-9 px-4 text-sm max-[400px]:hidden">
                Open dashboard
              </Link>
            ) : (
              <>
                <Link
                  to="/login"
                  className="hidden rounded-full px-3.5 py-2 text-sm text-(--lp-muted) transition-colors hover:text-(--lp-text) sm:inline-flex"
                >
                  Sign in
                </Link>
                <Link to="/register" className="lp-btn-primary h-9 px-4 text-sm max-[400px]:hidden">
                  Get started
                </Link>
              </>
            )}
            <button
              type="button"
              className="inline-flex h-9 w-9 items-center justify-center rounded-full text-(--lp-text) ring-1 ring-(--lp-border-strong) transition-colors hover:bg-(--lp-hover) lg:hidden"
              aria-expanded={open}
              aria-controls="lp-mobile-nav"
              aria-label={open ? 'Close menu' : 'Open menu'}
              onClick={() => setOpen((v) => !v)}
            >
              {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>

        {open && (
          <nav
            id="lp-mobile-nav"
            aria-label="Landing page"
            className="lp-mobile-nav border-t border-(--lp-border) lg:hidden"
          >
            <ul className="grid gap-1 p-3">
              {NAV_LINKS.map(({ href, label }, i) => (
                <li key={href} style={{ '--i': i }}>
                  <a
                    href={href}
                    onClick={(event) => onNav(event, href)}
                    className="flex items-center justify-between rounded-xl px-3 py-3 text-base text-(--lp-text) hover:bg-(--lp-hover)"
                  >
                    {label}
                    <ArrowRight className="h-4 w-4 text-(--lp-faint)" />
                  </a>
                </li>
              ))}
              {signedIn ? (
                <li className="min-[401px]:hidden" style={{ '--i': NAV_LINKS.length }}>
                  <Link to="/" className="lp-btn-primary mt-2 w-full">
                    Open dashboard
                  </Link>
                </li>
              ) : (
                <li className="mt-2 grid gap-2 sm:hidden" style={{ '--i': NAV_LINKS.length }}>
                  <Link to="/login" className="lp-btn-ghost w-full">
                    Sign in
                  </Link>
                  <Link to="/register" className="lp-btn-primary w-full min-[401px]:hidden">
                    Create your workspace
                  </Link>
                </li>
              )}
            </ul>
          </nav>
        )}
      </div>
    </header>
  );
}

const TRUST = [
  { icon: ShieldCheck, label: 'Official Meta Graph API' },
  { icon: Lock, label: 'Encrypted tokens' },
  { icon: Users, label: 'Role-based teams' },
];

const AUDIENCES = [
  { icon: Sparkles, label: 'Creators' },
  { icon: UserRound, label: 'Freelance social managers' },
  { icon: Building2, label: 'In-house brand teams' },
  { icon: Briefcase, label: 'Social media agencies' },
];

function Hero({ signedIn }) {
  const areaRef = useRef(null);
  const stageRef = useRef(null);
  const magnetic = useMagnetic();
  usePointerParallax(areaRef, stageRef);

  return (
    <section
      ref={areaRef}
      aria-labelledby="hero-title"
      className="relative pt-32 pb-16 sm:pt-44 sm:pb-24"
    >
      <div className="lp-aurora" aria-hidden="true">
        <div className="lp-rays" />
        <div className="lp-blob lp-blob-a" />
        <div className="lp-blob lp-blob-b" />
        <div className="lp-blob lp-blob-c" />
      </div>
      <div className="lp-grid" aria-hidden="true" />
      <div className="lp-grid-spot" aria-hidden="true" />

      <div className={cn(CONTAINER, 'relative text-center')}>
        <div className="lp-hero-copy">
          <p className="lp-eyebrow lp-rise">
            <span className="lp-eyebrow-badge">New</span>
            The universal post composer is here
          </p>

          <h1
            id="hero-title"
            className="mx-auto mt-7 max-w-6xl text-[2.6rem] leading-[1.03] font-semibold tracking-[-0.045em] text-balance text-(--lp-text) sm:text-6xl lg:text-[5.25rem]"
          >
            <Words text="Every client’s Facebook & Instagram." mode="enter" delay={150} step={70} />{' '}
            <span className="block">
              <span className="lp-wipe" style={{ '--lp-delay': '700ms' }}>
                <span className="lp-grad-text">One calm workspace.</span>
              </span>
            </span>
          </h1>

          <p
            className="lp-rise mx-auto mt-6 max-w-2xl text-base leading-relaxed text-pretty text-(--lp-muted) sm:text-lg"
            style={{ '--lp-delay': '950ms' }}
          >
            SocialHub connects Facebook Pages and Instagram professional accounts through Meta’s
            official login, keeps every connection healthy, gives each teammate exactly the access
            they need and lets you craft posts with live previews, without ever sharing a password.
          </p>

          <div
            className="lp-rise mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row"
            style={{ '--lp-delay': '1100ms' }}
          >
            <span ref={magnetic} className="lp-magnetic w-full sm:w-auto">
              {signedIn ? (
                <Link to="/" className="lp-btn-primary lp-shine-auto w-full sm:w-auto">
                  Open your dashboard <ArrowRight className="lp-arrow h-4 w-4" />
                </Link>
              ) : (
                <Link to="/register" className="lp-btn-primary lp-shine-auto w-full sm:w-auto">
                  Create your workspace <ArrowRight className="lp-arrow h-4 w-4" />
                </Link>
              )}
            </span>
            <a
              href="#how-it-works"
              onClick={(event) => scrollToSection(event, '#how-it-works')}
              className="lp-btn-ghost w-full sm:w-auto"
            >
              See how it works
            </a>
          </div>

          <ul
            className="lp-rise mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-(--lp-muted)"
            style={{ '--lp-delay': '1250ms' }}
          >
            {TRUST.map(({ icon: Icon, label }) => (
              <li key={label} className="inline-flex items-center gap-2">
                <Icon className="h-4 w-4 text-(--lp-mint)" />
                {label}
              </li>
            ))}
          </ul>
        </div>

        <div className="lp-scroll-tilt mt-16 sm:mt-20">
          <div ref={stageRef} className="lp-stage">
            <HeroDashboard />
          </div>
        </div>
      </div>
    </section>
  );
}

function MarqueeRow({ items, reverse = false }) {
  return (
    <div className={cn('lp-marquee-track', reverse && 'is-reverse')}>
      {[0, 1].map((copy) => (
        <div key={copy} className="flex shrink-0 gap-3 pr-3">
          {items.map((item) => (
            <span
              key={item}
              className="inline-flex items-center gap-2 rounded-full border border-(--lp-border) bg-(--lp-surface) px-4 py-2 text-sm whitespace-nowrap text-(--lp-muted)"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-gradient-to-r from-indigo-400 to-pink-400" />
              {item}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

function AudienceAndMarquee() {
  return (
    <section aria-label="Who SocialHub is for" className="relative py-12">
      <div className={cn(CONTAINER, 'text-center')}>
        <p className="text-sm text-(--lp-faint)">
          Made for everyone who looks after social accounts
        </p>
        <ul className="mt-5 flex flex-wrap justify-center gap-2.5">
          {AUDIENCES.map(({ icon: Icon, label }, i) => (
            <Reveal
              as="li"
              key={label}
              delay={i * 80}
              variant="scale"
              className="inline-flex items-center gap-2 rounded-full border border-(--lp-border) bg-(--lp-card-solid) px-4 py-2 text-sm text-(--lp-text) shadow-(--lp-card-shadow)"
            >
              <Icon className="h-4 w-4 text-(--lp-fuchsia)" />
              {label}
            </Reveal>
          ))}
        </ul>
      </div>
      <div className="lp-marquee mt-10 space-y-3 overflow-hidden" aria-hidden="true">
        <MarqueeRow items={MARQUEE_ITEMS} />
        <MarqueeRow items={[...MARQUEE_ITEMS].reverse()} reverse />
      </div>
      <p className="sr-only">Highlights: {MARQUEE_ITEMS.join(', ')}.</p>
    </section>
  );
}

function BackToTop({ show, ringRef }) {
  return (
    <button
      type="button"
      className="lp-to-top"
      data-show={show}
      tabIndex={show ? 0 : -1}
      aria-hidden={!show}
      aria-label="Back to top"
      onClick={() =>
        window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
      }
    >
      <svg
        viewBox="0 0 48 48"
        className="absolute inset-0 h-full w-full -rotate-90"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="lp-top-ring" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0" stopColor="#818cf8" />
            <stop offset="0.55" stopColor="#e879f9" />
            <stop offset="1" stopColor="#fb923c" />
          </linearGradient>
        </defs>
        <circle
          ref={ringRef}
          cx="24"
          cy="24"
          r="22.5"
          fill="none"
          stroke="url(#lp-top-ring)"
          strokeWidth="2"
          strokeLinecap="round"
          pathLength="1"
          strokeDasharray="1"
          strokeDashoffset="1"
        />
      </svg>
      <ArrowUp className="lp-arrow-up h-4 w-4" />
    </button>
  );
}

const footerLink = 'text-(--lp-muted) transition-colors hover:text-(--lp-text)';

function Footer({ signedIn }) {
  const year = new Date().getFullYear();
  return (
    <footer className="relative overflow-hidden border-t border-(--lp-border) pt-16">
      <div className={CONTAINER}>
        <div className="grid gap-10 sm:grid-cols-3 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div className="sm:col-span-3 md:col-span-1">
            <Logo />
            <p className="mt-4 max-w-sm text-sm leading-relaxed text-(--lp-muted)">
              The team workspace for Facebook Pages and Instagram professional accounts, built for
              creators, social media managers and agencies.
            </p>
          </div>
          <nav aria-label="Product">
            <p className="text-sm font-semibold text-(--lp-text)">Product</p>
            <ul className="mt-4 space-y-2.5 text-sm">
              {NAV_LINKS.map(({ href, label }) => (
                <li key={href}>
                  <a
                    href={href}
                    onClick={(event) => scrollToSection(event, href)}
                    className={footerLink}
                  >
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <nav aria-label="Account">
            <p className="text-sm font-semibold text-(--lp-text)">Get started</p>
            <ul className="mt-4 space-y-2.5 text-sm">
              {signedIn ? (
                <li>
                  <Link to="/" className={footerLink}>
                    Open dashboard
                  </Link>
                </li>
              ) : (
                <>
                  <li>
                    <Link to="/register" className={footerLink}>
                      Create an account
                    </Link>
                  </li>
                  <li>
                    <Link to="/login" className={footerLink}>
                      Sign in
                    </Link>
                  </li>
                  <li>
                    <Link to="/forgot-password" className={footerLink}>
                      Reset your password
                    </Link>
                  </li>
                </>
              )}
            </ul>
          </nav>
          <nav aria-label="Legal">
            <p className="text-sm font-semibold text-(--lp-text)">Legal</p>
            <ul className="mt-4 space-y-2.5 text-sm">
              {LEGAL_LINKS.map(({ path, title }) => (
                <li key={path}>
                  {/* Static pages outside the SPA: a plain link loads them from the server. */}
                  <a href={path} className={footerLink}>
                    {title}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </div>
        <div className="mt-14 flex flex-col gap-3 border-t border-(--lp-border) pt-6 text-xs text-(--lp-faint) sm:flex-row sm:items-center sm:justify-between">
          <p>© {year} SocialHub. All rights reserved.</p>
          <p className="max-w-xl sm:text-right">
            Facebook and Instagram are trademarks of Meta Platforms, Inc. SocialHub uses Meta’s
            official APIs and is not affiliated with or endorsed by Meta.
          </p>
        </div>
      </div>
      <p aria-hidden="true" className="lp-wordmark mt-8 text-center whitespace-nowrap">
        SocialHub
      </p>
    </footer>
  );
}

export default function LandingPage() {
  const { status } = useAuth();
  const signedIn = status === 'authenticated';
  const { isDark, switchTheme } = useLandingTheme();
  const { scrolled, showTop, barRef, ringRef } = useScrollChrome();

  useEffect(() => {
    const previous = document.title;
    document.title = PAGE_TITLE;
    return () => {
      document.title = previous;
    };
  }, []);

  return (
    <div className="lp-root font-sans" onPointerMove={trackSpotlight}>
      <div className="lp-noise" aria-hidden="true" />
      <a
        href="#main"
        onClick={(event) => scrollToSection(event, '#main')}
        className="sr-only z-[80] rounded-full bg-white px-4 py-2 text-sm font-medium text-slate-900 focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>
      <Header
        signedIn={signedIn}
        scrolled={scrolled}
        barRef={barRef}
        isDark={isDark}
        onToggleTheme={switchTheme}
      />
      <main id="main" tabIndex={-1} className="outline-none">
        <Hero signedIn={signedIn} />
        <AudienceAndMarquee />
        <FeaturesSection />
        <StatsBand />
        <HowItWorksSection />
        <TourSection />
        <ComposerSection />
        <RolesSection />
        <SecuritySection />
        <MetaSection />
        <RoadmapSection />
        <FaqSection />
        <CtaSection signedIn={signedIn} />
      </main>
      <Footer signedIn={signedIn} />
      <BackToTop show={showTop} ringRef={ringRef} />
    </div>
  );
}
