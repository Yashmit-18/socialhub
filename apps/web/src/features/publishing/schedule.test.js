import { describe, expect, it } from 'vitest';
import {
  dateBounds,
  instantToZoned,
  resolveSchedule,
  scheduleProblem,
  suggestedSchedule,
  zoneOffsetMs,
  zonedToInstant,
} from './schedule.js';

const iso = (result) => result.instant?.toISOString();

describe('zonedToInstant', () => {
  it('converts wall-clock time in a zone to the exact instant', () => {
    expect(
      iso(zonedToInstant({ date: '2026-11-22', time: '09:30', timeZone: 'Asia/Kolkata' })),
    ).toBe('2026-11-22T04:00:00.000Z');
    expect(iso(zonedToInstant({ date: '2026-11-22', time: '09:30', timeZone: 'UTC' }))).toBe(
      '2026-11-22T09:30:00.000Z',
    );
    expect(
      iso(zonedToInstant({ date: '2026-07-01', time: '12:00', timeZone: 'America/New_York' })),
    ).toBe('2026-07-01T16:00:00.000Z');
    expect(
      iso(zonedToInstant({ date: '2026-01-01', time: '12:00', timeZone: 'America/New_York' })),
    ).toBe('2026-01-01T17:00:00.000Z');
  });

  it('crosses the date line correctly', () => {
    expect(
      iso(zonedToInstant({ date: '2026-11-22', time: '06:00', timeZone: 'Pacific/Auckland' })),
    ).toBe('2026-11-21T17:00:00.000Z');
  });

  it('refuses a time skipped when the clocks go forward', () => {
    // 8 March 2026: New York clocks jump from 02:00 to 03:00.
    const gap = zonedToInstant({ date: '2026-03-08', time: '02:30', timeZone: 'America/New_York' });
    expect(gap.error).toMatch(/does not exist/);
  });

  it('uses the first of the two times that happen when the clocks go back', () => {
    // 1 November 2026: 01:30 happens twice in New York (EDT, then EST).
    const twice = zonedToInstant({
      date: '2026-11-01',
      time: '01:30',
      timeZone: 'America/New_York',
    });
    expect(iso(twice)).toBe('2026-11-01T05:30:00.000Z');
  });

  it.each([
    [{ date: '', time: '10:00', timeZone: 'UTC' }, /date and a time/],
    [{ date: '2026-02-30', time: '10:00', timeZone: 'UTC' }, /valid date/],
    [{ date: '2026-02-10', time: '24:00', timeZone: 'UTC' }, /valid time/],
    [{ date: '2026-02-10', time: '10:00', timeZone: 'Mars/Base' }, /time zone/],
  ])('refuses incomplete or impossible input %j', (value, message) => {
    expect(zonedToInstant(value).error).toMatch(message);
  });

  it('round-trips with instantToZoned', () => {
    for (const timeZone of ['UTC', 'Asia/Kolkata', 'America/Los_Angeles', 'Australia/Sydney']) {
      const instant = new Date('2026-06-15T13:45:00Z');
      const wall = instantToZoned(instant, timeZone);
      expect(iso(zonedToInstant({ ...wall, timeZone }))).toBe(instant.toISOString());
    }
  });

  it('knows the offset of a zone', () => {
    expect(zoneOffsetMs(new Date('2026-11-22T00:00:00Z'), 'Asia/Kolkata')).toBe(19_800_000);
    expect(zoneOffsetMs(new Date('2026-07-01T00:00:00Z'), 'Europe/London')).toBe(3_600_000);
  });
});

describe('scheduleProblem and resolveSchedule', () => {
  const now = new Date('2026-11-21T10:00:00Z');

  it('refuses past times, times too soon and times too far ahead', () => {
    expect(scheduleProblem(new Date('2026-11-21T09:59:00Z'), now)).toMatch(/already passed/);
    expect(scheduleProblem(new Date('2026-11-21T10:01:00Z'), now)).toMatch(/2 minutes/);
    expect(scheduleProblem(new Date('2027-03-01T10:00:00Z'), now)).toMatch(/90 days/);
    expect(scheduleProblem(new Date('2026-11-21T11:00:00Z'), now)).toBeNull();
  });

  it('resolves form values into an instant or a message', () => {
    expect(
      iso(resolveSchedule({ date: '2026-11-21', time: '17:00', timeZone: 'Asia/Kolkata' }, now)),
    ).toBe('2026-11-21T11:30:00.000Z');
    expect(
      resolveSchedule({ date: '2026-11-21', time: '15:00', timeZone: 'Asia/Kolkata' }, now).error,
    ).toMatch(/already passed/);
  });

  it('suggests the next full hour at least an hour away, in the zone', () => {
    expect(suggestedSchedule('UTC', new Date('2026-11-21T10:20:00Z'))).toEqual({
      date: '2026-11-21',
      time: '12:00',
      timeZone: 'UTC',
    });
    expect(dateBounds('UTC', now)).toEqual({ min: '2026-11-21', max: '2027-02-19' });
  });
});
