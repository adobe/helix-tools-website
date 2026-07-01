/* eslint-env node */
import {
  describe, it, beforeEach, afterEach,
} from 'node:test';
import assert from 'node:assert/strict';
import admin from '../../scripts/aem-admin.js';
import runSharedBehaviorTests from './admin-shared-behaviors.js';

// ─── Shared behavioral contract ──────────────────────────────────────────────
describe('aem-admin.js', () => {
  runSharedBehaviorTests(admin);
});

// ─── H6-specific functional tests ────────────────────────────────────────────
describe('aem-admin.js — H6 URL contract', () => {
  const realFetch = global.fetch;
  let calls;
  let respond;

  beforeEach(() => {
    calls = [];
    respond = () => new Response('', { status: 200 });
    global.fetch = async (url, init) => {
      calls.push({ url, init: init || {} });
      return respond();
    };
  });

  afterEach(() => {
    global.fetch = realFetch;
  });

  describe('admin.config(coords) URLs', () => {
    it('site-scoped URL is /{org}/sites/{site}/config.json', () => {
      assert.equal(
        admin.config({ org: 'adobe', site: 'x' }).url,
        'https://api.aem.live/adobe/sites/x/config.json',
      );
    });

    it('org-only URL is /{org}/config.json', () => {
      assert.equal(
        admin.config({ org: 'adobe' }).url,
        'https://api.aem.live/adobe/config.json',
      );
    });

    it('profile-scoped URL is /{org}/profiles/{profile}/config.json', () => {
      assert.equal(
        admin.config({ org: 'adobe', profile: 'p' }).url,
        'https://api.aem.live/adobe/profiles/p/config.json',
      );
    });

    it('select from site root descends into /{org}/sites/{site}/config/', async () => {
      await admin.config({ org: 'adobe', site: 'x' }).select('robots.txt').read();
      assert.equal(calls[0].url, 'https://api.aem.live/adobe/sites/x/config/robots.txt');
    });

    it('.read() at the site root hits /{org}/sites/{site}/config.json', async () => {
      await admin.config({ org: 'adobe', site: 'x' }).read();
      assert.equal(calls[0].url, 'https://api.aem.live/adobe/sites/x/config.json');
    });

    it('.read() at the org root hits /{org}/config.json', async () => {
      await admin.config({ org: 'adobe' }).read();
      assert.equal(calls[0].url, 'https://api.aem.live/adobe/config.json');
    });

    it('.read() at the profile root hits /{org}/profiles/{profile}/config.json', async () => {
      await admin.config({ org: 'adobe', profile: 'p' }).read();
      assert.equal(calls[0].url, 'https://api.aem.live/adobe/profiles/p/config.json');
    });
  });

  describe('admin.status(coords) URLs', () => {
    it('.url is /{org}/sites/{site}/status', () => {
      assert.equal(
        admin.status({ org: 'adobe', site: 'x' }).url,
        'https://api.aem.live/adobe/sites/x/status',
      );
    });

    it('.get(path) appends to the base URL', async () => {
      await admin.status({ org: 'adobe', site: 'x' }).get('/en/index');
      assert.equal(calls[0].url, 'https://api.aem.live/adobe/sites/x/status/en/index');
    });

    it('.get(path, { params }) appends query string', async () => {
      await admin.status({ org: 'adobe', site: 'x' }).get('/page', { params: { editUrl: 'auto' } });
      assert.equal(
        calls[0].url,
        'https://api.aem.live/adobe/sites/x/status/page?editUrl=auto',
      );
    });

    it('.update(path) POSTs a trigger', async () => {
      await admin.status({ org: 'adobe', site: 'x' }).update('/en/index');
      assert.equal(calls[0].url, 'https://api.aem.live/adobe/sites/x/status/en/index');
      assert.equal(calls[0].init.method, 'POST');
    });
  });

  describe('admin.preview(coords) URLs', () => {
    it('.url is /{org}/sites/{site}/preview', () => {
      assert.equal(
        admin.preview({ org: 'adobe', site: 'x' }).url,
        'https://api.aem.live/adobe/sites/x/preview',
      );
    });

    it('.get(path) GETs the preview status', async () => {
      await admin.preview({ org: 'adobe', site: 'x' }).get('/en/index');
      assert.equal(calls[0].url, 'https://api.aem.live/adobe/sites/x/preview/en/index');
    });

    it('.update(path) POSTs a bodyless trigger', async () => {
      await admin.preview({ org: 'adobe', site: 'x' }).update('/en/index');
      assert.equal(calls[0].url, 'https://api.aem.live/adobe/sites/x/preview/en/index');
    });

    it('.remove(path) DELETEs the preview', async () => {
      await admin.preview({ org: 'adobe', site: 'x' }).remove('/en/index');
      assert.equal(calls[0].url, 'https://api.aem.live/adobe/sites/x/preview/en/index');
    });
  });

  describe('admin.live(coords) URLs', () => {
    it('.url is /{org}/sites/{site}/live', () => {
      assert.equal(
        admin.live({ org: 'adobe', site: 'x' }).url,
        'https://api.aem.live/adobe/sites/x/live',
      );
    });
  });

  describe('admin.psi(coords) URLs', () => {
    it('.url is /{org}/sites/{site}/psi', () => {
      assert.equal(
        admin.psi({ org: 'adobe', site: 'x' }).url,
        'https://api.aem.live/adobe/sites/x/psi',
      );
    });
  });

  describe('admin.log(coords) URLs', () => {
    it('.url is /{org}/sites/{site}/log', () => {
      assert.equal(
        admin.log({ org: 'adobe', site: 'x' }).url,
        'https://api.aem.live/adobe/sites/x/log',
      );
    });
  });

  describe('admin.index(coords) URLs', () => {
    it('.update("/*", body) hits /{org}/sites/{site}/index/*', async () => {
      await admin.index({ org: 'adobe', site: 'x' }).update('/*', JSON.stringify({ paths: ['/'] }));
      assert.equal(calls[0].url, 'https://api.aem.live/adobe/sites/x/index/*');
    });
  });

  describe('admin.sitemap(coords) URLs', () => {
    it('.update("/sitemap.xml") hits /{org}/sites/{site}/sitemap/sitemap.xml', async () => {
      await admin.sitemap({ org: 'adobe', site: 'x' }).update('/sitemap.xml');
      assert.equal(calls[0].url, 'https://api.aem.live/adobe/sites/x/sitemap/sitemap.xml');
    });
  });

  describe('admin.job(coords) URLs', () => {
    it('.get("topic/name") hits /{org}/sites/{site}/job/topic/name', async () => {
      await admin.job({ org: 'adobe', site: 'x' }).get('index/job-123');
      assert.equal(calls[0].url, 'https://api.aem.live/adobe/sites/x/job/index/job-123');
    });
  });

  describe('admin.snapshot(coords) URLs', () => {
    it('.url is /{org}/sites/{site}/snapshot', () => {
      assert.equal(
        admin.snapshot({ org: 'adobe', site: 'x' }).url,
        'https://api.aem.live/adobe/sites/x/snapshot',
      );
    });
  });

  describe('admin.sidekick(coords) URLs', () => {
    it('.url is /{org}/sites/{site}/sidekick', () => {
      assert.equal(
        admin.sidekick({ org: 'adobe', site: 'x' }).url,
        'https://api.aem.live/adobe/sites/x/sidekick',
      );
    });
  });

  describe('admin.medialog(coords) URLs', () => {
    it('.get("") GETs /{org}/sites/{site}/medialog', async () => {
      await admin.medialog({ org: 'adobe', site: 'x' }).get('');
      assert.equal(calls[0].url, 'https://api.aem.live/adobe/sites/x/medialog');
      assert.equal(calls[0].init.method, 'GET');
    });

    it('does not expose .update or .remove', () => {
      const ml = admin.medialog({ org: 'adobe', site: 'x' });
      assert.equal(ml.update, undefined);
      assert.equal(ml.remove, undefined);
    });

    it('exposes .url equal to the base operation URL', () => {
      assert.equal(
        admin.medialog({ org: 'adobe', site: 'x' }).url,
        'https://api.aem.live/adobe/sites/x/medialog',
      );
    });
  });

  describe('admin.raw() H6 URLs', () => {
    it('/path resolves against https://api.aem.live', async () => {
      await admin.raw('GET', '/adobe/sites/x/status');
      assert.equal(calls[0].url, 'https://api.aem.live/adobe/sites/x/status');
    });
  });

  describe('admin.suggestions(coords) H6 URLs', () => {
    it('org-only includes /{org}/config.json', () => {
      const items = admin.suggestions({ org: 'adobe' });
      assert.ok(items.some(({ url }) => url === 'https://api.aem.live/adobe/config.json'));
    });

    it('org-only includes /{org}/sites.json and /{org}/profiles.json', () => {
      const items = admin.suggestions({ org: 'adobe' });
      assert.ok(items.some(({ url }) => url === 'https://api.aem.live/adobe/sites.json'));
      assert.ok(items.some(({ url }) => url === 'https://api.aem.live/adobe/profiles.json'));
    });

    it('with site includes /{org}/sites/{site}/config.json', () => {
      const items = admin.suggestions({ org: 'adobe', site: 'x' });
      assert.ok(items.some(({ url }) => url === 'https://api.aem.live/adobe/sites/x/config.json'));
    });

    it('with site includes status and preview URLs', () => {
      const items = admin.suggestions({ org: 'adobe', site: 'x' });
      assert.ok(items.some(({ url }) => url === 'https://api.aem.live/adobe/sites/x/status'));
      assert.ok(items.some(({ url }) => url === 'https://api.aem.live/adobe/sites/x/preview'));
    });

    it('org-only does not include site-specific URLs', () => {
      const items = admin.suggestions({ org: 'adobe' });
      assert.ok(items.every(({ url }) => !url.includes('/sites/x')));
    });
  });

  describe('admin.coordsFromURL(url) H6 patterns', () => {
    it('parses org + site from /{org}/sites/{site}/config.json', () => {
      assert.deepEqual(
        admin.coordsFromURL('https://api.aem.live/adobe/sites/x/config.json'),
        { org: 'adobe', site: 'x' },
      );
    });

    it('parses org-only from /{org}/config.json', () => {
      assert.deepEqual(
        admin.coordsFromURL('https://api.aem.live/adobe/config.json'),
        { org: 'adobe', site: null },
      );
    });

    it('treats /{org}/sites.json as org-only (list, not a specific site)', () => {
      assert.deepEqual(
        admin.coordsFromURL('https://api.aem.live/adobe/sites.json'),
        { org: 'adobe', site: null },
      );
    });

    it('parses org + site from an operation URL', () => {
      assert.deepEqual(
        admin.coordsFromURL('https://api.aem.live/adobe/sites/x/status'),
        { org: 'adobe', site: 'x' },
      );
    });

    it('parses org + site from an operation URL with content path', () => {
      assert.deepEqual(
        admin.coordsFromURL('https://api.aem.live/adobe/sites/x/preview/en/index'),
        { org: 'adobe', site: 'x' },
      );
    });

    it('derived client coordsFromURL parses correctly', () => {
      const a = admin.withRequestInit({ credentials: 'include' });
      assert.deepEqual(
        a.coordsFromURL('https://api.aem.live/adobe/sites/x/config.json'),
        { org: 'adobe', site: 'x' },
      );
    });
  });
});
