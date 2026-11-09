import { describe, expect, it } from 'vitest';
import { makeAccount, makeRun } from '@/testing/factories';
import { accountLabel, describePlatforms, pickCollectionTargets, PLATFORM_LABELS, summarizeStartedCollections } from './collection-targets';

const meta = makeAccount({ id: 'meta-1', name: 'Meta account' });
const tiktok = makeAccount({ id: 'tt-1', name: 'TikTok account', platform: 'tiktok', meta_account_id: 'tiktok:700' });
const disabled = makeAccount({ id: 'off-1', selected: false });

describe('pickCollectionTargets', () => {
  it('uses every enabled account across platforms when none is chosen', () => {
    expect(pickCollectionTargets([meta, tiktok, disabled], '').map((account) => account.id)).toEqual(['meta-1', 'tt-1']);
  });
  it('uses only the chosen account, even if it is not enabled', () => {
    expect(pickCollectionTargets([meta, tiktok, disabled], 'off-1').map((account) => account.id)).toEqual(['off-1']);
  });
  it('is empty without accounts or for an unknown choice', () => {
    expect(pickCollectionTargets(undefined, '')).toEqual([]);
    expect(pickCollectionTargets([meta], 'missing')).toEqual([]);
  });
});

describe('describePlatforms', () => {
  it('names each platform once', () => {
    expect(describePlatforms([meta])).toBe('Meta');
    expect(describePlatforms([tiktok, tiktok])).toBe('TikTok');
    expect(describePlatforms([meta, tiktok])).toBe('Meta and TikTok');
  });
  it('falls back to the raw platform name', () => {
    expect(describePlatforms([{ platform: 'snap' as never }])).toBe('snap');
    expect(PLATFORM_LABELS.tiktok).toBe('TikTok');
  });
});

describe('accountLabel', () => {
  it('appends the platform', () => {
    expect(accountLabel(tiktok)).toBe('TikTok account (TikTok)');
    expect(accountLabel({ name: null, meta_account_id: 'act_9', platform: 'meta' })).toBe('act_9 (Meta)');
    expect(accountLabel({ name: 'x', meta_account_id: 'y', platform: 'other' as never })).toBe('x (other)');
  });
});

describe('summarizeStartedCollections', () => {
  const started = (reused: boolean, existingMatches = 0) => ({ run: makeRun(), existing_matches: existingMatches, reused });

  it('adds up stored matches and names the platforms', () => {
    expect(summarizeStartedCollections([started(false, 4), started(false, 3)], [meta, tiktok])).toBe('7 matching ads already stored. Collecting fresh data from Meta and TikTok…');
  });
  it('says when everything is already running', () => {
    expect(summarizeStartedCollections([started(true)], [meta])).toBe('An identical collection is already running; showing its progress.');
    expect(summarizeStartedCollections([started(true), started(true)], [meta, tiktok])).toBe('Identical collections are already running; showing their progress.');
  });
  it('still reports the start when only some collections were already running', () => {
    expect(summarizeStartedCollections([started(true, 1), started(false, 2)], [meta, tiktok])).toContain('3 matching ads already stored');
  });
});
