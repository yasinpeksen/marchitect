import { createClient, SupabaseClient } from '@supabase/supabase-js';
import {
  ApiClient, createMockMetaAdmin, createTestUser, IntegrationEnvironment, loadIntegrationEnvironment, TestUser, waitFor,
} from './integration-support';

export interface IntegrationContext {
  environment: IntegrationEnvironment;
  /** Service-role client: bypasses RLS, for arranging and verifying database state. */
  admin: SupabaseClient;
  mock: ReturnType<typeof createMockMetaAdmin>;
  users: TestUser[];
  /** Deletes the test users (cascading all their data). */
  cleanup: () => Promise<void>;
}

/** Environment, service-role client, mock Meta control and signed-in test users for one integration spec. */
export async function createIntegrationContext(userLabels: string[], source: Record<string, string | undefined> = process.env): Promise<IntegrationContext> {
  const environment = loadIntegrationEnvironment(source);
  const admin = createClient(environment.supabaseUrl, environment.supabaseServiceRoleKey, { auth: { persistSession: false } });
  const createAnonymousClient = () => createClient(environment.supabaseUrl, environment.supabaseAnonKey, { auth: { persistSession: false } });
  const mock = createMockMetaAdmin(environment.mockMetaUrl);
  await mock.reset();
  const users: TestUser[] = [];
  for (const label of userLabels) users.push(await createTestUser(admin, createAnonymousClient, environment.apiBaseUrl, label));
  return {
    environment,
    admin,
    mock,
    users,
    cleanup: async () => {
      for (const user of users) await admin.auth.admin.deleteUser(user.id);
    },
  };
}

export interface AdAccountSummary {
  id: string;
  meta_account_id: string;
  name: string;
  currency: string;
  selected: boolean;
}

export interface RunSummary {
  id: string;
  status: 'queued' | 'running' | 'succeeded' | 'partial' | 'failed';
  stage: string | null;
  error: string | null;
  errors: { message: string }[];
  counters: Record<string, number>;
  trigger: string;
}

const TERMINAL_STATUSES = ['succeeded', 'partial', 'failed'];

/** Connects a Meta token for the user and returns the ad accounts that were synced. */
export async function connectMeta(api: ApiClient, token: string): Promise<AdAccountSummary[]> {
  const connected = await api.post('/meta/connections', { token });
  if (connected.status !== 201) throw new Error(`Connecting Meta failed with HTTP ${connected.status}: ${JSON.stringify(connected.body)}`);
  return (await api.get<AdAccountSummary[]>('/ad-accounts')).body;
}

/** Connects a TikTok token for the user (authorised for `advertiserIds`) and returns the ad accounts afterwards. */
export async function connectTikTok(api: ApiClient, token: string, advertiserIds: string[]): Promise<AdAccountSummary[]> {
  const connected = await api.post('/tiktok/connections', { token, advertiser_ids: advertiserIds });
  if (connected.status !== 201) throw new Error(`Connecting TikTok failed with HTTP ${connected.status}: ${JSON.stringify(connected.body)}`);
  return (await api.get<AdAccountSummary[]>('/ad-accounts')).body;
}

/** Waits until a collection run reaches a terminal status. */
export function waitForRun(api: ApiClient, runId: string, timeoutMs = 120_000): Promise<RunSummary> {
  return waitFor(
    async () => {
      const run = (await api.get<RunSummary>(`/collection-runs/${runId}`)).body;
      return TERMINAL_STATUSES.includes(run.status) ? run : null;
    },
    { timeoutMs, intervalMs: 500, description: `run ${runId} to finish` },
  );
}

/** `YYYY-MM-DD` for `daysAgo` days before today (UTC). */
export const isoDaysAgo = (daysAgo: number, now: Date = new Date()): string => new Date(now.getTime() - daysAgo * 86_400_000).toISOString().slice(0, 10);

/** Starts a collection and waits for it to finish. */
export async function collectAndWait(
  api: ApiClient,
  options: { accountId: string; keywords: string[]; days?: number },
): Promise<RunSummary> {
  const started = await api.post<{ run: { id: string }; reused: boolean }>('/search/collect', {
    keywords: options.keywords,
    ad_account_id: options.accountId,
    date_from: isoDaysAgo((options.days ?? 10) - 1),
    date_to: isoDaysAgo(0),
  });
  if (started.status !== 201) throw new Error(`Starting collection failed with HTTP ${started.status}: ${JSON.stringify(started.body)}`);
  return waitForRun(api, started.body.run.id);
}
