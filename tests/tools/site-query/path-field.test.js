import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { suggestPath } from '../../../tools/site-query/path-field.js';

describe('site-query:path-field.js', () => {
  describe('suggestPath', () => {
    it('cuts a full URL down to its path', () => {
      assert.equal(suggestPath('https://www.ingredion.com/na/en-us/sitemap'), '/na/en-us/sitemap');
    });

    it('keeps the file name of a sitemap or query index', () => {
      assert.equal(suggestPath('https://main--site--org.aem.live/sitemap.xml'), '/sitemap.xml');
      assert.equal(suggestPath('https://www.example.com/query-index.json'), '/query-index.json');
    });

    it('drops the query string and fragment', () => {
      assert.equal(suggestPath('https://www.example.com/sitemap.xml?x=1#top'), '/sitemap.xml');
    });

    it('accepts http, protocol-relative URLs, mixed case and whitespace', () => {
      assert.equal(suggestPath('http://www.example.com/a'), '/a');
      assert.equal(suggestPath('//www.example.com/a'), '/a');
      assert.equal(suggestPath('HTTPS://www.example.com/a'), '/a');
      assert.equal(suggestPath('  https://www.example.com/a  '), '/a');
    });

    it('returns null for a path', () => {
      assert.equal(suggestPath('/sitemap.xml'), null);
      assert.equal(suggestPath('/na/en-us/'), null);
      assert.equal(suggestPath('sitemap.xml'), null);
    });

    it('returns null for empty values and a bare scheme', () => {
      assert.equal(suggestPath(''), null);
      assert.equal(suggestPath(undefined), null);
      assert.equal(suggestPath('https://'), null);
    });

    it('suggests the root unless told not to', () => {
      assert.equal(suggestPath('https://www.example.com'), '/');
      assert.equal(suggestPath('https://www.example.com/', { allowRoot: false }), null);
      assert.equal(suggestPath('https://www.example.com/a', { allowRoot: false }), '/a');
    });
  });
});
