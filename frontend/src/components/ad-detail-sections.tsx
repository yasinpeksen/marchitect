'use client';
import { ArrowLeft, ExternalLink, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { describeTargeting, RANGE_PRESETS } from '@/lib/ad-analytics';
import { formatDateTime } from '@/lib/format';
import type { AdAnalytics, AdDetail } from '@/lib/types';
import { BreakdownCard, JsonBlock, Metric } from './ad-detail-parts';
import { Badge, Button, Card, statusTone } from './ui';

export function AdHeader({ ad, onRefresh }: { ad: AdDetail; onRefresh: () => void }) {
  return (
    <>
      <Link href="/library" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft className="h-4 w-4" /> Library</Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={statusTone(ad.effective_status)}>{ad.effective_status}</Badge>
            {ad.format && <Badge tone="purple">{ad.format}</Badge>}
            {ad.platforms?.map((platform) => <Badge key={platform} tone="blue">{platform}</Badge>)}
          </div>
          <h1 className="mt-2 text-xl font-semibold">{ad.name}</h1>
          <p className="text-sm text-slate-500">{ad.campaign?.name} › {ad.ad_set?.name} · Meta ID {ad.meta_ad_id} · {ad.ad_account?.name}</p>
        </div>
        <Button variant="secondary" onClick={onRefresh}><RefreshCw className="h-4 w-4" /> Refresh insights</Button>
      </div>
    </>
  );
}

export function AdCopyCard({ ad }: { ad: AdDetail }) {
  const destination = ad.creative?.link_url;
  return (
    <Card title="Ad copy" className="lg:col-span-2">
      <dl className="space-y-3 text-sm">
        <div><dt className="text-xs text-slate-500">Headline</dt><dd className="font-medium">{ad.headline ?? '—'}</dd></div>
        <div><dt className="text-xs text-slate-500">Primary text</dt><dd className="whitespace-pre-wrap">{ad.primary_text ?? '—'}</dd></div>
        <div><dt className="text-xs text-slate-500">Call to action</dt><dd>{ad.cta ? <Badge>{ad.cta}</Badge> : '—'}</dd></div>
        {destination && (
          <div>
            <dt className="text-xs text-slate-500">Destination</dt>
            <dd>
              <a className="inline-flex items-center gap-1 break-all text-brand-600" href={destination} target="_blank" rel="noopener noreferrer">
                {destination}<ExternalLink className="h-3 w-3 shrink-0" />
              </a>
            </dd>
          </div>
        )}
      </dl>
    </Card>
  );
}

export function DateRangeCard({
  range, from, to, onFromChange, onToChange, onPreset,
}: {
  range?: AdAnalytics['range'];
  from: string;
  to: string;
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
  onPreset: (days: number | null) => void;
}) {
  return (
    <Card>
      <div className="flex flex-wrap items-end gap-3">
        {RANGE_PRESETS.map(([label, days]) => <Button key={label} variant="secondary" onClick={() => onPreset(days)}>{label}</Button>)}
        <label><span className="label">From</span><input type="date" aria-label="From date" className="input" value={from} min={range?.available_from ?? undefined} onChange={(event) => onFromChange(event.target.value)} /></label>
        <label><span className="label">To</span><input type="date" aria-label="To date" className="input" value={to} max={range?.available_to ?? undefined} onChange={(event) => onToChange(event.target.value)} /></label>
        <p className="ml-auto text-xs text-slate-500">
          {range?.available_from ? `Collected data: ${range.available_from} → ${range.available_to} · ${range.days_with_data} days in range` : 'No daily data collected yet'}
        </p>
      </div>
    </Card>
  );
}

export function CampaignAndTargeting({ ad }: { ad: AdDetail }) {
  const targetingLines = ad.targeting ? describeTargeting(ad.targeting) : [];
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card title="Campaign & ad set">
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <Metric label="Campaign" value={ad.campaign?.name ?? '—'} hint={ad.campaign?.objective ?? undefined} />
          <Metric label="Ad set" value={ad.ad_set?.name ?? '—'} hint={ad.ad_set?.optimization_goal ?? undefined} />
          <Metric label="Campaign status" value={ad.campaign?.effective_status ?? '—'} />
          <Metric label="Created" value={formatDateTime(ad.ad_created_time)} />
        </dl>
      </Card>
      <Card title="Targeting">
        {ad.targeting ? (
          <dl className="space-y-2 text-sm">
            {targetingLines.map((line) => <div key={line.label}><dt className="inline text-slate-500">{line.label}: </dt><dd className="inline">{line.value}</dd></div>)}
            <details><summary className="cursor-pointer text-xs text-brand-600">Full targeting spec</summary><JsonBlock value={ad.targeting} /></details>
          </dl>
        ) : <p className="text-sm text-slate-500">Targeting is not available for this ad.</p>}
      </Card>
    </div>
  );
}

function VariationList({ label, values }: { label: string; values: string[] }) {
  if (values.length === 0) return null;
  return (
    <div>
      <p className="text-xs font-medium text-slate-500">{label} ({values.length})</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5">{values.map((value) => <li key={value} className="break-words">{value}</li>)}</ul>
    </div>
  );
}

/** Dynamic-creative asset lists, carousel cards, and performance by creative asset. */
export function CreativeVariationsCard({ ad, analytics, currency, assetBreakdownTypes }: { ad: AdDetail; analytics?: AdAnalytics; currency?: string | null; assetBreakdownTypes: string[] }) {
  const dynamic = ad.creative_variations?.dynamic;
  const carousel = ad.creative_variations?.carousel ?? [];
  return (
    <Card title="Creative variations">
      {dynamic && (
        <div className="grid gap-4 text-sm sm:grid-cols-2">
          <VariationList label="Primary texts" values={dynamic.bodies} />
          <VariationList label="Headlines" values={dynamic.titles} />
          <VariationList label="Descriptions" values={dynamic.descriptions} />
          <VariationList label="CTAs" values={dynamic.call_to_actions} />
          <VariationList label="Images" values={dynamic.images} />
          <VariationList label="Videos" values={dynamic.videos} />
        </div>
      )}
      {!dynamic && carousel.length > 0 && (
        <ul className="grid gap-3 text-sm sm:grid-cols-2">
          {carousel.map((card, position) => (
            <li key={position} className="rounded-lg border border-slate-200 p-3"><p className="font-medium">{card.name ?? `Card ${position + 1}`}</p><p className="text-xs text-slate-500">{card.description}</p></li>
          ))}
        </ul>
      )}
      {!dynamic && carousel.length === 0 && <p className="text-sm text-slate-500">This ad has a single creative (no dynamic variations or carousel cards).</p>}
      {analytics && assetBreakdownTypes.length > 0 && (
        <div className="mt-6 space-y-4">
          {assetBreakdownTypes.map((type) => <BreakdownCard key={type} label={`Performance by ${type.replaceAll('_', ' ')}`} rows={analytics.breakdowns[type].rows} currency={currency} />)}
        </div>
      )}
    </Card>
  );
}
