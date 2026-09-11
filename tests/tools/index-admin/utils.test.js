import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import deriveReindexPaths, { deriveAutoMetaUpdate } from '../../../tools/index-admin/utils.js';

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

  describe('deriveAutoMetaUpdate', () => {
    it('fills selectFirst when both fields are empty', () => {
      assert.deepEqual(
        deriveAutoMetaUpdate({
          oldName: '', newName: 'description', selectVal: '', selectFirstVal: '',
        }),
        { selectFirst: 'meta[property="og:description"]' },
      );
    });

    it('no-ops when the name did not actually change', () => {
      assert.deepEqual(
        deriveAutoMetaUpdate({
          oldName: 'description', newName: 'description', selectVal: '', selectFirstVal: 'meta[property="og:description"]',
        }),
        {},
      );
    });

    it('updates selectFirst when it still matches what we generated for the old name', () => {
      assert.deepEqual(
        deriveAutoMetaUpdate({
          oldName: 'description', newName: 'excerpt', selectVal: '', selectFirstVal: 'meta[property="og:description"]',
        }),
        { selectFirst: 'meta[name="excerpt"]' },
      );
    });

    it('leaves selectFirst alone when it does not match the old name pattern (custom value)', () => {
      assert.deepEqual(
        deriveAutoMetaUpdate({
          oldName: 'description', newName: 'excerpt', selectVal: '', selectFirstVal: 'meta[name="custom-excerpt"]',
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
        deriveAutoMetaUpdate({
          oldName: 'description', newName: 'excerpt', selectVal: '', selectFirstVal: 'meta[property="og:title"]',
        }),
        {},
      );
    });

    it('updates select when it matches the old-name pattern', () => {
      assert.deepEqual(
        deriveAutoMetaUpdate({
          oldName: 'title', newName: 'headline', selectVal: 'meta[property="og:title"]', selectFirstVal: '',
        }),
        { select: 'meta[name="headline"]' },
      );
    });
  });
});
