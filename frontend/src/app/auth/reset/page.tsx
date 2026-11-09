'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button, ErrorBox, Field, Notice, Spinner } from '@/components/ui';
import { useSupabase } from '@/lib/config';

/** Target of the password-reset email link. */
export default function ResetPassword() {
  const supabase = useSupabase();
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>();
  const [done, setDone] = useState(false);

  useEffect(() => {
    void (async () => {
      const code = new URLSearchParams(location.search).get('code');
      if (code) {
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
        if (exchangeError) {
          setError(exchangeError);
          return;
        }
      }
      const { data } = await supabase.auth.getSession();
      if (data.session) setReady(true);
      else setError(new Error('This reset link is invalid or has expired. Request a new one.'));
    })();
  }, [supabase]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(undefined);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      setError(updateError);
      return;
    }
    setDone(true);
    setTimeout(() => router.replace('/dashboard'), 1200);
  }

  return (
    <main className="mx-auto max-w-sm p-10">
      <h1 className="text-xl font-semibold">Choose a new password</h1>
      <div className="mt-6 space-y-4">
        <ErrorBox error={error} />
        {!ready && !error && <Spinner />}
        {done && <Notice tone="green">Password updated. Redirecting…</Notice>}
        {ready && !done && (
          <form onSubmit={submit} className="space-y-4">
            <Field label="New password">
              <input className="input" type="password" minLength={8} required autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} />
            </Field>
            <Button type="submit" className="w-full">Update password</Button>
          </form>
        )}
      </div>
    </main>
  );
}
