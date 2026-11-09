import type { MetaConnection } from './types';

/** Granted permissions line for a connection. */
export const describePermissions = (connection: Pick<MetaConnection, 'scopes'>): string =>
  connection.scopes && connection.scopes.length > 0 ? connection.scopes.join(', ') : 'not reported';

/** OAuth round-trip results arrive as `?connected=1` or `?error=...`. */
export function readOAuthResult(parameters: URLSearchParams): { message?: string; error?: string } {
  const error = parameters.get('error');
  if (error) return { error };
  return parameters.get('connected') ? { message: 'Meta account connected.' } : {};
}
