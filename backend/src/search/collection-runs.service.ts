import { Injectable, NotFoundException } from '@nestjs/common';
import { must, SupabaseService } from '../common/supabase.service';
import { AdPlatform, CollectionRunRow } from '../common/types';
import { NotificationsService } from '../notifications/notifications.service';

export interface NewRun {
  userId: string;
  adAccountId: string;
  keywords: string[];
  dateFrom: string;
  dateTo: string;
  trigger: 'manual' | 'schedule';
  savedSearchId?: string | null;
  scheduleId?: string | null;
}

const ACTIVE_STATUSES = ['queued', 'running'];

@Injectable()
export class CollectionRunsService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly notifications: NotificationsService,
  ) {}

  async create(newRun: NewRun): Promise<CollectionRunRow> {
    const response = await this.supabase
      .from('collection_runs')
      .insert({
        user_id: newRun.userId,
        ad_account_id: newRun.adAccountId,
        keywords: newRun.keywords,
        date_from: newRun.dateFrom,
        date_to: newRun.dateTo,
        trigger: newRun.trigger,
        saved_search_id: newRun.savedSearchId ?? null,
        schedule_id: newRun.scheduleId ?? null,
        stage: 'queued',
      })
      .select('*')
      .single();
    return must<CollectionRunRow>(response, 'create run');
  }

  /** An identical run still in flight (dedupes double clicks / overlapping triggers). */
  async findActive(userId: string, adAccountId: string, keywords: string[]): Promise<CollectionRunRow | null> {
    const response = await this.supabase
      .from('collection_runs')
      .select('*')
      .eq('user_id', userId)
      .eq('ad_account_id', adAccountId)
      .in('status', ACTIVE_STATUSES)
      .gte('created_at', new Date(Date.now() - 30 * 60_000).toISOString())
      .contains('keywords', keywords)
      .order('created_at', { ascending: false });
    return must<CollectionRunRow[]>(response, 'find active run').find((run) => run.keywords.length === keywords.length) ?? null;
  }

  /** Which ad platform an ad account belongs to (`meta` when the account cannot be found, so the Meta path reports it). */
  async platformOfAccount(userId: string, adAccountId: string): Promise<AdPlatform> {
    const response = await this.supabase.from('ad_accounts').select('platform').eq('id', adAccountId).eq('user_id', userId).maybeSingle();
    return must<{ platform: AdPlatform } | null>(response, 'load ad account platform')?.platform ?? 'meta';
  }

  async update(runId: string, patch: Record<string, unknown>): Promise<void> {
    must(await this.supabase.from('collection_runs').update(patch).eq('id', runId), 'update run');
  }

  async get(userId: string, runId: string): Promise<CollectionRunRow> {
    const response = await this.supabase.from('collection_runs').select('*').eq('id', runId).eq('user_id', userId).maybeSingle();
    const run = must<CollectionRunRow | null>(response, 'get run');
    if (!run) throw new NotFoundException('Run not found');
    return run;
  }

  async list(userId: string, limit = 25, offset = 0, status?: string) {
    let query = this.supabase
      .from('collection_runs')
      .select('*, ad_accounts(name,meta_account_id), schedules(name)', { count: 'exact' })
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);
    if (status) query = query.eq('status', status);
    const response = await query;
    return { items: must<unknown[]>(response, 'list runs'), total: response.count ?? 0 };
  }

  /** Which ads matched which keywords in a run (idempotent per run/ad/keyword). */
  async saveSearchResults(userId: string, runId: string, matches: { adId: string; keyword: string; isNew: boolean }[]): Promise<void> {
    const rows = matches.map((match) => ({ user_id: userId, run_id: runId, ad_id: match.adId, keyword: match.keyword, is_new: match.isNew }));
    for (let start = 0; start < rows.length; start += 500) {
      must(await this.supabase.from('search_results').upsert(rows.slice(start, start + 500), { onConflict: 'run_id,ad_id,keyword' }), 'save search results');
    }
  }

  /** Terminal failure after all retries. Manual runs notify the user; scheduled runs notify via the schedule. */
  async markFailed(userId: string, runId: string, errorMessage: string): Promise<CollectionRunRow | null> {
    await this.update(runId, { status: 'failed', stage: 'failed', error: errorMessage.slice(0, 1000), finished_at: new Date().toISOString() });
    const run = await this.get(userId, runId).catch(() => null);
    if (run && !run.schedule_id) {
      await this.notifications.notify(userId, 'collection_failed', 'Ad collection failed', errorMessage.slice(0, 300), { run_id: runId });
    }
    return run;
  }
}
