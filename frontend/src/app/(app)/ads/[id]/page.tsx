'use client';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { AdMedia, JsonBlock } from '@/components/ad-detail-parts';
import { AdCopyCard, AdHeader, CampaignAndTargeting, CreativeVariationsCard, DateRangeCard } from '@/components/ad-detail-sections';
import { AnalyticsSections } from '@/components/analytics-sections';
import { Button, Card, ErrorBox, Notice, Spinner } from '@/components/ui';
import { ASSET_BREAKDOWN_TYPES, rangeStartFor } from '@/lib/ad-analytics';
import { buildQueryString, useApi, useData } from '@/lib/api';
import { daysAgoIso, isNumber } from '@/lib/format';
import type { AdAnalytics, AdDetail } from '@/lib/types';

export default function AdDashboard() {
  const { id: adId } = useParams<{ id: string }>();
  const api = useApi();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [showRaw, setShowRaw] = useState(false);
  const [message, setMessage] = useState<string>();
  const [actionError, setActionError] = useState<unknown>();

  const { data: ad, error: adError, mutate: reloadAd } = useData<AdDetail>(`/ads/${adId}`);
  const { data: analytics, error: analyticsError, isLoading, mutate: reloadAnalytics } = useData<AdAnalytics>(`/ads/${adId}/analytics${buildQueryString({ from, to })}`, { keepPreviousData: true });
  const { data: raw } = useData<unknown>(showRaw ? `/ads/${adId}/raw` : null);

  if (adError) return <ErrorBox error={adError} />;
  if (!ad) return <Spinner />;

  const currency = analytics?.currency ?? ad.ad_account?.currency;
  const hasVideo = ad.format === 'video' || isNumber(analytics?.metrics.video_3s_views);
  const assetBreakdownTypes = analytics ? ASSET_BREAKDOWN_TYPES.filter((type) => analytics.breakdowns[type]?.rows.length) : [];

  async function refreshInsights() {
    setActionError(undefined);
    setMessage(undefined);
    try {
      await api.post('/insights/refresh', { ad_ids: [adId], date_from: from || analytics?.range.available_from || daysAgoIso(29), date_to: to || daysAgoIso(0) });
      setMessage('Insights refresh queued. Reload in a moment — progress is under Collection History.');
      setTimeout(() => { void reloadAnalytics(); void reloadAd(); }, 8000);
    } catch (caught) {
      setActionError(caught);
    }
  }

  return (
    <div className="space-y-6">
      <AdHeader ad={ad} onRefresh={refreshInsights} />
      {message && <Notice tone="green">{message}</Notice>}
      <ErrorBox error={actionError ?? analyticsError} />

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="lg:col-span-3"><AdMedia ad={ad} /></div>
        <AdCopyCard ad={ad} />
      </div>

      <DateRangeCard
        range={analytics?.range}
        from={from}
        to={to}
        onFromChange={setFrom}
        onToChange={setTo}
        onPreset={(days) => { setFrom(rangeStartFor(days)); setTo(''); }}
      />

      {isLoading && !analytics ? <Spinner /> : analytics && <AnalyticsSections analytics={analytics} currency={currency} hasVideo={hasVideo} />}

      <CampaignAndTargeting ad={ad} />
      <CreativeVariationsCard ad={ad} analytics={analytics} currency={currency} assetBreakdownTypes={assetBreakdownTypes} />

      <Card title="Raw Meta data" actions={<Button variant="secondary" onClick={() => setShowRaw(!showRaw)}>{showRaw ? 'Hide' : 'Show'} JSON</Button>}>
        {showRaw ? (raw ? <JsonBlock value={raw} /> : <Spinner />) : <p className="text-sm text-slate-500">Original Graph API responses stored alongside the normalised fields.</p>}
      </Card>
    </div>
  );
}
