/**
 * Calendar days in a workspace time zone ⇄ exact instants, using the platform's Intl data.
 * Analytics ranges are whole days ("1 Nov to 30 Nov") in the workspace's time zone.
 */
import { validationError } from '../../lib/errors.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const formatters = new Map();

function partsIn(timeZone) {
  if (!formatters.has(timeZone)) {
    formatters.set(
      timeZone,
      new Intl.DateTimeFormat('en-US', {
        timeZone,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }),
    );
  }
  return formatters.get(timeZone);
}

function wall(instant, timeZone) {
  const f = {};
  for (const part of partsIn(timeZone).formatToParts(instant)) {
    if (part.type !== 'literal') f[part.type] = Number(part.value);
  }
  return f;
}

const offsetMs = (instant, timeZone) => {
  const f = wall(instant, timeZone);
  return (
    Date.UTC(f.year, f.month - 1, f.day, f.hour, f.minute, f.second) -
    Math.floor(instant.getTime() / 1000) * 1000
  );
};

/** YYYY-MM-DD of `instant` in `timeZone`. */
export function dayIn(instant, timeZone) {
  const f = wall(instant, timeZone);
  return `${f.year}-${String(f.month).padStart(2, '0')}-${String(f.day).padStart(2, '0')}`;
}

/** The instant a calendar day starts in `timeZone` (handles days that start at 01:00). */
export function dayStart(day, timeZone) {
  const [y, m, d] = day.split('-').map(Number);
  const wallMs = Date.UTC(y, m - 1, d);
  // Midnight may not exist (clocks jump at 00:00 in some zones); then the day starts later.
  for (const probe of [wallMs - DAY_MS, wallMs + DAY_MS, wallMs]) {
    const candidate = new Date(wallMs - offsetMs(new Date(probe), timeZone));
    if (dayIn(candidate, timeZone) === day) {
      const f = wall(candidate, timeZone);
      if (f.hour === 0 && f.minute === 0) return candidate;
    }
  }
  // Fallback: the first instant of that day, found by stepping an hour at a time.
  let t = wallMs - 14 * 60 * 60 * 1000;
  while (dayIn(new Date(t), timeZone) !== day) t += 60 * 60 * 1000;
  return new Date(t);
}

export function addDays(day, n) {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Every day from `first` to `last`, inclusive. */
export function eachDay(first, last) {
  const days = [];
  for (let day = first; day <= last; day = addDays(day, 1)) days.push(day);
  return days;
}

/**
 * The range a request asks for: `{ startDay, endDay, from, to, days, timeZone }` where `from`
 * is inclusive and `to` exclusive. Defaults to the last 30 days including today.
 */
export function resolveRange({ startDate, endDate }, timeZone, now = new Date()) {
  let tz = timeZone;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
  } catch {
    tz = 'UTC';
  }
  const today = dayIn(now, tz);
  const endDay = endDate ?? today;
  const startDay = startDate ?? addDays(endDay, -29);
  if (endDay > addDays(today, 1)) {
    throw validationError({ fields: { endDate: 'The range cannot end in the future' } });
  }
  return {
    startDay,
    endDay,
    from: dayStart(startDay, tz),
    to: dayStart(addDays(endDay, 1), tz),
    days: eachDay(startDay, endDay),
    timeZone: tz,
  };
}
