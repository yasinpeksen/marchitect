'use client';
import { useEffect } from 'react';
import { useData } from '@/lib/api';
import type { CollectionRun } from '@/lib/types';
import { Badge, statusTone } from './ui';

export const isRunActive = (status?: string): boolean => status === 'queued' || status === 'running';

/** SWR refresh interval: poll every 2s until the run reaches a terminal status. */
export const runPollInterval = (run?: Pick<CollectionRun, 'status'>): number => (!run || isRunActive(run.status) ? 2000 : 0);

/** Live progress of a collection run (polls every 2s while active). */
export function RunProgress({ runId, onUpdate }: { runId: string; onUpdate?: (run: CollectionRun) => void }) {
  const { data: run, error } = useData<CollectionRun>(`/collection-runs/${runId}`, { refreshInterval: runPollInterval });
  useEffect(() => {
    if (run) onUpdate?.(run);
  }, [run?.status, run?.stage, run?.counters?.ads_found]); // eslint-disable-line react-hooks/exhaustive-deps
  if (error) return <p className="text-sm text-red-600">{(error as Error).message}</p>;
  if (!run) return null;
  const counters = run.counters ?? {};
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={statusTone(run.status)}>{run.status}</Badge>
        <span className="text-sm text-slate-600">{run.stage?.replaceAll('_', ' ')}</span>
        <span className="ml-auto text-xs text-slate-400">{run.progress}%</span>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full transition-all ${run.status === 'failed' ? 'bg-red-500' : 'bg-brand-600'}`} style={{ width: `${run.progress}%` }} />
      </div>
      {counters.ads_found !== undefined && (
        <p className="mt-3 text-sm text-slate-600">
          {counters.ads_found} ads found · {counters.ads_new ?? 0} new · {counters.ads_updated ?? 0} updated
          {counters.media_queued ? ` · ${counters.media_queued} media downloads queued` : ''}
        </p>
      )}
      {run.error && <p className="mt-3 text-sm text-red-600">{run.error}</p>}
      {run.errors?.length > 0 && (
        <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-amber-800">
          {run.errors.map((entry, position) => <li key={position}>{entry.message}</li>)}
        </ul>
      )}
    </div>
  );
}
