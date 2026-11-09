import { AppConfig, readInteger } from './app-config';

const VALID_ENVIRONMENT = {
  SUPABASE_URL: 'http://supabase.test',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key',
  REDIS_URL: 'redis://redis:6379',
  TOKEN_ENCRYPTION_KEY: 'a'.repeat(64),
};

describe('readInteger', () => {
  it('parses numeric text', () => expect(readInteger('42', 1)).toBe(42));
  it.each([undefined, '', 'abc', 'NaN'])('falls back for %p', (rawValue) => expect(readInteger(rawValue, 7)).toBe(7));
  it('accepts zero', () => expect(readInteger('0', 7)).toBe(0));
});

describe('AppConfig', () => {
  const originalEnvironment = { ...process.env };

  const withEnvironment = (values: Record<string, string | undefined>) => {
    process.env = { ...originalEnvironment, ...VALID_ENVIRONMENT, ...values } as NodeJS.ProcessEnv;
    for (const [name, value] of Object.entries(values)) if (value === undefined) delete process.env[name];
  };

  afterEach(() => {
    process.env = { ...originalEnvironment };
  });

  it('reads required values and applies defaults', () => {
    withEnvironment({});
    const config = new AppConfig();
    expect(config.supabaseUrl).toBe('http://supabase.test');
    expect(config.port).toBe(3001);
    expect(config.metaGraphBaseUrl).toBe('https://graph.facebook.com');
    expect(config.metaDialogBaseUrl).toBe('https://www.facebook.com');
    expect(config.corsOrigins).toEqual(['http://localhost:3000']);
    expect(config.mediaExtraAllowedHosts).toEqual([]);
    expect(config.adLibraryEnabled).toBe(false);
  });

  it('lists every missing required variable', () => {
    withEnvironment({ SUPABASE_URL: undefined, REDIS_URL: undefined });
    expect(() => new AppConfig()).toThrow('Missing required environment variables: SUPABASE_URL, REDIS_URL');
  });

  it('rejects an encryption key that is not 32 bytes', () => {
    withEnvironment({ TOKEN_ENCRYPTION_KEY: 'too-short' });
    expect(() => new AppConfig()).toThrow('32 bytes');
  });

  it('accepts a base64 encoded 32 byte key', () => {
    withEnvironment({ TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64') });
    expect(() => new AppConfig()).not.toThrow();
  });

  it('supports pointing Meta at a mock server and extra media hosts for test environments', () => {
    withEnvironment({
      META_GRAPH_BASE_URL: 'http://mock-meta:4010/',
      META_DIALOG_BASE_URL: 'http://mock-meta:4010',
      MEDIA_ALLOWED_HOSTS: 'mock-meta, other-host',
      META_AD_LIBRARY_ENABLED: 'true',
      CORS_ORIGINS: 'http://a.test, http://b.test',
    });
    const config = new AppConfig();
    expect(config.metaGraphBaseUrl).toBe('http://mock-meta:4010');
    expect(config.metaDialogBaseUrl).toBe('http://mock-meta:4010');
    expect(config.mediaExtraAllowedHosts).toEqual(['mock-meta', 'other-host']);
    expect(config.adLibraryEnabled).toBe(true);
    expect(config.corsOrigins).toEqual(['http://a.test', 'http://b.test']);
  });
});
