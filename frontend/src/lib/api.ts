'use client';
import { useCallback, useMemo } from 'react';
import useSWR, { SWRConfiguration } from 'swr';
import { useConfig } from './config';

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export type QueryValues = Record<string, string | number | boolean | string[] | undefined | null>;

/** `?a=1&b=x,y` from a values object. Empty values and empty arrays are dropped; arrays are comma-joined. */
export function buildQueryString(values: QueryValues): string {
  const parameters = new URLSearchParams();
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)) continue;
    parameters.set(name, Array.isArray(value) ? value.join(',') : String(value));
  }
  const text = parameters.toString();
  return text ? `?${text}` : '';
}

/** Human readable message from a NestJS error body (string or array of validation messages). */
export function extractErrorMessage(body: { message?: string | string[] } | null, status: number): string {
  const message = body?.message;
  if (Array.isArray(message)) return message.join('; ');
  return message ?? `Request failed (${status})`;
}

/** Calls the NestJS API with the user's Supabase access token. Meta tokens never reach the browser. */
export function useApi() {
  const { cfg, supabase } = useConfig();
  const request = useCallback(
    async <Result = unknown>(method: string, path: string, body?: unknown): Promise<Result> => {
      const { data } = await supabase.auth.getSession();
      const response = await fetch(`${cfg.apiUrl}/api/v1${path}`, {
        method,
        headers: {
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          ...(data.session ? { authorization: `Bearer ${data.session.access_token}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (response.status === 204) return undefined as Result;
      const json = (await response.json().catch(() => null)) as { message?: string | string[] } | null;
      if (!response.ok) throw new ApiError(extractErrorMessage(json, response.status), response.status);
      return json as Result;
    },
    [cfg.apiUrl, supabase],
  );
  return useMemo(
    () => ({
      get: <Result = unknown>(path: string) => request<Result>('GET', path),
      post: <Result = unknown>(path: string, body?: unknown) => request<Result>('POST', path, body ?? {}),
      patch: <Result = unknown>(path: string, body: unknown) => request<Result>('PATCH', path, body),
      remove: (path: string) => request('DELETE', path),
    }),
    [request],
  );
}

/** SWR bound to the API. Pass `null` to skip fetching. */
export function useData<Result = unknown>(path: string | null, options?: SWRConfiguration) {
  const api = useApi();
  return useSWR<Result>(path, (requestPath: string) => api.get<Result>(requestPath), { revalidateOnFocus: false, ...options });
}
