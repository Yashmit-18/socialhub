import { AlertTriangle, Loader2 } from 'lucide-react';
import { cn } from '../../lib/utils.js';
import { LogoMark } from './Brand.jsx';
import { Button } from './Button.jsx';

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

/** Branded loader: the logo breathing inside a spinning gradient ring. */
export function PageLoader({ label = 'Loading…' }) {
  return (
    <div className="flex min-h-[40vh] animate-fade-in items-center justify-center" role="status">
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

export function EmptyState({ icon: Icon, title, description, action, className, children }) {
  return (
    <div className={cn('flex flex-col items-center px-6 py-12 text-center', className)}>
      {Icon && (
        <div className="relative mb-5" aria-hidden="true">
          <div className="absolute -inset-3 rounded-[1.4rem] border border-dashed border-brand-500/25 dark:border-brand-400/20" />
          <div className="absolute inset-0 rounded-2xl bg-brand-500/30 blur-xl" />
          <div className="relative flex h-12 w-12 animate-float items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 via-violet-500 to-fuchsia-500 text-white shadow-lg shadow-brand-500/30 ring-1 ring-white/25 ring-inset">
            <Icon className="h-6 w-6" aria-hidden="true" />
          </div>
        </div>
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
