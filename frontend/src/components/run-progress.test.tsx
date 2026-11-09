import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { makeRun } from '@/testing/factories';
import { dataState } from '@/testing/mocks';
import { isRunActive, RunProgress, runPollInterval } from './run-progress';

describe('isRunActive', () => {
  it.each([['queued', true], ['running', true], ['succeeded', false], ['failed', false], ['partial', false], [undefined, false]])('%s -> %s', (status, expected) => {
    expect(isRunActive(status)).toBe(expected);
  });
});

describe('runPollInterval', () => {
  it('polls every 2s until the run is terminal', () => {
    expect(runPollInterval(undefined)).toBe(2000);
    expect(runPollInterval({ status: 'running' })).toBe(2000);
    expect(runPollInterval({ status: 'queued' })).toBe(2000);
    expect(runPollInterval({ status: 'succeeded' })).toBe(0);
    expect(runPollInterval({ status: 'failed' })).toBe(0);
  });
});

describe('RunProgress', () => {
  it('renders status, stage, progress and counters', () => {
    dataState.responses['/collection-runs/run-1'] = makeRun({ status: 'running', stage: 'ads_saved', progress: 30, counters: { ads_found: 5, ads_new: 2, ads_updated: 3, media_queued: 4 } });
    render(<RunProgress runId="run-1" />);
    expect(screen.getByText('running')).toBeInTheDocument();
    expect(screen.getByText('ads saved')).toBeInTheDocument();
    expect(screen.getByText('30%')).toBeInTheDocument();
    expect(screen.getByText(/5 ads found · 2 new · 3 updated · 4 media downloads queued/)).toBeInTheDocument();
  });
  it('shows the error and non-fatal errors', () => {
    dataState.responses['/collection-runs/run-1'] = makeRun({ status: 'failed', error: 'Meta said no', errors: [{ message: 'breakdown device failed' }] });
    render(<RunProgress runId="run-1" />);
    expect(screen.getByText('Meta said no')).toBeInTheDocument();
    expect(screen.getByText('breakdown device failed')).toBeInTheDocument();
  });
  it('omits counters until they exist', () => {
    dataState.responses['/collection-runs/run-1'] = makeRun({ status: 'queued', counters: {}, progress: 0 });
    render(<RunProgress runId="run-1" />);
    expect(screen.queryByText(/ads found/)).toBeNull();
  });
  it('renders nothing while loading and shows load errors', () => {
    const { container, rerender } = render(<RunProgress runId="missing" />);
    expect(container).toBeEmptyDOMElement();
    dataState.errors['/collection-runs/broken'] = new Error('Run not found');
    rerender(<RunProgress runId="broken" />);
    expect(screen.getByText('Run not found')).toBeInTheDocument();
  });
  it('notifies the parent when the run changes', () => {
    dataState.responses['/collection-runs/run-1'] = makeRun();
    const onUpdate = vi.fn();
    render(<RunProgress runId="run-1" onUpdate={onUpdate} />);
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ id: 'run-1', status: 'succeeded' }));
  });
});
