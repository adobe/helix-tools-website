/* eslint-env node */
import {
  describe, it, beforeEach, afterEach,
} from 'node:test';
import assert from 'node:assert/strict';
import admin from '../../scripts/helix-admin.js';
import { runSharedBehaviorTests } from './admin-shared-behaviors.js';

// ─── Shared behavioral contract ──────────────────────────────────────────────
describe('helix-admin.js', () => {
  runSharedBehaviorTests(admin);
});

// ─── H5-specific functional tests ────────────────────────────────────────────
describe('helix-admin.js — H5 URL contract', () => {
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
    it('site-scoped URL is /config/{org}/sites/{site}.json', () => {
      assert.equal(
        admin.config({ org: 'adobe', site: 'x' }).url,
        'https://admin.hlx.page/config/adobe/sites/x.json',
      );
    });

    it('org-only URL is /config/{org}.json', () => {
      assert.equal(
        admin.config({ org: 'adobe' }).url,
        'https://admin.hlx.page/config/adobe.json',
      );
    });

    it('profile-scoped URL is /config/{org}/profiles/{profile}.json', () => {
      assert.equal(
        admin.config({ org: 'adobe', profile: 'p' }).url,
        'https://admin.hlx.page/config/adobe/profiles/p.json',
      );
    });

    it('select from site root descends into /config/{org}/sites/{site}/', async () => {
      await admin.config({ org: 'adobe', site: 'x' }).select('robots.txt').read();
      assert.equal(calls[0].url, 'https://admin.hlx.page/config/adobe/sites/x/robots.txt');
    });

    it('select from org root descends into /config/{org}/', async () => {
      await admin.config({ org: 'adobe' }).select('aggregated/x.json').read();
      assert.equal(calls[0].url, 'https://admin.hlx.page/config/adobe/aggregated/x.json');
    });

    it('config({org, site}) ≡ config({org}).select(`sites/{site}.json`)', async () => {
      await admin.config({ org: 'adobe', site: 'x' }).read();
      await admin.config({ org: 'adobe' }).select('sites/x.json').read();
      assert.equal(calls[0].url, calls[1].url);
    });

    it('config({org, profile}) ≡ config({org}).select(`profiles/{profile}.json`)', async () => {
      await admin.config({ org: 'adobe', profile: 'p' }).read();
      await admin.config({ org: 'adobe' }).select('profiles/p.json').read();
      assert.equal(calls[0].url, calls[1].url);
    });

    it('.read() at the site root hits /config/{org}/sites/{site}.json', async () => {
      await admin.config({ org: 'adobe', site: 'x' }).read();
      assert.equal(calls[0].url, 'https://admin.hlx.page/config/adobe/sites/x.json');
    });

    it('.remove() hits the bound URL', async () => {
      await admin.config({ org: 'adobe', site: 'x' }).select('headers.json').remove();
      assert.equal(calls[0].url, 'https://admin.hlx.page/config/adobe/sites/x/headers.json');
    });
  });

  describe('admin.status(coords) URLs', () => {
    it('.url is /status/{org}/{site}/main', () => {
      assert.equal(
        admin.status({ org: 'adobe', site: 'x' }).url,
        'https://admin.hlx.page/status/adobe/x/main',
      );
    });

    it('.get(path) appends to the base URL', async () => {
      await admin.status({ org: 'adobe', site: 'x' }).get('/en/index');
      assert.equal(calls[0].url, 'https://admin.hlx.page/status/adobe/x/main/en/index');
    });

    it('.get(path, { params }) appends query string', async () => {
      await admin.status({ org: 'adobe', site: 'x' }).get('/page', { params: { editUrl: 'auto' } });
      assert.equal(calls[0].url, 'https://admin.hlx.page/status/adobe/x/main/page?editUrl=auto');
    });

    it('.update(path) POSTs a trigger', async () => {
      await admin.status({ org: 'adobe', site: 'x' }).update('/en/index');
      assert.equal(calls[0].url, 'https://admin.hlx.page/status/adobe/x/main/en/index');
      assert.equal(calls[0].init.method, 'POST');
    });

    it('ref: null omits the /main segment', async () => {
      await admin.status({ org: 'adobe', site: 'x', ref: null }).get('');
      assert.equal(calls[0].url, 'https://admin.hlx.page/status/adobe/x');
    });
  });

  describe('admin.preview(coords) URLs', () => {
    it('.url is /preview/{org}/{site}/main', () => {
      assert.equal(
        admin.preview({ org: 'adobe', site: 'x' }).url,
        'https://admin.hlx.page/preview/adobe/x/main',
      );
    });

    it('.get(path) GETs the preview status', async () => {
      await admin.preview({ org: 'adobe', site: 'x' }).get('/en/index');
      assert.equal(calls[0].url, 'https://admin.hlx.page/preview/adobe/x/main/en/index');
    });

    it('.update(path) POSTs a bodyless trigger', async () => {
      await admin.preview({ org: 'adobe', site: 'x' }).update('/en/index');
      assert.equal(calls[0].url, 'https://admin.hlx.page/preview/adobe/x/main/en/index');
    });

    it('.remove(path) DELETEs the preview', async () => {
      await admin.preview({ org: 'adobe', site: 'x' }).remove('/en/index');
      assert.equal(calls[0].url, 'https://admin.hlx.page/preview/adobe/x/main/en/index');
    });
  });

  describe('admin.live(coords) URLs', () => {
    it('.url is /live/{org}/{site}/main', () => {
      assert.equal(
        admin.live({ org: 'adobe', site: 'x' }).url,
        'https://admin.hlx.page/live/adobe/x/main',
      );
    });

    it('.get/.update/.remove hit /live/{org}/{site}/main/{path}', async () => {
      await admin.live({ org: 'adobe', site: 'x' }).get('/en/index');
      assert.equal(calls[0].url, 'https://admin.hlx.page/live/adobe/x/main/en/index');
    });
  });

  describe('admin.psi(coords) URLs', () => {
    it('.url is /psi/{org}/{site}/main', () => {
      assert.equal(
        admin.psi({ org: 'adobe', site: 'x' }).url,
        'https://admin.hlx.page/psi/adobe/x/main',
      );
    });

    it('.get("", { params }) appends query params', async () => {
      await admin.psi({ org: 'adobe', site: 'x' })
        .get('', { params: { url: 'https://main--x--adobe.aem.live/' } });
      const u = new URL(calls[0].url);
      assert.equal(u.searchParams.get('url'), 'https://main--x--adobe.aem.live/');
    });
  });

  describe('admin.log(coords) URLs', () => {
    it('.url is /log/{org}/{site}/main', () => {
      assert.equal(
        admin.log({ org: 'adobe', site: 'x' }).url,
        'https://admin.hlx.page/log/adobe/x/main',
      );
    });
  });

  describe('admin.sidekick(coords)', () => {
    it('.get("config.json") GETs the sidekick config', async () => {
      await admin.sidekick({ org: 'adobe', site: 'x' }).get('config.json');
      assert.equal(calls[0].url, 'https://admin.hlx.page/sidekick/adobe/x/main/config.json');
      assert.equal(calls[0].init.method, 'GET');
    });

    it('does not expose .update or .remove', () => {
      const s = admin.sidekick({ org: 'adobe', site: 'x' });
      assert.equal(s.update, undefined);
      assert.equal(s.remove, undefined);
    });

    it('exposes .url equal to the base operation URL', () => {
      assert.equal(
        admin.sidekick({ org: 'adobe', site: 'x' }).url,
        'https://admin.hlx.page/sidekick/adobe/x/main',
      );
    });
  });

  describe('admin.log(coords)', () => {
    it('.get(path) GETs logs', async () => {
      await admin.log({ org: 'adobe', site: 'x' }).get('');
      assert.equal(calls[0].url, 'https://admin.hlx.page/log/adobe/x/main');
      assert.equal(calls[0].init.method, 'GET');
    });

    it('.update(path) POSTs a log update', async () => {
      await admin.log({ org: 'adobe', site: 'x' }).update('');
      assert.equal(calls[0].url, 'https://admin.hlx.page/log/adobe/x/main');
      assert.equal(calls[0].init.method, 'POST');
    });

    it('does not expose .remove', () => {
      assert.equal(admin.log({ org: 'adobe', site: 'x' }).remove, undefined);
    });
  });

  describe('admin.index(coords)', () => {
    it('.update("/*", body) POSTs application/json to the bulk index endpoint', async () => {
      const payload = { paths: ['/'], indexNames: ['default'] };
      await admin.index({ org: 'adobe', site: 'x' }).update('/*', JSON.stringify(payload));
      assert.equal(calls[0].url, 'https://admin.hlx.page/index/adobe/x/main/*');
    });
  });

  describe('admin.sitemap(coords) URLs', () => {
    it('.update("/sitemap.xml") hits /sitemap/{org}/{site}/main/sitemap.xml', async () => {
      await admin.sitemap({ org: 'adobe', site: 'x' }).update('/sitemap.xml');
      assert.equal(calls[0].url, 'https://admin.hlx.page/sitemap/adobe/x/main/sitemap.xml');
    });
  });

  describe('admin.job(coords) URLs', () => {
    it('.get("topic/name") hits /job/{org}/{site}/main/topic/name', async () => {
      await admin.job({ org: 'adobe', site: 'x' }).get('index/job-123');
      assert.equal(calls[0].url, 'https://admin.hlx.page/job/adobe/x/main/index/job-123');
    });
  });

  describe('admin.raw() H5 URLs', () => {
    it('/path resolves against https://admin.hlx.page', async () => {
      await admin.raw('GET', '/sidekick/adobe/x/main/config.json');
      assert.equal(calls[0].url, 'https://admin.hlx.page/sidekick/adobe/x/main/config.json');
    });
  });

  describe('admin.suggestions(coords) H5 URLs', () => {
    it('org-only includes /config/{org}.json', () => {
      const items = admin.suggestions({ org: 'adobe' });
      assert.ok(items.some(({ url }) => url === 'https://admin.hlx.page/config/adobe.json'));
    });

    it('with site includes /config/{org}/sites/{site}.json', () => {
      const items = admin.suggestions({ org: 'adobe', site: 'x' });
      assert.ok(items.some(({ url }) => url === 'https://admin.hlx.page/config/adobe/sites/x.json'));
    });

    it('with site includes status and preview URLs', () => {
      const items = admin.suggestions({ org: 'adobe', site: 'x' });
      assert.ok(items.some(({ url }) => url.includes('/status/adobe/x/main')));
      assert.ok(items.some(({ url }) => url.includes('/preview/adobe/x/main')));
    });

    it('org-only does not include site-specific URLs', () => {
      const items = admin.suggestions({ org: 'adobe' });
      assert.ok(items.every(({ url }) => !url.includes('/sites/x')));
    });
  });

  describe('admin.coordsFromURL(url) H5 patterns', () => {
    it('parses org from /config/{org}.json', () => {
      assert.deepEqual(
        admin.coordsFromURL('https://admin.hlx.page/config/adobe.json'),
        { org: 'adobe', site: null },
      );
    });

    it('treats /config/{org}/sites.json as org-only (sites list, not a specific site)', () => {
      assert.deepEqual(
        admin.coordsFromURL('https://admin.hlx.page/config/adobe/sites.json'),
        { org: 'adobe', site: null },
      );
    });

    it('parses org + site from /config/{org}/sites/{site}.json', () => {
      assert.deepEqual(
        admin.coordsFromURL('https://admin.hlx.page/config/adobe/sites/x.json'),
        { org: 'adobe', site: 'x' },
      );
    });

    it('parses org + site from a site sub-resource config URL', () => {
      assert.deepEqual(
        admin.coordsFromURL('https://admin.hlx.page/config/adobe/sites/x/cdn.json'),
        { org: 'adobe', site: 'x' },
      );
    });

    it('parses org + site from an operation URL', () => {
      assert.deepEqual(
        admin.coordsFromURL('https://admin.hlx.page/status/adobe/x/main'),
        { org: 'adobe', site: 'x' },
      );
    });

    it('parses org + site from a preview URL with content path', () => {
      assert.deepEqual(
        admin.coordsFromURL('https://admin.hlx.page/preview/adobe/x/main/en/index'),
        { org: 'adobe', site: 'x' },
      );
    });

    it('derived client coordsFromURL parses correctly', () => {
      const a = admin.withRequestInit({ credentials: 'include' });
      assert.deepEqual(
        a.coordsFromURL('https://admin.hlx.page/config/adobe/sites/x.json'),
        { org: 'adobe', site: 'x' },
      );
    });
  });
});
