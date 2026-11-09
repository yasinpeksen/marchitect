import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { makeAccount, makeAd, makeAdDetail, makeAnalytics, makeConnection, makeRun, makeSavedSearch, makeSchedule } from '@/testing/factories';
import { apiMock, dataState, navigationMock, supabaseMock } from '@/testing/mocks';
import AdDashboard from './(app)/ads/[id]/page';
import AppLayout from './(app)/layout';
import Connections from './(app)/connections/page';
import Dashboard from './(app)/dashboard/page';
import History from './(app)/history/page';
import LibraryPage from './(app)/library/page';
import SavedSearches from './(app)/saved/page';
import Scheduler from './(app)/scheduler/page';
import SearchPage from './(app)/search/page';
import Settings from './(app)/settings/page';
import RootLayout from './layout';
import Home from './page';

describe('Dashboard', () => {
  const overview = {
    totals: { ads: 1234, saved_searches: 3, scheduled_searches: 2, schedules_total: 4, active_collections: 1 },
    recent_ads: [{ id: 'a1', name: 'Recent ad', meta_ad_id: 'm1', campaign_name: 'Camp', effective_status: 'ACTIVE' }],
    activity: [{ date: '2026-03-01', runs: 2, failed: 1, ads_found: 5 }],
    top_ads: [{ id: 't1', name: 'Top ROAS', roas: 3.5, ctr: 2, impressions: 5000 }, { id: 't2', name: 'Top CTR', roas: null, ctr: 4, impressions: 2000 }],
    performance: [{ date: '2026-03-01', spend: 10, ctr: 2 }],
  };

  it('shows totals, recent ads and top ads', () => {
    dataState.responses['/dashboard'] = overview;
    render(<Dashboard />);
    expect(screen.getByText('Collected ads')).toBeInTheDocument();
    expect(screen.getByText((1234).toLocaleString())).toBeInTheDocument();
    expect(screen.getByText('4 total')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Recent ad' })).toHaveAttribute('href', '/ads/a1');
    expect(screen.getByText(/3[.,]50x ROAS/)).toBeInTheDocument();
    expect(screen.getByText(/CTR · /)).toBeInTheDocument();
  });
  it('explains empty states', () => {
    dataState.responses['/dashboard'] = { ...overview, recent_ads: [], top_ads: [], performance: [] };
    render(<Dashboard />);
    expect(screen.getByText('No performance data yet')).toBeInTheDocument();
    expect(screen.getByText('Not enough data')).toBeInTheDocument();
    expect(screen.getByText('Nothing collected yet')).toBeInTheDocument();
  });
  it('shows loading and errors', () => {
    const { unmount } = render(<Dashboard />);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    unmount();
    dataState.errors['/dashboard'] = new Error('API down');
    render(<Dashboard />);
    expect(screen.getByText('API down')).toBeInTheDocument();
  });
});

describe('History', () => {
  const page = (runs = [makeRun()]) => ({ items: runs, total: runs.length });

  it('lists runs with source, keywords, status, counters and duration', () => {
    dataState.responses['/collection-runs'] = page([makeRun({ trigger: 'schedule', schedules: { name: 'Nightly' } }), makeRun({ id: 'run-2', keywords: [], status: 'running', progress: 50, counters: {}, finished_at: null })]);
    render(<History />);
    expect(screen.getByText('Nightly')).toBeInTheDocument();
    expect(screen.getByText('2 found · 1 new')).toBeInTheDocument();
    expect(screen.getByText('30s')).toBeInTheDocument();
    expect(screen.getByText('insights refresh')).toBeInTheDocument();
    expect(screen.getByText('50%')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View ads' })).toHaveAttribute('href', '/search?q=summer');
  });
  it('expands error details', () => {
    dataState.responses['/collection-runs'] = page([makeRun({ status: 'failed', error: 'Meta said no', errors: [{ message: 'device breakdown' }] })]);
    render(<History />);
    fireEvent.click(screen.getByRole('button', { name: 'Details' }));
    expect(screen.getByText('Meta said no')).toBeInTheDocument();
    expect(screen.getByText('device breakdown')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Hide' }));
    expect(screen.queryByText('Meta said no')).toBeNull();
  });
  it('filters by status and handles empty and failed loads', () => {
    dataState.responses['/collection-runs'] = page([]);
    const { unmount } = render(<History />);
    expect(screen.getByText('No collections yet')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Filter by status'), { target: { value: 'failed' } });
    unmount();
    dataState.errors['/collection-runs'] = new Error('Cannot load');
    render(<History />);
    expect(screen.getByText('Cannot load')).toBeInTheDocument();
  });
});

describe('SavedSearches', () => {
  const arrange = () => {
    dataState.responses['/saved-searches'] = [makeSavedSearch(), makeSavedSearch({ id: 'ss-2', name: 'No account', ad_account_id: null })];
    dataState.responses['/ad-accounts'] = [makeAccount()];
  };

  it('lists saved searches with open links and disables run without an account', () => {
    arrange();
    render(<SavedSearches />);
    expect(screen.getAllByRole('link', { name: 'Open' })[0]).toHaveAttribute('href', '/search?q=summer%2Csale&match=any&account=acc-1');
    expect(screen.getAllByRole('button', { name: 'Run on Meta' })[1]).toBeDisabled();
  });
  it('runs a saved search on Meta and shows progress', async () => {
    arrange();
    dataState.responses['/collection-runs/run-1'] = makeRun({ status: 'running' });
    apiMock.post.mockResolvedValue({ run: makeRun(), reused: false });
    render(<SavedSearches />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Run on Meta' })[0]);
    expect(await screen.findByText('Collection started.')).toBeInTheDocument();
    expect(apiMock.post).toHaveBeenCalledWith('/saved-searches/ss-1/run');
  });
  it('says when a run was reused and surfaces run errors', async () => {
    arrange();
    apiMock.post.mockResolvedValueOnce({ run: makeRun(), reused: true }).mockRejectedValueOnce(new Error('No account'));
    render(<SavedSearches />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Run on Meta' })[0]);
    expect(await screen.findByText('This search is already running.')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Run on Meta' })[0]);
    expect(await screen.findByText('No account')).toBeInTheDocument();
  });
  it('creates, edits and deletes', async () => {
    arrange();
    apiMock.post.mockResolvedValue({});
    apiMock.patch.mockResolvedValue({});
    apiMock.remove.mockResolvedValue(undefined);
    vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    render(<SavedSearches />);
    fireEvent.click(screen.getByRole('button', { name: 'New saved search' }));
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Brand new' } });
    const keywordInput = screen.getByPlaceholderText(/Type a keyword/);
    fireEvent.change(keywordInput, { target: { value: 'shoes' } });
    fireEvent.keyDown(keywordInput, { key: 'Enter' });
    fireEvent.change(screen.getByLabelText(/Ad account/), { target: { value: 'acc-1' } });
    fireEvent.change(screen.getByLabelText('Match'), { target: { value: 'all' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith('/saved-searches', { name: 'Brand new', tags: ['shoes'], match_mode: 'all', ad_account_id: 'acc-1' }));

    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    expect(screen.getByText('Edit saved search')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith('/saved-searches/ss-1', expect.objectContaining({ name: 'Summer set' })));

    fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0]);
    expect(apiMock.remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0]);
    await waitFor(() => expect(apiMock.remove).toHaveBeenCalledWith('/saved-searches/ss-1'));
  });
  it('cancels the form, reports save errors and shows the empty state', async () => {
    dataState.responses['/saved-searches'] = [];
    dataState.responses['/ad-accounts'] = [];
    apiMock.post.mockRejectedValue(new Error('Cannot save'));
    render(<SavedSearches />);
    expect(screen.getByText('No saved searches')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'New saved search' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'X' } });
    const keywordInput = screen.getByPlaceholderText(/Type a keyword/);
    fireEvent.change(keywordInput, { target: { value: 'tag' } });
    fireEvent.keyDown(keywordInput, { key: 'Enter' });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Cannot save')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText('New saved search', { selector: 'h2' })).toBeNull();
  });
});

describe('Scheduler', () => {
  const arrange = (schedules = [makeSchedule()]) => {
    dataState.responses['/schedules'] = schedules;
    dataState.responses['/ad-accounts'] = [makeAccount()];
  };

  it('shows schedule details, status badges and next run', () => {
    arrange([makeSchedule({ consecutive_failures: 2, last_status: 'failed', end_at: '2026-12-31T00:00:00Z' })]);
    render(<Scheduler />);
    expect(screen.getByText('Daily summer')).toBeInTheDocument();
    expect(screen.getByText('enabled')).toBeInTheDocument();
    expect(screen.getByText('last: failed')).toBeInTheDocument();
    expect(screen.getByText('2 failures')).toBeInTheDocument();
    expect(screen.getByText(/Every day · UTC · Main account/)).toBeInTheDocument();
    expect(screen.getByText(/Ends/)).toBeInTheDocument();
  });
  it('shows paused schedules without a next run, and the empty state', () => {
    arrange([makeSchedule({ enabled: false, last_status: null })]);
    const { unmount } = render(<Scheduler />);
    expect(screen.getByText('paused')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument();
    unmount();
    arrange([]);
    render(<Scheduler />);
    expect(screen.getByText('No schedules yet')).toBeInTheDocument();
  });
  it('runs now, pauses/resumes and deletes with confirmation', async () => {
    arrange();
    apiMock.post.mockResolvedValue({ started: true });
    apiMock.patch.mockResolvedValue({});
    apiMock.remove.mockResolvedValue(undefined);
    vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    render(<Scheduler />);
    fireEvent.click(screen.getByRole('button', { name: 'Run now' }));
    expect(await screen.findByText('Execution started.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith('/schedules/s1', { enabled: false }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(apiMock.remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(apiMock.remove).toHaveBeenCalledWith('/schedules/s1'));
  });
  it('shows execution history on demand', () => {
    arrange();
    dataState.responses['/schedules/s1/executions'] = [{ id: 'e1', scheduled_for: '2026-03-02T00:00:00Z', status: 'failed', attempt: 2, finished_at: null, error: 'Token expired' }];
    render(<Scheduler />);
    fireEvent.click(screen.getByRole('button', { name: 'History' }));
    expect(screen.getByText('Token expired')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'History' }));
    expect(screen.queryByText('Token expired')).toBeNull();
  });
  it('says when there are no executions', () => {
    arrange();
    dataState.responses['/schedules/s1/executions'] = [];
    render(<Scheduler />);
    fireEvent.click(screen.getByRole('button', { name: 'History' }));
    expect(screen.getByText('No executions yet.')).toBeInTheDocument();
  });
  it('creates a schedule from the form (times converted from the schedule timezone to UTC)', async () => {
    arrange([]);
    apiMock.post.mockResolvedValue({});
    render(<Scheduler />);
    fireEvent.click(screen.getByRole('button', { name: 'New schedule' }));
    expect(screen.getByRole('button', { name: 'Save schedule' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Search name'), { target: { value: 'Quarterly' } });
    const keywordInput = screen.getByPlaceholderText(/Type a keyword/);
    fireEvent.change(keywordInput, { target: { value: 'summer' } });
    fireEvent.keyDown(keywordInput, { key: 'Enter' });
    const [valueInput] = screen.getAllByRole('spinbutton');
    fireEvent.change(valueInput, { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('Interval unit'), { target: { value: 'month' } });
    fireEvent.change(screen.getByLabelText('Timezone'), { target: { value: 'Europe/Berlin' } });
    fireEvent.change(screen.getByLabelText('Start (in schedule timezone)'), { target: { value: '2026-07-15T09:00' } });
    fireEvent.change(screen.getByLabelText('End (optional)'), { target: { value: '2026-12-31T09:00' } });
    fireEvent.change(screen.getByLabelText(/Data lookback/), { target: { value: '14' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save schedule' }));
    await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith('/schedules', expect.objectContaining({
      name: 'Quarterly', keywords: ['summer'], ad_account_id: 'acc-1', interval_unit: 'month', interval_value: 3, timezone: 'Europe/Berlin',
      lookback_days: 14, start_at: '2026-07-15T07:00:00.000Z', end_at: '2026-12-31T08:00:00.000Z',
    })));
  });
  it('edits an existing schedule (account is locked) and reports save errors', async () => {
    arrange();
    apiMock.patch.mockRejectedValue(new Error('Invalid timezone'));
    render(<Scheduler />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByText('Edit schedule')).toBeInTheDocument();
    expect(screen.getByLabelText('Ad account')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Save schedule' }));
    expect(await screen.findByText('Invalid timezone')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText('Edit schedule')).toBeNull();
  });
});

describe('Connections', () => {
  const arrange = (overrides: { oauth?: boolean } = {}) => {
    dataState.responses['/meta/status'] = { oauthConfigured: overrides.oauth ?? false, adLibraryEnabled: false, graphVersion: 'v24.0' };
    dataState.responses['/meta/connections'] = [makeConnection({ status: 'expired', last_error: 'Session has expired' })];
    dataState.responses['/tiktok/connections'] = [];
    dataState.responses['/ad-accounts'] = [makeAccount({ business_name: 'Biz' })];
  };

  it('shows connections, permissions and errors, plus ad accounts', () => {
    arrange();
    render(<Connections />);
    expect(screen.getByText('My connection')).toBeInTheDocument();
    expect(screen.getByText('expired')).toBeInTheDocument();
    expect(screen.getByText('Session has expired')).toBeInTheDocument();
    expect(screen.getByText(/Permissions: ads_read/)).toBeInTheDocument();
    expect(screen.getByText(/act_1 · USD · UTC · Biz/)).toBeInTheDocument();
    expect(screen.getByText(/Optional and disabled/)).toBeInTheDocument();
  });
  it('explains OAuth is not configured, or offers it when configured', () => {
    arrange();
    const { unmount } = render(<Connections />);
    expect(screen.getByText(/OAuth is not configured/)).toBeInTheDocument();
    unmount();
    arrange({ oauth: true });
    render(<Connections />);
    expect(screen.getByRole('button', { name: 'Connect Meta account' })).toBeInTheDocument();
  });
  it('connects with a pasted token only when it is long enough, then clears the field', async () => {
    arrange();
    apiMock.post.mockResolvedValue({});
    render(<Connections />);
    const button = screen.getByRole('button', { name: 'Verify & connect' });
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Access token/), { target: { value: 'EAA'.padEnd(30, 'x') } });
    fireEvent.change(screen.getAllByLabelText(/Label/)[0], { target: { value: 'Work' } });
    fireEvent.click(button);
    expect(await screen.findByText('Token verified and stored securely.')).toBeInTheDocument();
    expect(apiMock.post).toHaveBeenCalledWith('/meta/connections', { token: 'EAA'.padEnd(30, 'x'), name: 'Work' });
    expect(screen.getByLabelText(/Access token/)).toHaveValue('');
  });
  it('shows Meta rejection errors', async () => {
    arrange();
    apiMock.post.mockRejectedValue(new Error('Meta rejected the token'));
    render(<Connections />);
    fireEvent.change(screen.getByLabelText(/Access token/), { target: { value: 'EAA'.padEnd(30, 'x') } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify & connect' }));
    expect(await screen.findByText('Meta rejected the token')).toBeInTheDocument();
  });
  it('syncs, disconnects (with confirmation) and toggles ad accounts', async () => {
    arrange();
    apiMock.post.mockResolvedValue({ synced: 2 });
    apiMock.remove.mockResolvedValue(undefined);
    apiMock.patch.mockResolvedValue({});
    vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    render(<Connections />);
    fireEvent.click(screen.getByRole('button', { name: 'Sync accounts' }));
    expect(await screen.findByText('Synced 2 ad accounts.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    expect(apiMock.remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    await waitFor(() => expect(apiMock.remove).toHaveBeenCalledWith('/meta/connections/conn-1'));
    fireEvent.click(screen.getByRole('checkbox'));
    await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith('/ad-accounts/acc-1', { selected: false }));
  });
  it('connects TikTok with a token and advertiser ids, then clears the form', async () => {
    arrange();
    apiMock.post.mockResolvedValue({});
    render(<Connections />);
    const button = screen.getByRole('button', { name: 'Verify & connect TikTok' });
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Marketing API access token'), { target: { value: 'tt'.padEnd(30, 'x') } });
    expect(button).toBeDisabled(); // still needs an advertiser id
    fireEvent.change(screen.getByLabelText(/Advertiser IDs/), { target: { value: '7001234567, nope, 7001234568' } });
    fireEvent.change(screen.getAllByLabelText(/Label/)[1], { target: { value: 'TikTok shop' } });
    fireEvent.click(button);
    expect(await screen.findByText('TikTok token verified and stored securely.')).toBeInTheDocument();
    expect(apiMock.post).toHaveBeenCalledWith('/tiktok/connections', { token: 'tt'.padEnd(30, 'x'), advertiser_ids: ['7001234567', '7001234568'], name: 'TikTok shop' });
    expect(screen.getByLabelText('Marketing API access token')).toHaveValue('');
    expect(screen.getByLabelText(/Advertiser IDs/)).toHaveValue('');
  });
  it('lists TikTok connections and accounts with their platform and uses the TikTok API to sync and disconnect', async () => {
    arrange();
    dataState.responses['/meta/connections'] = [];
    dataState.responses['/tiktok/connections'] = [makeConnection({ id: 'tt-conn', name: 'Shoe Shop TikTok' })];
    dataState.responses['/ad-accounts'] = [makeAccount({ id: 'tt-acc', platform: 'tiktok', meta_account_id: 'tiktok:7001', name: null })];
    apiMock.post.mockResolvedValue({ synced: 1 });
    apiMock.remove.mockResolvedValue(undefined);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<Connections />);
    expect(screen.getByText('Shoe Shop TikTok')).toBeInTheDocument();
    expect(screen.getAllByText('TikTok').length).toBeGreaterThanOrEqual(2); // connection + account badges
    expect(screen.queryByText(/Permissions:/)).toBeNull();
    expect(screen.getByText(/^7001 · USD/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sync accounts' }));
    await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith('/tiktok/connections/tt-conn/sync'));
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    await waitFor(() => expect(apiMock.remove).toHaveBeenCalledWith('/tiktok/connections/tt-conn'));
  });
  it('shows OAuth round-trip results from the URL', () => {
    arrange();
    navigationMock.searchParameters = new URLSearchParams('connected=1');
    const { unmount } = render(<Connections />);
    expect(screen.getByText('Meta account connected.')).toBeInTheDocument();
    unmount();
    navigationMock.searchParameters = new URLSearchParams('error=access_denied');
    render(<Connections />);
    expect(screen.getByText('access_denied')).toBeInTheDocument();
  });
  it('starts the OAuth flow', async () => {
    arrange({ oauth: true });
    apiMock.get.mockResolvedValue({ url: 'about:blank' });
    render(<Connections />);
    fireEvent.click(screen.getByRole('button', { name: 'Connect Meta account' }));
    await waitFor(() => expect(apiMock.get).toHaveBeenCalledWith('/meta/oauth/url'));
  });
  it('shows empty states and the enabled Ad Library note', () => {
    dataState.responses['/meta/status'] = { oauthConfigured: false, adLibraryEnabled: true, graphVersion: 'v24.0' };
    dataState.responses['/meta/connections'] = [];
    dataState.responses['/tiktok/connections'] = [];
    dataState.responses['/ad-accounts'] = [];
    render(<Connections />);
    expect(screen.getByText('No connections')).toBeInTheDocument();
    expect(screen.getByText('No ad accounts')).toBeInTheDocument();
    expect(screen.getByText(/Ad Library access is enabled/)).toBeInTheDocument();
  });
});

describe('Settings', () => {
  const arrange = () => {
    dataState.responses['/users/me'] = { id: 'u1', email: 'me@example.test', display_name: 'Me', timezone: 'Europe/Berlin' };
    dataState.responses['/notifications'] = [{ id: 'n1', type: 'x', title: 'Schedule failed', body: 'Meta said no', created_at: '2026-03-01T10:00:00Z' }];
  };

  it('shows the profile and notifications', async () => {
    arrange();
    render(<Settings />);
    await waitFor(() => expect(screen.getByLabelText('Display name')).toHaveValue('Me'));
    expect(screen.getByLabelText('Email')).toBeDisabled();
    expect(screen.getByText('Schedule failed')).toBeInTheDocument();
  });
  it('saves the profile', async () => {
    arrange();
    apiMock.patch.mockResolvedValue({});
    render(<Settings />);
    await waitFor(() => expect(screen.getByLabelText('Display name')).toHaveValue('Me'));
    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'New name' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Profile saved.')).toBeInTheDocument();
    expect(apiMock.patch).toHaveBeenCalledWith('/users/me', { display_name: 'New name', timezone: 'Europe/Berlin' });
  });
  it('reports profile errors', async () => {
    arrange();
    apiMock.patch.mockRejectedValue(new Error('Unknown IANA timezone'));
    render(<Settings />);
    await waitFor(() => expect(screen.getByLabelText('Display name')).toHaveValue('Me'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Unknown IANA timezone')).toBeInTheDocument();
  });
  it('changes the password only when long enough and reports failures', async () => {
    arrange();
    supabaseMock.auth.updateUser.mockResolvedValueOnce({ error: null }).mockResolvedValueOnce({ error: new Error('Too weak') });
    render(<Settings />);
    await waitFor(() => expect(screen.getByLabelText('Display name')).toHaveValue('Me'));
    const button = screen.getByRole('button', { name: 'Update password' });
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'long-enough-1' } });
    fireEvent.click(button);
    expect(await screen.findByText('Password updated.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'long-enough-2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update password' }));
    expect(await screen.findByText('Too weak')).toBeInTheDocument();
  });
  it('shows a spinner while loading, an empty notifications note and signs out', async () => {
    const { unmount } = render(<Settings />);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    unmount();
    dataState.responses['/users/me'] = { id: 'u1', email: null, display_name: null, timezone: 'UTC' };
    dataState.responses['/notifications'] = [];
    supabaseMock.auth.signOut.mockResolvedValue({});
    render(<Settings />);
    expect(await screen.findByText(/Nothing yet/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(supabaseMock.auth.signOut).toHaveBeenCalled());
  });
});

describe('Ad dashboard page', () => {
  const arrange = (analytics = makeAnalytics()) => {
    dataState.responses['/ads/ad-1/analytics'] = analytics;
    dataState.responses['/ads/ad-1/raw'] = { ad: { id: 'meta-1' } };
    dataState.responses['/ads/ad-1'] = makeAdDetail();
  };

  it('shows the ad, its analytics and the creative information', () => {
    arrange();
    render(<AdDashboard />);
    expect(screen.getByRole('heading', { name: 'Summer Sale' })).toBeInTheDocument();
    expect(screen.getByText('General performance')).toBeInTheDocument();
    expect(screen.getByText('Campaign & ad set')).toBeInTheDocument();
    expect(screen.getByText('Creative variations')).toBeInTheDocument();
  });
  it('shows loading and load errors', () => {
    const { unmount } = render(<AdDashboard />);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    unmount();
    dataState.errors['/ads/ad-1'] = new Error('Ad not found');
    render(<AdDashboard />);
    expect(screen.getByText('Ad not found')).toBeInTheDocument();
  });
  it('shows analytics errors without hiding the ad', () => {
    dataState.responses['/ads/ad-1'] = makeAdDetail();
    dataState.errors['/ads/ad-1/analytics'] = new Error('Analytics failed');
    render(<AdDashboard />);
    expect(screen.getByText('Analytics failed')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Summer Sale' })).toBeInTheDocument();
  });
  it('switches the date range with presets and inputs', () => {
    arrange();
    render(<AdDashboard />);
    fireEvent.click(screen.getByRole('button', { name: '7d' }));
    fireEvent.change(screen.getByLabelText('To date'), { target: { value: '2026-03-05' } });
    fireEvent.click(screen.getByRole('button', { name: 'All collected' }));
    expect(screen.getByLabelText('From date')).toHaveValue('');
  });
  it('queues an insights refresh and shows the raw JSON on demand', async () => {
    arrange();
    apiMock.post.mockResolvedValue({});
    render(<AdDashboard />);
    fireEvent.click(screen.getByRole('button', { name: /Refresh insights/ }));
    expect(await screen.findByText(/Insights refresh queued/)).toBeInTheDocument();
    expect(apiMock.post).toHaveBeenCalledWith('/insights/refresh', expect.objectContaining({ ad_ids: ['ad-1'], date_from: '2026-03-01' }));
    fireEvent.click(screen.getByRole('button', { name: 'Show JSON' }));
    expect(screen.getByText(/"id": "meta-1"/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Hide JSON' }));
    expect(screen.queryByText(/"id": "meta-1"/)).toBeNull();
  });
  it('reports a failed refresh', async () => {
    arrange();
    apiMock.post.mockRejectedValue(new Error('Refresh failed'));
    render(<AdDashboard />);
    fireEvent.click(screen.getByRole('button', { name: /Refresh insights/ }));
    expect(await screen.findByText('Refresh failed')).toBeInTheDocument();
  });
  it('treats a video ad as video even without view counts, and lists asset breakdowns for dynamic ads', () => {
    arrange(makeAnalytics({ breakdowns: { image_asset: { date_start: 'a', date_stop: 'b', rows: [{ dim_key: 'h1', spend: 5 }] } } }));
    dataState.responses['/ads/ad-1'] = makeAdDetail({ format: 'video' });
    render(<AdDashboard />);
    expect(screen.getByText('Video analytics')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Performance by image asset' })).toBeInTheDocument();
  });
});

describe('search and library pages', () => {
  it('render their headers and the browser', () => {
    dataState.responses['/ad-accounts'] = [makeAccount()];
    dataState.responses['/ads'] = { items: [makeAd()], total: 1, page: 1, page_size: 24 };
    const { unmount } = render(<SearchPage />);
    expect(screen.getByRole('heading', { name: 'Ad Search' })).toBeInTheDocument();
    expect(screen.getByText('Summer Sale')).toBeInTheDocument();
    unmount();
    render(<LibraryPage />);
    expect(screen.getByRole('heading', { name: 'Ad Library' })).toBeInTheDocument();
  });
});

describe('layouts and home', () => {
  it('AppLayout wraps pages in the authenticated shell', async () => {
    render(<AppLayout><p>Inside</p></AppLayout>);
    expect(await screen.findByText('Inside')).toBeInTheDocument();
    expect(within(screen.getAllByRole('navigation')[0]).getByText('Dashboard')).toBeInTheDocument();
  });
  it('Home redirects to the dashboard', async () => {
    const { redirect } = await import('next/navigation');
    Home();
    expect(redirect).toHaveBeenCalledWith('/dashboard');
  });
  it('RootLayout provides the runtime config, or explains missing configuration', () => {
    const original = { ...process.env };
    process.env.SUPABASE_URL = 'http://supabase.test';
    process.env.SUPABASE_ANON_KEY = 'anon';
    const configured = RootLayout({ children: <p>child</p> });
    expect(configured.type).toBe('html');
    process.env = { ...original };
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_ANON_KEY;
    const unconfigured = RootLayout({ children: <p>child</p> });
    const { container } = render(<div>{unconfigured.props.children.props.children}</div>);
    expect(container).toHaveTextContent('Missing configuration');
    expect(container).toHaveTextContent('SUPABASE_URL');
    process.env = original;
  });
});
