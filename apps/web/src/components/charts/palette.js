/*
 * Chart colours by ROLE, not by slot: a metric keeps one colour on every page.
 *
 * - real       a real figure: published posts, reach, views, any single-metric line
 * - failed     failures
 * - simulated  anything simulated or demo (the app's violet for "nothing real happened")
 * - people     people counts: new accounts, members, signups
 * - facebook, instagram   splits by platform (the platform colours)
 * - muted      the rest: "other", a remainder, a track
 *
 * Validated with the dataviz palette validator (lightness band, chroma, colour-blind
 * separation, normal vision, 3:1 against the surface) on white and on the dark card
 * (slate-900, #151727): real + failed, simulated + failed, people + real + failed, and
 * facebook + instagram all pass in both themes. Dark mode uses the 500 steps (the 400 steps
 * fall outside the dark lightness band), except `people`, which stays teal-600.
 * Two pairs must never share a chart: real with simulated (indigo and violet are too close),
 * and failed with instagram. Say "simulated" in words as well.
 *
 * Each role: `fill` and `stroke` for SVG marks, `swatch` for legend keys and HTML bars,
 * `wash` for the area under a line. Complete class strings (Tailwind scans them as written).
 */
export const SERIES = {
  real: {
    fill: 'fill-brand-600 dark:fill-brand-500',
    stroke: 'stroke-brand-600 dark:stroke-brand-500',
    swatch: 'bg-brand-600 dark:bg-brand-500',
    wash: 'fill-brand-600/10 dark:fill-brand-500/15',
  },
  failed: {
    fill: 'fill-rose-600 dark:fill-rose-500',
    stroke: 'stroke-rose-600 dark:stroke-rose-500',
    swatch: 'bg-rose-600 dark:bg-rose-500',
    wash: 'fill-rose-600/10 dark:fill-rose-500/15',
  },
  simulated: {
    fill: 'fill-violet-600 dark:fill-violet-500',
    stroke: 'stroke-violet-600 dark:stroke-violet-500',
    swatch: 'bg-violet-600 dark:bg-violet-500',
    wash: 'fill-violet-600/10 dark:fill-violet-500/15',
  },
  people: {
    fill: 'fill-teal-600',
    stroke: 'stroke-teal-600',
    swatch: 'bg-teal-600',
    wash: 'fill-teal-600/10 dark:fill-teal-600/15',
  },
  facebook: {
    fill: 'fill-[#1877f2]',
    stroke: 'stroke-[#1877f2]',
    swatch: 'bg-[#1877f2]',
    wash: 'fill-[#1877f2]/10',
  },
  instagram: {
    fill: 'fill-[#d62976]',
    stroke: 'stroke-[#d62976]',
    swatch: 'bg-[#d62976]',
    wash: 'fill-[#d62976]/10',
  },
  muted: {
    fill: 'fill-slate-300 dark:fill-slate-600',
    stroke: 'stroke-slate-300 dark:stroke-slate-600',
    swatch: 'bg-slate-300 dark:bg-slate-600',
    wash: 'fill-slate-300/20 dark:fill-slate-600/20',
  },
};

/** The classes of a role; an unknown role reads as `real`. */
export function seriesRole(role) {
  return SERIES[role] ?? SERIES.real;
}
