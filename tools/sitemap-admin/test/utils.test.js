import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { escapeXml, parseHreflang, collectSitemapEntries } from '../utils.js';

describe('sitemap-admin:utils.js', () => {
  describe('escapeXml', () => {
    it('escapes ampersand', () => {
      assert.equal(escapeXml('a & b'), 'a &amp; b');
    });

    it('escapes less-than', () => {
      assert.equal(escapeXml('<tag>'), '&lt;tag&gt;');
    });

    it('escapes greater-than', () => {
      assert.equal(escapeXml('a > b'), 'a &gt; b');
    });

    it('escapes double quotes', () => {
      assert.equal(escapeXml('"value"'), '&quot;value&quot;');
    });

    it('escapes single quotes', () => {
      assert.equal(escapeXml("it's"), 'it&apos;s');
    });

    it('escapes all five special characters together', () => {
      assert.equal(escapeXml('&<>"\' '), '&amp;&lt;&gt;&quot;&apos; ');
    });

    it('returns plain strings unchanged', () => {
      assert.equal(escapeXml('https://example.com/sitemap.xml'), 'https://example.com/sitemap.xml');
    });

    it('handles empty string', () => {
      assert.equal(escapeXml(''), '');
    });

    it('escapes multiple occurrences of the same character', () => {
      assert.equal(escapeXml('a & b & c'), 'a &amp; b &amp; c');
    });

    it('escapes ampersand before other characters to avoid double-escaping', () => {
      // Ensures & is replaced first so &lt; in input becomes &amp;lt; not &lt;
      assert.equal(escapeXml('&lt;'), '&amp;lt;');
    });
  });

  describe('parseHreflang', () => {
    it('returns null for empty string', () => {
      assert.equal(parseHreflang(''), null);
    });

    it('returns null for whitespace-only string', () => {
      assert.equal(parseHreflang('   '), null);
    });

    it('returns null for null input', () => {
      assert.equal(parseHreflang(null), null);
    });

    it('returns null for undefined input', () => {
      assert.equal(parseHreflang(undefined), null);
    });

    it('returns a single string for one value', () => {
      assert.equal(parseHreflang('en'), 'en');
    });

    it('trims whitespace from a single value', () => {
      assert.equal(parseHreflang('  en-US  '), 'en-US');
    });

    it('returns an array for multiple comma-separated values', () => {
      assert.deepEqual(parseHreflang('en, fr, de'), ['en', 'fr', 'de']);
    });

    it('trims whitespace from each value in a list', () => {
      assert.deepEqual(parseHreflang('  en-US , fr-FR  ,  de-DE  '), ['en-US', 'fr-FR', 'de-DE']);
    });

    it('filters out empty tokens produced by trailing commas', () => {
      // "en," has a trailing comma — the empty token after it should be dropped
      assert.equal(parseHreflang('en,'), 'en');
    });

    it('returns null when input is only commas', () => {
      assert.equal(parseHreflang(',,,'), null);
    });

    it('returns an array when exactly two values are present', () => {
      assert.deepEqual(parseHreflang('en,fr'), ['en', 'fr']);
    });
  });

  describe('collectSitemapEntries', () => {
    it('returns empty array for null input', () => {
      assert.deepEqual(collectSitemapEntries(null), []);
    });

    it('returns empty array for undefined input', () => {
      assert.deepEqual(collectSitemapEntries(undefined), []);
    });

    it('returns empty array for empty sitemaps object', () => {
      assert.deepEqual(collectSitemapEntries({}), []);
    });

    it('collects destination from a simple sitemap', () => {
      const sitemaps = {
        main: { source: '/query-index.json', destination: '/sitemap.xml' },
      };
      assert.deepEqual(collectSitemapEntries(sitemaps), [
        { destination: '/sitemap.xml', origin: '' },
      ]);
    });

    it('uses the origin field from a simple sitemap when present', () => {
      const sitemaps = {
        main: { source: '/query-index.json', destination: '/sitemap.xml', origin: 'https://example.com' },
      };
      assert.deepEqual(collectSitemapEntries(sitemaps), [
        { destination: '/sitemap.xml', origin: 'https://example.com' },
      ]);
    });

    it('skips simple sitemaps with no destination', () => {
      const sitemaps = {
        noDestination: { source: '/query-index.json' },
      };
      assert.deepEqual(collectSitemapEntries(sitemaps), []);
    });

    it('collects destinations from a multi-language sitemap', () => {
      const sitemaps = {
        multilang: {
          languages: {
            en: { source: '/en/query-index.json', destination: '/en/sitemap.xml' },
            fr: { source: '/fr/query-index.json', destination: '/fr/sitemap.xml' },
          },
        },
      };
      assert.deepEqual(collectSitemapEntries(sitemaps), [
        { destination: '/en/sitemap.xml', origin: '' },
        { destination: '/fr/sitemap.xml', origin: '' },
      ]);
    });

    it('uses top-level origin for each language entry in a multi-language sitemap', () => {
      const sitemaps = {
        multilang: {
          origin: 'https://example.com',
          languages: {
            en: { source: '/en/query-index.json', destination: '/en/sitemap.xml' },
          },
        },
      };
      assert.deepEqual(collectSitemapEntries(sitemaps), [
        { destination: '/en/sitemap.xml', origin: 'https://example.com' },
      ]);
    });

    it('skips language entries with no destination', () => {
      const sitemaps = {
        multilang: {
          languages: {
            en: { source: '/en/query-index.json', destination: '/en/sitemap.xml' },
            fr: { source: '/fr/query-index.json' }, // no destination
          },
        },
      };
      assert.deepEqual(collectSitemapEntries(sitemaps), [
        { destination: '/en/sitemap.xml', origin: '' },
      ]);
    });

    it('collects entries from a mix of simple and multi-language sitemaps', () => {
      const sitemaps = {
        simple: { source: '/query-index.json', destination: '/sitemap.xml' },
        multilang: {
          languages: {
            en: { destination: '/en/sitemap.xml' },
            de: { destination: '/de/sitemap.xml' },
          },
        },
      };
      assert.deepEqual(collectSitemapEntries(sitemaps), [
        { destination: '/sitemap.xml', origin: '' },
        { destination: '/en/sitemap.xml', origin: '' },
        { destination: '/de/sitemap.xml', origin: '' },
      ]);
    });

    it('treats a sitemap with an empty languages object as multi-lang with no entries', () => {
      const sitemaps = {
        multilang: { languages: {} },
      };
      assert.deepEqual(collectSitemapEntries(sitemaps), []);
    });
  });
});
