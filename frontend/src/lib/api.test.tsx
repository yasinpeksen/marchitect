import { renderHook, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';
import { supabaseMock } from '@/testing/mocks';
import { ApiError, buildQueryString, extractErrorMessage } from './api';
import { useConfig } from './config';

const actual = await vi.importActual<typeof import('./api')>('./api');

describe('buildQueryString', () => {
  it('joins values, comma-joins arrays and encodes', () => {
    expect(buildQueryString({ keywords: ['a', 'b'], page: 2, q: 'x y' })).toBe('?keywords=a%2Cb&page=2&q=x+y');
  });
  it('drops empty, null, undefined and empty-array values but keeps false and 0', () => {
    expect(buildQueryString({ a: '', b: null, c: undefined, d: [], e: false, f: 0 })).toBe('?e=false&f=0');
  });
  it('returns an empty string when nothing remains', () => expect(buildQueryString({})).toBe(''));
});

describe('extractErrorMessage', () => {
  it('uses a string message', () => expect(extractErrorMessage({ message: 'Nope' }, 400)).toBe('Nope'));
  it('joins validation message arrays', () => expect(extractErrorMessage({ message: ['a bad', 'b bad'] }, 400)).toBe('a bad; b bad'));
  it('falls back to the status', () => {
    expect(extractErrorMessage(null, 502)).toBe('Request failed (502)');
    expect(extractErrorMessage({}, 500)).toBe('Request failed (500)');
  });
});

describe('ApiError', () => {
  it('carries the HTTP status', () => {
    const error = new ApiError('boom', 404);
    expect(error).toBeInstanceOf(Error);
    expect(error.status).toBe(404);
    expect(error.message).toBe('boom');
  });
});

describe('useApi', () => {
  let fetchMock: MockInstance<typeof fetch>;

  beforeEach(() => {
    vi.mocked(useConfig).mockReturnValue({ cfg: { apiUrl: 'http://api.test', supabaseUrl: '', supabaseAnonKey: '' }, supabase: supabaseMock } as never);
    fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 })));
  });

  const api = () => renderHook(() => actual.useApi()).result.current;

  it('sends the Supabase access token to the versioned API (never a Meta token)', async () => {
    expect(await api().get('/ads')).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://api.test/api/v1/ads');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer jwt');
  });

  it('serialises JSON bodies for post and patch', async () => {
    await api().post('/search/collect', { keywords: ['a'] });
    await api().patch('/schedules/1', { enabled: false });
    const [, postInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const [, patchInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(postInit).toMatchObject({ method: 'POST', body: '{"keywords":["a"]}' });
    expect((postInit.headers as Record<string, string>)['content-type']).toBe('application/json');
    expect(patchInit).toMatchObject({ method: 'PATCH', body: '{"enabled":false}' });
  });

  it('sends an empty object for post without a body', async () => {
    await api().post('/x');
    expect((fetchMock.mock.calls[0] as [string, RequestInit])[1].body).toBe('{}');
  });

  it('omits authorization without a session', async () => {
    supabaseMock.auth.getSession.mockResolvedValue({ data: { session: null } });
    await api().get('/ads');
    expect(((fetchMock.mock.calls[0] as [string, RequestInit])[1].headers as Record<string, string>).authorization).toBeUndefined();
  });

  it('resolves undefined for 204 responses (remove)', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(new Response(null, { status: 204 })));
    expect(await api().remove('/saved-searches/1')).toBeUndefined();
    expect((fetchMock.mock.calls[0] as [string, RequestInit])[1].method).toBe('DELETE');
  });

  it('turns error responses into ApiError with the server message', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ message: ['bad a', 'bad b'] }), { status: 400 })));
    await expect(api().get('/x')).rejects.toMatchObject({ message: 'bad a; bad b', status: 400 });
  });

  it('tolerates non-JSON error bodies', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(new Response('<html>', { status: 502 })));
    await expect(api().get('/x')).rejects.toMatchObject({ message: 'Request failed (502)', status: 502 });
  });
});

describe('useData', () => {
  beforeEach(() => {
    vi.mocked(useConfig).mockReturnValue({ cfg: { apiUrl: 'http://api.test', supabaseUrl: '', supabaseAnonKey: '' }, supabase: supabaseMock } as never);
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>;

  it('fetches through the API client and exposes the data', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ total: 3 }), { status: 200 })));
    const { result } = renderHook(() => actual.useData<{ total: number }>('/ads'), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual({ total: 3 }));
  });

  it('does not fetch for a null path', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { result } = renderHook(() => actual.useData(null), { wrapper });
    expect(result.current.data).toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
