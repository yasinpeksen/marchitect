'use client';
import { Filter, Search as SearchIcon } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { AdFilters, buildAdsQuery, collectionRangeFor, EMPTY_FILTERS, parseKeywordParameter } from '@/lib/ad-filters';
import { useApi, useData } from '@/lib/api';
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
        hint={mode === 'search' ? 'Use “Collect from Meta” to fetch matching ads from your ad account.' : 'Run a search on the Ad Search page to collect ads.'}
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

/** Shared by Ad Search (keyword-first + Meta collection) and Ad Library (browse + filter). */
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
  const [runId, setRunId] = useState<string>();
  const [runActive, setRunActive] = useState(false);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);

  const { data: accounts } = useData<AdAccount[]>('/ad-accounts');
  const { data: campaigns } = useData<Campaign[]>(`/campaigns${accountId ? `?ad_account_id=${accountId}` : ''}`);
  const { data: history } = useData<SearchHistoryEntry[]>(mode === 'search' ? '/search/history' : null);
  const collectionAccountId = accountId || accounts?.find((account) => account.selected)?.id || '';

  const query = useMemo(() => buildAdsQuery({ keywords: tags, match, filters, accountId, sort, direction, page }), [tags, match, filters, accountId, sort, direction, page]);
  const { data, error: loadError, isLoading, mutate } = useData<AdsPage>(query, {
    keepPreviousData: true,
    refreshInterval: runActive ? 4000 : 0, // results appear as soon as the worker stores them
  });

  const changeTags = (next: string[]) => {
    setTags(next);
    setPage(1);
  };

  async function collectFromMeta() {
    setError(undefined);
    setMessage(undefined);
    setBusy(true);
    try {
      if (tags.length === 0) throw new Error('Add at least one keyword first.');
      if (!collectionAccountId) throw new Error('Connect a Meta ad account first (Meta Connections).');
      const { dateFrom, dateTo } = collectionRangeFor(lookbackDays);
      const started = await api.post<StartCollectionResponse>('/search/collect', { keywords: tags, ad_account_id: collectionAccountId, date_from: dateFrom, date_to: dateTo });
      setRunId(started.run.id);
      setRunActive(true);
      setMessage(started.reused ? 'An identical collection is already running; showing its progress.' : `${started.existing_matches} matching ads already stored. Collecting fresh data from Meta…`);
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
      await api.post('/saved-searches', { name, tags, match_mode: match, ad_account_id: collectionAccountId || undefined, filters: {} });
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
          busy={busy} onSave={saveSearch} onCollect={collectFromMeta}
        />
      ) : (
        <TagInput tags={tags} onChange={changeTags} placeholder="Filter by keywords…" />
      )}

      {message && <Notice tone="green">{message}</Notice>}
      <ErrorBox error={error ?? loadError} />
      {runId && <RunProgress runId={runId} onUpdate={(run) => { setRunActive(isRunActive(run.status)); void mutate(); }} />}

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
