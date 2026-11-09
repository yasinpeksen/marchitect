'use client';
import Link from 'next/link';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Badge, Card, Empty, ErrorBox, PageHeader, Spinner, StatCard, statusTone } from '@/components/ui';
import { useData } from '@/lib/api';
import { formatCompact, formatDay, formatDecimal, formatMoney, formatPercent } from '@/lib/format';
import type { DashboardOverview } from '@/lib/types';

export default function Dashboard() {
  const { data, error } = useData<DashboardOverview>('/dashboard', { refreshInterval: 15_000 });
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Spinner />;
  const { totals } = data;

  return (
    <>
      <PageHeader title="Dashboard" subtitle="Collection activity and performance across everything you have collected." />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Collected ads" value={totals.ads.toLocaleString()} />
        <StatCard label="Saved searches" value={totals.saved_searches} />
        <StatCard label="Scheduled searches" value={totals.scheduled_searches} hint={`${totals.schedules_total} total`} />
        <StatCard label="Collections running" value={totals.active_collections} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card title="Performance overview · last 30 days">
          {data.performance.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={data.performance}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="date" tickFormatter={formatDay} fontSize={11} />
                <YAxis yAxisId="left" fontSize={11} tickFormatter={formatCompact} />
                <YAxis yAxisId="right" orientation="right" fontSize={11} tickFormatter={(value: number) => `${formatDecimal(value, 1)}%`} />
                <Tooltip labelFormatter={formatDay} formatter={(value: number, name) => (name === 'CTR' ? formatPercent(value) : formatMoney(value))} />
                <Line yAxisId="left" type="monotone" dataKey="spend" name="Spend" stroke="#4f46e5" dot={false} strokeWidth={2} />
                <Line yAxisId="right" type="monotone" dataKey="ctr" name="CTR" stroke="#10b981" dot={false} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          ) : <Empty title="No performance data yet" hint="Collect ads to see spend and CTR here." />}
        </Card>

        <Card title="Collection activity · last 14 days">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={data.activity}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="date" tickFormatter={formatDay} fontSize={11} />
              <YAxis allowDecimals={false} fontSize={11} />
              <Tooltip labelFormatter={formatDay} />
              <Bar dataKey="runs" name="Runs" fill="#6366f1" radius={[4, 4, 0, 0]} />
              <Bar dataKey="failed" name="Failed" fill="#ef4444" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Top-performing ads" actions={<Link href="/library?sort=roas" className="text-xs text-brand-600">View library</Link>}>
          {data.top_ads.length === 0 ? <Empty title="Not enough data" hint="Ads need at least 1,000 impressions to rank." /> : (
            <ul className="divide-y divide-slate-100">
              {data.top_ads.map((ad) => (
                <li key={ad.id} className="flex items-center justify-between gap-3 py-2.5">
                  <Link href={`/ads/${ad.id}`} className="min-w-0 truncate text-sm font-medium hover:text-brand-700">{ad.name}</Link>
                  <span className="shrink-0 text-xs text-slate-500">
                    {ad.roas === null ? `${formatPercent(ad.ctr)} CTR` : `${formatDecimal(ad.roas)}x ROAS`} · {formatCompact(ad.impressions)} impr.
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Recently collected ads" actions={<Link href="/library" className="text-xs text-brand-600">View all</Link>}>
          {data.recent_ads.length === 0 ? <Empty title="Nothing collected yet" hint="Go to Ad Search to collect your first ads." /> : (
            <ul className="divide-y divide-slate-100">
              {data.recent_ads.map((ad) => (
                <li key={ad.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <Link href={`/ads/${ad.id}`} className="block truncate text-sm font-medium hover:text-brand-700">{ad.name ?? ad.meta_ad_id}</Link>
                    <p className="truncate text-xs text-slate-400">{ad.campaign_name}</p>
                  </div>
                  <Badge tone={statusTone(ad.effective_status)}>{ad.effective_status}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
