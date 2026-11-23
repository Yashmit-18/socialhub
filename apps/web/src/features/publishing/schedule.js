/**
 * Scheduling helpers: wall-clock time in a chosen IANA time zone ⇄ an exact instant.
 *
 * A person picks a date and a time "in" a time zone (the workspace's by default). The API
 * takes one exact instant (ISO 8601 with offset), so the conversion must be right on both
 * sides of daylight-saving changes. Only the platform's Intl data is used: no date library.
 */
import { PUBLISHING_LIMITS } from '@socialhub/shared';
import { browserTimeZone } from '../../lib/utils.js';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/** The earliest a post can be scheduled: a little ahead, so it is still future on arrival. */
export const SCHEDULE_MIN_LEAD_MS = 2 * MINUTE;
export const SCHEDULE_MAX_DAYS = PUBLISHING_LIMITS.SCHEDULE_MAX_DAYS;

const pad = (n) => String(n).padStart(2, '0');

export function isValidTimeZone(timeZone) {
  if (!timeZone || typeof timeZone !== 'string') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

const partsFormatters = new Map();
function partsIn(timeZone) {
  if (!partsFormatters.has(timeZone)) {
    partsFormatters.set(
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
  return partsFormatters.get(timeZone);
}

/** Wall-clock fields of `instant` in `timeZone`. */
function wallClock(instant, timeZone) {
  const fields = {};
  for (const part of partsIn(timeZone).formatToParts(instant)) {
    if (part.type !== 'literal') fields[part.type] = Number(part.value);
  }
  return fields;
}

/** Milliseconds the zone is ahead of UTC at `instant` (+05:30 → 19 800 000). */
export function zoneOffsetMs(instant, timeZone) {
  const f = wallClock(instant, timeZone);
  const asUtc = Date.UTC(f.year, f.month - 1, f.day, f.hour, f.minute, f.second);
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^(\d{2}):(\d{2})$/;

/**
 * The instant at which it is `date` (YYYY-MM-DD) `time` (HH:mm) in `timeZone`.
 * Returns `{ instant }`, or `{ error }` when the input is incomplete or the time does not
 * exist in that zone (the hour skipped when clocks go forward). For the hour that happens
 * twice when clocks go back, the first one is used.
 */
export function zonedToInstant({ date, time, timeZone }) {
  const d = DATE_RE.exec(date ?? '');
  const t = TIME_RE.exec(time ?? '');
  if (!d || !t) return { error: 'Choose a date and a time.' };
  if (!isValidTimeZone(timeZone)) return { error: 'Choose a time zone.' };
  const [year, month, day] = [Number(d[1]), Number(d[2]), Number(d[3])];
  const [hour, minute] = [Number(t[1]), Number(t[2])];
  if (hour > 23 || minute > 59) return { error: 'Choose a valid time.' };
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  const check = new Date(wall);
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    return { error: 'Choose a valid date.' };
  }

  // Try the offsets in force just before and just after: one of them is right.
  const candidates = [
    wall - zoneOffsetMs(new Date(wall - DAY), timeZone),
    wall - zoneOffsetMs(new Date(wall + DAY), timeZone),
    wall - zoneOffsetMs(new Date(wall), timeZone),
  ];
  const matching = candidates
    .filter((ms) => {
      const f = wallClock(new Date(ms), timeZone);
      return (
        f.year === year &&
        f.month === month &&
        f.day === day &&
        f.hour === hour &&
        f.minute === minute
      );
    })
    .sort((a, b) => a - b);
  if (matching.length === 0) {
    return {
      error: `${time} does not exist on that day in ${timeZone}, because the clocks change. Choose another time.`,
    };
  }
  return { instant: new Date(matching[0]) };
}

/** `{ date, time }` (YYYY-MM-DD, HH:mm) of `instant` in `timeZone`, for filling the inputs. */
export function instantToZoned(instant, timeZone) {
  const f = wallClock(new Date(instant), timeZone);
  return {
    date: `${f.year}-${pad(f.month)}-${pad(f.day)}`,
    time: `${pad(f.hour)}:${pad(f.minute)}`,
  };
}

/** "Sat, 22 Nov 2026, 09:30 GMT+5:30" in the given zone. */
export function formatInZone(instant, timeZone, { weekday = true } = {}) {
  return new Intl.DateTimeFormat(undefined, {
    timeZone,
    weekday: weekday ? 'short' : undefined,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(new Date(instant));
}

/** Why `instant` cannot be used as a scheduled time, or null when it can. */
export function scheduleProblem(instant, now = new Date()) {
  if (!(instant instanceof Date) || !Number.isFinite(instant.getTime())) {
    return 'Choose a date and a time.';
  }
  if (instant.getTime() < now.getTime() + SCHEDULE_MIN_LEAD_MS) {
    return instant.getTime() <= now.getTime()
      ? 'That time has already passed. Choose a time in the future.'
      : 'Choose a time at least 2 minutes from now.';
  }
  if (instant.getTime() > now.getTime() + SCHEDULE_MAX_DAYS * DAY) {
    return `Posts can be scheduled at most ${SCHEDULE_MAX_DAYS} days ahead.`;
  }
  return null;
}

/**
 * Validates the schedule form: `{ date, time, timeZone }` → `{ instant }` or `{ error }`.
 * The same rules as the API, plus a small lead so the time is still future when it arrives.
 */
export function resolveSchedule(value, now = new Date()) {
  const converted = zonedToInstant(value);
  if (converted.error) return converted;
  const problem = scheduleProblem(converted.instant, now);
  return problem ? { error: problem } : converted;
}

/** The zone a new schedule starts in: the workspace's, else this browser's. */
export function defaultTimeZone(workspaceTimeZone) {
  return isValidTimeZone(workspaceTimeZone) ? workspaceTimeZone : browserTimeZone();
}

/** A sensible first suggestion: the next full hour at least an hour from now, in `timeZone`. */
export function suggestedSchedule(timeZone, now = new Date()) {
  const next = new Date(Math.ceil((now.getTime() + 60 * MINUTE) / (60 * MINUTE)) * 60 * MINUTE);
  return { ...instantToZoned(next, timeZone), timeZone };
}

/** Bounds for the date input, in `timeZone`. */
export function dateBounds(timeZone, now = new Date()) {
  return {
    min: instantToZoned(now, timeZone).date,
    max: instantToZoned(new Date(now.getTime() + SCHEDULE_MAX_DAYS * DAY), timeZone).date,
  };
}
