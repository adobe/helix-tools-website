import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { matchesCategory, matchesSearch, parseCategoryFromUrl } from '../../../blocks/tool-catalog/filter.js';

const map = {
  'setup-configure': {
    label: 'Setup & Configure',
    tools: [
      { url: '/tools/admin-edit/index.html', label: 'Admin Edit' },
      { url: '/tools/site-admin/index.html', label: 'Site Admin' },
    ],
  },
  'publish-manage': {
    label: 'Publish & Manage',
    tools: [
      { url: '/tools/bulk/index.html', label: 'Bulk Operations' },
    ],
  },
};

describe('blocks/tool-catalog/filter.js', () => {
  describe('matchesCategory', () => {
    it('treats "all" or null as match-everything', () => {
      assert.equal(matchesCategory('/tools/admin-edit/index.html', 'all', map), true);
      assert.equal(matchesCategory('/tools/admin-edit/index.html', null, map), true);
      assert.equal(matchesCategory('/tools/admin-edit/index.html', '', map), true);
    });
    it('matches when path is in the slug bucket', () => {
      assert.equal(matchesCategory('/tools/admin-edit/index.html', 'setup-configure', map), true);
      assert.equal(matchesCategory('/tools/bulk/index.html', 'publish-manage', map), true);
    });
    it('does not match when path is not in the slug bucket', () => {
      assert.equal(matchesCategory('/tools/bulk/index.html', 'setup-configure', map), false);
    });
    it('returns false for unknown slug', () => {
      assert.equal(matchesCategory('/tools/admin-edit/index.html', 'nope', map), false);
    });
    it('normalizes /index.html and trailing slash equivalence', () => {
      const m = { foo: { label: 'Foo', tools: [{ url: '/tools/x/', label: 'X' }] } };
      assert.equal(matchesCategory('/tools/x/index.html', 'foo', m), true);
      assert.equal(matchesCategory('/tools/x', 'foo', m), true);
    });
  });

  describe('matchesSearch', () => {
    it('matches everything for an empty or whitespace query', () => {
      assert.equal(matchesSearch('Admin Edit', ''), true);
      assert.equal(matchesSearch('Admin Edit', '   '), true);
      assert.equal(matchesSearch('Admin Edit', undefined), true);
    });
    it('matches case-insensitive substrings', () => {
      assert.equal(matchesSearch('Admin Edit — manage metadata', 'METADATA'), true);
      assert.equal(matchesSearch('Bulk Operations', 'bulk'), true);
    });
    it('does not match when the query is absent from the text', () => {
      assert.equal(matchesSearch('Admin Edit', 'sitemap'), false);
    });
    it('trims surrounding whitespace from the query', () => {
      assert.equal(matchesSearch('Admin Edit', '  edit  '), true);
    });
    it('treats missing text as no match for a non-empty query', () => {
      assert.equal(matchesSearch('', 'edit'), false);
      assert.equal(matchesSearch(undefined, 'edit'), false);
    });
  });

  describe('parseCategoryFromUrl', () => {
    it('reads ?category=', () => {
      assert.equal(parseCategoryFromUrl('https://x/?category=publish-manage'), 'publish-manage');
    });
    it('returns null when missing', () => {
      assert.equal(parseCategoryFromUrl('https://x/'), null);
    });
  });
});
