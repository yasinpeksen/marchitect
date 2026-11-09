'use client';
import { ImageOff, Play } from 'lucide-react';
import Link from 'next/link';
import { formatCompact, formatMoney, formatPercent } from '@/lib/format';
import type { AdListItem, MediaItem } from '@/lib/types';
import { Badge, statusTone } from './ui';

/** Best still image for a card: stored thumbnail, else stored image. */
export function pickPreview(media: MediaItem[] = []): MediaItem | null {
  return media.find((item) => item.kind === 'thumbnail' && item.url) ?? media.find((item) => item.kind === 'image' && item.url) ?? null;
}

/** CTR (link clicks / impressions) and ROAS for a card, from stored lifetime totals. Null when not computable. */
export function cardMetrics(ad: Pick<AdListItem, 'total_impressions' | 'total_link_clicks' | 'total_spend' | 'total_revenue'>) {
  const impressions = Number(ad.total_impressions);
  const spend = Number(ad.total_spend);
  return {
    impressions,
    spend,
    ctr: impressions > 0 ? (Number(ad.total_link_clicks) / impressions) * 100 : null,
    roas: spend > 0 && Number(ad.total_revenue) > 0 ? Number(ad.total_revenue) / spend : null,
  };
}

export function AdCard({ ad, currency }: { ad: AdListItem; currency?: string | null }) {
  const preview = pickPreview(ad.media);
  const downloading = ad.media.some((item) => item.status === 'pending' || item.status === 'downloading');
  const { impressions, spend, ctr, roas } = cardMetrics(ad);

  return (
    <Link href={`/ads/${ad.id}`} className="group flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition hover:shadow-md">
      <div className="relative aspect-video bg-slate-100">
        {preview?.url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview.url} alt={ad.name ?? 'Ad preview'} className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-1 text-xs text-slate-400">
            <ImageOff className="h-6 w-6" />
            {downloading ? 'Media downloading…' : 'No media stored'}
          </div>
        )}
        {ad.format === 'video' && (
          <span className="absolute left-2 top-2 flex items-center gap-1 rounded bg-black/60 px-1.5 py-0.5 text-[11px] text-white"><Play className="h-3 w-3" /> Video</span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-3.5">
        <div className="flex items-center gap-2">
          <Badge tone={statusTone(ad.effective_status)}>{ad.effective_status ?? 'UNKNOWN'}</Badge>
          {ad.format && <Badge tone="purple">{ad.format}</Badge>}
        </div>
        <p className="line-clamp-2 text-sm font-medium text-slate-900 group-hover:text-brand-700">{ad.name ?? ad.meta_ad_id}</p>
        {ad.headline && <p className="line-clamp-1 text-xs text-slate-600">{ad.headline}</p>}
        <p className="line-clamp-1 text-xs text-slate-400">{ad.campaign_name}</p>
        <dl className="mt-auto grid grid-cols-3 gap-2 border-t border-slate-100 pt-2.5 text-xs">
          <div><dt className="text-slate-400">Spend</dt><dd className="font-medium">{spend > 0 ? formatMoney(spend, currency) : '—'}</dd></div>
          <div><dt className="text-slate-400">Impr.</dt><dd className="font-medium">{impressions > 0 ? formatCompact(impressions) : '—'}</dd></div>
          <div><dt className="text-slate-400">{roas ? 'ROAS' : 'CTR'}</dt><dd className="font-medium">{roas ? `${roas.toFixed(2)}x` : formatPercent(ctr)}</dd></div>
        </dl>
      </div>
    </Link>
  );
}
