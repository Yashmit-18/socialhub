import { AlertTriangle, Loader2, Lock } from 'lucide-react';
import { isValidElement } from 'react';
import { cn } from '../../lib/utils.js';
import { LogoMark } from './Brand.jsx';
import { Button } from './Button.jsx';
import { Card } from './Card.jsx';
import { useSectionTone } from './sectionTone.js';
import { softTone } from './tones.js';

export function Spinner({ className, label = 'Loading' }) {
  return (
    <span
      role="status"
      className={cn('inline-flex items-center gap-2 text-sm text-muted', className)}
    >
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </span>
  );
}

/**
 * Branded loader: the logo breathing inside a spinning gradient ring. For moments with no page
 * yet (session restore, a route chunk); a page that has its header uses skeletons instead.
 * `fullScreen` centres it in the whole window (route guards), where the next screen will be.
 */
export function PageLoader({ label = 'Loading…', fullScreen = false }) {
  return (
    <div
      className={cn(
        'flex animate-fade-in items-center justify-center',
        fullScreen ? 'min-h-dvh' : 'min-h-[40vh]',
      )}
      role="status"
    >
      <div className="flex flex-col items-center gap-4 text-sm text-muted">
        <span className="relative flex h-14 w-14 items-center justify-center" aria-hidden="true">
          <span className="absolute inset-0 animate-spin rounded-full bg-[conic-gradient(from_0deg,transparent_0_35%,var(--color-brand-500)_60%,#d946ef_85%,transparent)] [mask:radial-gradient(farthest-side,transparent_calc(100%_-_2.5px),#000_calc(100%_-_2px))]" />
          <span className="absolute inset-2 animate-ping-soft rounded-full bg-brand-500/20" />
          <LogoMark className="relative h-7 w-7" />
        </span>
        {label}
      </div>
    </div>
  );
}

/** Placeholder block with a light sweeping across it. */
export function Skeleton({ className }) {
  return (
    <div
      className={cn(
        'relative isolate overflow-hidden rounded-lg bg-slate-200/60 dark:bg-white/[0.05]',
        'before:absolute before:inset-0 before:animate-shimmer before:bg-gradient-to-r before:from-transparent before:via-white/70 before:to-transparent dark:before:via-white/[0.07]',
        className,
      )}
      aria-hidden="true"
    />
  );
}

/**
 * Loading rows shaped like a divided list (members, activity, table rows). `shape` is the
 * leading mark: 'avatar' (40 px circle), 'tile' (32 px rounded square) or 'none'. `label`
 * adds the hidden status line screen readers hear ("Loading members…"); leave it out when the
 * page already announces loading.
 */
export function RowsSkeleton({ rows = 4, shape = 'avatar', label, className }) {
  return (
    <div className={className}>
      {label && (
        <p role="status" className="sr-only">
          {label}
        </p>
      )}
      <div aria-hidden="true" className="divide-y divide-slate-100 dark:divide-white/5">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-center gap-4 px-5 py-4 sm:px-6">
            {shape === 'avatar' && <Skeleton className="h-10 w-10 shrink-0 rounded-full" />}
            {shape === 'tile' && <Skeleton className="h-8 w-8 shrink-0 rounded-lg" />}
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className={cn('h-3.5', i % 2 ? 'w-1/3' : 'w-2/5')} />
              <Skeleton className={cn('h-3', i % 2 ? 'w-1/2' : 'w-3/5')} />
            </div>
            <Skeleton className="hidden h-8 w-24 sm:block" />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Nothing to show yet. `art` is a drawing from illustrations.jsx (the component, e.g.
 * `art={PostsArt}`, or an element) and replaces the icon chip; `tone` colours the chip or the
 * drawing (a key of SOFT_TONES; default: the page's section colour). `layout="inline"` is a
 * compact row panel (drawing left, text right) for a section inside a card.
 */
export function EmptyState({
  icon: Icon,
  art: Art,
  tone,
  layout = 'stack',
  title,
  description,
  action,
  className,
  children,
}) {
  const section = useSectionTone();
  const key = tone ?? section?.soft ?? 'brand';
  const drawing = Art ? (
    isValidElement(Art) ? (
      Art
    ) : (
      <Art tone={key} className={layout === 'inline' ? 'h-20 w-32' : undefined} />
    )
  ) : null;

  if (layout === 'inline') {
    return (
      <div
        className={cn(
          'flex flex-col items-center gap-4 rounded-xl bg-slate-50 px-5 py-6 text-center ring-1 ring-slate-200/70 ring-inset sm:flex-row sm:gap-6 sm:px-6 sm:text-left dark:bg-white/[0.03] dark:ring-white/[0.08]',
          className,
        )}
      >
        {drawing ? (
          <div className="shrink-0" aria-hidden="true">
            {drawing}
          </div>
        ) : (
          Icon && (
            <div
              className={cn(
                'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ring-1 ring-slate-900/5 ring-inset dark:ring-white/10',
                softTone(key),
              )}
              aria-hidden="true"
            >
              <Icon className="h-5 w-5" aria-hidden="true" />
            </div>
          )
        )}
        <div className="min-w-0 flex-1">
          <h3 className="text-[15px] font-semibold text-slate-900 dark:text-white">{title}</h3>
          {description && (
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-600 dark:text-slate-400">
              {description}
            </p>
          )}
          {children}
          {action && <div className="mt-4">{action}</div>}
        </div>
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col items-center px-6 py-12 text-center', className)}>
      {drawing ? (
        <div className="mb-5" aria-hidden="true">
          {drawing}
        </div>
      ) : (
        Icon && (
          <div
            className={cn(
              'mb-4 flex h-11 w-11 items-center justify-center rounded-xl ring-1 ring-slate-900/5 ring-inset dark:ring-white/10',
              softTone(key),
            )}
            aria-hidden="true"
          >
            <Icon className="h-5 w-5" aria-hidden="true" />
          </div>
        )
      )}
      <h3 className="text-base font-semibold text-slate-900 dark:text-white">{title}</h3>
      {description && (
        <p className="mt-1.5 max-w-md text-sm leading-relaxed text-muted">{description}</p>
      )}
      {children}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/** A page or section this role may not open: a lock in a card, with the reason. */
export function RestrictedState({ title, description, className }) {
  return (
    <Card className={className}>
      <EmptyState icon={Lock} tone="neutral" title={title} description={description} />
    </Card>
  );
}

export function ErrorState({ error, onRetry, title = 'Something went wrong' }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center" role="alert">
      <div className="relative mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-rose-50 to-orange-50 text-rose-600 ring-1 ring-rose-500/15 ring-inset dark:from-rose-500/15 dark:to-orange-500/10 dark:text-rose-400">
        <AlertTriangle className="h-5 w-5" aria-hidden="true" />
      </div>
      <h3 className="text-base font-semibold">{title}</h3>
      <p className="mt-1 max-w-md text-sm text-muted">{error?.message ?? 'Please try again.'}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" className="mt-4" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}
