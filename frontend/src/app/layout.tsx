import type { Metadata } from 'next';
import { ConfigProvider } from '@/lib/config';
import { isConfigured, readRuntimeConfig } from '@/lib/runtime-config';
import './globals.css';

export const metadata: Metadata = { title: 'Meta Ads Intelligence', description: 'Collect, search and analyse Meta ads' };
export const dynamic = 'force-dynamic'; // read runtime env on every request

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const config = readRuntimeConfig(process.env);
  return (
    <html lang="en">
      <body>
        {isConfigured(config) ? (
          <ConfigProvider cfg={config}>{children}</ConfigProvider>
        ) : (
          <main className="mx-auto max-w-xl p-10">
            <h1 className="text-lg font-semibold">Missing configuration</h1>
            <p className="mt-2 text-sm text-slate-600">
              Set <code>SUPABASE_URL</code> and <code>SUPABASE_ANON_KEY</code> in <code>.env</code> and restart the frontend.
            </p>
          </main>
        )}
      </body>
    </html>
  );
}
