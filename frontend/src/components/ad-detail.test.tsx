import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { formatPercent } from '@/lib/format';
import { makeAdDetail, makeAnalytics, makeMetrics } from '@/testing/factories';
import { AdMedia, BreakdownCard, ChartCard, JsonBlock, Metric, MetricGroup } from './ad-detail-parts';
import { AdCopyCard, AdHeader, CampaignAndTargeting, CreativeVariationsCard, DateRangeCard } from './ad-detail-sections';
import { AnalyticsSections, fatigueTone, formatRatio, formatSeconds } from './analytics-sections';

const media = (kind: string, url: string | null, status = 'stored', error: string | null = null) => ({ kind, url, status, error });

describe('AdMedia', () => {
  it('plays the stored video with the thumbnail as poster', () => {
    const { container } = render(<AdMedia ad={{ name: 'Ad', media: [media('video', 'https://v'), media('thumbnail', 'https://t')] }} />);
    const video = container.querySelector('video');
    expect(video).toHaveAttribute('src', 'https://v');
    expect(video).toHaveAttribute('poster', 'https://t');
  });
  it('falls back to the image, then the thumbnail', () => {
    const { rerender } = render(<AdMedia ad={{ name: 'Ad', media: [media('image', 'https://i')] }} />);
    expect(screen.getByRole('img')).toHaveAttribute('src', 'https://i');
    rerender(<AdMedia ad={{ name: 'Ad', media: [media('thumbnail', 'https://t')] }} />);
    expect(screen.getByRole('img')).toHaveAttribute('src', 'https://t');
  });
  it('says when nothing is stored and lists unavailable media with the reason (never bypassed)', () => {
    render(<AdMedia ad={{ name: 'Ad', media: [media('video', null, 'unavailable', 'restricted by Meta')] }} />);
    expect(screen.getByText('No media stored for this ad yet')).toBeInTheDocument();
    expect(screen.getByText('video: unavailable — restricted by Meta')).toBeInTheDocument();
  });
});

describe('Metric, MetricGroup, ChartCard, JsonBlock', () => {
  it('Metric shows label, value and hint', () => {
    render(<Metric label="Hook rate" value="40%" hint="3s views ÷ impressions" />);
    expect(screen.getByText('Hook rate')).toBeInTheDocument();
    expect(screen.getByText('40%')).toBeInTheDocument();
    expect(screen.getByText('3s views ÷ impressions')).toBeInTheDocument();
  });
  it('MetricGroup titles its metrics', () => {
    render(<MetricGroup title="General"><Metric label="CPM" value="$1" /></MetricGroup>);
    expect(screen.getByRole('heading', { name: 'General' })).toBeInTheDocument();
  });
  it('ChartCard titles its chart', () => {
    render(<ChartCard title="Spend"><div>chart</div></ChartCard>);
    expect(screen.getByRole('heading', { name: 'Spend' })).toBeInTheDocument();
  });
  it('JsonBlock pretty-prints', () => {
    render(<JsonBlock value={{ a: 1 }} />);
    expect(screen.getByText(/"a": 1/)).toBeInTheDocument();
  });
});

describe('BreakdownCard', () => {
  it('renders a segment table with formatted values', () => {
    render(<BreakdownCard label="Country" currency="USD" rows={[{ dim_key: '25-34|female', spend: 50, impressions: 5000, ctr: 2, cpm: 10 }]} />);
    expect(screen.getByText('25-34 · female')).toBeInTheDocument();
    expect(screen.getByText(formatPercent(2))).toBeInTheDocument();
  });
  it('says when nothing was collected', () => {
    render(<BreakdownCard label="Device" rows={[]} />);
    expect(screen.getByText('No data collected.')).toBeInTheDocument();
  });
});

