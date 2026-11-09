import { parseMigrationFilename, pendingMigrations } from './migration-helpers';

describe('parseMigrationFilename', () => {
  it('splits version and name', () => {
    expect(parseMigrationFilename('20260101000000_core_schema.sql')).toEqual({ version: '20260101000000', name: 'core_schema' });
  });
  it('handles a filename without a name', () => expect(parseMigrationFilename('20260101.sql')).toEqual({ version: '20260101', name: '' }));
});

describe('pendingMigrations', () => {
  const files = ['20260101000200_c.sql', '20260101000000_a.sql', 'README.md', '20260101000100_b.sql'];
  it('returns unapplied sql files in chronological order', () => {
    expect(pendingMigrations(files, new Set(['20260101000000']))).toEqual(['20260101000100_b.sql', '20260101000200_c.sql']);
  });
  it('returns nothing when everything is applied', () => {
    expect(pendingMigrations(files, new Set(['20260101000000', '20260101000100', '20260101000200']))).toEqual([]);
  });
});
