import { render, renderHook } from '@testing-library/react';
import { createBrowserClient } from '@supabase/ssr';
import { describe, expect, it, vi } from 'vitest';

const actual = await vi.importActual<typeof import('./config')>('./config');
const configuration = { supabaseUrl: 'http://supabase.test', supabaseAnonKey: 'anon', apiUrl: 'http://api.test' };

describe('ConfigProvider / useConfig / useSupabase', () => {
  const wrapper = ({ children }: { children: React.ReactNode }) => <actual.ConfigProvider cfg={configuration}>{children}</actual.ConfigProvider>;

  it('provides the runtime config and a Supabase browser client built from it', () => {
    const { result } = renderHook(() => actual.useConfig(), { wrapper });
    expect(result.current.cfg).toEqual(configuration);
    expect(createBrowserClient).toHaveBeenCalledWith('http://supabase.test', 'anon');
    expect(result.current.supabase).toEqual({ auth: 'client' });
  });

  it('useSupabase returns just the client', () => {
    expect(renderHook(() => actual.useSupabase(), { wrapper }).result.current).toEqual({ auth: 'client' });
  });

  it('creates the client once across re-renders', () => {
    vi.mocked(createBrowserClient).mockClear();
    const { rerender } = render(<actual.ConfigProvider cfg={configuration}>x</actual.ConfigProvider>);
    rerender(<actual.ConfigProvider cfg={{ ...configuration }}>y</actual.ConfigProvider>);
    expect(createBrowserClient).toHaveBeenCalledTimes(1);
  });

  it('fails clearly outside the provider', () => {
    expect(() => renderHook(() => actual.useConfig())).toThrow('ConfigProvider missing');
  });
});
