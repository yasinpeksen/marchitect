import type { SavedSearch } from './types';

/** Link that opens a saved search on the Ad Search page. */
export function savedSearchHref(search: Pick<SavedSearch, 'tags' | 'match_mode' | 'ad_account_id'>): string {
  const account = search.ad_account_id ? `&account=${search.ad_account_id}` : '';
  return `/search?q=${encodeURIComponent(search.tags.join(','))}&match=${search.match_mode}${account}`;
}
