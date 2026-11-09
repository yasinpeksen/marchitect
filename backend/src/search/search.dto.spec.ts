import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AdQueryDto, normalizeKeywords, SavedSearchDto, splitCommaSeparated, StartCollectionDto } from './search.dto';

describe('splitCommaSeparated', () => {
  it('splits, trims and drops blanks', () => expect(splitCommaSeparated({ value: 'a, b,,c ' })).toEqual(['a', 'b', 'c']));
  it('passes arrays through', () => expect(splitCommaSeparated({ value: ['x'] })).toEqual(['x']));
  it.each(['', undefined, 5])('returns undefined for %p', (value) => expect(splitCommaSeparated({ value })).toBeUndefined());
});

describe('normalizeKeywords', () => {
  it('lowercases, collapses whitespace and removes duplicates and blanks', () => {
    expect(normalizeKeywords(['  Summer   Sale ', 'summer sale', '', 'WINTER'])).toEqual(['summer sale', 'winter']);
  });
  it('handles undefined', () => expect(normalizeKeywords(undefined)).toEqual([]));
});

describe('DTO validation', () => {
  const errorsFor = async <Dto extends object>(type: new () => Dto, plain: object) => validate(plainToInstance(type, plain));

  it('transforms and validates a query', async () => {
    const query = plainToInstance(AdQueryDto, { keywords: 'a,b', page: '2', min_ctr: '1.5', formats: 'video,image', match: 'all' });
    expect(query.keywords).toEqual(['a', 'b']);
    expect(query.page).toBe(2);
    expect(query.min_ctr).toBe(1.5);
    expect(await validate(query)).toHaveLength(0);
  });

  it('rejects an invalid sort, page size and format', async () => {
    const errors = await errorsFor(AdQueryDto, { sort: 'bogus', page_size: '500', formats: 'hologram' });
    expect(errors.map((error) => error.property).sort()).toEqual(['formats', 'page_size', 'sort']);
  });

  it('requires at least one keyword and a valid account to collect', async () => {
    expect((await errorsFor(StartCollectionDto, { keywords: [], ad_account_id: 'nope' })).map((error) => error.property).sort()).toEqual(['ad_account_id', 'keywords']);
    expect(await errorsFor(StartCollectionDto, { keywords: ['ok'], ad_account_id: '5f0d6d3e-8f4e-4d3c-8f8e-3c0b3a8f9a11' })).toHaveLength(0);
  });

  it('validates saved searches', async () => {
    expect(await errorsFor(SavedSearchDto, { name: 'N', tags: ['a'] })).toHaveLength(0);
    expect((await errorsFor(SavedSearchDto, { name: '', tags: [] })).length).toBeGreaterThan(0);
  });
});
