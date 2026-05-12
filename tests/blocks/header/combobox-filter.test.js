import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { filterItems } from '../../../blocks/header/combobox-filter.js';

describe('blocks/header/combobox-filter.js · filterItems', () => {
  const items = ['adobe', 'Acme Corp', 'globex', 'Initech'];

  it('returns all items for an empty query, as a copy (not the same array)', () => {
    const result = filterItems('', items);
    assert.deepEqual(result, items);
    assert.notStrictEqual(result, items);
  });

  it('matches case-insensitively on substring', () => {
    assert.deepEqual(filterItems('ADOBE', items), ['adobe']);
    assert.deepEqual(filterItems('corp', items), ['Acme Corp']);
  });

  it('returns an empty array when nothing matches', () => {
    assert.deepEqual(filterItems('zzz', items), []);
  });

  it('matches a substring in the middle of a string', () => {
    assert.deepEqual(filterItems('lob', items), ['globex']);
  });

  it('returns all items for a whitespace-only query', () => {
    const result = filterItems('   ', items);
    assert.deepEqual(result, items);
    assert.notStrictEqual(result, items);
  });

  it('does not mutate the input array', () => {
    const input = ['one', 'two', 'three'];
    const copy = [...input];
    filterItems('two', input);
    assert.deepEqual(input, copy);
  });
});
