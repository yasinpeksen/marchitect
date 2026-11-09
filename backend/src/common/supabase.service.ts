import { Injectable } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { AppConfig } from './app-config';

/**
 * Service-role Supabase client. Bypasses RLS, so every query MUST be scoped by the
 * authenticated user's id. Never exposed to the frontend.
 */
@Injectable()
export class SupabaseService {
  readonly admin: SupabaseClient;

  constructor(readonly config: AppConfig) {
    this.admin = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }

  from(table: string) {
    return this.admin.from(table);
  }

  rpc(functionName: string, functionArguments: Record<string, unknown>) {
    return this.admin.rpc(functionName, functionArguments);
  }

  get storage() {
    return this.admin.storage.from(this.config.mediaBucket);
  }
}

interface SupabaseResponse {
  data: unknown;
  error: { message: string; code?: string } | null;
}

/**
 * Unwrap a Supabase response or throw with context. `Data` is the caller's row type: supabase-js
 * infers column types from the select string, so the boundary is cast to our own row interfaces.
 */
export function must<Data>(response: SupabaseResponse, context = 'database'): Data {
  if (response.error) throw new Error(`${context}: ${response.error.message}`);
  return response.data as Data;
}

/** Splits an array into consecutive groups of at most `size` items. */
export function chunk<Item>(items: Item[], size: number): Item[][] {
  const groups: Item[][] = [];
  for (let start = 0; start < items.length; start += size) groups.push(items.slice(start, start + size));
  return groups;
}
