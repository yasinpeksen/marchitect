import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useData } from '@/lib/api';
import { EMPTY_FILTERS } from '@/lib/ad-filters';
import { makeAccount, makeAd, makeRun } from '@/testing/factories';
import { apiMock, dataState, navigationMock } from '@/testing/mocks';
import { AdBrowser } from './ad-browser';
import { ChoiceChips, FiltersPanel, LOOKBACK_OPTIONS, SearchPanel, SORT_OPTIONS } from './ad-browser-parts';

describe('ChoiceChips', () => {
  it('toggles options and reflects the selection', () => {
    const onChange = vi.fn();
    render(<ChoiceChips label="Letters" options={['a', 'b']} selected={['a']} onChange={onChange} />);
    expect(screen.getByRole('group', { name: 'Letters' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'a' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'b' }));
    expect(onChange).toHaveBeenCalledWith(['a', 'b']);
    fireEvent.click(screen.getByRole('button', { name: 'a' }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });
});

describe('option lists', () => {
  it('offer the documented sort keys and lookbacks', () => {
    expect(SORT_OPTIONS.map(([value]) => value)).toEqual(['recent', 'spend', 'impressions', 'clicks', 'ctr', 'roas', 'revenue', 'purchases', 'name']);
    expect(LOOKBACK_OPTIONS.map(([days]) => days)).toEqual([7, 30, 90, 365, 1095]);
  });
});

describe('FiltersPanel', () => {
  it('reports every filter change and clears', () => {
    const onChange = vi.fn();
    const onClear = vi.fn();
    render(<FiltersPanel filters={EMPTY_FILTERS} campaigns={[{ id: 'c1', name: 'Campaign 1' }]} onChange={onChange} onClear={onClear} />);
    fireEvent.click(screen.getByRole('button', { name: 'video' }));
    expect(onChange).toHaveBeenLastCalledWith({ formats: ['video'] });
    fireEvent.click(screen.getByRole('button', { name: 'ACTIVE' }));
    fireEvent.click(screen.getByRole('button', { name: 'instagram' }));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'c1' } });
    expect(onChange).toHaveBeenLastCalledWith({ campaignIds: ['c1'] });
    fireEvent.change(screen.getByLabelText('Min spend'), { target: { value: '10' } });
    expect(onChange).toHaveBeenLastCalledWith({ minSpend: '10' });
    fireEvent.change(screen.getByLabelText('Min CTR (%)'), { target: { value: '1.5' } });
    fireEvent.change(screen.getByLabelText('Min ROAS'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Created from'), { target: { value: '2026-01-01' } });
    fireEvent.change(screen.getByLabelText('Created to'), { target: { value: '2026-02-01' } });
    expect(onChange).toHaveBeenLastCalledWith({ dateTo: '2026-02-01' });
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(onClear).toHaveBeenCalled();
  });
  it('clears the campaign filter when "All campaigns" is chosen', () => {
    const onChange = vi.fn();
    render(<FiltersPanel filters={{ ...EMPTY_FILTERS, campaignIds: ['c1'] }} onChange={onChange} onClear={vi.fn()} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '' } });
    expect(onChange).toHaveBeenLastCalledWith({ campaignIds: [] });
  });
});

describe('SearchPanel', () => {
  const props = () => ({
    tags: ['summer'], onTagsChange: vi.fn(), match: 'any' as const, onMatchChange: vi.fn(), accounts: [makeAccount()], accountId: '', onAccountChange: vi.fn(),
    lookbackDays: 30, onLookbackChange: vi.fn(), history: [{ keywords: ['old', 'search'] }], busy: false, onSave: vi.fn(), onCollect: vi.fn(),
  });

  it('wires every control to its handler', () => {
    const handlers = props();
    render(<SearchPanel {...handlers} />);
    fireEvent.change(screen.getByLabelText('Match'), { target: { value: 'all' } });
    expect(handlers.onMatchChange).toHaveBeenCalledWith('all');
    fireEvent.change(screen.getByLabelText('Ad account'), { target: { value: 'acc-1' } });
    expect(handlers.onAccountChange).toHaveBeenCalledWith('acc-1');
    fireEvent.change(screen.getByLabelText('Collection range'), { target: { value: '90' } });
    expect(handlers.onLookbackChange).toHaveBeenCalledWith(90);
    fireEvent.click(screen.getByRole('button', { name: /Save/ }));
    fireEvent.click(screen.getByRole('button', { name: /Collect ads/ }));
    expect(handlers.onSave).toHaveBeenCalled();
    expect(handlers.onCollect).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'old, search' }));
    expect(handlers.onTagsChange).toHaveBeenCalledWith(['old', 'search']);
  });

  it('disables saving and collecting without keywords and says when no account is connected', () => {
    render(<SearchPanel {...props()} tags={[]} accounts={[]} />);
    expect(screen.getByRole('button', { name: /Save/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Collect ads/ })).toBeDisabled();
    expect(screen.getByText('No accounts connected')).toBeInTheDocument();
  });
});