describe('ad detail sections', () => {
  it('AdHeader shows status, format, platforms, hierarchy and refreshes', () => {
    const onRefresh = vi.fn();
    render(<AdHeader ad={makeAdDetail({ format: 'video' })} onRefresh={onRefresh} />);
    expect(screen.getByRole('heading', { name: 'Summer Sale' })).toBeInTheDocument();
    expect(screen.getByText('video')).toBeInTheDocument();
    expect(screen.getByText('instagram')).toBeInTheDocument();
    expect(screen.getByText(/Summer Campaign › US Adults/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Library/ })).toHaveAttribute('href', '/library');
    fireEvent.click(screen.getByRole('button', { name: /Refresh insights/ }));
    expect(onRefresh).toHaveBeenCalled();
  });

  it('AdCopyCard shows the copy and a safe external destination link', () => {
    render(<AdCopyCard ad={makeAdDetail()} />);
    expect(screen.getByText('Big discounts')).toBeInTheDocument();
    expect(screen.getByText('Save big this summer')).toBeInTheDocument();
    expect(screen.getByText('SHOP_NOW')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /shop.example.test/ });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });
  it('AdCopyCard shows dashes for missing copy and omits the destination', () => {
    render(<AdCopyCard ad={makeAdDetail({ headline: null, primary_text: null, cta: null, creative: null })} />);
    expect(screen.getAllByText('—')).toHaveLength(3);
    expect(screen.queryByText('Destination')).toBeNull();
  });

  describe('DateRangeCard', () => {
    it('offers presets and date inputs bounded by the collected range', () => {
      const onPreset = vi.fn();
      const onFromChange = vi.fn();
      const onToChange = vi.fn();
      render(<DateRangeCard range={makeAnalytics().range} from="" to="" onFromChange={onFromChange} onToChange={onToChange} onPreset={onPreset} />);
      fireEvent.click(screen.getByRole('button', { name: '30d' }));
      expect(onPreset).toHaveBeenCalledWith(30);
      fireEvent.click(screen.getByRole('button', { name: 'All collected' }));
      expect(onPreset).toHaveBeenLastCalledWith(null);
      fireEvent.change(screen.getByLabelText('From date'), { target: { value: '2026-03-05' } });
      fireEvent.change(screen.getByLabelText('To date'), { target: { value: '2026-03-08' } });
      expect(onFromChange).toHaveBeenCalledWith('2026-03-05');
      expect(onToChange).toHaveBeenCalledWith('2026-03-08');
      expect(screen.getByLabelText('From date')).toHaveAttribute('min', '2026-03-01');
      expect(screen.getByText(/Collected data: 2026-03-01 → 2026-03-10 · 10 days in range/)).toBeInTheDocument();
    });
    it('says when no data was collected yet', () => {
      render(<DateRangeCard from="" to="" onFromChange={vi.fn()} onToChange={vi.fn()} onPreset={vi.fn()} />);
      expect(screen.getByText('No daily data collected yet')).toBeInTheDocument();
    });
  });

  describe('CampaignAndTargeting', () => {
    it('lists campaign, ad set and readable targeting', () => {
      render(<CampaignAndTargeting ad={makeAdDetail()} />);
      expect(screen.getByText('OUTCOME_SALES')).toBeInTheDocument();
      expect(screen.getByText('OFFSITE_CONVERSIONS')).toBeInTheDocument();
      expect(screen.getByText('25–44')).toBeInTheDocument();
      expect(screen.getByText('female')).toBeInTheDocument();
    });
    it('says targeting is unavailable', () => {
      render(<CampaignAndTargeting ad={makeAdDetail({ targeting: null, campaign: null, ad_set: null })} />);
      expect(screen.getByText('Targeting is not available for this ad.')).toBeInTheDocument();
    });
  });

  describe('CreativeVariationsCard', () => {
    it('lists dynamic creative assets and performance by asset', () => {
      const ad = makeAdDetail({ creative_variations: { dynamic: { bodies: ['Stay warm', 'Winter'], titles: ['Promo'], descriptions: [], images: ['h1'], videos: [], call_to_actions: ['SHOP_NOW'], link_urls: [] }, carousel: [] } });
      const analytics = makeAnalytics({ breakdowns: { image_asset: { date_start: 'a', date_stop: 'b', rows: [{ dim_key: 'h1', spend: 5 }] } } });
      render(<CreativeVariationsCard ad={ad} analytics={analytics} currency="USD" assetBreakdownTypes={['image_asset']} />);
      expect(screen.getByText('Primary texts (2)')).toBeInTheDocument();
      expect(screen.getByText('Stay warm')).toBeInTheDocument();
      expect(screen.queryByText(/Descriptions/)).toBeNull();
      expect(screen.getByRole('heading', { name: 'Performance by image asset' })).toBeInTheDocument();
    });
    it('lists carousel cards', () => {
      render(<CreativeVariationsCard ad={makeAdDetail({ creative_variations: { dynamic: null, carousel: [{ name: 'First', description: 'Desc' }, {}] } })} assetBreakdownTypes={[]} />);
      expect(screen.getByText('First')).toBeInTheDocument();
      expect(screen.getByText('Card 2')).toBeInTheDocument();
    });
    it('explains a single-creative ad', () => {
      render(<CreativeVariationsCard ad={makeAdDetail()} assetBreakdownTypes={[]} />);
      expect(screen.getByText(/single creative/)).toBeInTheDocument();
    });
  });
});

