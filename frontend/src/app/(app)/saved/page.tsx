'use client';
import Link from 'next/link';
import { useState } from 'react';
import { RunProgress } from '@/components/run-progress';
import { TagInput } from '@/components/tag-input';
import { Badge, Button, Card, Empty, ErrorBox, Field, Notice, PageHeader, Spinner } from '@/components/ui';
import { useApi, useData } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { savedSearchHref } from '@/lib/saved-searches';
import type { AdAccount, SavedSearch, StartCollectionResponse } from '@/lib/types';

interface SavedSearchForm {
  id?: string;
  name: string;
  tags: string[];
  accountId: string;
  matchMode: 'any' | 'all';
}

export default function SavedSearches() {
  const api = useApi();
  const { data: searches, error, mutate } = useData<SavedSearch[]>('/saved-searches');
  const { data: accounts } = useData<AdAccount[]>('/ad-accounts');
  const [form, setForm] = useState<SavedSearchForm | null>(null);
  const [actionError, setActionError] = useState<unknown>();
  const [runId, setRunId] = useState<string>();
  const [message, setMessage] = useState<string>();

  async function save() {
    if (!form) return;
    setActionError(undefined);
    try {
      const body = { name: form.name, tags: form.tags, match_mode: form.matchMode, ad_account_id: form.accountId || undefined };
      if (form.id) await api.patch(`/saved-searches/${form.id}`, body);
      else await api.post('/saved-searches', body);
      setForm(null);
      await mutate();
    } catch (caught) {
      setActionError(caught);
    }
  }

  async function runOnMeta(searchId: string) {
    setActionError(undefined);
    setMessage(undefined);
    try {
      const started = await api.post<StartCollectionResponse>(`/saved-searches/${searchId}/run`);
      setRunId(started.run.id);
      setMessage(started.reused ? 'This search is already running.' : 'Collection started.');
      await mutate();
    } catch (caught) {
      setActionError(caught);
    }
  }

  return (
    <>
      <PageHeader
        title="Saved Searches"
        subtitle="Keyword sets you want to re-run quickly."
        actions={<Button onClick={() => setForm({ name: '', tags: [], accountId: '', matchMode: 'any' })}>New saved search</Button>}
      />
      <div className="space-y-4">
        <ErrorBox error={actionError ?? error} />
        {message && <Notice tone="green">{message}</Notice>}
        {runId && <RunProgress runId={runId} />}

        {form && (
          <Card title={form.id ? 'Edit saved search' : 'New saved search'}>
            <div className="space-y-4">
              <Field label="Name"><input className="input" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></Field>
              <Field label="Keywords"><TagInput tags={form.tags} onChange={(tags) => setForm({ ...form, tags })} /></Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Ad account (used when running)">
                  <select className="input" value={form.accountId} onChange={(event) => setForm({ ...form, accountId: event.target.value })}>
                    <option value="">None</option>
                    {accounts?.map((account) => <option key={account.id} value={account.id}>{account.name ?? account.meta_account_id}</option>)}
                  </select>
                </Field>
                <Field label="Match">
                  <select className="input" value={form.matchMode} onChange={(event) => setForm({ ...form, matchMode: event.target.value as 'any' | 'all' })}>
                    <option value="any">Any keyword</option><option value="all">All keywords</option>
                  </select>
                </Field>
              </div>
              <div className="flex gap-2">
                <Button onClick={save} disabled={!form.name.trim() || form.tags.length === 0}>Save</Button>
                <Button variant="secondary" onClick={() => setForm(null)}>Cancel</Button>
              </div>
            </div>
          </Card>
        )}

        {!searches ? <Spinner /> : (searches.length === 0 ? (
          <Empty title="No saved searches" hint="Save a search from the Ad Search page, or create one here." />
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {searches.map((search) => (
              <Card key={search.id}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{search.name}</p>
                    <p className="mt-1 text-xs text-slate-500">Last run: {formatDateTime(search.last_run_at)}</p>
                  </div>
                  <Badge>{search.match_mode}</Badge>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">{search.tags.map((tag) => <Badge key={tag} tone="blue">{tag}</Badge>)}</div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Link href={savedSearchHref(search)}><Button variant="secondary">Open</Button></Link>
                  <Button onClick={() => runOnMeta(search.id)} disabled={!search.ad_account_id} title={search.ad_account_id ? undefined : 'Choose an ad account first'}>Run on Meta</Button>
                  <Button
                    variant="ghost"
                    onClick={() => setForm({ id: search.id, name: search.name, tags: search.tags, accountId: search.ad_account_id ?? '', matchMode: search.match_mode })}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={async () => {
                      if (!confirm(`Delete “${search.name}”?`)) return;
                      await api.remove(`/saved-searches/${search.id}`);
                      await mutate();
                    }}
                  >
                    Delete
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}
