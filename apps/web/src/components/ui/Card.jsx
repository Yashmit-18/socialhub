import { cn } from '../../lib/utils.js';

/** `interactive` lifts the card towards the pointer (for cards that link somewhere). */
export function Card({ className, children, interactive = false, ...props }) {
  return (
    <section className={cn('surface', interactive && 'surface-hover', className)} {...props}>
      {children}
    </section>
  );
}

export function CardHeader({ title, description, action, icon: Icon, className }) {
  return (
    <div className={cn('flex items-start justify-between gap-4 px-5 pt-5 sm:px-6', className)}>
      <div className="flex min-w-0 items-start gap-3">
        {Icon && (
          <div className="relative mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-50 to-violet-100/70 text-brand-600 ring-1 ring-brand-500/10 ring-inset dark:from-brand-500/15 dark:to-fuchsia-500/10 dark:text-brand-300 dark:ring-white/10">
            <Icon className="h-4.5 w-4.5" aria-hidden="true" />
          </div>
        )}
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold tracking-tight text-slate-900 dark:text-white">
            {title}
          </h2>
          {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function CardBody({ className, children }) {
  return <div className={cn('px-5 py-5 sm:px-6', className)}>{children}</div>;
}

export function CardFooter({ className, children }) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-end gap-3 rounded-b-2xl border-t border-slate-100 bg-slate-50/60 px-5 py-3.5 sm:px-6 dark:border-white/[0.06] dark:bg-white/[0.02]',
        className,
      )}
    >
      {children}
    </div>
  );
}
