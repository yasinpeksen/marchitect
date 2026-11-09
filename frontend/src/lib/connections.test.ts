import { describe, expect, it } from 'vitest';
import { makeConnection } from '@/testing/factories';
import { connectionsPathFor, displayAccountId, mergeConnections, parseAdvertiserIds } from './connections';

describe('mergeConnections', () => {
  it('tags each connection with its platform', () => {
    const merged = mergeConnections([makeConnection({ id: 'm1' })], [makeConnection({ id: 't1' })]);
    expect(merged?.map((connection) => [connection.id, connection.platform])).toEqual([['m1', 'meta'], ['t1', 'tiktok']]);
  });
  it('waits until both lists have loaded', () => {
    expect(mergeConnections(undefined, [])).toBeUndefined();
    expect(mergeConnections([], undefined)).toBeUndefined();
    expect(mergeConnections([], [])).toEqual([]);
  });
});

describe('connectionsPathFor', () => {
  it('routes each platform to its own API', () => {
    expect(connectionsPathFor('meta')).toBe('/meta/connections');
    expect(connectionsPathFor('tiktok')).toBe('/tiktok/connections');
  });
});

describe('parseAdvertiserIds', () => {
  it('accepts commas, spaces and new lines, and removes duplicates', () => {
    expect(parseAdvertiserIds('7001234567, 7001234568\n7001234567;7001234569')).toEqual(['7001234567', '7001234568', '7001234569']);
  });
  it('drops anything that is not a 5-25 digit id', () => {
    expect(parseAdvertiserIds('abc, 12, 12345, 1234567890123456789012345678')).toEqual(['12345']);
    expect(parseAdvertiserIds('')).toEqual([]);
  });
});

describe('displayAccountId', () => {
  it('hides the tiktok: storage prefix only', () => {
    expect(displayAccountId('tiktok:7001')).toBe('7001');
    expect(displayAccountId('act_1')).toBe('act_1');
  });
});
