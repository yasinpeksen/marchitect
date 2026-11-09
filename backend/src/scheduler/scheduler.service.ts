import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { must, SupabaseService } from '../common/supabase.service';
import { CollectionRunRow, ScheduleRow } from '../common/types';
import { QueueService } from '../jobs/queues';
import { NotificationsService } from '../notifications/notifications.service';
import { CollectionRunsService } from '../search/collection-runs.service';
import { normalizeKeywords } from '../search/search.dto';
import { IntervalUnit, nextRun } from './next-run';
import {
  computeNextRunAfterEdit, computeNextRunAt, lookbackRange, MAXIMUM_CONSECUTIVE_FAILURES, validateScheduleTiming,
} from './schedule-helpers';

export interface ScheduleInput {
  name?: string;
  keywords?: string[];
  ad_account_id?: string;
  interval_unit?: IntervalUnit;
  interval_value?: number;
  timezone?: string;
  lookback_days?: number;
  start_at?: string;
  end_at?: string | null;
  enabled?: boolean;
}

export type NewScheduleInput = Required<Pick<ScheduleInput, 'name' | 'keywords' | 'ad_account_id' | 'interval_unit' | 'interval_value' | 'start_at'>> & ScheduleInput;

/** Postgres unique-violation code, raised when another worker already claimed the slot. */
const UNIQUE_VIOLATION = '23505';

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly runs: CollectionRunsService,
    private readonly queues: QueueService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(userId: string) {
    return must(
      await this.supabase.from('schedules').select('*, ad_accounts(name,meta_account_id)').eq('user_id', userId).order('created_at', { ascending: false }),
      'list schedules',
    );
  }

  private async get(userId: string, scheduleId: string): Promise<ScheduleRow> {
    const schedule = must<ScheduleRow | null>(
      await this.supabase.from('schedules').select('*').eq('id', scheduleId).eq('user_id', userId).maybeSingle(),
      'load schedule',
    );
    if (!schedule) throw new NotFoundException('Schedule not found');
    return schedule;
  }

  async create(userId: string, input: NewScheduleInput) {
    const account = must(
      await this.supabase.from('ad_accounts').select('id').eq('id', input.ad_account_id).eq('user_id', userId).maybeSingle(),
      'load account',
    );
    if (!account) throw new NotFoundException('Ad account not found');
    const row = {
      user_id: userId,
      name: input.name.trim(),
      keywords: normalizeKeywords(input.keywords),
      ad_account_id: input.ad_account_id,
      interval_unit: input.interval_unit,
      interval_value: input.interval_value,
      timezone: input.timezone ?? 'UTC',
      lookback_days: input.lookback_days ?? 30,
      start_at: input.start_at,
      end_at: input.end_at ?? null,
      enabled: input.enabled ?? true,
    };
    validateScheduleTiming(row);
    const nextRunAt = row.enabled ? computeNextRunAt(row, 'first') : null;
    return must(await this.supabase.from('schedules').insert({ ...row, next_run_at: nextRunAt }).select('*').single(), 'create schedule');
  }

  async update(userId: string, scheduleId: string, input: ScheduleInput) {
    const current = await this.get(userId, scheduleId);
    const patch: Record<string, unknown> = { ...input };
    if (input.name) patch.name = input.name.trim();
    if (input.keywords) patch.keywords = normalizeKeywords(input.keywords);
    const merged = { ...current, ...patch } as ScheduleRow;
    validateScheduleTiming(merged);

    const timingChanged = ['interval_unit', 'interval_value', 'timezone', 'start_at', 'end_at'].some((field) => input[field as keyof ScheduleInput] !== undefined);
    if (merged.enabled === false) {
      patch.next_run_at = null;
    } else if (timingChanged || (input.enabled === true && !current.enabled)) {
      // Resume/edit never backfills missed slots; schedule the next future one.
      patch.next_run_at = computeNextRunAfterEdit(merged);
      if (input.enabled === true) patch.consecutive_failures = 0;
    }
    return must(await this.supabase.from('schedules').update(patch).eq('id', scheduleId).eq('user_id', userId).select('*').single(), 'update schedule');
  }

  async remove(userId: string, scheduleId: string): Promise<void> {
    const rows = must<unknown[]>(
      await this.supabase.from('schedules').delete().eq('id', scheduleId).eq('user_id', userId).select('id'),
      'delete schedule',
    );
    if (rows.length === 0) throw new NotFoundException('Schedule not found');
  }

  async executions(userId: string, scheduleId: string) {
    await this.get(userId, scheduleId);
    return must(
      await this.supabase
        .from('schedule_executions')
        .select('*, collection_runs(status,progress,counters,error,started_at,finished_at)')
        .eq('schedule_id', scheduleId)
        .eq('user_id', userId)
        .order('scheduled_for', { ascending: false })
        .limit(50),
      'list executions',
    );
  }

  /** Manual execution: independent of the recurring slot, still guarded against overlap. */
  async runNow(userId: string, scheduleId: string) {
    const schedule = await this.get(userId, scheduleId);
    return this.dispatch(schedule, new Date(), false);
  }

  /** Called every minute by the worker. Safe to run on several workers at once. */
  async tick(limit = 50): Promise<number> {
    const dueSchedules = must<ScheduleRow[]>(
      await this.supabase
        .from('schedules')
        .select('*')
        .eq('enabled', true)
        .lte('next_run_at', new Date().toISOString())
        .order('next_run_at')
        .limit(limit),
      'load due schedules',
    );
    let started = 0;
    for (const schedule of dueSchedules) {
      try {
        if (await this.dispatch(schedule, new Date(schedule.next_run_at as string), true)) started++;
      } catch (error) {
        this.logger.error(`Schedule ${schedule.id} dispatch failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return started;
  }

  /**
   * Claims a slot via the unique (schedule_id, scheduled_for) key, so concurrent workers can't both
   * start it, then creates the run + job and advances next_run_at.
   */
  private async dispatch(schedule: ScheduleRow, scheduledFor: Date, advanceSchedule: boolean): Promise<CollectionRunRow | null> {
    const now = new Date();
    const claim = await this.supabase
      .from('schedule_executions')
      .insert({ user_id: schedule.user_id, schedule_id: schedule.id, scheduled_for: scheduledFor.toISOString(), status: 'queued' })
      .select('id')
      .single();
    if (claim.error) {
      if (claim.error.code === UNIQUE_VIOLATION) {
        if (advanceSchedule) await this.advance(schedule, now);
        return null; // another worker (or an earlier tick) already owns this slot
      }
      throw new Error(claim.error.message);
    }
    const executionId = (claim.data as { id: string }).id;

    // Overlap guard: a previous run of this schedule is still in flight.
    const inFlight = must<unknown[]>(
      await this.supabase.from('collection_runs').select('id').eq('schedule_id', schedule.id).in('status', ['queued', 'running']).limit(1),
      'check running',
    );
    if (inFlight.length > 0) {
      await this.supabase
        .from('schedule_executions')
        .update({ status: 'failed', error: 'Skipped: previous execution still running', finished_at: now.toISOString() })
        .eq('id', executionId);
      if (advanceSchedule) await this.advance(schedule, now);
      return null;
    }

    const { dateFrom, dateTo } = lookbackRange(now, schedule.lookback_days);
    const run = await this.runs.create({
      userId: schedule.user_id, adAccountId: schedule.ad_account_id, keywords: schedule.keywords, dateFrom, dateTo, trigger: 'schedule', scheduleId: schedule.id,
    });
    await this.supabase.from('schedule_executions').update({ run_id: run.id }).eq('id', executionId);
    await this.queues.enqueueCollection({ runId: run.id, userId: schedule.user_id });
    if (advanceSchedule) await this.advance(schedule, now);
    else await this.supabase.from('schedules').update({ last_run_at: now.toISOString() }).eq('id', schedule.id);
    return run;
  }

  private async advance(schedule: ScheduleRow, now: Date): Promise<void> {
    const next = nextRun(
      new Date(schedule.start_at), schedule.interval_unit, schedule.interval_value, schedule.timezone, now, schedule.end_at ? new Date(schedule.end_at) : null,
    );
    await this.supabase
      .from('schedules')
      .update({ last_run_at: now.toISOString(), next_run_at: next?.toISOString() ?? null, enabled: next ? schedule.enabled : false })
      .eq('id', schedule.id);
  }

  // ------------------------------------------------ callbacks from the worker
  async onExecutionStart(runId: string, attempt: number): Promise<void> {
    await this.supabase.from('schedule_executions').update({ status: 'running', attempt, started_at: new Date().toISOString() }).eq('run_id', runId);
  }

  async onRunFinished(
    run: Pick<CollectionRunRow, 'id' | 'user_id' | 'schedule_id'>,
    status: 'succeeded' | 'partial' | 'failed',
    error?: string,
  ): Promise<void> {
    if (!run.schedule_id) return;
    await this.supabase
      .from('schedule_executions')
      .update({ status, error: error ?? null, finished_at: new Date().toISOString() })
      .eq('run_id', run.id);
    const schedule = must<Pick<ScheduleRow, 'name' | 'consecutive_failures'> | null>(
      await this.supabase.from('schedules').select('name,consecutive_failures').eq('id', run.schedule_id).maybeSingle(),
      'load schedule',
    );
    if (!schedule) return;

    if (status !== 'failed') {
      await this.supabase.from('schedules').update({ last_status: status, consecutive_failures: 0 }).eq('id', run.schedule_id);
      return;
    }
    const failures = schedule.consecutive_failures + 1;
    const shouldPause = failures >= MAXIMUM_CONSECUTIVE_FAILURES;
    await this.supabase
      .from('schedules')
      .update({ last_status: 'failed', consecutive_failures: failures, ...(shouldPause ? { enabled: false, next_run_at: null } : {}) })
      .eq('id', run.schedule_id);
    await this.notifications.notify(
      run.user_id,
      'schedule_failed',
      `Scheduled search "${schedule.name}" failed`,
      `${error ?? 'Unknown error'}${shouldPause ? ` The schedule was paused after ${failures} consecutive failures.` : ''}`,
      { schedule_id: run.schedule_id, run_id: run.id },
    );
  }
}
