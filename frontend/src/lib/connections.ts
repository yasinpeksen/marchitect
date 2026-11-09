import type { AdPlatform, MetaConnection } from './types';

/** Granted permissions line for a connection. */
export const describePermissions = (connection: Pick<MetaConnection, 'scopes'>): string =>
  connection.scopes && connection.scopes.length > 0 ? connection.scopes.join(', ') : 'not reported';

/** OAuth round-trip results arrive as `?connected=1` or `?error=...`. */
export function readOAuthResult(parameters: URLSearchParams): { message?: string; error?: string } {
  const error = parameters.get('error');
  if (error) return { error };
  return parameters.get('connected') ? { message: 'Meta account connected.' } : {};
}

export type ConnectionEntry = MetaConnection & { platform: AdPlatform };

/** Meta and TikTok connections in one list; `undefined` until both have loaded. */
export function mergeConnections(metaConnections: MetaConnection[] | undefined, tiktokConnections: MetaConnection[] | undefined): ConnectionEntry[] | undefined {
  if (!metaConnections || !tiktokConnections) return undefined;
  return [
    ...metaConnections.map((connection) => ({ ...connection, platform: 'meta' as const })),
    ...tiktokConnections.map((connection) => ({ ...connection, platform: 'tiktok' as const })),
  ];
}

/** API path prefix that owns connections of a platform. */
export const connectionsPathFor = (platform: AdPlatform): string => (platform === 'tiktok' ? '/tiktok/connections' : '/meta/connections');

/** Advertiser ids typed as "7001, 7002" or one per line; anything that is not 5-25 digits is dropped. */
export const parseAdvertiserIds = (text: string): string[] => [...new Set(text.split(/[\s,;]+/).filter((part) => /^\d{5,25}$/.test(part)))];

/** The id shown for an ad account (TikTok ids are stored with a "tiktok:" prefix). */
export const displayAccountId = (metaAccountId: string): string => metaAccountId.replace(/^tiktok:/, '');
