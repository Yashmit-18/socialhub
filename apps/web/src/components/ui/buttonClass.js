import { cn } from '../../lib/utils.js';

/*
 * The main action is an indigo → violet gradient (the logo's colours) with a soft coloured
 * shadow; secondary buttons keep a hairline border. Every variant presses in slightly; disabled
 * buttons stay still. `bg-brand-600` stays underneath the gradient as its fallback colour.
 */
const VARIANTS = {
  primary: cn(
    'bg-brand-600 bg-gradient-to-r from-brand-600 to-violet-600 text-white',
    'shadow-[0_1px_2px_rgb(30_27_75/0.16),0_4px_12px_-3px_rgb(99_102_241/0.45),inset_0_1px_0_0_rgb(255_255_255/0.16)]',
    'hover:bg-brand-700 hover:from-brand-700 hover:to-violet-700 active:from-brand-800 active:to-violet-800',
    'disabled:from-brand-600/60 disabled:to-violet-600/60 disabled:shadow-none dark:disabled:from-brand-500/40 dark:disabled:to-violet-500/40',
  ),
  secondary: cn(
    'border border-slate-200 bg-white text-slate-800 shadow-[0_1px_2px_rgb(16_24_40/0.05)]',
    'hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900',
    'dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-100 dark:shadow-none',
    'dark:hover:border-white/20 dark:hover:bg-white/[0.07]',
  ),
  ghost:
    'text-slate-600 hover:bg-slate-900/[0.05] hover:text-slate-900 dark:text-slate-300 dark:hover:bg-white/[0.06] dark:hover:text-white',
  danger: cn(
    'bg-rose-600 text-white shadow-[0_1px_2px_rgb(16_24_40/0.12),inset_0_1px_0_0_rgb(255_255_255/0.12)]',
    'hover:bg-rose-700 active:bg-rose-800',
    'disabled:bg-rose-600/60',
  ),
  'danger-outline':
    'border border-rose-200 text-rose-600 hover:border-rose-300 hover:bg-rose-50 dark:border-rose-500/30 dark:text-rose-400 dark:hover:bg-rose-500/10',
};

const SIZES = {
  sm: 'h-8 px-3 text-xs gap-1.5 rounded-lg',
  md: 'h-9 px-3.5 text-sm gap-2 rounded-lg',
  lg: 'h-10 px-4 text-sm gap-2 rounded-lg',
  icon: 'h-9 w-9 rounded-lg',
};

/** The classes of a button, for elements that must stay links (e.g. to another site). */
export function buttonClass({ variant = 'primary', size = 'md', className } = {}) {
  return cn(
    'inline-flex shrink-0 items-center justify-center font-medium whitespace-nowrap select-none',
    'transition-[color,background-color,border-color,box-shadow,transform,opacity] duration-150 active:scale-[0.98]',
    'disabled:cursor-not-allowed disabled:opacity-70 disabled:active:scale-100',
    VARIANTS[variant],
    SIZES[size],
    className,
  );
}
