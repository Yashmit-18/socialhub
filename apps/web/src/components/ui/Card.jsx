import { cn } from '../../lib/utils.js';
import { useSectionTone } from './sectionTone.js';
import { softTone } from './tones.js';

/** `interactive` lifts the card towards the pointer (for cards that link somewhere). */
export function Card({ className, children, interactive = false, ...props }) {
  return (
    <section className={cn('surface', interactive && 'surface-hover', className)} {...props}>
      {children}
    </section>
  );
}

/**
 * `tone` (gradient classes, e.g. 'from-indigo-500 to-violet-600') paints the icon tile in that
 * colour; without it the icon sits on a soft chip in the colour of the page's section (or
 * `iconTone`, a key of SOFT_TONES, e.g. 'danger' for a danger zone). `step` adds a small label
 * such as "Step 2" above the title, in `stepClassName`. `titleId` lets the card name itself
 * with `aria-labelledby`.
 */
export function CardHeader({
  title,
  description,
  action,
  icon: Icon,
  tone,
  iconTone,
  step,
  stepClassName,
  titleId,
  className,
}) {
  const section = useSectionTone();
  return (
    <div className={cn('flex items-start justify-between gap-4 px-5 pt-5 sm:px-6', className)}>
      <div className="flex min-w-0 items-start gap-3">
        {Icon && (
          <div
            className={cn(
              'mt-0.5 flex shrink-0 items-center justify-center',
              tone
                ? cn(
                    'h-9 w-9 rounded-xl bg-gradient-to-br text-white shadow-md shadow-slate-900/10 ring-1 ring-white/20 ring-inset',
                    tone,
                  )
                : cn('h-8 w-8 rounded-lg', softTone(iconTone ?? section?.soft)),
            )}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
          </div>
        )}
        <div className="min-w-0">
          {step && (
            <p
              className={cn(
                'text-xs font-semibold text-brand-600 dark:text-brand-300',
                stepClassName,
              )}
            >
              {step}
            </p>
          )}
          <h2
            id={titleId}
            className="text-[15px] font-semibold tracking-tight text-slate-900 dark:text-white"
          >
            {title}
          </h2>
          {description && (
            <p className="mt-0.5 text-[13px] leading-5 text-slate-500 dark:text-slate-400">
              {description}
            </p>
          )}
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
        'flex flex-wrap items-center justify-end gap-3 rounded-b-xl border-t border-slate-100 bg-slate-50/60 px-5 py-3.5 sm:px-6 dark:border-white/[0.06] dark:bg-white/[0.02]',
        className,
      )}
    >
      {children}
    </div>
  );
}
