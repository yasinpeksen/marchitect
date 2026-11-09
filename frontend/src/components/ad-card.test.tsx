import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { makeAd } from '@/testing/factories';
import { AdCard, cardMetrics, pickPreview } from './ad-card';

const media = (kind: string, url: string | null = `https://signed/${kind}`, status = 'stored') => ({ kind, status, url, error: null });

describe('pickPreview', () => {
  it('prefers the thumbnail, then the image', () => {
    expect(pickPreview([media('image'), media('thumbnail')])?.kind).toBe('thumbnail');
    expect(pickPreview([media('video'), media('image')])?.kind).toBe('image');
  });
  it('ignores entries without a URL and handles no media', () => {
    expect(pickPreview([media('thumbnail', null)])).toBeNull();
    expect(pickPreview()).toBeNull();
  });
});

describe('cardMetrics', () => {
  it('computes CTR and ROAS from lifetime totals', () => {
    expect(cardMetrics(makeAd({ total_spend: 100, total_impressions: 10_000, total_link_clicks: 200, total_revenue: 300 }))).toEqual({ impressions: 10_000, spend: 100, ctr: 2, roas: 3 });
  });
  it('returns null (never 0) when not computable', () => {
    expect(cardMetrics(makeAd({ total_spend: 0, total_impressions: 0, total_revenue: 0 }))).toMatchObject({ ctr: null, roas: null });
    expect(cardMetrics(makeAd({ total_spend: 50, total_revenue: 0 })).roas).toBeNull();
  });
});

describe('AdCard', () => {
  it('links to the ad dashboard and shows name, headline, campaign and status', () => {
    render(<AdCard ad={makeAd()} currency="USD" />);
    expect(screen.getByRole('link')).toHaveAttribute('href', '/ads/ad-1');
    expect(screen.getByText('Summer Sale')).toBeInTheDocument();
    expect(screen.getByText('Big discounts')).toBeInTheDocument();
    expect(screen.getByText('Summer Campaign')).toBeInTheDocument();
    expect(screen.getByText('ACTIVE')).toBeInTheDocument();
  });
  it('shows the preview image when stored', () => {
    render(<AdCard ad={makeAd({ media: [media('thumbnail')] })} />);
    expect(screen.getByRole('img')).toHaveAttribute('src', 'https://signed/thumbnail');
  });
  it('explains missing or downloading media', () => {
    const { rerender } = render(<AdCard ad={makeAd()} />);
    expect(screen.getByText('No media stored')).toBeInTheDocument();
    rerender(<AdCard ad={makeAd({ media: [media('video', null, 'pending')] })} />);
    expect(screen.getByText('Media downloading…')).toBeInTheDocument();
  });
  it('marks videos and shows ROAS when revenue exists, otherwise CTR', () => {
    const { rerender } = render(<AdCard ad={makeAd({ format: 'video', total_revenue: 300 })} />);
    expect(screen.getByText('Video')).toBeInTheDocument();
    expect(screen.getByText('3.00x')).toBeInTheDocument();
    rerender(<AdCard ad={makeAd()} />);
    expect(screen.getByText('CTR')).toBeInTheDocument();
  });
  it('shows dashes for missing metrics and falls back to the Meta id and unknown status', () => {
    render(<AdCard ad={makeAd({ name: null, meta_ad_id: 'meta-99', effective_status: null, total_spend: 0, total_impressions: 0, headline: null })} />);
    expect(screen.getByText('meta-99')).toBeInTheDocument();
    expect(screen.getByText('UNKNOWN')).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(3);
  });
});
