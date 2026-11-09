'use client';
import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createContext, useContext, useMemo } from 'react';

/** Runtime (not build-time) config, injected by the server layout so one image works everywhere. */
export interface RuntimeConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  apiUrl: string;
}

const ConfigContext = createContext<{ cfg: RuntimeConfig; supabase: SupabaseClient } | null>(null);

export function ConfigProvider({ cfg, children }: { cfg: RuntimeConfig; children: React.ReactNode }) {
  const { supabaseUrl, supabaseAnonKey, apiUrl } = cfg;
  const value = useMemo(
    () => ({ cfg: { supabaseUrl, supabaseAnonKey, apiUrl }, supabase: createBrowserClient(supabaseUrl, supabaseAnonKey) }),
    [supabaseUrl, supabaseAnonKey, apiUrl],
  );
  return <ConfigContext.Provider value={value}>{children}</ConfigContext.Provider>;
}

export function useConfig() {
  const value = useContext(ConfigContext);
  if (!value) throw new Error('ConfigProvider missing');
  return value;
}

export const useSupabase = () => useConfig().supabase;
