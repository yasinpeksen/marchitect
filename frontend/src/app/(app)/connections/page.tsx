'use client';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Badge, Button, Card, Empty, ErrorBox, Field, Notice, PageHeader, Spinner, statusTone } from '@/components/ui';
import { useApi, useData } from '@/lib/api';
import { describePermissions, readOAuthResult } from '@/lib/connections';
import { formatDateTime } from '@/lib/format';
import type { AdAccount, MetaConnection, MetaStatus } from '@/lib/types';

function Connections() {
  const api = useApi();
  const oauthResult = readOAuthResult(useSearchParams());
  const { data: status } = useData<MetaStatus>('/meta/status');
  const { data: connections, error, mutate } = useData<MetaConnection[]>('/meta/connections');
  const { data: accounts, mutate: reloadAccounts } = useData<AdAccount[]>('/ad-accounts');
  const [token, setToken] = useState('');
  const [label, setLabel] = useState('');
  const [busyKey, setBusyKey] = useState<string>();
  const [actionError, setActionError] = useState<unknown>(oauthResult.error ? new Error(oauthResult.error) : undefined);
  const [message, setMessage] = useState<string | undefined>(oauthResult.message);

  const perform = async (key: string, action: () => Promise<unknown>) => {
    setBusyKey(key);
    setActionError(undefined);
    setMessage(undefined);
    try {
      const result = await action();
      if (typeof result === 'string') setMessage(result);
      await mutate();
      await reloadAccounts();
    } catch (caught) {
      setActionError(caught);
    } finally {
      setBusyKey(undefined);
    }
  };

  return (
    <>
      <PageHeader title="Meta Connections" subtitle="Connect Meta so the app can read ads from ad accounts you are authorised for." />
      <div className="space-y-5">
        <ErrorBox error={actionError ?? error} />
        {message && <Notice tone="green">{message}</Notice>}
        <Notice>
          Required permission: <b>ads_read</b>. Recommended: <b>business_management</b> (lists ad accounts owned by your Business Manager).
          Tokens are encrypted on the server and never sent back to the browser.
        </Notice>

        <div className="grid gap-5 lg:grid-cols-2">
          <Card title="Connect with Facebook login">
            {status?.oauthConfigured ? (
              <Button
                loading={busyKey === 'oauth'}
                onClick={() => perform('oauth', async () => {
                  const { url } = await api.get<{ url: string }>('/meta/oauth/url');
                  window.location.href = url;
                })}
              >
                Connect Meta account
              </Button>
            ) : (
              <Notice tone="amber">OAuth is not configured. Set <code>META_APP_ID</code> and <code>META_APP_SECRET</code> on the backend, or paste an access token instead.</Notice>
            )}
          </Card>
          <Card title="Connect with an access token">
            <div className="space-y-3">
              <Field label="Access token (user or system user)">
                <input className="input font-mono" type="password" autoComplete="off" value={token} onChange={(event) => setToken(event.target.value)} placeholder="EAAB…" />
              </Field>
              <Field label="Label (optional)"><input className="input" value={label} onChange={(event) => setLabel(event.target.value)} /></Field>
              <Button
                loading={busyKey === 'token'}
                disabled={token.trim().length < 20}
                onClick={() => perform('token', async () => {
                  await api.post('/meta/connections', { token: token.trim(), name: label || undefined });
                  setToken('');
                  setLabel('');
                  return 'Token verified and stored securely.';
                })}
              >
                Verify & connect
              </Button>
            </div>
          </Card>
        </div>

        <Card title="Connections">
          {!connections ? <Spinner /> : (connections.length === 0 ? <Empty title="No Meta connections" /> : (
            <ul className="divide-y divide-slate-100">
              {connections.map((connection) => (
                <li key={connection.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="font-medium">{connection.name ?? connection.meta_user_id} <Badge tone={statusTone(connection.status)}>{connection.status}</Badge></p>
                    <p className="mt-1 text-xs text-slate-500">
                      Permissions: {describePermissions(connection)} · Expires: {connection.token_expires_at ? formatDateTime(connection.token_expires_at) : 'unknown'} · Validated {formatDateTime(connection.last_validated_at)}
                    </p>
                    {connection.last_error && <p className="mt-1 text-xs text-red-600">{connection.last_error}</p>}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      loading={busyKey === connection.id}
                      onClick={() => perform(connection.id, async () => {
                        const synced = await api.post<{ synced: number }>(`/meta/connections/${connection.id}/sync`);
                        return `Synced ${synced.synced} ad accounts.`;
                      })}
                    >
                      Sync accounts
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => confirm('Disconnect this Meta account? Collected data is kept.') && perform(connection.id, () => api.remove(`/meta/connections/${connection.id}`))}
                    >
                      Disconnect
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          ))}
        </Card>

        <Card title="Ad accounts">
          {!accounts || accounts.length === 0 ? <Empty title="No ad accounts" hint="Connect Meta and sync to list your ad accounts." /> : (
            <ul className="divide-y divide-slate-100">
              {accounts.map((account) => (
                <li key={account.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div>
                    <p className="text-sm font-medium">{account.name ?? account.meta_account_id}</p>
                    <p className="text-xs text-slate-500">{account.meta_account_id} · {account.currency} · {account.timezone_name}{account.business_name ? ` · ${account.business_name}` : ''}</p>
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={account.selected}
                      onChange={(event) => perform(account.id, async () => { await api.patch(`/ad-accounts/${account.id}`, { selected: event.target.checked }); })}
                    />
                    Use for collection
                  </label>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Competitor research (Meta Ad Library)">
          <p className="text-sm text-slate-600">
            {status?.adLibraryEnabled
              ? 'Ad Library access is enabled on the server (GET /api/v1/meta/ad-library/search). Availability depends on Meta’s identity verification and eligibility; competitor ads do not expose account-level performance metrics.'
              : 'Optional and disabled. Set META_AD_LIBRARY_ENABLED=true on the backend to enable the separate Ad Library integration. It is subject to Meta’s eligibility rules and exposes no competitor performance metrics.'}
          </p>
        </Card>
      </div>
    </>
  );
}

export default function Page() {
  return <Suspense fallback={<Spinner />}><Connections /></Suspense>;
}
