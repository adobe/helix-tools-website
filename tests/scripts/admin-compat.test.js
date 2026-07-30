/* eslint-env node */
import {
  describe, it, afterEach, mock,
} from 'node:test';
import assert from 'node:assert/strict';

// Mock the two admin modules before loading admin-compat so that
// getAdminClient()'s dynamic import picks up the stubs.
mock.module('../../scripts/helix-admin.js', {
  defaultExport: { clientId: 'helix-admin' },
});
mock.module('../../scripts/aem-admin.js', {
  defaultExport: { clientId: 'aem-admin' },
});

const {
  default: getAdminClient,
  isHelix6,
  getAdminClientForSite,
} = await import('../../scripts/admin-compat.js');

describe('getAdminClient()', () => {
  afterEach(() => {
    window.localStorage.removeItem('use-h6-api');
  });

  it('returns the H5 client when use-h6-api is absent', async () => {
    const client = await getAdminClient();
    assert.deepEqual(client, { clientId: 'helix-admin' });
  });

  it('returns the H6 client when use-h6-api is present with an empty value', async () => {
    window.localStorage.setItem('use-h6-api', '');
    const client = await getAdminClient();
    assert.deepEqual(client, { clientId: 'aem-admin' });
  });

  it('returns the H6 client regardless of the key\'s value', async () => {
    window.localStorage.setItem('use-h6-api', 'true');
    const client = await getAdminClient();
    assert.deepEqual(client, { clientId: 'aem-admin' });
  });
});

describe('isHelix6()', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    window.localStorage.removeItem('use-h6-api');
    global.fetch = originalFetch;
  });

  const stubFetch = (headerValue, { throws = false } = {}) => {
    const calls = [];
    global.fetch = async (url, init) => {
      calls.push({ url, init });
      if (throws) throw new Error('network down');
      return { headers: { get: (name) => (name === 'x-api-upgrade-available' ? headerValue : null) } };
    };
    return calls;
  };

  it('returns true when the upgrade header is present', async () => {
    stubFetch('true');
    assert.equal(await isHelix6({ org: 'adobe', site: 'aem-website' }), true);
  });

  it('returns false when the upgrade header is absent', async () => {
    stubFetch(null);
    assert.equal(await isHelix6({ org: 'adobe', site: 'helix-tools-website' }), false);
  });

  it('probes the legacy sidekick config endpoint for the default ref', async () => {
    const calls = stubFetch('true');
    await isHelix6({ org: 'o', site: 's' });
    assert.equal(calls[0].url, 'https://admin.hlx.page/sidekick/o/s/main/config.json');
    assert.equal(calls[0].init.credentials, 'omit');
  });

  it('honors an explicit ref', async () => {
    const calls = stubFetch('true');
    await isHelix6({ org: 'o', site: 's', ref: 'dev' });
    assert.equal(calls[0].url, 'https://admin.hlx.page/sidekick/o/s/dev/config.json');
  });

  it('short-circuits to true on the use-h6-api override without a network call', async () => {
    window.localStorage.setItem('use-h6-api', '');
    const calls = stubFetch('false');
    assert.equal(await isHelix6({ org: 'o', site: 's' }), true);
    assert.equal(calls.length, 0);
  });

  it('returns false without a network call when coords are incomplete', async () => {
    const calls = stubFetch('true');
    assert.equal(await isHelix6({ org: 'o' }), false);
    assert.equal(calls.length, 0);
  });

  it('caches detection per site to dedupe concurrent probes', async () => {
    const calls = stubFetch('true');
    const [a, b] = await Promise.all([
      isHelix6({ org: 'cached', site: 's' }),
      isHelix6({ org: 'cached', site: 's' }),
    ]);
    assert.equal(a, true);
    assert.equal(b, true);
    assert.equal(calls.length, 1);
  });

  it('treats a network error as not-Helix6', async () => {
    stubFetch(null, { throws: true });
    assert.equal(await isHelix6({ org: 'err', site: 's' }), false);
  });
});

describe('getAdminClientForSite()', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    window.localStorage.removeItem('use-h6-api');
    global.fetch = originalFetch;
  });

  it('returns the H6 client for a Helix 6 site', async () => {
    global.fetch = async () => ({
      headers: { get: () => 'true' },
    });
    const client = await getAdminClientForSite({ org: 'h6org', site: 's' });
    assert.deepEqual(client, { clientId: 'aem-admin' });
  });

  it('returns the H5 client for a legacy site', async () => {
    global.fetch = async () => ({
      headers: { get: () => null },
    });
    const client = await getAdminClientForSite({ org: 'h5org', site: 's' });
    assert.deepEqual(client, { clientId: 'helix-admin' });
  });
});
