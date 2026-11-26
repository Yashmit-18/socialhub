/*
 * The app's colour families, written out once as complete class strings (Tailwind finds classes
 * only as whole strings, so never build one from parts).
 *
 * - SOFT_TONES: the quiet tinted chip used for icons inside cards, stat tiles and empty states.
 *   Status tones (success, warning, danger) only where the thing itself reports a state.
 * - GRADIENT_TONES: the loud section tile (page header, numbered steps, area markers). The
 *   gradients are the ones navigation.js gives each section.
 */
export const SOFT_TONES = {
  neutral: 'bg-slate-100 text-slate-600 dark:bg-white/[0.06] dark:text-slate-300',
  brand: 'bg-brand-50 text-brand-600 dark:bg-brand-400/10 dark:text-brand-300',
  violet: 'bg-violet-50 text-violet-600 dark:bg-violet-400/10 dark:text-violet-300',
  fuchsia: 'bg-fuchsia-50 text-fuchsia-600 dark:bg-fuchsia-400/10 dark:text-fuchsia-300',
  pink: 'bg-pink-50 text-pink-600 dark:bg-pink-400/10 dark:text-pink-300',
  blue: 'bg-blue-50 text-blue-600 dark:bg-blue-400/10 dark:text-blue-300',
  sky: 'bg-sky-50 text-sky-600 dark:bg-sky-400/10 dark:text-sky-300',
  teal: 'bg-teal-50 text-teal-700 dark:bg-teal-400/10 dark:text-teal-300',
  amber: 'bg-amber-50 text-amber-700 dark:bg-amber-400/10 dark:text-amber-300',
  success: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300',
  warning: 'bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-300',
  danger: 'bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-300',
  facebook: 'bg-[#1877F2]/10 text-[#1877F2] dark:bg-[#1877F2]/15 dark:text-[#6ea8fb]',
  instagram: 'bg-pink-50 text-pink-600 dark:bg-pink-400/10 dark:text-pink-300',
};

export const GRADIENT_TONES = {
  brand: 'from-indigo-500 to-violet-600',
  violet: 'from-violet-500 to-fuchsia-600',
  pink: 'from-pink-500 to-rose-500',
  blue: 'from-blue-500 to-indigo-600',
  teal: 'from-emerald-500 to-teal-600',
  sky: 'from-sky-500 to-cyan-600',
  amber: 'from-amber-400 to-amber-600',
  neutral: 'from-slate-500 to-slate-700',
  fuchsia: 'from-fuchsia-500 to-purple-600',
  rose: 'from-rose-500 to-pink-600',
};

/** The soft chip for a tone key; unknown keys fall back to the brand chip. */
export function softTone(key) {
  return SOFT_TONES[key] ?? SOFT_TONES.brand;
}
