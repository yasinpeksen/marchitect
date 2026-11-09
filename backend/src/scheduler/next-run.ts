import { DateTime } from 'luxon';

export type IntervalUnit = 'hour' | 'day' | 'week' | 'month';

const MILLISECONDS_PER_DAY = 86_400_000;
const LUXON_UNIT = { day: 'days', week: 'weeks', month: 'months' } as const;
const APPROXIMATE_UNIT_MS = { day: MILLISECONDS_PER_DAY, week: 7 * MILLISECONDS_PER_DAY, month: 28 * MILLISECONDS_PER_DAY } as const;

/**
 * Next occurrence strictly after `after`, anchored on `startAt` (so months never drift:
 * Jan 31 + 1 month = Feb 28, but the anchor keeps the 31st for March).
 * Hours are absolute durations; days/weeks/months follow the wall clock in `zone` (DST-safe).
 * Returns null when it falls after `endAt`.
 */
export function nextRun(
  startAt: Date,
  unit: IntervalUnit,
  value: number,
  zone: string,
  after: Date,
  endAt?: Date | null,
): Date | null {
  const start = DateTime.fromJSDate(startAt, { zone });
  if (!start.isValid) throw new Error(`Invalid timezone: ${zone}`);
  const afterMs = after.getTime();
  let next: DateTime;

  if (startAt.getTime() > afterMs) {
    next = start;
  } else if (unit === 'hour') {
    const stepMs = value * 3_600_000;
    const steps = Math.floor((afterMs - startAt.getTime()) / stepMs) + 1;
    next = DateTime.fromMillis(startAt.getTime() + steps * stepMs, { zone });
  } else {
    const luxonUnit = LUXON_UNIT[unit];
    const approximateMs = APPROXIMATE_UNIT_MS[unit];
    let steps = Math.max(1, Math.floor((afterMs - startAt.getTime()) / (approximateMs * value)));
    // Step back if the estimate overshoots, then forward to the first slot strictly after `after`.
    while (steps > 1 && start.plus({ [luxonUnit]: (steps - 1) * value }).toMillis() > afterMs) steps--;
    next = start.plus({ [luxonUnit]: steps * value });
    while (next.toMillis() <= afterMs) {
      steps++;
      next = start.plus({ [luxonUnit]: steps * value });
    }
  }
  const result = next.toJSDate();
  return endAt && result.getTime() > endAt.getTime() ? null : result;
}
