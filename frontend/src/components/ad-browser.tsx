'use client';
import { Filter, Search as SearchIcon } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { AdFilters, buildAdsQuery, collectionRangeFor, EMPTY_FILTERS, parseKeywordParameter } from '@/lib/ad-filters';
import { useApi, useData } from '@/lib/api';
import { pickCollectionTargets, summarizeStartedCollections } from '@/lib/collection-targets';
import type { AdAccount, AdsPage, Campaign, SearchHistoryEntry, StartCollectionResponse } from '@/lib/types';
import { AdCard } from './ad-card';
import { FiltersPanel, SearchPanel, SORT_OPTIONS } from './ad-browser-parts';
import { isRunActive, RunProgress } from './run-progress';
import { TagInput } from './tag-input';
import { Button, Empty, ErrorBox, Notice, Pagination, Spinner } from './ui';

/** Results grid + paging for the current query. */
function ResultsGrid({ data, loading, hasKeywords, mode, accounts, page, onPageChange }: {
  data?: AdsPage;
  loading: boolean;
  hasKeywords: boolean;
  mode: 'search' | 'library';
  accounts?: AdAccount[];
  page: number;
  onPageChange: (page: number) => void;
}) {
  if (loading && !data) return <Spinner />;
  const items = data?.items ?? [];
  if (items.length === 0) {
    return (
      <Empty
        title={hasKeywords ? 'No collected ads match these keywords' : 'No ads collected yet'}
        hint={mode === 'search' ? 'Use “Collect ads” to fetch matching ads from your connected Meta and TikTok ad accounts.' : 'Run a search on the Ad Search page to collect ads.'}
        action={<SearchIcon className="mx-auto h-6 w-6 text-slate-300" />}
      />
    );
  }
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {items.map((ad) => <AdCard key={ad.id} ad={ad} currency={accounts?.find((account) => account.id === ad.ad_account_id)?.currency} />)}
      </div>
      <Pagination page={page} pageSize={24} total={data?.total ?? 0} onChange={onPageChange} />
    </>
  );
}

/** Shared by Ad Search (keyword-first + one-click Meta and TikTok collection) and Ad Library (browse + filter). */
export function AdBrowser({ mode }: { mode: 'search' | 'library' }) {
  const api = useApi();
  const searchParameters = useSearchParams();
  const [tags, setTags] = useState<string[]>(() => parseKeywordParameter(searchParameters.get('q')));
  const [match, setMatch] = useState<'any' | 'all'>((searchParameters.get('match') as 'any' | 'all' | null) ?? 'any');
  const [accountId, setAccountId] = useState(searchParameters.get('account') ?? '');
  const [lookbackDays, setLookbackDays] = useState(30);
  const [showFilters, setShowFilters] = useState(mode === 'library');
  const [filters, setFilters] = useState<AdFilters>(EMPTY_FILTERS);
  const [sort, setSort] = useState('recent');
  const [direction, setDirection] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [runIds, setRunIds] = useState<string[]>([]);
  const [activeRuns, setActiveRuns] = useState<Record<string, boolean>>({});
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);

  const { data: accounts } = useData<AdAccount[]>('/ad-accounts');
  const { data: campaigns } = useData<Campaign[]>(`/campaigns${accountId ? `?ad_account_id=${accountId}` : ''}`);
  const { data: history } = useData<SearchHistoryEntry[]>(mode === 'search' ? '/search/history' : null);
  const collectionTargets = pickCollectionTargets(accounts, accountId);
  const runActive = Object.values(activeRuns).some(Boolean);

  const query = useMemo(() => buildAdsQuery({ keywords: tags, match, filters, accountId, sort, direction, page }), [tags, match, filters, accountId, sort, direction, page]);
  const { data, error: loadError, isLoading, mutate } = useData<AdsPage>(query, {
    keepPreviousData: true,
    refreshInterval: runActive ? 4000 : 0, // results appear as soon as the worker stores them
  });

  const changeTags = (next: string[]) => {
    setTags(next);
    setPage(1);
  };

  async function collectAds() {
    setError(undefined);
    setMessage(undefined);
    setBusy(true);
    try {
      if (tags.length === 0) throw new Error('Add at least one keyword first.');
      if (collectionTargets.length === 0) throw new Error('Connect and enable an ad account first (Connections).');
      const { dateFrom, dateTo } = collectionRangeFor(lookbackDays);
      const attempts = await Promise.allSettled(
        collectionTargets.map((account) => api.post<StartCollectionResponse>('/search/collect', { keywords: tags, ad_account_id: account.id, date_from: dateFrom, date_to: dateTo })),
      );
      const started = attempts.flatMap((attempt) => (attempt.status === 'fulfilled' ? [attempt.value] : []));
      const failures = attempts.flatMap((attempt) => (attempt.status === 'rejected' ? [attempt.reason as unknown] : []));
      if (started.length === 0) throw failures[0];
      setRunIds(started.map((entry) => entry.run.id));
      setActiveRuns(Object.fromEntries(started.map((entry) => [entry.run.id, true])));
      setMessage(summarizeStartedCollections(started, collectionTargets));
      if (failures.length > 0) setError(failures[0]); // some accounts failed to start; the others are running
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  async function saveSearch() {
    const name = window.prompt('Name this search', tags.join(', '));
    if (!name) return;
    setError(undefined);
    try {
      await api.post('/saved-searches', { name, tags, match_mode: match, ad_account_id: accountId || collectionTargets[0]?.id || undefined, filters: {} });
      setMessage('Search saved.');
    } catch (caught) {
      setError(caught);
    }
  }

  return (
    <div className="space-y-5">
      {mode === 'search' ? (
        <SearchPanel
          tags={tags} onTagsChange={changeTags} match={match} onMatchChange={setMatch} accounts={accounts} accountId={accountId}
          onAccountChange={setAccountId} lookbackDays={lookbackDays} onLookbackChange={setLookbackDays} history={history}
          busy={busy} onSave={saveSearch} onCollect={collectAds}
        />
      ) : (
        <TagInput tags={tags} onChange={changeTags} placeholder="Filter by keywords…" />
      )}

      {message && <Notice tone="green">{message}</Notice>}
      <ErrorBox error={error ?? loadError} />
      {runIds.map((runId) => (
        <RunProgress key={runId} runId={runId} onUpdate={(run) => { setActiveRuns((current) => ({ ...current, [runId]: isRunActive(run.status) })); void mutate(); }} />
      ))}

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" onClick={() => setShowFilters(!showFilters)}><Filter className="h-4 w-4" /> Filters</Button>
        <div className="ml-auto flex items-center gap-2 text-sm">
          <span className="text-slate-500">Sort</span>
          <select className="input w-40" aria-label="Sort by" value={sort} onChange={(event) => { setSort(event.target.value); setPage(1); }}>
            {SORT_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <Button variant="secondary" onClick={() => setDirection(direction === 'desc' ? 'asc' : 'desc')}>{direction === 'desc' ? '↓ Desc' : '↑ Asc'}</Button>
        </div>
      </div>

      {showFilters && (
        <FiltersPanel
          filters={filters} campaigns={campaigns}
          onChange={(patch) => { setFilters({ ...filters, ...patch }); setPage(1); }}
          onClear={() => { setFilters(EMPTY_FILTERS); setPage(1); }}
        />
      )}

      <ResultsGrid data={data} loading={isLoading} hasKeywords={tags.length > 0} mode={mode} accounts={accounts} page={page} onPageChange={setPage} />
    </div>
  );
}
