import type { CollectionRun } from './types';

/** Whole seconds a run took, or `null` while it has not both started and finished. */
export function runDurationSeconds(run: Pick<CollectionRun, 'started_at' | 'finished_at'>): number | null {
  if (!run.started_at || !run.finished_at) return null;
  return Math.round((Date.parse(run.finished_at) - Date.parse(run.started_at)) / 1000);
}

/** A run has details worth expanding when it failed or recorded non-fatal errors. */
export const hasRunDetails = (run: Pick<CollectionRun, 'error' | 'errors'>): boolean => Boolean(run.error) || (run.errors?.length ?? 0) > 0;

/** "12 found · 3 new" for a run's counters, or a dash when none were recorded. */
export function summarizeRunCounters(counters: CollectionRun['counters']): string {
  return counters?.ads_found === undefined ? '—' : `${counters.ads_found} found · ${counters.ads_new ?? 0} new`;
}
