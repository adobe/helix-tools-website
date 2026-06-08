import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import deriveReindexPaths, { buildCopyIndexStates } from '../../../tools/index-admin/utils.js';

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

  describe('buildCopyIndexStates', () => {
    it('returns an empty array when sourceIndices is empty', () => {
      assert.deepEqual(buildCopyIndexStates({}, new Set(['existing']), false), []);
    });

    it('returns enabled+checked items when there are no conflicts', () => {
      const result = buildCopyIndexStates(
        { foo: {}, bar: {} },
        new Set(),
        false,
      );
      assert.equal(result.length, 2);
      result.forEach((item) => {
        assert.equal(item.conflicts, false);
        assert.equal(item.disabled, false);
        assert.equal(item.checked, true);
      });
    });

    it('disables and unchecks conflicting items when overwrite is false', () => {
      const result = buildCopyIndexStates(
        { foo: {}, bar: {} },
        new Set(['foo', 'bar']),
        false,
      );
      result.forEach((item) => {
        assert.equal(item.conflicts, true);
        assert.equal(item.disabled, true);
        assert.equal(item.checked, false);
      });
    });

    it('enables and checks conflicting items when overwrite is true', () => {
      const result = buildCopyIndexStates(
        { foo: {}, bar: {} },
        new Set(['foo', 'bar']),
        true,
      );
      result.forEach((item) => {
        assert.equal(item.conflicts, true);
        assert.equal(item.disabled, false);
        assert.equal(item.checked, true);
      });
    });

    it('marks conflict correctly for only the matching names', () => {
      const result = buildCopyIndexStates(
        { foo: {}, bar: {}, baz: {} },
        new Set(['bar']),
        false,
      );
      const byName = Object.fromEntries(result.map((item) => [item.name, item]));
      assert.equal(byName.foo.conflicts, false);
      assert.equal(byName.foo.disabled, false);
      assert.equal(byName.bar.conflicts, true);
      assert.equal(byName.bar.disabled, true);
      assert.equal(byName.baz.conflicts, false);
      assert.equal(byName.baz.disabled, false);
    });

    it('enables all items when overwrite is true, even with mixed conflicts', () => {
      const result = buildCopyIndexStates(
        { foo: {}, bar: {}, baz: {} },
        new Set(['bar']),
        true,
      );
      result.forEach((item) => {
        assert.equal(item.disabled, false);
        assert.equal(item.checked, true);
      });
    });

    it('preserves source index name order', () => {
      const result = buildCopyIndexStates(
        { c: {}, a: {}, b: {} },
        new Set(),
        false,
      );
      assert.deepEqual(result.map((item) => item.name), ['c', 'a', 'b']);
    });

    it('overwrite=false has no effect when there are no conflicts', () => {
      const withOverwrite = buildCopyIndexStates({ foo: {} }, new Set(), true);
      const withoutOverwrite = buildCopyIndexStates({ foo: {} }, new Set(), false);
      assert.deepEqual(withOverwrite, withoutOverwrite);
    });
  });
});
