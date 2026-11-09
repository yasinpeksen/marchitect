/**
 * Test double for SupabaseService. Query builders are recorded and resolve to queued results,
 * so services can be unit tested without a database.
 */
export interface FakeResult {
  data?: unknown;
  error?: { message: string; code?: string } | null;
  count?: number | null;
}

export interface RecordedCall {
  /** Table name, or `rpc:<function>` for stored-function calls. */
  target: string;
  operations: { name: string; args: unknown[] }[];
}

export class FakeSupabase {
  readonly calls: RecordedCall[] = [];
  readonly storageUpload = jest.fn().mockResolvedValue({ data: {}, error: null });
  readonly storageSignedUrls = jest.fn().mockResolvedValue({ data: [], error: null });
  readonly getUser = jest.fn();
  readonly storage = { upload: this.storageUpload, createSignedUrls: this.storageSignedUrls };
  readonly admin = { auth: { getUser: this.getUser } };
  private readonly queuedResults = new Map<string, FakeResult[]>();

  /** Queue a result for the next query against `target` (the last queued result repeats). */
  respond(target: string, result: FakeResult): this {
    this.queuedResults.set(target, [...(this.queuedResults.get(target) ?? []), result]);
    return this;
  }

  from(table: string) {
    return this.createBuilder(table);
  }

  rpc(functionName: string, functionArguments: Record<string, unknown>) {
    const builder = this.createBuilder(`rpc:${functionName}`);
    this.calls.at(-1)?.operations.push({ name: 'args', args: [functionArguments] });
    return builder;
  }

  /** All recorded calls against a table (or `rpc:<name>`). */
  callsTo(target: string): RecordedCall[] {
    return this.calls.filter((call) => call.target === target);
  }

  /** Arguments of the first `operation` found in the calls to `target`, or `undefined`. */
  argumentsOf(target: string, operation: string): unknown[] | undefined {
    for (const call of this.callsTo(target)) {
      const found = call.operations.find((entry) => entry.name === operation);
      if (found) return found.args;
    }
    return undefined;
  }

  private nextResult(target: string): FakeResult {
    const queue = this.queuedResults.get(target);
    if (!queue || queue.length === 0) return { data: [], error: null, count: 0 };
    return queue.length > 1 ? (queue.shift() as FakeResult) : queue[0];
  }

  private createBuilder(target: string): unknown {
    const call: RecordedCall = { target, operations: [] };
    this.calls.push(call);
    const builder: unknown = new Proxy({}, {
      get: (_object, property) => {
        if (property === 'then') {
          return (resolve: (value: unknown) => void, reject: (reason: unknown) => void) => {
            const result = this.nextResult(target);
            return Promise.resolve({ data: result.data ?? null, error: result.error ?? null, count: result.count ?? null }).then(resolve, reject);
          };
        }
        return (...callArguments: unknown[]) => {
          call.operations.push({ name: String(property), args: callArguments });
          return builder;
        };
      },
    });
    return builder;
  }
}

/** Minimal AppConfig stand-in; override fields per test. */
export function buildTestConfig(overrides: Record<string, unknown> = {}) {
  return {
    mediaBucket: 'ad-media',
    maxAdsPerRun: 100,
    defaultLookbackDays: 30,
    asyncInsightsMinDays: 31,
    asyncInsightsMinAds: 100,
    asyncInsightsTimeoutMs: 1000,
    mediaMaxBytes: 1024 * 1024,
    mediaDownloadTimeoutMs: 5000,
    mediaExtraAllowedHosts: [] as string[],
    signedUrlTtlSeconds: 60,
    metaGraphBaseUrl: 'https://graph.example.test',
    metaDialogBaseUrl: 'https://www.example.test',
    metaGraphVersion: 'v24.0',
    metaAppId: undefined as string | undefined,
    metaAppSecret: undefined as string | undefined,
    metaRedirectUri: 'http://localhost:3001/api/v1/meta/oauth/callback',
    metaMaxRetries: 2,
    metaRetryBaseMs: 1,
    adLibraryEnabled: false,
    frontendUrl: 'http://localhost:3000',
    schedulerTickMs: 1000,
    ...overrides,
  };
}
