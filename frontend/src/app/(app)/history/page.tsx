'use client';
import Link from 'next/link';
import { Fragment, useState } from 'react';
import { Badge, Card, Empty, ErrorBox, PageHeader, Pagination, Spinner, statusTone } from '@/components/ui';
import { buildQueryString, useData } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { hasRunDetails, runDurationSeconds, summarizeRunCounters } from '@/lib/runs';
import type { RunsPage } from '@/lib/types';

const STATUS_OPTIONS = ['queued', 'running', 'succeeded', 'partial', 'failed'];

export default function History() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [openRunId, setOpenRunId] = useState<string>();
  const { data, error } = useData<RunsPage>(`/collection-runs${buildQueryString({ page, page_size: 20, status })}`, { refreshInterval: 5000, keepPreviousData: true });

  return (
    <>
      <PageHeader
        title="Collection History"
        subtitle="Every manual and scheduled collection, with progress and errors."
        actions={
          <select className="input w-40" aria-label="Filter by status" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}>
            <option value="">All statuses</option>
            {STATUS_OPTIONS.map((option) => <option key={option}>{option}</option>)}
          </select>
        }
      />
      <ErrorBox error={error} />
      {!data ? <Spinner /> : (data.items.length === 0 ? <Empty title="No collections yet" /> : (
        <Card className="overflow-hidden !p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr><th className="px-4 py-2.5">Started</th><th>Source</th><th>Keywords</th><th>Status</th><th>Ads</th><th>Duration</th><th /></tr>
              </thead>
              <tbody>
                {data.items.map((run) => {
                  const durationSeconds = runDurationSeconds(run);
                  return (
                    <Fragment key={run.id}>
                      <tr className="border-t border-slate-100 align-top">
                        <td className="whitespace-nowrap px-4 py-3">{formatDateTime(run.created_at)}</td>
                        <td>{run.trigger === 'schedule' ? <Badge tone="purple">{run.schedules?.name ?? 'schedule'}</Badge> : <Badge>manual</Badge>}</td>
                        <td className="max-w-xs">
                          <div className="flex flex-wrap gap-1">
                            {run.keywords.length > 0 ? run.keywords.map((keyword) => <Badge key={keyword} tone="blue">{keyword}</Badge>) : <span className="text-xs text-slate-400">insights refresh</span>}
                          </div>
                        </td>
                        <td>
                          <Badge tone={statusTone(run.status)}>{run.status}</Badge>
                          {(run.status === 'running' || run.status === 'queued') && <span className="ml-2 text-xs text-slate-500">{run.progress}%</span>}
                        </td>
                        <td className="whitespace-nowrap text-xs text-slate-600">{summarizeRunCounters(run.counters)}</td>
                        <td className="text-xs text-slate-600">{durationSeconds === null ? '—' : `${durationSeconds}s`}</td>
                        <td className="pr-4 text-right">
                          {hasRunDetails(run) && (
                            <button className="text-xs text-brand-600" onClick={() => setOpenRunId(openRunId === run.id ? undefined : run.id)}>
                              {openRunId === run.id ? 'Hide' : 'Details'}
                            </button>
                          )}
                          {run.status === 'succeeded' && run.keywords.length > 0 && (
                            <Link className="ml-3 text-xs text-brand-600" href={`/search?q=${encodeURIComponent(run.keywords.join(','))}`}>View ads</Link>
                          )}
                        </td>
                      </tr>
                      {openRunId === run.id && (
                        <tr className="bg-slate-50">
                          <td colSpan={7} className="px-4 py-3 text-xs">
                            {run.error && <p className="text-red-600">{run.error}</p>}
                            <ul className="list-disc pl-5 text-amber-800">{run.errors.map((entry, position) => <li key={position}>{entry.message}</li>)}</ul>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      ))}
      <Pagination page={page} pageSize={20} total={data?.total ?? 0} onChange={setPage} />
    </>
  );
}
