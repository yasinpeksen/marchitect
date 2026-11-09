'use client';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, Tooltip, XAxis, YAxis } from 'recharts';
import { buildRetentionFunnel, fatigueLabel, RANKING_TONES } from '@/lib/ad-analytics';
import { formatCompact, formatDateTime, formatDay, formatDecimal, formatInteger, formatMoney, formatPercent, isNumber } from '@/lib/format';
import type { AdAnalytics } from '@/lib/types';
import { BreakdownCard, ChartCard, Metric, MetricGroup } from './ad-detail-parts';
import { Badge, Card, Empty, StatCard } from './ui';

const BREAKDOWN_SECTIONS: [string, string][] = [['age_gender', 'Age & gender'], ['country', 'Country'], ['placement', 'Placement'], ['device', 'Device']];

export const formatRatio = (value: number | null): string => (isNumber(value) ? `${formatDecimal(value)}x` : '—');
export const formatSeconds = (value: number | null): string => (isNumber(value) ? `${formatDecimal(value, 1)}s` : '—');

/** Colour for the fatigue badge. */
export const fatigueTone = (status: string): 'red' | 'amber' | 'green' => {
  if (status === 'high') return 'red';
  return status === 'moderate' ? 'amber' : 'green';
};

/** KPI cards, metric groups, daily charts, fatigue, rankings and breakdowns for one ad and date range. */
export function AnalyticsSections({ analytics, currency, hasVideo }: { analytics: AdAnalytics; currency?: string | null; hasVideo: boolean }) {
  const { metrics } = analytics;
  const funnel = buildRetentionFunnel(metrics);
  return (
    <>
          {analytics.range.days_with_data === 0 && <Empty title="No performance data in this range" hint="Pick a wider range, or use “Refresh insights” to collect it from Meta." />}
          {analytics.reach_note && <p className="text-xs text-slate-500">{analytics.reach_note}</p>}

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Spend" value={formatMoney(metrics.spend, currency)} />
            <StatCard label="Impressions" value={formatInteger(metrics.impressions)} />
            <StatCard label="CTR (link)" value={formatPercent(metrics.ctr)} />
            <StatCard label="ROAS" value={formatRatio(metrics.roas)} />
          </div>

          <MetricGroup title="General performance">
            <Metric label="Reach" value={formatInteger(metrics.reach)} /><Metric label="Frequency" value={formatDecimal(metrics.frequency)} />
            <Metric label="CPM" value={formatMoney(metrics.cpm, currency)} /><Metric label="CPC (link)" value={formatMoney(metrics.cpc, currency)} />
            <Metric label="Link clicks" value={formatInteger(metrics.link_clicks)} /><Metric label="Outbound clicks" value={formatInteger(metrics.outbound_clicks)} />
          </MetricGroup>

          <MetricGroup title="Conversions">
            <Metric label="Installs" value={formatInteger(metrics.installs)} /><Metric label="CPI" value={formatMoney(metrics.cpi, currency)} />
            <Metric label="IPM" value={formatDecimal(metrics.ipm)} /><Metric label="Registrations" value={formatInteger(metrics.registrations)} />
            <Metric label="Cost / registration" value={formatMoney(metrics.cost_per_registration, currency)} /><Metric label="Trials" value={formatInteger(metrics.trials)} />
            <Metric label="Purchases" value={formatInteger(metrics.purchases)} /><Metric label="CPA" value={formatMoney(metrics.cpa, currency)} />
            <Metric label="Revenue" value={formatMoney(metrics.revenue, currency)} /><Metric label="ROAS" value={formatRatio(metrics.roas)} />
          </MetricGroup>

          {hasVideo && (
            <MetricGroup title="Video analytics">
              <Metric label="3-second views" value={formatInteger(metrics.video_3s_views)} /><Metric label="Hook rate" value={formatPercent(metrics.hook_rate)} hint="3s views ÷ impressions" />
              <Metric label="ThruPlay" value={formatInteger(metrics.video_thruplays)} /><Metric label="Hold rate" value={formatPercent(metrics.hold_rate)} hint="ThruPlay ÷ 3s views" />
              <Metric label="25% watched" value={formatPercent(metrics.completion_25)} /><Metric label="50% watched" value={formatPercent(metrics.completion_50)} />
              <Metric label="75% watched" value={formatPercent(metrics.completion_75)} /><Metric label="100% watched" value={formatPercent(metrics.completion_100)} />
              <Metric label="Avg watch time" value={formatSeconds(metrics.avg_watch_seconds)} />
            </MetricGroup>
          )}

          {analytics.daily.length > 0 && (
            <div className="grid gap-6 lg:grid-cols-2">
              <ChartCard title="Spend & impressions (daily)">
                <LineChart data={analytics.daily}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" /><XAxis dataKey="date" tickFormatter={formatDay} fontSize={11} />
                  <YAxis yAxisId="left" fontSize={11} tickFormatter={formatCompact} /><YAxis yAxisId="right" orientation="right" fontSize={11} tickFormatter={formatCompact} />
                  <Tooltip labelFormatter={formatDay} /><Legend />
                  <Line yAxisId="left" dataKey="spend" name="Spend" stroke="#4f46e5" dot={false} strokeWidth={2} connectNulls />
                  <Line yAxisId="right" dataKey="impressions" name="Impressions" stroke="#94a3b8" dot={false} strokeWidth={2} connectNulls />
                </LineChart>
              </ChartCard>
              <ChartCard title="CTR & CPC (daily)">
                <LineChart data={analytics.daily}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" /><XAxis dataKey="date" tickFormatter={formatDay} fontSize={11} />
                  <YAxis yAxisId="left" fontSize={11} tickFormatter={(value: number) => `${value}%`} /><YAxis yAxisId="right" orientation="right" fontSize={11} />
                  <Tooltip labelFormatter={formatDay} /><Legend />
                  <Line yAxisId="left" dataKey="ctr" name="CTR %" stroke="#10b981" dot={false} strokeWidth={2} connectNulls />
                  <Line yAxisId="right" dataKey="cpc" name="CPC" stroke="#f59e0b" dot={false} strokeWidth={2} connectNulls />
                </LineChart>
              </ChartCard>
              <ChartCard title="Purchases & ROAS (daily)">
                <LineChart data={analytics.daily}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" /><XAxis dataKey="date" tickFormatter={formatDay} fontSize={11} />
                  <YAxis yAxisId="left" fontSize={11} /><YAxis yAxisId="right" orientation="right" fontSize={11} />
                  <Tooltip labelFormatter={formatDay} /><Legend />
                  <Line yAxisId="left" dataKey="purchases" name="Purchases" stroke="#6366f1" dot={false} strokeWidth={2} connectNulls />
                  <Line yAxisId="right" dataKey="roas" name="ROAS" stroke="#ef4444" dot={false} strokeWidth={2} connectNulls />
                </LineChart>
              </ChartCard>
              {funnel.length > 0 && (
                <ChartCard title="Video retention">
                  <BarChart data={funnel}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" /><XAxis dataKey="name" fontSize={11} /><YAxis fontSize={11} tickFormatter={formatCompact} />
                    <Tooltip formatter={(value: number) => formatInteger(value)} /><Bar dataKey="value" name="Viewers" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ChartCard>
              )}
            </div>
          )}

          <Card title="Ad fatigue">
            {analytics.fatigue.status === 'insufficient_data' ? (
              <p className="text-sm text-slate-500">Needs at least 14 days with delivery data ({analytics.fatigue.days_with_data} in range) to compare the first and last 7 days.</p>
            ) : (
              <div className="grid gap-4 sm:grid-cols-4">
                <Metric label="First 7-day CTR" value={formatPercent(analytics.fatigue.first_7d_ctr)} />
                <Metric label="Last 7-day CTR" value={formatPercent(analytics.fatigue.last_7d_ctr)} />
                <Metric label="CTR drop" value={formatPercent(analytics.fatigue.ctr_drop_pct, 1)} hint={`ratio ${formatDecimal(analytics.fatigue.ctr_ratio)} · trend ${formatDecimal(analytics.fatigue.ctr_trend_per_day, 3)} pp/day`} />
                <div>
                  <dt className="text-xs text-slate-500">Status</dt>
                  <dd className="mt-1"><Badge tone={analytics.fatigue.status === 'high' ? 'red' : (analytics.fatigue.status === 'moderate' ? 'amber' : 'green')}>{fatigueLabel(analytics.fatigue.status)}</Badge></dd>
                </div>
              </div>
            )}
          </Card>

          <Card title="Creative rankings">
            {analytics.rankings ? (
              <div className="flex flex-wrap gap-6 text-sm">
                {([['Quality', analytics.rankings.quality], ['Engagement', analytics.rankings.engagement], ['Conversion', analytics.rankings.conversion]] as [string, string | null][]).map(([label, ranking]) => (
                  <div key={label}>
                    <p className="text-xs text-slate-500">{label} ranking</p>
                    {ranking ? <Badge tone={RANKING_TONES[ranking] ?? 'gray'}>{ranking.replaceAll('_', ' ').toLowerCase()}</Badge> : <span>—</span>}
                  </div>
                ))}
                <p className="text-xs text-slate-400">as of {formatDateTime(analytics.rankings.as_of)}. Meta only ranks ads with enough impressions.</p>
              </div>
            ) : <p className="text-sm text-slate-500">No ranking data collected.</p>}
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            {BREAKDOWN_SECTIONS.map(([type, label]) => <BreakdownCard key={type} label={label} rows={analytics.breakdowns[type]?.rows ?? []} currency={currency} />)}
          </div>
          {analytics.breakdowns.age_gender && <p className="text-xs text-slate-400">Breakdowns cover the range collected: {analytics.breakdowns.age_gender.date_start} → {analytics.breakdowns.age_gender.date_stop}.</p>}
    </>
  );
}
