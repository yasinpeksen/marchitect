import { sanitizeSearchText } from './search-text';

describe('sanitizeSearchText', () => {
  it('replaces LIKE and filter metacharacters with spaces and trims', () => {
    expect(sanitizeSearchText('  50%_off,(sale)  ')).toBe('50  off  sale');
  });
  it('returns an empty string for undefined', () => expect(sanitizeSearchText()).toBe(''));
  it('leaves normal text alone', () => expect(sanitizeSearchText('summer sale')).toBe('summer sale'));
});
