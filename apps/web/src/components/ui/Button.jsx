import { Loader2 } from 'lucide-react';
import { Link } from 'react-router';
import { cn } from '../../lib/utils.js';

/*
 * Solid variants carry a soft top highlight and a coloured glow, lift a pixel on hover and a
 * light sweeps across them; every variant presses in slightly. Disabled buttons stay still.
 */
const SHEEN =
  'relative isolate overflow-hidden after:pointer-events-none after:absolute after:inset-y-0 after:-left-3/4 after:-z-10 after:w-1/2 after:-skew-x-12 after:bg-gradient-to-r after:from-transparent after:via-white/30 after:to-transparent after:transition-[left] after:duration-700 after:ease-out-expo hover:after:left-[130%] disabled:after:hidden';

const VARIANTS = {
  primary: cn(
    SHEEN,
    'bg-brand-600 bg-gradient-to-b from-brand-500 to-brand-600 text-white shadow-[inset_0_1px_0_0_rgb(255_255_255/0.2),0_1px_2px_rgb(24_20_51/0.2),0_8px_20px_-8px_rgb(79_70_229/0.6)]',
    'hover:-translate-y-px hover:from-brand-500 hover:to-violet-600 hover:shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25),0_1px_2px_rgb(24_20_51/0.2),0_14px_28px_-10px_rgb(99_70_229/0.7)]',
    'active:translate-y-0 active:from-brand-600 active:to-brand-700',
    'disabled:from-brand-500/70 disabled:to-brand-600/70 disabled:hover:translate-y-0',
  ),
  secondary: cn(
    'border border-slate-200 bg-white bg-gradient-to-b from-white to-slate-50/80 text-slate-800 shadow-[0_1px_2px_rgb(24_20_51/0.06)]',
    'hover:border-slate-300 hover:to-slate-100/70 hover:text-slate-900',
    'dark:border-white/10 dark:bg-white/[0.04] dark:from-white/[0.06] dark:to-white/[0.02] dark:text-slate-100 dark:shadow-[inset_0_1px_0_0_rgb(255_255_255/0.05)]',
    'dark:hover:border-white/20 dark:hover:from-white/[0.09] dark:hover:to-white/[0.04]',
  ),
  ghost:
    'text-slate-600 hover:bg-slate-900/[0.05] hover:text-slate-900 dark:text-slate-300 dark:hover:bg-white/[0.06] dark:hover:text-white',
  danger: cn(
    SHEEN,
    'bg-rose-600 bg-gradient-to-b from-rose-500 to-rose-600 text-white shadow-[inset_0_1px_0_0_rgb(255_255_255/0.2),0_1px_2px_rgb(24_20_51/0.2),0_8px_20px_-8px_rgb(225_29_72/0.6)]',
    'hover:-translate-y-px hover:from-rose-500 hover:to-rose-500 active:translate-y-0 active:to-rose-700',
    'disabled:from-rose-500/70 disabled:to-rose-600/70 disabled:hover:translate-y-0',
  ),
  'danger-outline':
    'border border-rose-200 text-rose-600 hover:border-rose-300 hover:bg-rose-50 dark:border-rose-500/30 dark:text-rose-400 dark:hover:bg-rose-500/10',
};

const SIZES = {
  sm: 'h-8 px-3 text-xs gap-1.5 rounded-lg',
  md: 'h-10 px-4 text-sm gap-2 rounded-xl',
  lg: 'h-11 px-5 text-sm gap-2 rounded-xl',
  icon: 'h-9 w-9 rounded-xl',
};

function buttonClass({ variant = 'primary', size = 'md', className } = {}) {
  return cn(
    'inline-flex shrink-0 items-center justify-center font-medium whitespace-nowrap select-none',
    'transition-[color,background-color,border-color,box-shadow,transform,opacity] duration-200 ease-out-expo active:scale-[0.97]',
    'disabled:cursor-not-allowed disabled:opacity-70 disabled:active:scale-100',
    VARIANTS[variant],
    SIZES[size],
    className,
  );
}

/** A router link styled as a button. */
export function ButtonLink({ variant, size, className, ...props }) {
  return <Link className={buttonClass({ variant, size, className })} {...props} />;
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled,
  className,
  children,
  type = 'button',
  ...props
}) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClass({ variant, size, className })}
      {...props}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
      {children}
    </button>
  );
}
