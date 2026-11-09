import { describe, expect, it } from 'vitest';
import { blankScheduleForm, describeInterval, INTERVAL_UNITS, isScheduleFormComplete, scheduleFormToPayload, scheduleToForm } from './schedule-form';
import type { Schedule } from './types';

const schedule: Schedule = {
  id: 's1', name: 'Daily', keywords: ['summer'], ad_account_id: 'acc', interval_unit: 'day', interval_value: 2, timezone: 'Europe/Berlin', lookback_days: 14,
  start_at: '2026-07-15T07:00:00.000Z', end_at: null, enabled: true, last_run_at: null, next_run_at: null, last_status: null, consecutive_failures: 0,
};

describe('INTERVAL_UNITS', () => {
  it('supports hours, days, weeks and months', () => expect(INTERVAL_UNITS).toEqual(['hour', 'day', 'week', 'month']));
});

describe('blankScheduleForm', () => {
  it('starts now in the given timezone with sensible defaults', () => {
    const form = blankScheduleForm('Europe/Berlin', 'acc-1', new Date('2026-07-15T07:30:00Z'));
    expect(form).toMatchObject({ name: '', keywords: [], accountId: 'acc-1', intervalValue: 1, intervalUnit: 'day', timezone: 'Europe/Berlin', start: '2026-07-15T09:30', end: '', lookbackDays: 30 });
  });
});

describe('scheduleToForm', () => {
  it('shows start and end in the schedule timezone', () => {
    expect(scheduleToForm({ ...schedule, end_at: '2026-08-15T07:00:00.000Z' })).toMatchObject({
      id: 's1', accountId: 'acc', intervalValue: 2, lookbackDays: 14, start: '2026-07-15T09:00', end: '2026-08-15T09:00',
    });
  });
  it('leaves the end empty without an end date', () => expect(scheduleToForm(schedule).end).toBe(''));
});

describe('scheduleFormToPayload', () => {
  it('converts wall-clock times back to UTC', () => {
    expect(scheduleFormToPayload(scheduleToForm(schedule))).toEqual({
      name: 'Daily', keywords: ['summer'], interval_unit: 'day', interval_value: 2, timezone: 'Europe/Berlin', lookback_days: 14,
      start_at: '2026-07-15T07:00:00.000Z', end_at: null,
    });
  });
  it('omits end_at for new schedules without one, but clears it when editing', () => {
    const fresh = { ...scheduleToForm(schedule), id: undefined };
    expect(scheduleFormToPayload(fresh).end_at).toBeUndefined();
    expect(scheduleFormToPayload(scheduleToForm(schedule)).end_at).toBeNull();
  });
  it('sends an end date when set', () => {
    expect(scheduleFormToPayload({ ...scheduleToForm(schedule), end: '2026-08-01T00:00' }).end_at).toBe('2026-07-31T22:00:00.000Z');
  });
});

describe('isScheduleFormComplete', () => {
  const complete = scheduleToForm(schedule);
  it('accepts a complete form', () => expect(isScheduleFormComplete(complete)).toBe(true));
  it.each([{ name: '  ' }, { keywords: [] }, { accountId: '' }, { start: '' }])('rejects %o', (patch) => {
    expect(isScheduleFormComplete({ ...complete, ...patch })).toBe(false);
  });
});

describe('describeInterval', () => {
  it('uses the singular for 1', () => expect(describeInterval(1, 'hour')).toBe('Every hour'));
  it('pluralises otherwise', () => expect(describeInterval(3, 'month')).toBe('Every 3 months'));
});
