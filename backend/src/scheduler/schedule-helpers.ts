import { BadRequestException } from '@nestjs/common';
import { IANAZone } from 'luxon';
import { ScheduleRow } from '../common/types';
import { nextRun } from './next-run';

type TimingFields = Pick<ScheduleRow, 'start_at' | 'end_at' | 'interval_unit' | 'interval_value' | 'timezone'>;

export const MAXIMUM_CONSECUTIVE_FAILURES = 5;

/** Rejects unknown timezones and end dates that are not after the start. */
export function validateScheduleTiming(schedule: Pick<TimingFields, 'timezone' | 'start_at' | 'end_at'>): void {
  if (!IANAZone.isValidZone(schedule.timezone)) throw new BadRequestException('Unknown IANA timezone');
  if (schedule.end_at && new Date(schedule.end_at) <= new Date(schedule.start_at)) {
    throw new BadRequestException('end_at must be after start_at');
  }
}

/**
 * When a schedule should next run.
 * - `first`: the start time itself (a start in the past is immediately due and then runs once before advancing).
 * - `future`: the next recurring slot strictly after `now` (used on resume/edit: never backfills missed slots).
 */
export function computeNextRunAt(schedule: TimingFields, mode: 'first' | 'future', now: Date = new Date()): string | null {
  const start = new Date(schedule.start_at);
  const end = schedule.end_at ? new Date(schedule.end_at) : null;
  if (mode === 'first') return end && start > end ? null : start.toISOString();
  return nextRun(start, schedule.interval_unit, schedule.interval_value, schedule.timezone, now, end)?.toISOString() ?? null;
}

/** On edit/resume: a start still in the future keeps being the first run, otherwise next future slot. */
export function computeNextRunAfterEdit(schedule: TimingFields, now: Date = new Date()): string | null {
  return computeNextRunAt(schedule, new Date(schedule.start_at) <= now ? 'future' : 'first', now);
}

/** Insights window `[from, to]` (UTC dates) covering the last `lookbackDays` days ending at `now`. */
export function lookbackRange(now: Date, lookbackDays: number): { dateFrom: string; dateTo: string } {
  return {
    dateTo: now.toISOString().slice(0, 10),
    dateFrom: new Date(now.getTime() - (lookbackDays - 1) * 86_400_000).toISOString().slice(0, 10),
  };
}
