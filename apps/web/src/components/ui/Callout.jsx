import { CircleCheck, FlaskConical, Info, OctagonAlert, TriangleAlert } from 'lucide-react';
import { cn } from '../../lib/utils.js';

const TONES = {
  // Calm information: where data comes from, what happens next.
  info: 'border-sky-200/80 bg-sky-50/70 text-sky-900 dark:border-sky-400/20 dark:bg-sky-500/[0.08] dark:text-sky-100',
  // A note about the product itself (a feature, a tip), in the brand colour.
  brand:
    'border-brand-200/80 bg-brand-50 text-brand-900 dark:border-brand-400/20 dark:bg-brand-500/10 dark:text-brand-100',
  // Simulated or demo: violet is the app's colour for "nothing real happened".
  violet:
    'border-violet-200 bg-violet-50 text-violet-900 dark:border-violet-400/20 dark:bg-violet-500/10 dark:text-violet-100',
  success:
    'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-400/20 dark:bg-emerald-500/10 dark:text-emerald-100',
  warning:
    'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-100',
  danger:
    'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200',
  neutral:
    'border-slate-200 bg-slate-50 text-slate-700 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-200',
};

const ICONS = {
  info: Info,
  brand: Info,
  violet: FlaskConical,
  success: CircleCheck,
  warning: TriangleAlert,
  danger: OctagonAlert,
  neutral: Info,
};

const SIZES = {
  md: 'gap-3 rounded-xl px-4 py-3 text-sm',
  sm: 'gap-2 rounded-lg px-3 py-2 text-xs',
};

/**
 * A tinted note: the one recipe for every hand-made coloured box. `title` is a bold lead-in on
 * the same line; a plain-string child stays a direct text node (tests find sentences with
 * getByText). `icon` overrides the tone's icon; `icon={null}` shows none. `action` sits on the
 * right. There is no default `role`: pass `status` for a live message, `alert` only for
 * something that must interrupt, `note` for a remark. `as` changes the element (e.g. 'section'
 * with an `aria-label`).
 */
export function Callout({
  tone = 'info',
  size = 'md',
  icon,
  title,
  children,
  action,
  role,
  as: Tag = 'div',
  className,
  ...rest
}) {
  const Icon = icon === undefined ? ICONS[tone] : icon;
  return (
    <Tag
      role={role}
      className={cn('flex items-start border', SIZES[size], TONES[tone] ?? TONES.info, className)}
      {...rest}
    >
      {Icon && (
        <Icon
          className={cn('shrink-0', size === 'sm' ? 'mt-px h-3.5 w-3.5' : 'mt-0.5 h-4 w-4')}
          aria-hidden="true"
        />
      )}
      <div className="min-w-0 flex-1 leading-relaxed break-words">
        {title && <span className="font-semibold">{title}</span>}
        {title && children ? ' ' : null}
        {children}
      </div>
      {action && <div className="shrink-0 self-center">{action}</div>}
    </Tag>
  );
}
