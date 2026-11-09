'use client';
import { useState } from 'react';
import { TagInput } from '@/components/tag-input';
import { Badge, Button, Card, Empty, ErrorBox, Field, Notice, PageHeader, Spinner, statusTone } from '@/components/ui';
import { useApi, useData } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import {
  blankScheduleForm, describeInterval, INTERVAL_UNITS, isScheduleFormComplete, scheduleFormToPayload, ScheduleForm, scheduleToForm,
} from '@/lib/schedule-form';
import { browserTimezone, listTimezones } from '@/lib/timezones';
import type { AdAccount, IntervalUnit, Schedule, ScheduleExecution } from '@/lib/types';

const TIMEZONES = listTimezones();

function Executions({ scheduleId }: { scheduleId: string }) {
  const { data: executions } = useData<ScheduleExecution[]>(`/schedules/${scheduleId}/executions`, { refreshInterval: 10_000 });
  if (!executions) return <Spinner />;
  if (executions.length === 0) return <p className="text-sm text-slate-500">No executions yet.</p>;
  return (
    <table className="w-full text-left text-xs">
      <thead className="text-slate-500"><tr><th className="py-1">Scheduled for</th><th>Status</th><th>Attempt</th><th>Finished</th><th>Error</th></tr></thead>
      <tbody>
        {executions.map((execution) => (
          <tr key={execution.id} className="border-t border-slate-100">
            <td className="py-1.5">{formatDateTime(execution.scheduled_for)}</td>
            <td><Badge tone={statusTone(execution.status)}>{execution.status}</Badge></td>
            <td>{execution.attempt || '—'}</td>
            <td>{formatDateTime(execution.finished_at)}</td>
            <td className="max-w-xs truncate text-red-600">{execution.error}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function Scheduler() {
  const api = useApi();
  const { data: schedules, error, mutate } = useData<Schedule[]>('/schedules', { refreshInterval: 15_000 });
  const { data: accounts } = useData<AdAccount[]>('/ad-accounts');
  const [form, setForm] = useState<ScheduleForm | null>(null);
  const [historyScheduleId, setHistoryScheduleId] = useState<string>();
  const [actionError, setActionError] = useState<unknown>();
  const [message, setMessage] = useState<string>();

  async function save() {
    if (!form) return;
    setActionError(undefined);
    try {
      const payload = scheduleFormToPayload(form);
      if (form.id) await api.patch(`/schedules/${form.id}`, payload);
      else await api.post('/schedules', { ...payload, ad_account_id: form.accountId });
      setForm(null);
      await mutate();
    } catch (caught) {
      setActionError(caught);
    }
  }

  const perform = async (action: () => Promise<unknown>, successMessage?: string) => {
    setActionError(undefined);
    setMessage(undefined);
    try {
      await action();
      if (successMessage) setMessage(successMessage);
      await mutate();
    } catch (caught) {
      setActionError(caught);
    }
  };

  return (
    <>
      <PageHeader
        title="Scheduler"
        subtitle="Recurring collections run in background workers, in the schedule's own timezone."
        actions={<Button onClick={() => setForm(blankScheduleForm(browserTimezone(), accounts?.find((account) => account.selected)?.id ?? ''))}>New schedule</Button>}
      />
      <div className="space-y-4">
        <ErrorBox error={actionError ?? error} />
        {message && <Notice tone="green">{message}</Notice>}

        {form && (
          <Card title={form.id ? 'Edit schedule' : 'New schedule'}>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Search name"><input className="input" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></Field>
              <Field label="Ad account">
                <select className="input" disabled={Boolean(form.id)} value={form.accountId} onChange={(event) => setForm({ ...form, accountId: event.target.value })}>
                  <option value="">Select…</option>
                  {accounts?.map((account) => <option key={account.id} value={account.id}>{account.name ?? account.meta_account_id}</option>)}
                </select>
              </Field>
              <div className="md:col-span-2"><Field label="Keywords"><TagInput tags={form.keywords} onChange={(keywords) => setForm({ ...form, keywords })} /></Field></div>
              <Field label="Run every">
                <div className="flex gap-2">
                  <input className="input w-24" type="number" min={1} max={1000} value={form.intervalValue} onChange={(event) => setForm({ ...form, intervalValue: Math.max(1, Number(event.target.value)) })} />
                  <select className="input" aria-label="Interval unit" value={form.intervalUnit} onChange={(event) => setForm({ ...form, intervalUnit: event.target.value as IntervalUnit })}>
                    {INTERVAL_UNITS.map((unit) => <option key={unit} value={unit}>{unit}(s)</option>)}
                  </select>
                </div>
              </Field>
              <Field label="Timezone">
                <select className="input" value={form.timezone} onChange={(event) => setForm({ ...form, timezone: event.target.value })}>
                  {TIMEZONES.map((timezone) => <option key={timezone}>{timezone}</option>)}
                </select>
              </Field>
              <Field label="Start (in schedule timezone)"><input className="input" type="datetime-local" value={form.start} onChange={(event) => setForm({ ...form, start: event.target.value })} /></Field>
              <Field label="End (optional)"><input className="input" type="datetime-local" value={form.end} onChange={(event) => setForm({ ...form, end: event.target.value })} /></Field>
              <Field label="Data lookback (days)" hint="Insights window collected on each run.">
                <input className="input" type="number" min={1} max={1100} value={form.lookbackDays} onChange={(event) => setForm({ ...form, lookbackDays: Number(event.target.value) })} />
              </Field>
            </div>
            <div className="mt-5 flex gap-2">
              <Button onClick={save} disabled={!isScheduleFormComplete(form)}>Save schedule</Button>
              <Button variant="secondary" onClick={() => setForm(null)}>Cancel</Button>
            </div>
          </Card>
        )}

        {!schedules ? <Spinner /> : (schedules.length === 0 ? (
          <Empty title="No schedules yet" hint="Create one to collect new ads and fresh performance data automatically." />
        ) : schedules.map((schedule) => (
          <Card key={schedule.id}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{schedule.name}</p>
                  <Badge tone={schedule.enabled ? 'green' : 'amber'}>{schedule.enabled ? 'enabled' : 'paused'}</Badge>
                  {schedule.last_status && <Badge tone={statusTone(schedule.last_status)}>last: {schedule.last_status}</Badge>}
                  {schedule.consecutive_failures > 0 && <Badge tone="red">{schedule.consecutive_failures} failures</Badge>}
                </div>
                <p className="mt-1 text-sm text-slate-500">{describeInterval(schedule.interval_value, schedule.interval_unit)} · {schedule.timezone} · {schedule.ad_accounts?.name}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">{schedule.keywords.map((keyword) => <Badge key={keyword} tone="blue">{keyword}</Badge>)}</div>
                <p className="mt-2 text-xs text-slate-500">
                  Last run: {formatDateTime(schedule.last_run_at, schedule.timezone)} · Next run: {schedule.enabled ? formatDateTime(schedule.next_run_at, schedule.timezone) : '—'}
                  {schedule.end_at && ` · Ends ${formatDateTime(schedule.end_at, schedule.timezone)}`}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => perform(() => api.post(`/schedules/${schedule.id}/run`), 'Execution started.')}>Run now</Button>
                <Button variant="secondary" onClick={() => perform(() => api.patch(`/schedules/${schedule.id}`, { enabled: !schedule.enabled }))}>{schedule.enabled ? 'Pause' : 'Resume'}</Button>
                <Button variant="ghost" onClick={() => setForm(scheduleToForm(schedule))}>Edit</Button>
                <Button variant="ghost" onClick={() => setHistoryScheduleId(historyScheduleId === schedule.id ? undefined : schedule.id)}>History</Button>
                <Button variant="ghost" onClick={() => confirm(`Delete schedule “${schedule.name}”?`) && perform(() => api.remove(`/schedules/${schedule.id}`))}>Delete</Button>
              </div>
            </div>
            {historyScheduleId === schedule.id && <div className="mt-4 border-t border-slate-100 pt-4"><Executions scheduleId={schedule.id} /></div>}
          </Card>
        )))}
      </div>
    </>
  );
}
