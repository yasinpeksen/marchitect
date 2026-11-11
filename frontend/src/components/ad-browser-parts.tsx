'use client';
import { Save, Zap } from 'lucide-react';
import { AdFilters, toggleValue } from '@/lib/ad-filters';
import { accountLabel } from '@/lib/collection-targets';
import type { AdAccount, Campaign, SearchHistoryEntry } from '@/lib/types';
import { TagInput } from './tag-input';
import { Button, Card, Field } from './ui';

const FORMATS = ['image', 'video', 'carousel', 'dynamic'];
const STATUSES = ['ACTIVE', 'PAUSED', 'ARCHIVED', 'WITH_ISSUES', 'DISAPPROVED'];
const PLATFORMS = ['facebook', 'instagram', 'audience_network', 'messenger', 'tiktok'];
export const SORT_OPTIONS: [string, string][] = [
  ['recent', 'Most recent'], ['spend', 'Spend'], ['impressions', 'Impressions'], ['clicks', 'Link clicks'],
  ['ctr', 'CTR'], ['roas', 'ROAS'], ['revenue', 'Revenue'], ['purchases', 'Purchases'], ['name', 'Name'],
];
export const LOOKBACK_OPTIONS: [number, string][] = [[7, 'Last 7 days'], [30, 'Last 30 days'], [90, 'Last 90 days'], [365, 'Last 12 months'], [1095, 'Last 36 months']];

/** Labelled group of toggle chips (a role=group, so chip buttons keep their own accessible names). */
export function ChoiceChips({ label, options, selected, onChange }: { label: string; options: string[]; selected: string[]; onChange: (selected: string[]) => void }) {
  return (
    <div>
      <span className="label">{label}</span>
      <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={selected.includes(option)}
          onClick={() => onChange(toggleValue(selected, option))}
          className={`rounded-full border px-2.5 py-1 text-xs ${selected.includes(option) ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'}`}
        >
          {option}
        </button>
      ))}
      </div>
    </div>
  );
}

/** Advanced filters: format, status, platform, campaign, dates and performance thresholds. */
export function FiltersPanel({ filters, campaigns, onChange, onClear }: { filters: AdFilters; campaigns?: Campaign[]; onChange: (patch: Partial<AdFilters>) => void; onClear: () => void }) {
  return (
    <Card>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <ChoiceChips label="Format" options={FORMATS} selected={filters.formats} onChange={(formats) => onChange({ formats })} />
        <ChoiceChips label="Status" options={STATUSES} selected={filters.statuses} onChange={(statuses) => onChange({ statuses })} />
        <ChoiceChips label="Platform" options={PLATFORMS} selected={filters.platforms} onChange={(platforms) => onChange({ platforms })} />
        <Field label="Campaign">
          <select className="input" value={filters.campaignIds[0] ?? ''} onChange={(event) => onChange({ campaignIds: event.target.value ? [event.target.value] : [] })}>
            <option value="">All campaigns</option>
            {campaigns?.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}
          </select>
        </Field>
        <Field label="Created from"><input className="input" type="date" value={filters.dateFrom} onChange={(event) => onChange({ dateFrom: event.target.value })} /></Field>
        <Field label="Created to"><input className="input" type="date" value={filters.dateTo} onChange={(event) => onChange({ dateTo: event.target.value })} /></Field>
        <Field label="Min spend"><input className="input" type="number" min="0" value={filters.minSpend} onChange={(event) => onChange({ minSpend: event.target.value })} /></Field>
        <Field label="Min CTR (%)"><input className="input" type="number" min="0" step="0.1" value={filters.minCtr} onChange={(event) => onChange({ minCtr: event.target.value })} /></Field>
        <Field label="Min ROAS"><input className="input" type="number" min="0" step="0.1" value={filters.minRoas} onChange={(event) => onChange({ minRoas: event.target.value })} /></Field>
      </div>
      <div className="mt-4"><Button variant="ghost" onClick={onClear}>Clear filters</Button></div>
    </Card>
  );
}

export interface SearchPanelProps {
  tags: string[];
  onTagsChange: (tags: string[]) => void;
  match: 'any' | 'all';
  onMatchChange: (match: 'any' | 'all') => void;
  accounts?: AdAccount[];
  accountId: string;
  onAccountChange: (accountId: string) => void;
  lookbackDays: number;
  onLookbackChange: (days: number) => void;
  history?: SearchHistoryEntry[];
  busy: boolean;
  onSave: () => void;
  onCollect: () => void;
}

/** Keyword-first search box with account, match mode, collection range and the single "Collect ads" trigger (Meta and TikTok). */
export function SearchPanel(props: SearchPanelProps) {
  const { tags, accounts, history } = props;
  return (
    <Card>
      <TagInput large tags={tags} onChange={props.onTagsChange} placeholder="Search ads by keywords — campaign, ad name, headline or copy…" />
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <Field label="Match">
          <select className="input w-32" value={props.match} onChange={(event) => props.onMatchChange(event.target.value as 'any' | 'all')}>
            <option value="any">Any keyword</option><option value="all">All keywords</option>
          </select>
        </Field>
        <Field label="Ad account">
          <select className="input w-56" value={props.accountId} onChange={(event) => props.onAccountChange(event.target.value)}>
            <option value="">{accounts?.length ? 'All enabled accounts' : 'No accounts connected'}</option>
            {accounts?.map((account) => <option key={account.id} value={account.id}>{accountLabel(account)}</option>)}
          </select>
        </Field>
        <Field label="Collection range">
          <select className="input w-44" value={props.lookbackDays} onChange={(event) => props.onLookbackChange(Number(event.target.value))}>
            {LOOKBACK_OPTIONS.map(([days, label]) => <option key={days} value={days}>{label}</option>)}
          </select>
        </Field>
        <div className="ml-auto flex gap-2">
          <Button variant="secondary" onClick={props.onSave} disabled={tags.length === 0}><Save className="h-4 w-4" /> Save</Button>
          <Button onClick={props.onCollect} loading={props.busy} disabled={tags.length === 0}><Zap className="h-4 w-4" /> Collect ads</Button>
        </div>
      </div>
      {history && history.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-slate-500">
          Previous:
          {history.slice(0, 6).map((entry) => (
            <button key={entry.keywords.join(',')} className="rounded-full bg-slate-100 px-2.5 py-1 hover:bg-slate-200" onClick={() => props.onTagsChange(entry.keywords)}>
              {entry.keywords.join(', ')}
            </button>
          ))}
        </div>
      )}
      <p className="mt-3 text-xs text-slate-500">
        Results below come instantly from your collected database. “Collect ads” asynchronously fetches matching ads, creatives, insights and media from your connected Meta and TikTok ad accounts (matched by ad, campaign and ad group name), and public ads from Meta’s Ad Library when it is enabled (no performance data).
      </p>
    </Card>
  );
}

