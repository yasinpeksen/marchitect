'use client';
import clsx from 'clsx';
import {
  Bell, CalendarClock, History, LayoutDashboard, Library, LogOut, Menu, PlugZap, Search, Settings, Star, X,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useApi, useData } from '@/lib/api';
import { useSupabase } from '@/lib/config';
import { formatDateTime } from '@/lib/format';
import type { NotificationItem } from '@/lib/types';
import { Spinner } from './ui';

export const NAVIGATION = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/search', label: 'Ad Search', icon: Search },
  { href: '/library', label: 'Ad Library', icon: Library },
  { href: '/saved', label: 'Saved Searches', icon: Star },
  { href: '/scheduler', label: 'Scheduler', icon: CalendarClock },
  { href: '/history', label: 'Collection History', icon: History },
  { href: '/connections', label: 'Connections', icon: PlugZap },
  { href: '/settings', label: 'Settings', icon: Settings },
];

/** Whether a nav link is the current page (exact match or a nested page below it). */
export const isActiveRoute = (currentPath: string, href: string): boolean => currentPath === href || currentPath.startsWith(`${href}/`);

export function NotificationsBell() {
  const api = useApi();
  const { data: unread, mutate } = useData<NotificationItem[]>('/notifications?unread=true', { refreshInterval: 30_000 });
  const [open, setOpen] = useState(false);
  const unreadCount = unread?.length ?? 0;
  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)} className="relative rounded-lg p-2 text-slate-600 hover:bg-slate-100" aria-label="Notifications">
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] text-white">{unreadCount}</span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-2 w-80 rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
          {unreadCount === 0 ? (
            <p className="p-3 text-sm text-slate-500">No new notifications.</p>
          ) : (
            <>
              <ul className="max-h-80 divide-y divide-slate-100 overflow-auto">
                {unread?.map((notification) => (
                  <li key={notification.id} className="p-3">
                    <p className="text-sm font-medium">{notification.title}</p>
                    {notification.body && <p className="mt-0.5 text-xs text-slate-600">{notification.body}</p>}
                    <p className="mt-1 text-[11px] text-slate-400">{formatDateTime(notification.created_at)}</p>
                  </li>
                ))}
              </ul>
              <button
                className="w-full p-2 text-xs text-brand-600"
                onClick={async () => {
                  await api.post('/notifications/read', {});
                  await mutate([]);
                  setOpen(false);
                }}
              >
                Mark all as read
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function NavigationLinks({ currentPath }: { currentPath: string }) {
  return (
    <nav className="flex-1 space-y-1 p-3">
      {NAVIGATION.map(({ href, label, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          className={clsx('flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium', isActiveRoute(currentPath, href) ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100')}
        >
          <Icon className="h-4 w-4" /> {label}
        </Link>
      ))}
    </nav>
  );
}

/** Authenticated layout: redirects to /login without a session. */
export function Shell({ children }: { children: React.ReactNode }) {
  const supabase = useSupabase();
  const router = useRouter();
  const currentPath = usePathname();
  const [ready, setReady] = useState(false);
  const [email, setEmail] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      if (!data.session) {
        router.replace('/login');
      } else {
        setEmail(data.session.user.email ?? '');
        setReady(true);
      }
    });
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) router.replace('/login');
    });
    return () => subscription.subscription.unsubscribe();
  }, [supabase, router]);

  useEffect(() => setMenuOpen(false), [currentPath]);
  if (!ready) return <Spinner />;

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-slate-200 bg-white lg:flex">
        <div className="px-5 py-4 text-sm font-semibold">Meta Ads Intelligence</div>
        <NavigationLinks currentPath={currentPath} />
      </aside>
      {menuOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setMenuOpen(false)} />
          <aside className="relative flex h-full w-64 flex-col bg-white">
            <div className="flex items-center justify-between px-5 py-4 text-sm font-semibold">
              Meta Ads Intelligence <button aria-label="Close menu" onClick={() => setMenuOpen(false)}><X className="h-4 w-4" /></button>
            </div>
            <NavigationLinks currentPath={currentPath} />
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-slate-200 bg-white/90 px-4 py-2.5 backdrop-blur">
          <button className="rounded-lg p-2 hover:bg-slate-100 lg:hidden" onClick={() => setMenuOpen(true)} aria-label="Menu"><Menu className="h-5 w-5" /></button>
          <div className="flex-1" />
          <NotificationsBell />
          <span className="hidden text-sm text-slate-500 sm:block">{email}</span>
          <button
            className="rounded-lg p-2 text-slate-600 hover:bg-slate-100"
            aria-label="Sign out"
            onClick={async () => {
              await supabase.auth.signOut();
              router.replace('/login');
            }}
          >
            <LogOut className="h-4 w-4" />
          </button>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
