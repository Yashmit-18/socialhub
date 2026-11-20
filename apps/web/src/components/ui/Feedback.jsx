import { AlertTriangle, Loader2 } from 'lucide-react';
import { cn } from '../../lib/utils.js';
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

export function PageLoader({ label = 'Loading…' }) {
  return (
    <div className="flex min-h-[40vh] items-center justify-center" role="status">
      <div className="flex flex-col items-center gap-3 text-sm text-muted">
        <Loader2 className="h-6 w-6 animate-spin text-brand-500" aria-hidden="true" />
        {label}
      </div>
    </div>
  );
}

export function Skeleton({ className }) {
  return (
    <div
      className={cn('animate-pulse rounded-lg bg-slate-200/70 dark:bg-white/5', className)}
      aria-hidden="true"
    />
  );
}

export function EmptyState({ icon: Icon, title, description, action, className, children }) {
  return (
    <div className={cn('flex flex-col items-center px-6 py-12 text-center', className)}>
      {Icon && (
        <div className="relative mb-4">
          <div
            className="absolute inset-0 rounded-2xl bg-brand-500/20 blur-xl"
            aria-hidden="true"
          />
          <div className="relative flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-fuchsia-500 text-white shadow-lg shadow-brand-500/25">
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
      <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-400">
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
