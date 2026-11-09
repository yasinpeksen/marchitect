import type { RuntimeConfig } from './config';

/** Reads the public runtime configuration from environment variables (server side, per request). */
export function readRuntimeConfig(environment: Record<string, string | undefined>): RuntimeConfig {
  return {
    supabaseUrl: environment.SUPABASE_URL ?? '',
    supabaseAnonKey: environment.SUPABASE_ANON_KEY ?? '',
    apiUrl: environment.API_URL ?? 'http://localhost:3001',
  };
}

/** Supabase URL and anon key are mandatory for the app to work. */
export const isConfigured = (config: RuntimeConfig): boolean => Boolean(config.supabaseUrl && config.supabaseAnonKey);
