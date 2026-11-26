import { cn } from '../../lib/utils.js';

/*
 * The one segmented look: white pill on a grey track. SegmentedControl uses these; markup that
 * needs its own structure (a fieldset with a legend, a stretched tile) can use them directly.
 */
export const segmentTrack =
  'inline-flex max-w-full flex-wrap gap-1 rounded-xl bg-slate-100 p-1 dark:bg-white/[0.06]';

const HEIGHTS = { sm: 'h-7', md: 'h-8', lg: 'h-9' };

/** `sm` items (28 px) make a 36 px track that lines up with `h-9` controls. */
export function segmentItem(active, size = 'md') {
  return cn(
    'inline-flex items-center justify-center gap-1.5 rounded-lg px-3 text-xs font-medium whitespace-nowrap transition-[color,background-color,box-shadow] duration-150 disabled:cursor-not-allowed disabled:opacity-50',
    HEIGHTS[size] ?? HEIGHTS.md,
    active
      ? 'bg-white text-slate-900 shadow-xs ring-1 ring-slate-900/5 dark:bg-slate-700 dark:text-white dark:ring-white/10'
      : 'text-slate-600 hover:bg-white/60 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-white/[0.05] dark:hover:text-white',
  );
}
