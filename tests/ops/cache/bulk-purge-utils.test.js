import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseHostList,
  KEY_PRESETS,
  DEFAULT_PRESET_IDS,
  expandTemplate,
  buildKeys,
  parseList,
  parsePaths,
  summarizePurgeLog,
} from '../../../ops/cache/bulk-purge-utils.js';

describe('bulk-purge-utils.js', () => {
  describe('parseHostList', () => {
    it('parses hosts separated by mixed whitespace and commas', () => {
      const result = parseHostList('main--site1--org.aem.live,\nmain--site2--org.aem.page  main--site3--org.aem.live');
      assert.equal(result.sites.length, 3);
      assert.deepEqual(result.sites.map((s) => s.liveHost), [
        'main--site1--org.aem.live',
        'main--site2--org.aem.live',
        'main--site3--org.aem.live',
      ]);
      assert.deepEqual(result.rejected, []);
      assert.deepEqual(result.duplicates, []);
    });

    it('extracts hostname from a full URL with a path', () => {
      const result = parseHostList('https://main--site--org.aem.page/some/path?x=1');
      assert.equal(result.sites.length, 1);
      assert.equal(result.sites[0].host, 'main--site--org.aem.page');
      assert.equal(result.sites[0].liveHost, 'main--site--org.aem.live');
    });

    it('treats the .page and .live hosts of the same site as a duplicate', () => {
      const result = parseHostList('main--site--org.aem.page main--site--org.aem.live');
      assert.equal(result.sites.length, 1);
      assert.equal(result.sites[0].input, 'main--site--org.aem.page');
      assert.equal(result.duplicates.length, 1);
      assert.deepEqual(result.duplicates[0], {
        input: 'main--site--org.aem.live',
        liveHost: 'main--site--org.aem.live',
      });
    });

    it('accepts hlx and -fastly/-cloudflare domain variants', () => {
      const result = parseHostList([
        'main--site--org.hlx.live',
        'main--site--org.aem-fastly.page',
        'main--site--org.hlx-cloudflare.live',
      ].join(' '));
      // all resolve to the same liveHost, so only the first is kept
      assert.equal(result.sites.length, 1);
      assert.equal(result.duplicates.length, 2);
    });

    it('lowercases uppercase hostnames', () => {
      const result = parseHostList('MAIN--SITE--ORG.AEM.LIVE');
      assert.equal(result.sites.length, 1);
      assert.equal(result.sites[0].liveHost, 'main--site--org.aem.live');
      assert.equal(result.sites[0].ref, 'main');
      assert.equal(result.sites[0].site, 'site');
      assert.equal(result.sites[0].org, 'org');
    });

    it('parses ref/site/org segments containing single hyphens', () => {
      const result = parseHostList('main--my-site--my-org.aem.live');
      assert.equal(result.sites.length, 1);
      assert.deepEqual(
        { ref: result.sites[0].ref, site: result.sites[0].site, org: result.sites[0].org },
        { ref: 'main', site: 'my-site', org: 'my-org' },
      );
    });

    it('rejects a non-AEM custom domain', () => {
      const result = parseHostList('www.example.com');
      assert.deepEqual(result.sites, []);
      assert.equal(result.rejected.length, 1);
      assert.equal(result.rejected[0].input, 'www.example.com');
      assert.match(result.rejected[0].reason, /aem\.live|aem\.page/);
    });

    it('rejects a garbage URL as invalid', () => {
      const result = parseHostList('http://');
      assert.deepEqual(result.sites, []);
      assert.equal(result.rejected.length, 1);
      assert.equal(result.rejected[0].input, 'http://');
    });

    it('returns empty result for empty input', () => {
      const result = parseHostList('');
      assert.deepEqual(result, { sites: [], rejected: [], duplicates: [] });
    });
  });

  describe('KEY_PRESETS / DEFAULT_PRESET_IDS', () => {
    it('is frozen', () => {
      assert.ok(Object.isFrozen(KEY_PRESETS));
    });

    it('defaults to metadata', () => {
      assert.deepEqual(DEFAULT_PRESET_IDS, ['metadata']);
    });

    it('defines the expected preset ids', () => {
      assert.deepEqual(
        KEY_PRESETS.map((p) => p.id),
        ['metadata', 'content', 'media', 'head', '404', 'code', 'site'],
      );
    });
  });

  describe('expandTemplate', () => {
    const siteInfo = {
      ref: 'main', site: 'mysite', org: 'myorg', contentBusId: 'abc123',
    };

    it('expands {cbid}', () => {
      assert.equal(expandTemplate('{cbid}_metadata', siteInfo), 'abc123_metadata');
    });

    it('expands {ref}/{site}/{org}', () => {
      assert.equal(expandTemplate('{ref}--{site}--{org}_head', siteInfo), 'main--mysite--myorg_head');
    });

    it('throws when {cbid} is used but contentBusId is missing', () => {
      assert.throws(() => expandTemplate('{cbid}_media', { ref: 'main', site: 's', org: 'o' }), /contentBusId/);
    });

    it('does not throw when {cbid} is absent and contentBusId is missing', () => {
      assert.equal(expandTemplate('{ref}--{site}--{org}', { ref: 'main', site: 's', org: 'o' }), 'main--s--o');
    });

    it('throws on an unknown placeholder', () => {
      assert.throws(() => expandTemplate('{cbid}_{bogus}', siteInfo), /bogus/);
    });
  });

  describe('buildKeys', () => {
    const siteInfo = {
      ref: 'main', site: 'mysite', org: 'myorg', contentBusId: 'abc123',
    };

    it('expands the metadata preset with its preview variant', () => {
      const keys = buildKeys({ presetIds: ['metadata'] }, siteInfo);
      assert.deepEqual(keys, ['abc123_metadata', 'p_abc123_metadata']);
    });

    it('expands the content preset with its preview variant', () => {
      const keys = buildKeys({ presetIds: ['content'] }, siteInfo);
      assert.deepEqual(keys, ['abc123', 'p_abc123']);
    });

    it('expands the media preset with no preview variant', () => {
      const keys = buildKeys({ presetIds: ['media'] }, siteInfo);
      assert.deepEqual(keys, ['abc123_media']);
    });

    it('expands the head preset with no preview variant', () => {
      const keys = buildKeys({ presetIds: ['head'] }, siteInfo);
      assert.deepEqual(keys, ['main--mysite--myorg_head']);
    });

    it('expands the 404 preset with no preview variant', () => {
      const keys = buildKeys({ presetIds: ['404'] }, siteInfo);
      assert.deepEqual(keys, ['main--mysite--myorg_404']);
    });

    it('expands the code preset with no preview variant', () => {
      const keys = buildKeys({ presetIds: ['code'] }, siteInfo);
      assert.deepEqual(keys, ['main--mysite--myorg_code']);
    });

    it('expands the site preset with no preview variant', () => {
      const keys = buildKeys({ presetIds: ['site'] }, siteInfo);
      assert.deepEqual(keys, ['main--mysite--myorg']);
    });

    it('dedupes keys across presets and custom keys', () => {
      const keys = buildKeys({
        presetIds: ['content'],
        customKeys: ['{cbid}', 'p_{cbid}'],
      }, siteInfo);
      assert.deepEqual(keys, ['abc123', 'p_abc123']);
    });

    it('adds custom keys as-is without an automatic preview variant', () => {
      const keys = buildKeys({ customKeys: ['p_{cbid}_x', '{ref}--{site}--{org}_custom'] }, siteInfo);
      assert.deepEqual(keys, ['p_abc123_x', 'main--mysite--myorg_custom']);
    });

    it('throws for an unknown preset id', () => {
      assert.throws(() => buildKeys({ presetIds: ['bogus'] }, siteInfo), /Unknown preset/);
    });

    it('throws when a preset needing contentBusId is used without one', () => {
      assert.throws(
        () => buildKeys({ presetIds: ['metadata'] }, { ref: 'main', site: 's', org: 'o' }),
        /contentBusId/,
      );
    });
  });

  describe('parseList', () => {
    it('splits on commas and whitespace and dedupes', () => {
      assert.deepEqual(parseList('a, b\nc  a'), ['a', 'b', 'c']);
    });

    it('returns an empty array for empty input', () => {
      assert.deepEqual(parseList(''), []);
    });
  });

  describe('parsePaths', () => {
    it('separates valid paths from invalid tokens', () => {
      const result = parsePaths('/foo /bar baz');
      assert.deepEqual(result.paths, ['/foo', '/bar']);
      assert.deepEqual(result.invalid, ['baz']);
    });

    it('returns empty arrays for empty input', () => {
      assert.deepEqual(parsePaths(''), { paths: [], invalid: [] });
    });
  });

  describe('summarizePurgeLog', () => {
    it('counts ERROR and WARN prefixed lines', () => {
      const log = [
        'INFO: starting purge',
        'ERROR: failed to purge key x',
        'WARN: fastly purge slow',
        'ERROR: failed to purge key y',
        'INFO: done',
      ].join('\n');
      assert.deepEqual(summarizePurgeLog(log), { errors: 2, warnings: 1 });
    });

    it('returns zero counts for a clean log', () => {
      assert.deepEqual(summarizePurgeLog('INFO: all good\nINFO: done'), { errors: 0, warnings: 0 });
    });

    it('returns zero counts for empty input', () => {
      assert.deepEqual(summarizePurgeLog(''), { errors: 0, warnings: 0 });
    });
  });
});
