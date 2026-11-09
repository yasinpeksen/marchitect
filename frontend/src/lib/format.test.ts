import { describe, expect, it } from 'vitest';
import {
  daysAgoIso, formatCompact, formatDateTime, formatDay, formatDecimal, formatInteger, formatMoney, formatPercent, isNumber, MISSING_VALUE,
  todayIso, utcToZonedLocal, zonedToUtcIso,
} from './format';

describe('isNumber', () => {
  it('accepts finite numbers only', () => {
    expect(isNumber(0)).toBe(true);
    expect(isNumber(Number.NaN)).toBe(false);
    expect(isNumber(Infinity)).toBe(false);
    expect(isNumber('1')).toBe(false);
    expect(isNumber(null)).toBe(false);
  });
});

describe('number formatters render missing values as a dash, never 0', () => {
  it.each([formatInteger, formatCompact, formatDecimal, formatPercent, formatMoney])('%o', (formatter) => {
    expect(formatter(null)).toBe(MISSING_VALUE);
    expect(formatter(undefined)).toBe(MISSING_VALUE);
  });
});

describe('number formatters render present values', () => {
  it('rounds integers with grouping', () => expect(formatInteger(1234.6)).toBe((1235).toLocaleString()));
  it('keeps zero', () => expect(formatInteger(0)).toBe('0'));
  it('compacts large numbers', () => expect(formatCompact(1_500_000)).toBe('1.5M'));
  it('formats decimals', () => {
    expect(formatDecimal(1.5)).toBe((1.5).toLocaleString(undefined, { minimumFractionDigits: 2 }));
    expect(formatDecimal(1.23456, 3)).toBe((1.23456).toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 }));
  });
  it('appends a percent sign', () => expect(formatPercent(2)).toMatch(/2[.,]00%$/));
  it('formats money in the given currency and falls back for invalid codes', () => {
    expect(formatMoney(12.5, 'USD')).toContain('12');
    expect(formatMoney(12.5, 'EUR')).toContain('€');
    expect(formatMoney(12.5, 'NOT-A-CURRENCY')).toBe(formatDecimal(12.5));
    expect(formatMoney(12.5)).toContain('$');
  });
});

describe('date formatters', () => {
  it('renders missing dates as a dash', () => {
    expect(formatDateTime(null)).toBe(MISSING_VALUE);
    expect(formatDay(undefined)).toBe(MISSING_VALUE);
  });
  it('formats a date-time in a timezone', () => {
    expect(formatDateTime('2026-03-01T12:00:00Z', 'UTC')).toContain('2026');
  });
  it('formats a day without timezone drift', () => expect(formatDay('2026-03-01')).toMatch(/Mar\s+1|1\s+Mar/));
});

describe('timezone conversion', () => {
  it('converts wall-clock time in a timezone to UTC, DST aware', () => {
    expect(zonedToUtcIso('2026-01-15T09:00', 'Europe/Berlin')).toBe('2026-01-15T08:00:00.000Z');
    expect(zonedToUtcIso('2026-07-15T09:00', 'Europe/Berlin')).toBe('2026-07-15T07:00:00.000Z');
    expect(zonedToUtcIso('2026-07-15T09:00', 'UTC')).toBe('2026-07-15T09:00:00.000Z');
  });
  it('round-trips', () => {
    expect(utcToZonedLocal(zonedToUtcIso('2026-07-15T09:30', 'America/New_York'), 'America/New_York')).toBe('2026-07-15T09:30');
  });
});

describe('day helpers', () => {
  const now = new Date('2026-03-10T12:00:00Z');
  it('todayIso is the UTC date', () => expect(todayIso(now)).toBe('2026-03-10'));
  it('daysAgoIso subtracts days', () => expect(daysAgoIso(9, now)).toBe('2026-03-01'));
});
