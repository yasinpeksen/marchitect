/**
 * Black-box checks against a RUNNING stack (docker compose run --rm test-e2e).
 * No Meta credentials needed: verifies wiring, auth enforcement and docs.
 */
const baseUrl = process.env.API_BASE_URL ?? 'http://localhost:3001';

describe('API (running stack)', () => {
  it('reports healthy dependencies', async () => {
    const response = await fetch(`${baseUrl}/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'ok', redis: true, database: true });
  });

  it('serves Swagger docs', async () => {
    const page = await fetch(`${baseUrl}/api/docs`);
    expect(page.status).toBe(200);
    const document = (await (await fetch(`${baseUrl}/api/docs-json`)).json()) as { paths: Record<string, unknown> };
    expect(document.paths['/api/v1/ads']).toBeDefined();
  });

  it.each(['/api/v1/ads', '/api/v1/dashboard', '/api/v1/schedules', '/api/v1/meta/connections'])(
    'rejects unauthenticated %s',
    async (path) => {
      expect((await fetch(`${baseUrl}${path}`)).status).toBe(401);
    },
  );

  it('rejects a forged bearer token', async () => {
    const response = await fetch(`${baseUrl}/api/v1/auth/me`, { headers: { authorization: 'Bearer not-a-real-token' } });
    expect(response.status).toBe(401);
  });
});
