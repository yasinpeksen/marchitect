import { nextRun } from './next-run';

const date = (isoText: string) => new Date(isoText);

describe('nextRun', () => {
  it('returns the start when it is in the future', () => {
    expect(nextRun(date('2026-03-01T10:00:00Z'), 'hour', 6, 'UTC', date('2026-02-01T00:00:00Z'))).toEqual(date('2026-03-01T10:00:00Z'));
  });

  it('steps by N hours from the anchor', () => {
    expect(nextRun(date('2026-01-01T00:00:00Z'), 'hour', 6, 'UTC', date('2026-01-01T06:00:00Z'))).toEqual(date('2026-01-01T12:00:00Z'));
  });

  it('keeps the wall-clock hour across DST for daily schedules', () => {
    // Europe/Berlin: 09:00 local on both sides of the 2026-03-29 DST change.
    const start = date('2026-03-27T08:00:00Z'); // 09:00 CET
    expect(nextRun(start, 'day', 1, 'Europe/Berlin', date('2026-03-28T08:30:00Z'))).toEqual(date('2026-03-29T07:00:00Z')); // 09:00 CEST
  });

  it('anchors months so the 31st is not lost after February', () => {
    const start = date('2026-01-31T12:00:00Z');
    expect(nextRun(start, 'month', 1, 'UTC', date('2026-02-28T13:00:00Z'))).toEqual(date('2026-03-31T12:00:00Z'));
  });

  it('supports every 3 months and every 2 weeks', () => {
    expect(nextRun(date('2026-01-15T00:00:00Z'), 'month', 3, 'UTC', date('2026-01-16T00:00:00Z'))).toEqual(date('2026-04-15T00:00:00Z'));
    expect(nextRun(date('2026-01-01T00:00:00Z'), 'week', 2, 'UTC', date('2026-01-20T00:00:00Z'))).toEqual(date('2026-01-29T00:00:00Z'));
  });

  it('collapses missed runs into the next future slot', () => {
    expect(nextRun(date('2026-01-01T00:00:00Z'), 'day', 1, 'UTC', date('2026-01-10T12:00:00Z'))).toEqual(date('2026-01-11T00:00:00Z'));
  });

  it('returns null once the next slot is past the end date', () => {
    expect(nextRun(date('2026-01-01T00:00:00Z'), 'day', 1, 'UTC', date('2026-01-10T12:00:00Z'), date('2026-01-10T23:00:00Z'))).toBeNull();
  });

  it('rejects an unknown timezone', () => {
    expect(() => nextRun(date('2026-01-01T00:00:00Z'), 'day', 1, 'Not/AZone', date('2026-01-02T00:00:00Z'))).toThrow('Invalid timezone');
  });
});
