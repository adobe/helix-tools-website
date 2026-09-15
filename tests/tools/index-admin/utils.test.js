import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import deriveReindexPaths, {
  isAutoMetaSelector,
  metaSelectFirstForProperty,
  suggestPropertyConfig,
  LAST_MODIFIED_CONFIG,
  META_VALUE,
} from '../../../tools/index-admin/utils.js';

describe('index-admin:utils.js', () => {
  describe('deriveReindexPaths', () => {
    it('returns /* when includes is null', () => {
      assert.deepEqual(deriveReindexPaths(null), ['/*']);
    });

    it('returns /* when includes is empty', () => {
      assert.deepEqual(deriveReindexPaths([]), ['/*']);
    });

    it('returns /* when any pattern is a top-level wildcard (/**)', () => {
      assert.deepEqual(deriveReindexPaths(['/**']), ['/*']);
    });

    it('returns /* directly when a pattern is /*', () => {
      assert.deepEqual(deriveReindexPaths(['/*']), ['/*']);
    });

    it('short-circuits to /* when one of multiple patterns covers root', () => {
      assert.deepEqual(deriveReindexPaths(['/blog/**', '/**']), ['/*']);
    });

    it('uses a static path (no wildcards) as-is', () => {
      assert.deepEqual(deriveReindexPaths(['/about']), ['/about']);
    });

    it('derives base path from a single nested wildcard pattern', () => {
      assert.deepEqual(deriveReindexPaths(['/blog/**']), ['/blog/*']);
    });

    it('strips wildcard segment and returns parent path with /*', () => {
      assert.deepEqual(deriveReindexPaths(['/en/blog/**']), ['/en/blog/*']);
    });

    it('handles mid-path wildcard correctly', () => {
      // ['', 'en', '*', 'posts'] — stops at '*' → base is /en → /en/*
      assert.deepEqual(deriveReindexPaths(['/en/*/posts']), ['/en/*']);
    });

    it('deduplicates paths that resolve to the same base', () => {
      const result = deriveReindexPaths(['/blog/**', '/blog/*.json']);
      assert.deepEqual(result, ['/blog/*']);
    });

    it('returns multiple distinct base paths without duplicates', () => {
      const result = deriveReindexPaths(['/blog/**', '/news/**', '/docs/**']);
      assert.deepEqual(result.sort(), ['/blog/*', '/docs/*', '/news/*'].sort());
    });

    it('mixes static paths and wildcard patterns correctly', () => {
      const result = deriveReindexPaths(['/about', '/blog/**']);
      assert.ok(result.includes('/about'));
      assert.ok(result.includes('/blog/*'));
      assert.equal(result.length, 2);
    });

    it('does not short-circuit to /* when a static path is /about alongside wildcard', () => {
      const result = deriveReindexPaths(['/about', '/blog/**']);
      assert.ok(!result.includes('/*'));
    });

    it('deduplicates identical static paths', () => {
      assert.deepEqual(deriveReindexPaths(['/about', '/about']), ['/about']);
    });

    it('handles the default new-index include patterns from the UI', () => {
      // The "Add Index" button seeds: ['/**', '**/fragments/**', '**/drafts/**', '**/*.json']
      // '/**' resolves to '/*' which triggers the short-circuit
      const result = deriveReindexPaths(['/**', '**/fragments/**', '**/drafts/**', '**/*.json']);
      assert.deepEqual(result, ['/*']);
    });

    it('handles a pattern with wildcard at the very start (no leading slash)', () => {
      // segments: ['**', 'fragments', '**'] — first segment is wildcard, so pathSegments = []
      // basePath = '' → '/', which maps to '/*'
      assert.deepEqual(deriveReindexPaths(['**/fragments/**']), ['/*']);
    });
  });
  describe('metaSelectFirstForProperty', () => {
    it('returns an empty string for an empty name', () => {
      assert.equal(metaSelectFirstForProperty('  '), '');
    });

    it('maps open graph properties', () => {
      assert.equal(metaSelectFirstForProperty('title'), 'meta[property="og:title"]');
      assert.equal(metaSelectFirstForProperty('Description'), 'meta[property="og:description"]');
      assert.equal(metaSelectFirstForProperty('image'), 'meta[property="og:image"]');
    });

    it('maps date to the publication date meta', () => {
      assert.equal(metaSelectFirstForProperty('date'), 'meta[name="publication-date"]');
    });

    it('kebab-cases other names', () => {
      assert.equal(metaSelectFirstForProperty('author'), 'meta[name="author"]');
      assert.equal(metaSelectFirstForProperty('readingTime'), 'meta[name="reading-time"]');
    });
  });

  describe('isAutoMetaSelector', () => {
    it('recognizes generated selectors', () => {
      assert.equal(isAutoMetaSelector('meta[name="author"]'), true);
      assert.equal(isAutoMetaSelector('  meta[property="og:title"]  '), true);
    });

    it('rejects hand-written selectors', () => {
      assert.equal(isAutoMetaSelector('main > div'), false);
      assert.equal(isAutoMetaSelector('none'), false);
      assert.equal(isAutoMetaSelector(''), false);
    });
  });

  describe('suggestPropertyConfig', () => {
    it('suggests the response header for lastModified', () => {
      assert.deepEqual(suggestPropertyConfig('lastModified'), {
        select: LAST_MODIFIED_CONFIG.select,
        selectFirst: '',
        value: LAST_MODIFIED_CONFIG.value,
      });
    });

    it('matches lastModified regardless of case and padding', () => {
      assert.deepEqual(suggestPropertyConfig('  LastModified '), suggestPropertyConfig('lastModified'));
    });

    it('suggests a meta selector for other properties', () => {
      assert.deepEqual(suggestPropertyConfig('author'), {
        select: '',
        selectFirst: 'meta[name="author"]',
        value: META_VALUE,
      });
    });

    it('suggests no selector for an empty name', () => {
      assert.deepEqual(suggestPropertyConfig(''), {
        select: '',
        selectFirst: '',
        value: META_VALUE,
      });
    });
  });
});
