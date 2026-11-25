import {
  describe, it, beforeEach, afterEach, mock,
} from 'node:test';
import assert from 'node:assert/strict';
import h5Admin from '../../../scripts/helix-admin.js';
import h6Admin from '../../../scripts/aem-admin.js';
import adminForURL, { movedToH6 } from '../../../tools/admin-edit/utils.js';

describe('admin-edit:utils.js', () => {
  describe('adminForURL', () => {
    it('returns the H5 client for admin.hlx.page URLs', () => {
      assert.equal(adminForURL('https://admin.hlx.page/config/adobe/sites/foo.json'), h5Admin);
    });

    it('returns the H6 client for api.aem.live URLs', () => {
      assert.equal(adminForURL('https://api.aem.live/adobe/sites/foo/config.json'), h6Admin);
    });

    it('defaults to the H6 client for other hosts', () => {
      assert.equal(adminForURL('https://example.com/adobe/sites/foo/config.json'), h6Admin);
    });

    it('defaults to the H6 client for unparseable input', () => {
      assert.equal(adminForURL('not a url'), h6Admin);
    });
  });

  describe('movedToH6', () => {
    let requested;

    const upgradeFetch = (upgrade) => mock.method(global, 'fetch', async (url) => {
      requested.push(String(url));
      return new Response('', { status: 401, headers: { 'x-api-upgrade-available': String(upgrade) } });
    });

    beforeEach(() => {
      requested = [];
      global.localStorage = window.localStorage;
      window.localStorage.removeItem('use-h6-api');
    });
    afterEach(() => { mock.restoreAll(); });

    it('is true for an H5 site URL whose site is on H6', async () => {
      upgradeFetch(true);
      assert.equal(await movedToH6('https://admin.hlx.page/status/myorg/mysite/main/index'), true);
      assert.deepEqual(requested, ['https://admin.hlx.page/sidekick/myorg/mysite/main/config.json']);
    });

    it('is false for an H5 site URL whose site is not on H6', async () => {
      upgradeFetch(false);
      assert.equal(await movedToH6('https://admin.hlx.page/config/myorg/sites/mysite.json'), false);
      assert.deepEqual(requested, ['https://admin.hlx.page/sidekick/myorg/mysite/main/config.json']);
    });

    it('is false without detection for an H5 org-only URL', async () => {
      upgradeFetch(true);
      assert.equal(await movedToH6('https://admin.hlx.page/config/myorg.json'), false);
      assert.deepEqual(requested, []);
    });

    it('is false without detection for an H6 URL', async () => {
      upgradeFetch(true);
      assert.equal(await movedToH6('https://api.aem.live/myorg/sites/mysite/status/index'), false);
      assert.deepEqual(requested, []);
    });
  });
});
