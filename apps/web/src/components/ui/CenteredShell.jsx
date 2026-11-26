import { Link } from 'react-router';
import { useThemeTransition } from '../../hooks/useThemeTransition.js';
import { cn } from '../../lib/utils.js';
import { Logo } from './Brand.jsx';
import { ThemeToggle } from './ThemeToggle.jsx';

const WIDTHS = { md: 'max-w-md', lg: 'max-w-lg' };

/**
 * The frame for single-card screens outside the app shell (onboarding, an invitation, the Meta
 * result, not found): the logo home link and the theme switch on top, one soft brand glow, the
 * content centred (near the top on a phone). `card` wraps the content in the auth card with its
 * gradient hairline; `action` sits left of the theme switch; `footer` is a line under the card.
 */
export function CenteredShell({ children, action, footer, width = 'md', card = true }) {
  const { isDark, toggle } = useThemeTransition();
  return (
    <div className="relative isolate flex min-h-dvh flex-col overflow-hidden">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-40 left-1/2 -z-10 h-[30rem] w-[30rem] -translate-x-1/2 animate-drift rounded-full bg-brand-500/15 blur-3xl dark:bg-brand-500/10"
      />
      <header className="flex h-16 shrink-0 items-center justify-between gap-3 px-5 sm:px-8">
        <Link to="/" aria-label="SocialHub home" className="rounded-lg">
          <Logo />
        </Link>
        <div className="flex items-center gap-2">
          {action}
          <ThemeToggle isDark={isDark} onToggle={toggle} />
        </div>
      </header>
      <main className="flex flex-1 items-start justify-center px-5 pt-6 pb-12 sm:items-center sm:px-8 sm:pt-0">
        <div className={cn('w-full', WIDTHS[width] ?? WIDTHS.md)}>
          {card ? (
            <div className="relative animate-scale-in overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-7 shadow-[0_1px_2px_rgb(30_27_75/0.05),0_28px_56px_-28px_rgb(49_46_129/0.3)] sm:p-9 dark:border-white/[0.08] dark:bg-slate-900 dark:shadow-none">
              <span
                aria-hidden="true"
                className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-brand-500 via-violet-500 to-pink-500"
              />
              {children}
            </div>
          ) : (
            children
          )}
          {footer && (
            <div className="mt-6 text-center text-sm text-slate-600 dark:text-slate-400">
              {footer}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
