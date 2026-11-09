import type { AdAccount, AdPlatform, StartCollectionResponse } from './types';

export const PLATFORM_LABELS: Record<AdPlatform, string> = { meta: 'Meta', tiktok: 'TikTok' };

/** Accounts a single "Collect ads" click searches: the chosen account, or every enabled account on every platform. */
export function pickCollectionTargets(accounts: AdAccount[] | undefined, chosenAccountId: string): AdAccount[] {
  if (!accounts) return [];
  if (chosenAccountId) return accounts.filter((account) => account.id === chosenAccountId);
  return accounts.filter((account) => account.selected);
}

/** "Meta", "TikTok" or "Meta and TikTok" for the platforms present in `accounts`. */
export function describePlatforms(accounts: Pick<AdAccount, 'platform'>[]): string {
  const platforms = [...new Set(accounts.map((account) => account.platform))];
  return platforms.map((platform) => PLATFORM_LABELS[platform] ?? platform).join(' and ');
}

/** Account label with its platform, e.g. "Shoe Shop (TikTok)". */
export const accountLabel = (account: Pick<AdAccount, 'name' | 'meta_account_id' | 'platform'>): string =>
  `${account.name ?? account.meta_account_id} (${PLATFORM_LABELS[account.platform] ?? account.platform})`;

/** The notice shown after starting collections for `targets`. */
export function summarizeStartedCollections(started: StartCollectionResponse[], targets: Pick<AdAccount, 'platform'>[]): string {
  if (started.length > 0 && started.every((entry) => entry.reused)) {
    return started.length === 1
      ? 'An identical collection is already running; showing its progress.'
      : 'Identical collections are already running; showing their progress.';
  }
  const alreadyStored = started.reduce((total, entry) => total + entry.existing_matches, 0);
  return `${alreadyStored} matching ads already stored. Collecting fresh data from ${describePlatforms(targets)}…`;
}
