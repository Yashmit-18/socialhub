import { useEffect } from 'react';
import { Link } from 'react-router';
import { useThemeTransition } from '../../hooks/useThemeTransition.js';
import { cn } from '../../lib/utils.js';
import { LEGAL_LINKS } from '../../pages/legal/legalLinks.js';
import { Logo } from '../ui/Brand.jsx';
import { ThemeToggle } from '../ui/ThemeToggle.jsx';
import { AuthShowcase, PlatformMarks } from './AuthShowcase.jsx';

/** The deep indigo of the panel (and of the phone header), a shade deeper in the dark theme. */
const INK =
  'bg-[linear-gradient(160deg,#11103a_0%,#19154f_55%,#2a1760_100%)] dark:bg-[linear-gradient(160deg,#0c0b2b_0%,#141040_55%,#211250_100%)]';

/**
 * The frame of the sign-in, sign-up and password screens. Large screens: the product panel on
 * the left, the form card on the right. Phones and tablets: a compact indigo header with the
 * logo, the tagline and the theme switch, then the card. The legal links stay once, under the
 * card, on the first screen. `pageTitle` names the browser tab (defaults to `title`).
 */
export function AuthLayout({ title, subtitle, children, footer, pageTitle }) {
  const { isDark, toggle } = useThemeTransition();
  const tabTitle = `${pageTitle ?? title} · SocialHub`;

  useEffect(() => {
    const previous = document.title;
    document.title = tabTitle;
    return () => {
      document.title = previous;
    };
  }, [tabTitle]);

  return (
    <div className="flex min-h-dvh">
      <aside
        className={cn(
          'relative isolate hidden w-[46%] max-w-2xl overflow-hidden border-white/[0.06] lg:sticky lg:top-0 lg:flex lg:h-dvh lg:flex-col lg:self-start lg:border-r',
          INK,
        )}
      >
        <div
          className="absolute -top-40 -left-40 -z-10 h-[30rem] w-[30rem] animate-drift rounded-full bg-indigo-500/40 blur-[110px] dark:bg-indigo-500/30"
          aria-hidden="true"
        />
        <div
          className="absolute -right-32 -bottom-48 -z-10 h-[28rem] w-[28rem] animate-drift rounded-full bg-pink-500/30 blur-[110px] [animation-delay:-9s] dark:bg-pink-500/20"
          aria-hidden="true"
        />
        <div
          className="absolute inset-0 -z-10 bg-[linear-gradient(to_right,rgb(255_255_255/.04)_1px,transparent_1px),linear-gradient(to_bottom,rgb(255_255_255/.04)_1px,transparent_1px)] [mask-image:radial-gradient(ellipse_80%_70%_at_30%_40%,#000_30%,transparent_80%)] bg-[size:44px_44px]"
          aria-hidden="true"
        />
        <div className="relative flex min-h-0 flex-1 flex-col px-10 py-10 xl:px-14 [@media(max-height:820px)]:py-8">
          <Link to="/" aria-label="SocialHub home" className="w-fit animate-fade-in rounded-lg">
            <Logo light />
          </Link>
          <div className="flex flex-1 flex-col justify-center py-8 [@media(max-height:720px)]:py-3 [@media(max-height:820px)]:py-6">
            <AuthShowcase />
          </div>
          <p className="text-xs text-indigo-100/70">© {new Date().getFullYear()} SocialHub</p>
        </div>
      </aside>

      <div className="relative isolate flex min-w-0 flex-1 flex-col overflow-hidden">
        <div
          className="absolute -top-48 right-[-10%] -z-10 h-[26rem] w-[34rem] animate-drift rounded-full bg-brand-400/25 blur-[110px] dark:bg-brand-500/20"
          aria-hidden="true"
        />
        <div
          className="absolute bottom-[-12rem] left-[-8%] -z-10 h-[22rem] w-[26rem] animate-drift rounded-full bg-pink-400/20 blur-[110px] [animation-delay:-11s] dark:bg-pink-500/[0.12]"
          aria-hidden="true"
        />
        {/* Dark theme: carry the panel's indigo into the form side so the two halves match. */}
        <div
          className="absolute inset-y-0 left-0 -z-10 hidden w-1/2 bg-gradient-to-r from-brand-500/[0.08] to-transparent dark:lg:block"
          aria-hidden="true"
        />

        <header
          className={cn(
            'relative isolate overflow-hidden rounded-b-[1.75rem] px-5 pt-3 pb-5 shadow-[0_18px_40px_-24px_rgb(25_21_79/0.7)] sm:mx-6 sm:mt-4 sm:rounded-[1.75rem] sm:px-7 dark:ring-1 dark:ring-white/[0.07] dark:ring-inset',
            INK,
            'lg:absolute lg:top-0 lg:right-0 lg:z-10 lg:m-0 lg:rounded-none lg:bg-none lg:p-5 lg:shadow-none lg:dark:bg-none lg:dark:ring-0',
          )}
        >
          <div
            className="absolute -top-16 -right-10 -z-10 h-40 w-56 rounded-full bg-pink-500/25 blur-3xl lg:hidden"
            aria-hidden="true"
          />
          <div className="flex items-center justify-between gap-3">
            <Link to="/" aria-label="SocialHub home" className="rounded-lg lg:hidden">
              <Logo light />
            </Link>
            <ThemeToggle
              isDark={isDark}
              onToggle={toggle}
              className="text-white/85 hover:bg-white/10 hover:text-white lg:text-slate-600 lg:hover:bg-slate-900/[0.05] lg:hover:text-slate-900 lg:dark:hover:bg-white/[0.06]"
            />
          </div>
          <div className="mt-2 flex items-center justify-between gap-4 lg:hidden">
            <p className="text-[15px] leading-snug font-medium text-white/90">
              One home for your team&apos;s social presence.
            </p>
            <PlatformMarks />
          </div>
        </header>

        <main className="flex flex-1 flex-col items-center justify-start px-4 pt-6 pb-8 sm:justify-center sm:px-8 lg:py-10 [@media(max-height:780px)]:lg:py-5">
          <div className="w-full max-w-md">
            <div className="relative animate-scale-in overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgb(30_27_75/0.05),0_28px_56px_-28px_rgb(49_46_129/0.3)] dark:border-white/10 dark:bg-slate-900 dark:shadow-[inset_0_1px_0_0_rgb(255_255_255/0.06),0_30px_80px_-20px_rgb(0_0_0/0.8)]">
              <span
                aria-hidden="true"
                className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-brand-500 via-violet-500 to-pink-500"
              />
              <div className="px-6 pt-7 pb-7 sm:px-8 sm:pt-8">
                <h1 className="animate-rise text-[1.625rem] leading-tight font-semibold tracking-[-0.025em] text-slate-900 sm:text-[1.75rem] dark:text-white">
                  {title}
                </h1>
                {subtitle && (
                  <p className="mt-1.5 animate-rise text-sm text-slate-600 [animation-delay:60ms] dark:text-slate-400">
                    {subtitle}
                  </p>
                )}
                <div className="auth-form mt-7">{children}</div>
              </div>
              {footer && (
                <div className="border-t border-slate-100 bg-slate-50/70 px-6 py-3.5 text-center text-sm text-slate-600 sm:px-8 dark:border-white/[0.06] dark:bg-white/[0.02] dark:text-slate-400">
                  {footer}
                </div>
              )}
            </div>
            <nav
              aria-label="Legal"
              className="mt-5 flex flex-wrap items-center justify-center gap-x-2 text-xs sm:gap-x-1 text-slate-600 dark:text-slate-300"
            >
              {/* Static pages outside the SPA: plain links load them from the server. */}
              {LEGAL_LINKS.map(({ path, title: label }, i) => (
                <span key={path} className="inline-flex items-center gap-x-1">
                  {i > 0 && (
                    <span
                      aria-hidden="true"
                      className="hidden text-slate-400 sm:inline dark:text-slate-500"
                    >
                      ·
                    </span>
                  )}
                  <a
                    href={path}
                    className="rounded px-1.5 py-1 transition-colors hover:text-slate-900 dark:hover:text-white"
                  >
                    {label}
                  </a>
                </span>
              ))}
            </nav>
          </div>
        </main>
      </div>
    </div>
  );
}
