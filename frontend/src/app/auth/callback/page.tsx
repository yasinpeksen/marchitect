'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ErrorBox, Spinner } from '@/components/ui';
import { useSupabase } from '@/lib/config';

/** OAuth (Google) and email-confirmation landing page: exchanges the PKCE code for a session. */
export default function AuthCallback() {
  const supabase = useSupabase();
  const router = useRouter();
  const [error, setError] = useState<unknown>();

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
      if (data.session) router.replace('/dashboard');
      else setError(new Error('No session was created. Try signing in again.'));
    })();
  }, [supabase, router]);

  return <main className="mx-auto max-w-sm p-10">{error ? <ErrorBox error={error} /> : <Spinner label="Signing you in…" />}</main>;
}
