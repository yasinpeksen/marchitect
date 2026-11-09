import { BadRequestException } from '@nestjs/common';
import { computeNextRunAfterEdit, computeNextRunAt, lookbackRange, validateScheduleTiming } from './schedule-helpers';

const timing = (overrides: Record<string, unknown> = {}) => ({
  start_at: '2026-01-01T00:00:00.000Z', end_at: null, interval_unit: 'day' as const, interval_value: 1, timezone: 'UTC', ...overrides,
});

describe('validateScheduleTiming', () => {
  it('accepts a valid schedule', () => expect(() => validateScheduleTiming(timing())).not.toThrow());
  it('rejects unknown timezones', () => expect(() => validateScheduleTiming(timing({ timezone: 'Mars/Base' }))).toThrow(BadRequestException));
  it('rejects an end before the start', () => {
    expect(() => validateScheduleTiming(timing({ end_at: '2025-12-31T00:00:00.000Z' }))).toThrow('end_at must be after start_at');
  });
});

describe('computeNextRunAt', () => {
  const now = new Date('2026-01-10T12:00:00Z');
  it('first: the start itself, even when it is in the past (due immediately)', () => {
    expect(computeNextRunAt(timing(), 'first', now)).toBe('2026-01-01T00:00:00.000Z');
  });
  it('first: null when the end is before the start', () => {
    expect(computeNextRunAt(timing({ end_at: '2025-01-01T00:00:00.000Z' }), 'first', now)).toBeNull();
  });
  it('future: the next recurring slot after now', () => {
    expect(computeNextRunAt(timing(), 'future', now)).toBe('2026-01-11T00:00:00.000Z');
  });
  it('future: null when the next slot is after the end date', () => {
    expect(computeNextRunAt(timing({ end_at: '2026-01-10T23:00:00.000Z' }), 'future', now)).toBeNull();
  });
});

describe('computeNextRunAfterEdit', () => {
  const now = new Date('2026-01-10T12:00:00Z');
  it('keeps a future start as the first run', () => {
    expect(computeNextRunAfterEdit(timing({ start_at: '2026-02-01T00:00:00.000Z' }), now)).toBe('2026-02-01T00:00:00.000Z');
  });
  it('does not backfill missed slots when the start is past', () => {
    expect(computeNextRunAfterEdit(timing(), now)).toBe('2026-01-11T00:00:00.000Z');
  });
});

describe('lookbackRange', () => {
  it('covers the last N days inclusive of today', () => {
    expect(lookbackRange(new Date('2026-03-31T10:00:00Z'), 30)).toEqual({ dateFrom: '2026-03-02', dateTo: '2026-03-31' });
  });
  it('is a single day for a lookback of one', () => {
    expect(lookbackRange(new Date('2026-03-31T10:00:00Z'), 1)).toEqual({ dateFrom: '2026-03-31', dateTo: '2026-03-31' });
  });
});