describe('analytics helpers', () => {
  it('formatRatio and formatSeconds render dashes for missing values', () => {
    expect(formatRatio(null)).toBe('—');
    expect(formatRatio(3)).toMatch(/3[.,]00x/);
    expect(formatSeconds(null)).toBe('—');
    expect(formatSeconds(7.5)).toMatch(/7[.,]5s/);
  });
  it.each([['high', 'red'], ['moderate', 'amber'], ['none', 'green'], ['insufficient_data', 'green']])('fatigueTone(%s) = %s', (status, tone) => expect(fatigueTone(status)).toBe(tone));
});

describe('AnalyticsSections', () => {
  it('renders KPIs, metric groups, video analytics, fatigue, rankings and breakdowns', () => {
    render(<AnalyticsSections analytics={makeAnalytics()} currency="USD" hasVideo />);
    expect(screen.getByText('General performance')).toBeInTheDocument();
    expect(screen.getByText('Conversions')).toBeInTheDocument();
    expect(screen.getByText('Video analytics')).toBeInTheDocument();
    expect(screen.getByText('Hook rate')).toBeInTheDocument();
    expect(screen.getByText('healthy')).toBeInTheDocument();
    expect(screen.getByText('above average')).toBeInTheDocument();
    expect(screen.getByText('below average 35')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Country' })).toBeInTheDocument();
    expect(screen.getByText('Spend & impressions (daily)')).toBeInTheDocument();
    expect(screen.getByText('Video retention')).toBeInTheDocument();
  });
  it('never shows missing metrics as zero and hides video analytics for non-video ads', () => {
    render(<AnalyticsSections analytics={makeAnalytics({ metrics: makeMetrics({ installs: null, purchases: null, roas: null }) })} hasVideo={false} />);
    expect(screen.queryByText('Video analytics')).toBeNull();
    expect(screen.getAllByText('—').length).toBeGreaterThan(3);
  });
  it('explains the reach note, empty ranges and missing data', () => {
    render(<AnalyticsSections analytics={makeAnalytics({ reach_note: 'Reach cannot be summed', range: { ...makeAnalytics().range, days_with_data: 0 }, daily: [], rankings: null, fatigue: { ...makeAnalytics().fatigue, status: 'insufficient_data', days_with_data: 5 } })} hasVideo={false} />);
    expect(screen.getByText('Reach cannot be summed')).toBeInTheDocument();
    expect(screen.getByText('No performance data in this range')).toBeInTheDocument();
    expect(screen.getByText('No ranking data collected.')).toBeInTheDocument();
    expect(screen.getByText(/Needs at least 14 days/)).toBeInTheDocument();
    expect(screen.queryByText('Spend & impressions (daily)')).toBeNull();
  });
  it('flags high fatigue and shows the breakdown date range', () => {
    const analytics = makeAnalytics({ fatigue: { ...makeAnalytics().fatigue, status: 'high', ctr_drop_pct: 40 }, breakdowns: { age_gender: { date_start: '2026-03-01', date_stop: '2026-03-10', rows: [] } } });
    render(<AnalyticsSections analytics={analytics} hasVideo={false} />);
    expect(screen.getByText('high fatigue')).toBeInTheDocument();
    expect(screen.getByText(/Breakdowns cover the range collected: 2026-03-01 → 2026-03-10/)).toBeInTheDocument();
  });
});
