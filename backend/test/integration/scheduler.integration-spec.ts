import {
  AdAccountSummary, connectMeta, createIntegrationContext, IntegrationContext, RunSummary } from '../../src/testing/integration-flows';
import { waitFor } from '../../src/testing/integration-support';
import { MOCK_TOKENS } from '../../src/testing/mock-meta/fixtures';

interface ScheduleSummary {
  id: string;
  enabled: boolean;
  next_run_at: string | null;
  last_run_at: string | null;
  last_status: string | null;
  consecutive_failures: number;
}

interface ExecutionSummary {
  id: string;
  status: string;
  run_id: string | null;
  scheduled_for: string;
}

/** Persisted schedules executed by the background worker (tick every 2s in the test stack). */
describe('Scheduler (integration)', () => {
  let context: IntegrationContext;
  let accountId: string;

  beforeAll(async () => {
    context = await createIntegrationContext(['scheduler']);
    const accounts = await connectMeta(context.users[0].api, MOCK_TOKENS.valid);
    accountId = (accounts as AdAccountSummary[]).find((account) => account.meta_account_id === 'act_1001')?.id as string;
  });
  afterAll(() => context.cleanup());
  beforeEach(() => context.mock.reset());
  const api = () => context.users[0].api;

  const createSchedule = async (overrides: Record<string, unknown> = {}) =>
    (await api().post<ScheduleSummary>('/schedules', {
      name: 'Every 6 hours', keywords: ['summer'], ad_account_id: accountId, interval_unit: 'hour', interval_value: 6, timezone: 'Europe/Berlin',
      lookback_days: 5, start_at: new Date(Date.now() - 60_000).toISOString(), ...overrides,
    })).body;
  const executionsOf = async (scheduleId: string) => (await api().get<ExecutionSummary[]>(`/schedules/${scheduleId}/executions`)).body;
  const scheduleOf = async (scheduleId: string) => (await api().get<ScheduleSummary[]>('/schedules')).body.find((schedule) => schedule.id === scheduleId) as ScheduleSummary;

  it('automatically executes a due schedule through the worker and advances to the next slot', async () => {
    const schedule = await createSchedule();
    expect(new Date(schedule.next_run_at as string).getTime()).toBeLessThanOrEqual(Date.now()); // start is in the past: due immediately

    const execution = await waitFor(
      async () => (await executionsOf(schedule.id)).find((entry) => entry.status === 'succeeded') ?? null,
      { timeoutMs: 90_000, description: 'the scheduled execution to succeed' },
    );
    expect(execution.run_id).toBeTruthy();
    const run = (await api().get<RunSummary>(`/collection-runs/${execution.run_id}`)).body;
    expect(run).toMatchObject({ status: 'succeeded', trigger: 'schedule' });
    expect(run.counters.ads_found).toBe(2);

    const after = await scheduleOf(schedule.id);
    expect(after.last_status).toBe('succeeded');
    expect(after.consecutive_failures).toBe(0);
    const hoursAhead = (new Date(after.next_run_at as string).getTime() - Date.now()) / 3_600_000;
    expect(hoursAhead).toBeGreaterThan(5);
    expect(hoursAhead).toBeLessThanOrEqual(6);
  });

  it('never double-executes a slot (several ticks later there is still exactly one execution)', async () => {
    const [schedule] = (await api().get<ScheduleSummary[]>('/schedules')).body;
    await new Promise((resolve) => setTimeout(resolve, 7000)); // > 3 scheduler ticks
    expect(await executionsOf(schedule.id)).toHaveLength(1);
    const { data: runs } = await context.admin.from('collection_runs').select('id').eq('schedule_id', schedule.id);
    expect(runs).toHaveLength(1);
  });

  it('runs a schedule manually and refuses to overlap a run that is still in flight', async () => {
    const schedule = await createSchedule({ name: 'Manual', start_at: new Date(Date.now() + 3_600_000).toISOString() });
    expect(await executionsOf(schedule.id)).toEqual([]); // start is in the future: not due
    await context.mock.setLatency(400);
    const first = (await api().post<{ started: boolean; run: { id: string } | null }>(`/schedules/${schedule.id}/run`)).body;
    expect(first.started).toBe(true);
    const second = (await api().post<{ started: boolean; run: unknown }>(`/schedules/${schedule.id}/run`)).body;
    expect(second).toEqual({ started: false, run: null });
    await context.mock.setLatency(0);
    await waitFor(async () => ((await api().get<RunSummary>(`/collection-runs/${first.run?.id}`)).body.status === 'succeeded' ? true : null), { timeoutMs: 90_000 });
    expect((await executionsOf(schedule.id)).filter((entry) => entry.status === 'succeeded')).toHaveLength(1);
  });

  it('pauses, edits and resumes a schedule (resume never backfills missed slots)', async () => {
    const schedule = await createSchedule({ name: 'Pausable', start_at: new Date(Date.now() + 86_400_000).toISOString() });
    const paused = (await api().patch<ScheduleSummary>(`/schedules/${schedule.id}`, { enabled: false })).body;
    expect(paused).toMatchObject({ enabled: false, next_run_at: null });

    const edited = (await api().patch<ScheduleSummary & { interval_unit: string; interval_value: number }>(`/schedules/${schedule.id}`, { interval_unit: 'day', interval_value: 2, name: 'Every 2 days' })).body;
    expect(edited).toMatchObject({ interval_unit: 'day', interval_value: 2, enabled: false, next_run_at: null });

    const resumed = (await api().patch<ScheduleSummary>(`/schedules/${schedule.id}`, { enabled: true })).body;
    expect(resumed.enabled).toBe(true);
    expect(new Date(resumed.next_run_at as string).getTime()).toBeGreaterThan(Date.now());
    expect((await executionsOf(schedule.id)).length).toBe(0);
  });

  it('supports months, weeks and a timezone in its definition and rejects invalid ones', async () => {
    const monthly = await createSchedule({ name: 'Quarterly', interval_unit: 'month', interval_value: 3, start_at: new Date(Date.now() + 86_400_000).toISOString() });
    expect(monthly.enabled).toBe(true);
    expect((await api().post('/schedules', { name: 'Bad zone', keywords: ['a1'], ad_account_id: accountId, interval_unit: 'day', interval_value: 1, timezone: 'Mars/Olympus', start_at: new Date().toISOString() })).status).toBe(400);
    expect((await api().post('/schedules', { name: 'Bad unit', keywords: ['a1'], ad_account_id: accountId, interval_unit: 'minute', interval_value: 1, start_at: new Date().toISOString() })).status).toBe(400);
    expect((await api().post('/schedules', { name: 'End first', keywords: ['a1'], ad_account_id: accountId, interval_unit: 'day', interval_value: 1, start_at: '2026-06-01T00:00:00Z', end_at: '2026-05-01T00:00:00Z' })).status).toBe(400);
  });

  it('retries failures, records the failed execution, counts failures and notifies the user', async () => {
    const schedule = await createSchedule({ name: 'Failing', start_at: new Date(Date.now() + 3_600_000).toISOString() });
    await context.mock.failNext({ match: 'act_1001/ads', times: 99, status: 401, error: { code: 190, message: 'Session has expired' } });
    expect((await api().post<{ started: boolean }>(`/schedules/${schedule.id}/run`)).body.started).toBe(true);

    const failed = await waitFor(async () => (await executionsOf(schedule.id)).find((entry) => entry.status === 'failed') ?? null, { timeoutMs: 90_000, description: 'the execution to fail' });
    expect(failed.run_id).toBeTruthy();
    const after = await waitFor(async () => {
      const current = await scheduleOf(schedule.id);
      return current.last_status === 'failed' ? current : null;
    }, { description: 'the schedule to record its failure' });
    expect(after.consecutive_failures).toBe(1);

    const notifications = await waitFor(async () => {
      const list = (await api().get<{ type: string; title: string; body: string }[]>('/notifications')).body;
      return list.some((entry) => entry.type === 'schedule_failed') ? list : null;
    }, { description: 'the failure notification' });
    expect(notifications.find((entry) => entry.type === 'schedule_failed')?.title).toBe('Scheduled search "Failing" failed');
  });

  it('keeps an execution history per schedule and deletes schedules with their history', async () => {
    const [schedule] = (await api().get<ScheduleSummary[]>('/schedules')).body;
    expect((await executionsOf(schedule.id)).length).toBeGreaterThan(0);
    expect((await api().delete(`/schedules/${schedule.id}`)).status).toBe(204);
    expect((await api().get(`/schedules/${schedule.id}/executions`)).status).toBe(404);
    const { data } = await context.admin.from('schedule_executions').select('id').eq('schedule_id', schedule.id);
    expect(data).toEqual([]);
  });
});
