import { createClient } from '@supabase/supabase-js';
import { AppConfig } from './app-config';
import { chunk, must, SupabaseService } from './supabase.service';

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn() }));

describe('must', () => {
  it('returns data on success', () => expect(must({ data: [1, 2], error: null })).toEqual([1, 2]));
  it('returns null data as is', () => expect(must({ data: null, error: null })).toBeNull());
  it('throws with context and the database message', () => {
    expect(() => must({ data: null, error: { message: 'boom' } }, 'load ads')).toThrow('load ads: boom');
  });
  it('uses a default context', () => {
    expect(() => must({ data: null, error: { message: 'boom' } })).toThrow('database: boom');
  });
});

describe('chunk', () => {
  it('splits into groups of the given size', () => expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]));
  it('returns no groups for an empty array', () => expect(chunk([], 3)).toEqual([]));
  it('keeps a short array in one group', () => expect(chunk([1], 10)).toEqual([[1]]));
});

describe('SupabaseService', () => {
  const storageBucket = { upload: jest.fn() };
  const client = { from: jest.fn().mockReturnValue('from-result'), rpc: jest.fn().mockReturnValue('rpc-result'), storage: { from: jest.fn().mockReturnValue(storageBucket) } };

  beforeEach(() => {
    (createClient as jest.Mock).mockReturnValue(client);
  });

  const config = { supabaseUrl: 'http://supabase.test', supabaseServiceRoleKey: 'service-key', mediaBucket: 'ad-media' } as AppConfig;

  it('creates a non-persistent service-role client', () => {
    const service = new SupabaseService(config);
    expect(createClient).toHaveBeenCalledWith('http://supabase.test', 'service-key', { auth: { autoRefreshToken: false, persistSession: false } });
    expect(service.admin).toBe(client);
  });

  it('delegates table queries, rpc calls and storage', () => {
    const service = new SupabaseService(config);
    expect(service.from('ads')).toBe('from-result');
    expect(client.from).toHaveBeenCalledWith('ads');
    expect(service.rpc('search_ads', { p_user_id: 'u1' })).toBe('rpc-result');
    expect(client.rpc).toHaveBeenCalledWith('search_ads', { p_user_id: 'u1' });
    expect(service.storage).toBe(storageBucket);
    expect(client.storage.from).toHaveBeenCalledWith('ad-media');
  });
});
