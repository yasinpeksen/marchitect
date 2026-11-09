'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button, ErrorBox, Field, Notice } from '@/components/ui';
import { useSupabase } from '@/lib/config';

type AuthMode = 'login' | 'register' | 'forgot';

const SUBTITLES: Record<AuthMode, string> = { login: 'Sign in to your account', register: 'Create your account', forgot: 'Reset your password' };
const SUBMIT_LABELS: Record<AuthMode, string> = { login: 'Sign in', register: 'Create account', forgot: 'Send reset link' };

export default function LoginPage() {
  const supabase = useSupabase();
  const router = useRouter();
  const [mode, setMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [info, setInfo] = useState<string>();

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    setInfo(undefined);
    try {
      if (mode === 'login') {
        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
        if (signInError) throw signInError;
        router.replace('/dashboard');
      } else if (mode === 'register') {
        const { data, error: signUpError } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: `${location.origin}/auth/callback` } });
        if (signUpError) throw signUpError;
        if (data.session) router.replace('/dashboard');
        else setInfo('Check your email to confirm your account, then sign in.');
      } else {
        const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/auth/reset` });
        if (resetError) throw resetError;
        setInfo('If that address has an account, a reset link is on its way.');
      }
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  async function continueWithGoogle() {
    setError(undefined);
    const { error: oauthError } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${location.origin}/auth/callback` } });
    if (oauthError) setError(oauthError);
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-7 shadow-sm">
        <h1 className="text-xl font-semibold">Meta Ads Intelligence</h1>
        <p className="mt-1 text-sm text-slate-500">{SUBTITLES[mode]}</p>

        <form onSubmit={submit} className="mt-6 space-y-4">
          <Field label="Email">
            <input className="input" type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} />
          </Field>
          {mode !== 'forgot' && (
            <Field label="Password">
              <input
                className="input" type="password" required minLength={8}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                value={password} onChange={(event) => setPassword(event.target.value)}
              />
            </Field>
          )}
          <ErrorBox error={error} />
          {info && <Notice tone="green">{info}</Notice>}
          <Button type="submit" loading={busy} className="w-full">{SUBMIT_LABELS[mode]}</Button>
        </form>

        {mode !== 'forgot' && (
          <>
            <div className="my-5 flex items-center gap-3 text-xs text-slate-400">
              <span className="h-px flex-1 bg-slate-200" /> or <span className="h-px flex-1 bg-slate-200" />
            </div>
            <Button variant="secondary" className="w-full" onClick={continueWithGoogle} type="button">Continue with Google</Button>
          </>
        )}

        <div className="mt-6 flex justify-between text-sm text-brand-600">
          {mode === 'login' ? (
            <>
              <button onClick={() => setMode('register')}>Create account</button>
              <button onClick={() => setMode('forgot')}>Forgot password?</button>
            </>
          ) : (
            <button onClick={() => setMode('login')}>Back to sign in</button>
          )}
        </div>
      </div>
    </main>
  );
}
