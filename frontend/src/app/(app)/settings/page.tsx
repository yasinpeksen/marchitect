'use client';
import { useEffect, useState } from 'react';
import { Button, Card, ErrorBox, Field, Notice, PageHeader, Spinner } from '@/components/ui';
import { useApi, useData } from '@/lib/api';
import { useSupabase } from '@/lib/config';
import { formatDateTime } from '@/lib/format';
import { listTimezones } from '@/lib/timezones';
import type { NotificationItem, Profile } from '@/lib/types';

const TIMEZONES = listTimezones();

export default function Settings() {
  const api = useApi();
  const supabase = useSupabase();
  const { data: profile, mutate } = useData<Profile>('/users/me');
  const { data: notifications } = useData<NotificationItem[]>('/notifications');
  const [displayName, setDisplayName] = useState('');
  const [timezone, setTimezone] = useState('UTC');
  const [newPassword, setNewPassword] = useState('');
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<unknown>();

  useEffect(() => {
    if (profile) {
      setDisplayName(profile.display_name ?? '');
      setTimezone(profile.timezone);
    }
  }, [profile]);
  if (!profile) return <Spinner />;

  const perform = async (action: () => Promise<unknown>, successMessage: string) => {
    setError(undefined);
    setMessage(undefined);
    try {
      await action();
      setMessage(successMessage);
    } catch (caught) {
      setError(caught);
    }
  };

  return (
    <>
      <PageHeader title="Settings" />
      <div className="max-w-2xl space-y-5">
        <ErrorBox error={error} />
        {message && <Notice tone="green">{message}</Notice>}
        <Card title="Profile">
          <div className="space-y-4">
            <Field label="Email"><input className="input" value={profile.email ?? ''} disabled /></Field>
            <Field label="Display name"><input className="input" value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></Field>
            <Field label="Default timezone">
              <select className="input" value={timezone} onChange={(event) => setTimezone(event.target.value)}>{TIMEZONES.map((zone) => <option key={zone}>{zone}</option>)}</select>
            </Field>
            <Button onClick={() => perform(async () => { await api.patch('/users/me', { display_name: displayName, timezone }); await mutate(); }, 'Profile saved.')}>Save</Button>
          </div>
        </Card>
        <Card title="Change password">
          <div className="space-y-4">
            <Field label="New password">
              <input className="input" type="password" minLength={8} autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
            </Field>
            <Button
              disabled={newPassword.length < 8}
              onClick={() => perform(async () => {
                const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
                if (updateError) throw updateError;
                setNewPassword('');
              }, 'Password updated.')}
            >
              Update password
            </Button>
          </div>
        </Card>
        <Card title="Recent notifications">
          {!notifications || notifications.length === 0 ? <p className="text-sm text-slate-500">Nothing yet. Failed scheduled collections show up here.</p> : (
            <ul className="divide-y divide-slate-100">
              {notifications.map((notification) => (
                <li key={notification.id} className="py-2.5">
                  <p className="text-sm font-medium">{notification.title}</p>
                  <p className="text-xs text-slate-600">{notification.body}</p>
                  <p className="text-[11px] text-slate-400">{formatDateTime(notification.created_at)}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Session">
          <Button variant="secondary" onClick={async () => { await supabase.auth.signOut(); location.href = '/login'; }}>Sign out</Button>
        </Card>
      </div>
    </>
  );
}
