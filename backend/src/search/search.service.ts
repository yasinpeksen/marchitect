import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AppConfig } from '../common/app-config';
import { AuditService } from '../common/audit.service';
import { must, SupabaseService } from '../common/supabase.service';
import { AdRow, CollectionRunRow } from '../common/types';
import { QueueService } from '../jobs/queues';
import { MediaService } from '../media/media.service';
import { CollectionRunsService } from './collection-runs.service';
import { buildSearchFilters, dedupeByKeywordSet, resolveCollectionRange } from './search-helpers';
import { AdQueryDto, normalizeKeywords, SavedSearchDto, StartCollectionDto, UpdateSavedSearchDto } from './search.dto';

interface SavedSearchRow {
  id: string;
  tags: string[];
  match_mode: 'any' | 'all';
  ad_account_id: string | null;
}

@Injectable()
export class SearchService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly runs: CollectionRunsService,
    private readonly queues: QueueService,
    private readonly media: MediaService,
    private readonly config: AppConfig,
    private readonly audit: AuditService,
  ) {}

  /** Instant search over already-collected ads (indexed SQL; never calls Meta). */
  async instant(userId: string, query: AdQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.page_size ?? 24;
    const response = await this.supabase.rpc('search_ads', {
      p_user_id: userId,
      p_keywords: normalizeKeywords(query.keywords),
      p_match: query.match ?? 'any',
      p_filters: buildSearchFilters(query),
      p_sort: query.sort ?? 'recent',
      p_dir: query.dir ?? 'desc',
      p_limit: pageSize,
      p_offset: (page - 1) * pageSize,
    });
    const rows = must<{ ad: AdRow; total_count: number }[]>(response, 'search ads');
    const ads = rows.map((row) => row.ad);
    const mediaByAd = await this.media.mediaForAds(userId, ads.map((ad) => ad.id));
    return {
      items: ads.map((ad) => ({ ...ad, media: mediaByAd.get(ad.id) ?? [] })),
      total: Number(rows[0]?.total_count ?? 0),
      page,
      page_size: pageSize,
    };
  }

  /** Validate, reuse an in-flight identical run, otherwise queue a new Meta collection. */
  async startCollection(userId: string, body: StartCollectionDto, trigger: 'manual' | 'schedule' = 'manual') {
    const keywords = normalizeKeywords(body.keywords);
    if (keywords.length === 0) throw new BadRequestException('Enter at least one keyword');
    if (keywords.some((keyword) => keyword.length < 2)) throw new BadRequestException('Keywords must be at least 2 characters');

    const account = must<{ id: string; selected: boolean } | null>(
      await this.supabase.from('ad_accounts').select('id,selected').eq('id', body.ad_account_id).eq('user_id', userId).maybeSingle(),
      'load ad account',
    );
    if (!account) throw new NotFoundException('Ad account not found');
    if (!account.selected) throw new BadRequestException('Ad account is not enabled for collection');

    const { dateFrom, dateTo } = resolveCollectionRange(body.date_from, body.date_to, this.config.defaultLookbackDays);

    // Step 2: what we already have for these keywords.
    const existing = await this.instant(userId, { keywords, match: 'any', page: 1, page_size: 1, ad_account_id: body.ad_account_id });

    const activeRun = await this.runs.findActive(userId, body.ad_account_id, keywords);
    if (activeRun) return { run: activeRun, existing_matches: existing.total, reused: true };

    await this.touchTags(userId, keywords);
    const run: CollectionRunRow = await this.runs.create({
      userId, adAccountId: body.ad_account_id, keywords, dateFrom, dateTo, trigger, savedSearchId: body.saved_search_id,
    });
    await this.queues.enqueueCollection({ runId: run.id, userId });
    if (body.saved_search_id) {
      await this.supabase.from('saved_searches').update({ last_run_at: new Date().toISOString() }).eq('id', body.saved_search_id).eq('user_id', userId);
    }
    await this.audit.record(userId, 'collection.start', 'collection_run', run.id, { keywords });
    return { run, existing_matches: existing.total, reused: false };
  }

  private async touchTags(userId: string, tags: string[]): Promise<void> {
    const now = new Date().toISOString();
    const existing = must<{ tag: string; usage_count: number }[]>(
      await this.supabase.from('search_tags').select('tag,usage_count').eq('user_id', userId).in('tag', tags),
      'load tags',
    );
    const usageByTag = new Map(existing.map((entry) => [entry.tag, entry.usage_count]));
    must(
      await this.supabase.from('search_tags').upsert(
        tags.map((tag) => ({ user_id: userId, tag, usage_count: (usageByTag.get(tag) ?? 0) + 1, last_used_at: now })),
        { onConflict: 'user_id,tag' },
      ),
      'save tags',
    );
  }

  async tagSuggestions(userId: string, prefix = '') {
    let query = this.supabase.from('search_tags').select('tag,usage_count').eq('user_id', userId).order('usage_count', { ascending: false }).limit(15);
    const cleaned = prefix.trim().replaceAll(/[%_]/g, '');
    if (cleaned) query = query.ilike('tag', `${cleaned}%`);
    return must(await query, 'tag suggestions');
  }

  /** Previous searches = distinct keyword sets from past runs. */
  async history(userId: string) {
    const rows = must<{ keywords: string[]; created_at: string; status: string; ad_account_id: string }[]>(
      await this.supabase
        .from('collection_runs')
        .select('keywords,created_at,status,ad_account_id')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(100),
      'history',
    );
    return dedupeByKeywordSet(rows);
  }

  // ----------------------------------------------------------- saved searches
  async listSaved(userId: string) {
    return must(await this.supabase.from('saved_searches').select('*').eq('user_id', userId).order('created_at', { ascending: false }), 'list saved');
  }

  async createSaved(userId: string, body: SavedSearchDto) {
    const response = await this.supabase
      .from('saved_searches')
      .insert({
        user_id: userId,
        name: body.name.trim(),
        tags: normalizeKeywords(body.tags),
        match_mode: body.match_mode ?? 'any',
        filters: body.filters ?? {},
        ad_account_id: body.ad_account_id ?? null,
      })
      .select('*')
      .single();
    return must(response, 'create saved search');
  }

  async updateSaved(userId: string, savedSearchId: string, body: UpdateSavedSearchDto) {
    const patch: Record<string, unknown> = { ...body };
    if (body.name) patch.name = body.name.trim();
    if (body.tags) patch.tags = normalizeKeywords(body.tags);
    const rows = must<unknown[]>(
      await this.supabase.from('saved_searches').update(patch).eq('id', savedSearchId).eq('user_id', userId).select('*'),
      'update saved search',
    );
    if (rows.length === 0) throw new NotFoundException('Saved search not found');
    return rows[0];
  }

  async deleteSaved(userId: string, savedSearchId: string): Promise<void> {
    const rows = must<unknown[]>(
      await this.supabase.from('saved_searches').delete().eq('id', savedSearchId).eq('user_id', userId).select('id'),
      'delete saved search',
    );
    if (rows.length === 0) throw new NotFoundException('Saved search not found');
  }

  async runSaved(userId: string, savedSearchId: string) {
    const saved = must<SavedSearchRow | null>(
      await this.supabase.from('saved_searches').select('*').eq('id', savedSearchId).eq('user_id', userId).maybeSingle(),
      'load saved search',
    );
    if (!saved) throw new NotFoundException('Saved search not found');
    if (!saved.ad_account_id) throw new BadRequestException('Saved search has no ad account; edit it to choose one');
    return this.startCollection(userId, { keywords: saved.tags, ad_account_id: saved.ad_account_id, saved_search_id: saved.id });
  }
}
