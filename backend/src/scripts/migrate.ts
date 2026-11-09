/**
 * Minimal migration runner compatible with the Supabase CLI's history table, so cloud projects
 * and the local CLI stack can share supabase/migrations.
 * Usage: DATABASE_URL=postgres://... node dist/scripts/migrate.js
 */
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { Client } from 'pg';
import { parseMigrationFilename, pendingMigrations } from './migration-helpers';

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required (Supabase Postgres connection string).');
  const migrationsDirectory = process.env.MIGRATIONS_DIR ?? join(__dirname, '../../../supabase/migrations');

  const database = new Client({
    connectionString: databaseUrl,
    ssl: /supabase\.(co|com)/.test(databaseUrl) ? { rejectUnauthorized: false } : undefined,
  });
  await database.connect();
  try {
    await database.query('select pg_advisory_lock(727274)');
    await database.query('create schema if not exists supabase_migrations');
    await database.query('create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text)');
    const appliedVersions = new Set<string>(
      (await database.query<{ version: string }>('select version from supabase_migrations.schema_migrations')).rows.map((row) => row.version),
    );

    const pending = pendingMigrations(readdirSync(migrationsDirectory), appliedVersions);
    for (const filename of pending) {
      const { version, name } = parseMigrationFilename(filename);
      const sql = readFileSync(join(migrationsDirectory, filename), 'utf8');
      console.log(`Applying ${filename}`);
      await database.query('begin');
      try {
        await database.query(sql);
        await database.query('insert into supabase_migrations.schema_migrations (version, name, statements) values ($1,$2,$3)', [version, name, [sql]]);
        await database.query('commit');
      } catch (error) {
        await database.query('rollback');
        throw new Error(`Migration ${filename} failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    console.log(pending.length > 0 ? `Applied ${pending.length} migration(s).` : 'Database is up to date.');
  } finally {
    await database.end();
  }
}
main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
