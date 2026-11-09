import { describe, expect, it } from 'vitest';
import { isConfigured, readRuntimeConfig } from './runtime-config';

describe('readRuntimeConfig', () => {
  it('reads the public values from the environment', () => {
    expect(readRuntimeConfig({ SUPABASE_URL: 'http://s', SUPABASE_ANON_KEY: 'k', API_URL: 'http://api' })).toEqual({ supabaseUrl: 'http://s', supabaseAnonKey: 'k', apiUrl: 'http://api' });
  });
  it('defaults the API URL and leaves Supabase values empty', () => {
    expect(readRuntimeConfig({})).toEqual({ supabaseUrl: '', supabaseAnonKey: '', apiUrl: 'http://localhost:3001' });
  });
  it('never picks up server-only secrets', () => {
    const config = readRuntimeConfig({ SUPABASE_SERVICE_ROLE_KEY: 'secret', TOKEN_ENCRYPTION_KEY: 'secret' });
    expect(JSON.stringify(config)).not.toContain('secret');
  });
});

describe('isConfigured', () => {
  it('needs both the Supabase URL and anon key', () => {
    expect(isConfigured({ supabaseUrl: 'u', supabaseAnonKey: 'k', apiUrl: 'a' })).toBe(true);
    expect(isConfigured({ supabaseUrl: '', supabaseAnonKey: 'k', apiUrl: 'a' })).toBe(false);
    expect(isConfigured({ supabaseUrl: 'u', supabaseAnonKey: '', apiUrl: 'a' })).toBe(false);
  });
});
