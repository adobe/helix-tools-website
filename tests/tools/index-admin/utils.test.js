import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import deriveReindexPaths, {
  isAutoMetaSelector,
  metaSelectFirstForProperty,
  suggestPropertyConfig,
  deriveAutoPropertyUpdate,
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

  describe('deriveAutoPropertyUpdate', () => {
    it('fills selectFirst and value when all fields are empty', () => {
      assert.deepEqual(
        deriveAutoPropertyUpdate({
          oldName: '', newName: 'description', selectVal: '', selectFirstVal: '', valueVal: '',
        }),
        { selectFirst: 'meta[property="og:description"]', value: META_VALUE },
      );
    });

    it('no-ops when the name did not actually change', () => {
      assert.deepEqual(
        deriveAutoPropertyUpdate({
          oldName: 'description',
          newName: 'description',
          selectVal: '',
          selectFirstVal: 'meta[property="og:description"]',
          valueVal: META_VALUE,
        }),
        {},
      );
    });

    it('updates selectFirst when it still matches what we generated for the old name', () => {
      assert.deepEqual(
        deriveAutoPropertyUpdate({
          oldName: 'description',
          newName: 'excerpt',
          selectVal: '',
          selectFirstVal: 'meta[property="og:description"]',
          valueVal: META_VALUE,
        }),
        { selectFirst: 'meta[name="excerpt"]', value: META_VALUE },
      );
    });

    it('leaves selectFirst alone when it does not match the old name pattern (custom value)', () => {
      assert.deepEqual(
        deriveAutoPropertyUpdate({
          oldName: 'description',
          newName: 'excerpt',
          selectVal: '',
          selectFirstVal: 'meta[name="custom-excerpt"]',
          valueVal: 'attribute(el, "data-excerpt")',
        }),
        {},
      );
    });

    it('leaves a field alone when it looks auto-generated but for an unrelated name', () => {
      // e.g. field was renamed from "title" to "excerpt" previously, leaving an
      // og:title selector that happens to match the auto-pattern regex, but not
      // what we'd generate for the prior name "title" -> should be left alone here
      // since oldName passed in is "description", not "title"
      assert.deepEqual(
        deriveAutoPropertyUpdate({
          oldName: 'description',
          newName: 'excerpt',
          selectVal: '',
          selectFirstVal: 'meta[property="og:title"]',
          valueVal: 'attribute(el, "data-title")',
        }),
        {},
      );
    });

    it('updates select when it matches the old-name pattern', () => {
      assert.deepEqual(
        deriveAutoPropertyUpdate({
          oldName: 'title',
          newName: 'headline',
          selectVal: 'meta[property="og:title"]',
          selectFirstVal: '',
          valueVal: META_VALUE,
        }),
        { select: 'meta[name="headline"]', value: META_VALUE },
      );
    });

    it('switches from lastModified config to a meta selector on rename', () => {
      assert.deepEqual(
        deriveAutoPropertyUpdate({
          oldName: 'lastModified',
          newName: 'published',
          selectVal: LAST_MODIFIED_CONFIG.select,
          selectFirstVal: '',
          valueVal: LAST_MODIFIED_CONFIG.value,
        }),
        { select: '', selectFirst: 'meta[name="published"]', value: META_VALUE },
      );
    });

    it('fills the lastModified config when renaming into lastModified', () => {
      assert.deepEqual(
        deriveAutoPropertyUpdate({
          oldName: 'published',
          newName: 'lastModified',
          selectVal: '',
          selectFirstVal: 'meta[name="published"]',
          valueVal: META_VALUE,
        }),
        { select: LAST_MODIFIED_CONFIG.select, selectFirst: '', value: LAST_MODIFIED_CONFIG.value },
      );
    });
  });
});
