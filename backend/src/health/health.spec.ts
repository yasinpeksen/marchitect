import { buildHealthReport } from './health.module';

describe('buildHealthReport', () => {
  it('is ok when redis and the database are up', () => {
    expect(buildHealthReport(true, true, 12.6)).toEqual({ status: 'ok', redis: true, database: true, uptime: 13 });
  });
  it.each([[false, true], [true, false], [false, false]])('is degraded when redis=%s database=%s', (redis, database) => {
    expect(buildHealthReport(redis, database, 1).status).toBe('degraded');
  });
});
