'use client';
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { segmentLabel } from '@/lib/ad-analytics';
import { formatCompact, formatInteger, formatMoney, formatPercent } from '@/lib/format';
import type { AdDetail, BreakdownRow, MediaItem } from '@/lib/types';
import { Card } from './ui';

/** Video player (when a video is stored) or image preview, with notes about restricted media. */
export function AdMedia({ ad }: { ad: Pick<AdDetail, 'media' | 'name'> }) {
  const video = ad.media.find((item: MediaItem) => item.kind === 'video' && item.url);
  const image = ad.media.find((item) => item.kind === 'image' && item.url) ?? ad.media.find((item) => item.kind === 'thumbnail' && item.url);
  const poster = ad.media.find((item) => item.kind === 'thumbnail' && item.url)?.url ?? undefined;
  const problems = ad.media.filter((item) => item.status === 'unavailable' || item.status === 'failed');
  return (
    <div className="space-y-2">
      <div className="overflow-hidden rounded-xl bg-slate-900">
        {video?.url ? (
          <video src={video.url} poster={poster} controls preload="metadata" className="max-h-[480px] w-full" />
        ) : (image?.url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={image.url} alt={ad.name ?? 'Ad creative'} className="max-h-[480px] w-full object-contain" />
        ) : (
          <div className="flex h-56 items-center justify-center text-sm text-slate-400">No media stored for this ad yet</div>
        ))}
      </div>
      {problems.map((item) => (
        <p key={`${item.kind}-${item.status}`} className="text-xs text-amber-700">{item.kind}: {item.status}{item.error ? ` — ${item.error}` : ''}</p>
      ))}
    </div>
  );
}

export function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-base font-semibold text-slate-900">{value}</dd>
      {hint && <dd className="text-[11px] text-slate-400">{hint}</dd>}
    </div>
  );
}

export function MetricGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return <Card title={title}><dl className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-3 lg:grid-cols-4">{children}</dl></Card>;
}

export function ChartCard({ title, children }: { title: string; children: React.ReactElement }) {
  return <Card title={title}><ResponsiveContainer width="100%" height={230}>{children}</ResponsiveContainer></Card>;
}

export function BreakdownCard({ rows, label, currency }: { rows: BreakdownRow[]; label: string; currency?: string | null }) {
  const topRows = rows.slice(0, 8);
  return (
    <Card title={label}>
      {topRows.length === 0 ? <p className="text-sm text-slate-500">No data collected.</p> : (
        <>
          <ResponsiveContainer width="100%" height={Math.max(120, topRows.length * 30)}>
            <BarChart data={topRows.map((row) => ({ name: segmentLabel(row.dim_key), spend: row.spend ?? 0 }))} layout="vertical" margin={{ left: 24 }}>
              <XAxis type="number" fontSize={11} tickFormatter={formatCompact} />
              <YAxis type="category" dataKey="name" width={110} fontSize={11} />
              <Tooltip formatter={(value: number) => formatMoney(value, currency)} />
              <Bar dataKey="spend" name="Spend" fill="#6366f1" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-slate-500"><tr><th className="py-1 pr-3">Segment</th><th className="pr-3">Spend</th><th className="pr-3">Impr.</th><th className="pr-3">CTR</th><th>CPM</th></tr></thead>
              <tbody>
                {rows.slice(0, 25).map((row) => (
                  <tr key={row.dim_key} className="border-t border-slate-100">
                    <td className="max-w-[160px] truncate py-1 pr-3">{segmentLabel(row.dim_key)}</td>
                    <td className="pr-3">{formatMoney(row.spend, currency)}</td>
                    <td className="pr-3">{formatInteger(row.impressions)}</td>
                    <td className="pr-3">{formatPercent(row.ctr)}</td>
                    <td>{formatMoney(row.cpm, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}

export function JsonBlock({ value }: { value: unknown }) {
  return <pre className="max-h-96 overflow-auto rounded-lg bg-slate-900 p-4 text-xs leading-relaxed text-slate-100">{JSON.stringify(value, null, 2)}</pre>;
}