describe('AdBrowser', () => {
  const arrange = (ads = [makeAd()]) => {
    dataState.responses['/ad-accounts'] = [makeAccount()];
    dataState.responses['/campaigns'] = [];
    dataState.responses['/search/history'] = [];
    dataState.responses['/ads'] = { items: ads, total: ads.length, page: 1, page_size: 24 };
  };

  it('shows collected ads in library mode with filters open', () => {
    arrange();
    render(<AdBrowser mode="library" />);
    expect(screen.getByText('Summer Sale')).toBeInTheDocument();
    expect(screen.getByText('Format')).toBeInTheDocument();
  });

  it('shows the empty state with guidance per mode', () => {
    arrange([]);
    const { unmount } = render(<AdBrowser mode="search" />);
    expect(screen.getByText('No ads collected yet')).toBeInTheDocument();
    expect(screen.getByText(/Use “Collect ads”/)).toBeInTheDocument();
    unmount();
    render(<AdBrowser mode="library" />);
    expect(screen.getByText(/Run a search on the Ad Search page/)).toBeInTheDocument();
  });

  it('initialises keywords, match and account from the URL', () => {
    arrange();
    navigationMock.searchParameters = new URLSearchParams('q=summer,sale&match=all&account=acc-1');
    render(<AdBrowser mode="search" />);
    expect(screen.getByText('summer')).toBeInTheDocument();
    expect(screen.getByLabelText('Match')).toHaveValue('all');
    expect(vi.mocked(useData).mock.calls.some(([path]) => String(path).includes('keywords=summer%2Csale'))).toBe(true);
  });

  it('starts a collection for the enabled account and shows progress', async () => {
    arrange();
    navigationMock.searchParameters = new URLSearchParams('q=summer');
    dataState.responses['/collection-runs/run-1'] = makeRun({ status: 'running', progress: 40 });
    apiMock.post.mockResolvedValue({ run: makeRun({ status: 'queued' }), existing_matches: 4, reused: false });
    render(<AdBrowser mode="search" />);
    fireEvent.click(screen.getByRole('button', { name: /Collect ads/ }));
    await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith('/search/collect', expect.objectContaining({ keywords: ['summer'], ad_account_id: 'acc-1' })));
    expect(await screen.findByText(/4 matching ads already stored/)).toBeInTheDocument();
    expect(screen.getByText('40%')).toBeInTheDocument();
  });

  it('one click collects from every enabled account on every platform', async () => {
    arrange();
    dataState.responses['/ad-accounts'] = [
      makeAccount({ id: 'meta-1' }),
      makeAccount({ id: 'tt-1', platform: 'tiktok', meta_account_id: 'tiktok:700', name: 'Shoe Shop' }),
      makeAccount({ id: 'off-1', selected: false }),
    ];
    navigationMock.searchParameters = new URLSearchParams('q=summer');
    apiMock.post.mockImplementation((_path: string, body: { ad_account_id: string }) =>
      Promise.resolve({ run: makeRun({ id: `run-${body.ad_account_id}`, status: 'queued' }), existing_matches: 2, reused: false }));
    render(<AdBrowser mode="search" />);
    expect(screen.getAllByRole('button', { name: /Collect/ })).toHaveLength(1); // a single collect button
    fireEvent.click(screen.getByRole('button', { name: /Collect ads/ }));
    expect(await screen.findByText('4 matching ads already stored. Collecting fresh data from Meta and TikTok…')).toBeInTheDocument();
    expect(apiMock.post.mock.calls.map(([, body]) => body.ad_account_id)).toEqual(['meta-1', 'tt-1']);
    expect(vi.mocked(useData).mock.calls.some(([path]) => path === '/collection-runs/run-tt-1')).toBe(true);
    expect(vi.mocked(useData).mock.calls.some(([path]) => path === '/collection-runs/run-meta-1')).toBe(true);
  });

  it('collects only from the chosen account', async () => {
    arrange();
    dataState.responses['/ad-accounts'] = [makeAccount({ id: 'meta-1' }), makeAccount({ id: 'tt-1', platform: 'tiktok', meta_account_id: 'tiktok:700' })];
    navigationMock.searchParameters = new URLSearchParams('q=summer&account=tt-1');
    apiMock.post.mockResolvedValue({ run: makeRun(), existing_matches: 0, reused: false });
    render(<AdBrowser mode="search" />);
    fireEvent.click(screen.getByRole('button', { name: /Collect ads/ }));
    await waitFor(() => expect(apiMock.post).toHaveBeenCalledTimes(1));
    expect(apiMock.post).toHaveBeenCalledWith('/search/collect', expect.objectContaining({ ad_account_id: 'tt-1' }));
    expect(await screen.findByText(/Collecting fresh data from TikTok/)).toBeInTheDocument();
  });

  it('keeps the runs that started and reports the account that failed to start', async () => {
    arrange();
    dataState.responses['/ad-accounts'] = [makeAccount({ id: 'meta-1' }), makeAccount({ id: 'tt-1', platform: 'tiktok', meta_account_id: 'tiktok:700' })];
    navigationMock.searchParameters = new URLSearchParams('q=summer');
    apiMock.post.mockImplementation((_path: string, body: { ad_account_id: string }) =>
      body.ad_account_id === 'tt-1' ? Promise.reject(new Error('TikTok connection is no longer valid')) : Promise.resolve({ run: makeRun(), existing_matches: 1, reused: false }));
    render(<AdBrowser mode="search" />);
    fireEvent.click(screen.getByRole('button', { name: /Collect ads/ }));
    expect(await screen.findByText('TikTok connection is no longer valid')).toBeInTheDocument();
    expect(screen.getByText(/1 matching ads already stored/)).toBeInTheDocument();
  });

  it('saves the search against the first enabled account when none is chosen', async () => {
    arrange();
    navigationMock.searchParameters = new URLSearchParams('q=summer');
    apiMock.post.mockResolvedValue({});
    vi.spyOn(window, 'prompt').mockReturnValue('Named');
    render(<AdBrowser mode="search" />);
    fireEvent.click(screen.getByRole('button', { name: /Save/ }));
    await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith('/saved-searches', expect.objectContaining({ ad_account_id: 'acc-1' })));
  });

  it('says when an identical collection is already running', async () => {
    arrange();
    navigationMock.searchParameters = new URLSearchParams('q=summer');
    apiMock.post.mockResolvedValue({ run: makeRun({ status: 'running' }), existing_matches: 0, reused: true });
    render(<AdBrowser mode="search" />);
    fireEvent.click(screen.getByRole('button', { name: /Collect ads/ }));
    expect(await screen.findByText(/already running/)).toBeInTheDocument();
  });

  it('explains when no ad account is connected and surfaces API errors', async () => {
    arrange();
    dataState.responses['/ad-accounts'] = [];
    navigationMock.searchParameters = new URLSearchParams('q=summer');
    const { unmount } = render(<AdBrowser mode="search" />);
    fireEvent.click(screen.getByRole('button', { name: /Collect ads/ }));
    expect(await screen.findByText(/Connect and enable an ad account first/)).toBeInTheDocument();
    unmount();
    dataState.responses['/ad-accounts'] = [makeAccount()];
    apiMock.post.mockRejectedValue(new Error('Server exploded'));
    render(<AdBrowser mode="search" />);
    fireEvent.click(screen.getByRole('button', { name: /Collect ads/ }));
    expect(await screen.findByText('Server exploded')).toBeInTheDocument();
  });

  it('saves the search under a chosen name and ignores a cancelled prompt', async () => {
    arrange();
    navigationMock.searchParameters = new URLSearchParams('q=summer');
    apiMock.post.mockResolvedValue({});
    const prompt = vi.spyOn(window, 'prompt').mockReturnValueOnce(null).mockReturnValueOnce('My search');
    render(<AdBrowser mode="search" />);
    fireEvent.click(screen.getByRole('button', { name: /Save/ }));
    expect(apiMock.post).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Save/ }));
    expect(await screen.findByText('Search saved.')).toBeInTheDocument();
    expect(apiMock.post).toHaveBeenCalledWith('/saved-searches', expect.objectContaining({ name: 'My search', tags: ['summer'], match_mode: 'any' }));
    prompt.mockRestore();
  });

  it('reports a failed save', async () => {
    arrange();
    navigationMock.searchParameters = new URLSearchParams('q=summer');
    apiMock.post.mockRejectedValue(new Error('Cannot save'));
    vi.spyOn(window, 'prompt').mockReturnValue('Name');
    render(<AdBrowser mode="search" />);
    fireEvent.click(screen.getByRole('button', { name: /Save/ }));
    expect(await screen.findByText('Cannot save')).toBeInTheDocument();
  });

  it('changes sort and direction, toggles and clears filters', () => {
    arrange();
    render(<AdBrowser mode="library" />);
    fireEvent.change(screen.getByLabelText('Sort by'), { target: { value: 'spend' } });
    fireEvent.click(screen.getByRole('button', { name: '↓ Desc' }));
    expect(screen.getByRole('button', { name: '↑ Asc' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'video' }));
    expect(vi.mocked(useData).mock.calls.some(([path]) => String(path).includes('formats=video') && String(path).includes('sort=spend') && String(path).includes('dir=asc'))).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    fireEvent.click(screen.getByRole('button', { name: /Filters/ }));
    expect(screen.queryByText('Format')).toBeNull();
  });

  it('adds keywords in library mode and pages through results', () => {
    dataState.responses['/ad-accounts'] = [makeAccount()];
    dataState.responses['/campaigns'] = [];
    dataState.responses['/ads'] = { items: [makeAd()], total: 100, page: 1, page_size: 24 };
    render(<AdBrowser mode="library" />);
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(vi.mocked(useData).mock.calls.some(([path]) => String(path).includes('page=2'))).toBe(true);
  });
});
