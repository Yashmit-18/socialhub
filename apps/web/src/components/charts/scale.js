const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);

/**
 * The smallest round top that holds `max`, with 2 to 5 steps from 0 (closest to 4 wins a
 * tie). `integer` keeps every step a whole number, for counts. Nothing to show (0, null):
 * 0 to 4.
 */
export function niceScale(max, { integer = false } = {}) {
  if (!isNumber(max) || max <= 0) return { top: 4, ticks: [0, 1, 2, 3, 4] };
  const power = 10 ** Math.floor(Math.log10(max));
  let best = null;
  for (const p of [power / 10, power, power * 10]) {
    for (const m of [1, 2, 2.5, 5]) {
      const step = m * p;
      if (integer && !Number.isInteger(step)) continue;
      const n = Math.max(2, Math.ceil(max / step - 1e-9));
      if (n > 5) continue;
      const top = n * step;
      const closer = best && Math.abs(n - 4) < Math.abs(best.n - 4);
      if (!best || top < best.top || (top === best.top && closer)) best = { top, step, n };
    }
  }
  if (!best) return { top: max, ticks: [0, max] };
  return {
    top: best.top,
    ticks: Array.from({ length: best.n + 1 }, (_, i) => Number((i * best.step).toPrecision(12))),
  };
}

/**
 * Which of `count` x positions get a label at this plot width: about one every 88 px, the
 * first and the last always. Returns indexes in order.
 */
export function labelIndexes(count, innerWidth) {
  if (count <= 0) return [];
  const slots = Math.max(2, Math.min(7, Math.floor(innerWidth / 88)));
  if (count <= slots) return Array.from({ length: count }, (_, i) => i);
  const last = count - 1;
  const picks = new Set(
    Array.from({ length: slots }, (_, k) => Math.round((k * last) / (slots - 1))),
  );
  return [...picks].sort((a, b) => a - b);
}

/** Left gutter wide enough for the longest tick label (11 px text). */
export function gutterFor(labels) {
  const longest = Math.max(1, ...labels.map((label) => String(label).length));
  return Math.min(56, Math.max(24, 14 + 6.5 * longest));
}

const SHORT_DAY = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});
const LONG_DAY = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});

/** "26 Nov" for a 'YYYY-MM-DD' day (read as a UTC calendar day); `long` adds the weekday. */
export function formatChartDay(day, long = false) {
  const date = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return String(day);
  return (long ? LONG_DAY : SHORT_DAY).format(date);
}

export { isNumber as isChartNumber };
