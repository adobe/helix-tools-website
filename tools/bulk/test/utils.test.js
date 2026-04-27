import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeUrls, extractOrgSite } from '../utils.js';

describe('bulk:utils.js', () => {
  describe('extractOrgSite', () => {
    it('extracts org and site from a standard AEM URL', () => {
      const result = extractOrgSite('https://main--mysite--myorg.aem.page/some/path');
      assert.deepEqual(result, { org: 'myorg', site: 'mysite' });
    });
  });

  describe('analyzeUrls', () => {
    it('passes a clean HTTPS URL through unmodified', () => {
      const result = analyzeUrls(['https://main--site--org.aem.page/some/path']);
      assert.deepEqual(result.urls, ['https://main--site--org.aem.page/some/path']);
      assert.deepEqual(result.rejected, []);
      assert.deepEqual(result.modified, []);
      assert.deepEqual(result.deduplicated, []);
    });

    it('rejects an HTTP URL', () => {
      const result = analyzeUrls(['http://main--site--org.aem.page/page']);
      assert.deepEqual(result.urls, []);
      assert.equal(result.rejected.length, 1);
      assert.equal(result.rejected[0].original, 'http://main--site--org.aem.page/page');
      assert.match(result.rejected[0].reason, /https/);
    });

    it('rejects an invalid URL format', () => {
      const result = analyzeUrls(['/just/a/path']);
      assert.deepEqual(result.urls, []);
      assert.equal(result.rejected.length, 1);
      assert.equal(result.rejected[0].reason, 'Invalid URL format');
    });

    it('strips query params and records as modified', () => {
      const result = analyzeUrls(['https://main--site--org.aem.page/path?foo=bar']);
      assert.deepEqual(result.urls, ['https://main--site--org.aem.page/path']);
      assert.equal(result.modified.length, 1);
      assert.equal(result.modified[0].original, 'https://main--site--org.aem.page/path?foo=bar');
      assert.ok(result.modified[0].changes.includes('query params removed'));
    });

    it('strips hash and records as modified', () => {
      const result = analyzeUrls(['https://main--site--org.aem.page/path#section']);
      assert.deepEqual(result.urls, ['https://main--site--org.aem.page/path']);
      assert.equal(result.modified.length, 1);
      assert.ok(result.modified[0].changes.includes('hash removed'));
    });

    it('lowercases uppercase path segments', () => {
      const result = analyzeUrls(['https://main--site--org.aem.page/UPPER/Path']);
      assert.deepEqual(result.urls, ['https://main--site--org.aem.page/upper/path']);
      assert.equal(result.modified.length, 1);
      assert.ok(result.modified[0].changes.some((c) => c.includes('lowercase')));
    });

    it('normalizes accented characters', () => {
      const result = analyzeUrls(['https://main--site--org.aem.page/caf\u00e9']);
      assert.deepEqual(result.urls, ['https://main--site--org.aem.page/cafe']);
      assert.equal(result.modified.length, 1);
    });

    it('collapses duplicate slashes', () => {
      const result = analyzeUrls(['https://main--site--org.aem.page//double//slash']);
      assert.deepEqual(result.urls, ['https://main--site--org.aem.page/double/slash']);
      assert.equal(result.modified.length, 1);
      assert.ok(result.modified[0].changes.some((c) => c.includes('duplicate slashes')));
    });

    it('deduplicates identical URLs and reports them', () => {
      const url = 'https://main--site--org.aem.page/page';
      const result = analyzeUrls([url, url, url]);
      assert.deepEqual(result.urls, [url]);
      assert.deepEqual(result.deduplicated, [url]);
    });

    it('deduplicates URLs that normalize to the same value', () => {
      const result = analyzeUrls([
        'https://main--site--org.aem.page/Page',
        'https://main--site--org.aem.page/page',
      ]);
      assert.deepEqual(result.urls, ['https://main--site--org.aem.page/page']);
      assert.deepEqual(result.deduplicated, ['https://main--site--org.aem.page/page']);
    });

    it('preserves .json suffix on the last path segment', () => {
      const result = analyzeUrls(['https://main--site--org.aem.page/data.json']);
      assert.deepEqual(result.urls, ['https://main--site--org.aem.page/data.json']);
      assert.deepEqual(result.modified, []);
    });

    it('silently skips null/empty entries', () => {
      const result = analyzeUrls([null, '', 'https://main--site--org.aem.page/page']);
      assert.deepEqual(result.urls, ['https://main--site--org.aem.page/page']);
      assert.deepEqual(result.rejected, []);
    });

    it('rejects whitespace-only entries as invalid URL format', () => {
      const result = analyzeUrls(['   ']);
      assert.equal(result.rejected.length, 1);
      assert.equal(result.rejected[0].reason, 'Invalid URL format');
    });

    it('tracks the original unsanitized URL alongside the sanitized one', () => {
      const original = 'https://main--site--org.aem.page/UPPER';
      const result = analyzeUrls([original]);
      assert.deepEqual(result.urls, ['https://main--site--org.aem.page/upper']);
      assert.deepEqual(result.urlsUnsanitized, [original]);
    });

    it('handles mixed valid, rejected, and modified URLs in one call', () => {
      const result = analyzeUrls([
        'https://main--site--org.aem.page/clean',
        'http://main--site--org.aem.page/rejected',
        'https://main--site--org.aem.page/Has Spaces',
        'not-a-url',
      ]);
      assert.equal(result.urls.length, 2);
      assert.equal(result.rejected.length, 2);
      assert.equal(result.modified.length, 1);
    });
  });
});
