/** Splits `20260101000000_core_schema.sql` into its version and name. */
export function parseMigrationFilename(filename: string): { version: string; name: string } {
  const [version, ...nameParts] = filename.replace(/\.sql$/, '').split('_');
  return { version, name: nameParts.join('_') };
}

/** `.sql` files not yet applied, in lexical (= chronological) order. */
export function pendingMigrations(filenames: string[], appliedVersions: Set<string>): string[] {
  return filenames
    .filter((filename) => filename.endsWith('.sql'))
    .sort()
    .filter((filename) => !appliedVersions.has(parseMigrationFilename(filename).version));
}
