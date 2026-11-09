import { utcToZonedLocal, zonedToUtcIso } from './format';
import type { IntervalUnit, Schedule } from './types';

export const INTERVAL_UNITS: IntervalUnit[] = ['hour', 'day', 'week', 'month'];

export interface ScheduleForm {
  id?: string;
  name: string;
  keywords: string[];
  accountId: string;
  intervalValue: number;
  intervalUnit: IntervalUnit;
  timezone: string;
  /** Wall-clock "YYYY-MM-DDTHH:mm" in `timezone`. */
  start: string;
  end: string;
  lookbackDays: number;
}

export function blankScheduleForm(timezone: string, accountId = '', now: Date = new Date()): ScheduleForm {
  return {
    name: '', keywords: [], accountId, intervalValue: 1, intervalUnit: 'day', timezone,
    start: utcToZonedLocal(now.toISOString(), timezone), end: '', lookbackDays: 30,
  };
}

/** Form values for editing an existing schedule (times shown in the schedule's own timezone). */
export function scheduleToForm(schedule: Schedule): ScheduleForm {
  return {
    id: schedule.id,
    name: schedule.name,
    keywords: schedule.keywords,
    accountId: schedule.ad_account_id,
    intervalValue: schedule.interval_value,
    intervalUnit: schedule.interval_unit,
    timezone: schedule.timezone,
    start: utcToZonedLocal(schedule.start_at, schedule.timezone),
    end: schedule.end_at ? utcToZonedLocal(schedule.end_at, schedule.timezone) : '',
    lookbackDays: schedule.lookback_days,
  };
}

/** API payload for create/update. Clearing the end date on an existing schedule sends `null`. */
export function scheduleFormToPayload(form: ScheduleForm) {
  return {
    name: form.name,
    keywords: form.keywords,
    interval_unit: form.intervalUnit,
    interval_value: form.intervalValue,
    timezone: form.timezone,
    lookback_days: form.lookbackDays,
    start_at: zonedToUtcIso(form.start, form.timezone),
    end_at: form.end ? zonedToUtcIso(form.end, form.timezone) : (form.id ? null : undefined),
  };
}

/** The form can be saved when it has a name, keywords, an account and a start time. */
export const isScheduleFormComplete = (form: ScheduleForm): boolean =>
  Boolean(form.name.trim() && form.keywords.length > 0 && form.accountId && form.start);

/** "Every 2 days", "Every hour". */
export function describeInterval(value: number, unit: IntervalUnit): string {
  return value === 1 ? `Every ${unit}` : `Every ${value} ${unit}s`;
}
