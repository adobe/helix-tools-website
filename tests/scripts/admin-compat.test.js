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

// getAdminClientForSite() is the only public entry point for per-site H5/H6
// selection — the underlying probe (isHelix6) is private, so its behavior
// (caching, override, error handling) is exercised indirectly here via which
// client module ends up loaded and whether a network call was made at all.
describe('getAdminClientForSite()', () => {
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

  it('returns the H6 client for a Helix 6 site', async () => {
    stubFetch('true');
    const client = await getAdminClientForSite({ org: 'h6org', site: 's' });
    assert.deepEqual(client, { clientId: 'aem-admin' });
  });

  it('returns the H5 client for a legacy site', async () => {
    stubFetch(null);
    const client = await getAdminClientForSite({ org: 'h5org', site: 's' });
    assert.deepEqual(client, { clientId: 'helix-admin' });
  });

  it('probes the legacy sidekick config endpoint for the default ref', async () => {
    const calls = stubFetch('true');
    await getAdminClientForSite({ org: 'o', site: 'probe-default-ref' });
    assert.equal(calls[0].url, 'https://admin.hlx.page/sidekick/o/probe-default-ref/main/config.json');
    assert.equal(calls[0].init.credentials, 'omit');
  });

  it('honors an explicit ref', async () => {
    const calls = stubFetch('true');
    await getAdminClientForSite({ org: 'o', site: 'probe-explicit-ref', ref: 'dev' });
    assert.equal(calls[0].url, 'https://admin.hlx.page/sidekick/o/probe-explicit-ref/dev/config.json');
  });

  it('short-circuits to the H6 client on the use-h6-api override without a network call', async () => {
    window.localStorage.setItem('use-h6-api', '');
    const calls = stubFetch('false');
    const client = await getAdminClientForSite({ org: 'o', site: 'override-site' });
    assert.deepEqual(client, { clientId: 'aem-admin' });
    assert.equal(calls.length, 0);
  });

  it('returns the H5 client without a network call when coords are incomplete', async () => {
    const calls = stubFetch('true');
    const client = await getAdminClientForSite({ org: 'o' });
    assert.deepEqual(client, { clientId: 'helix-admin' });
    assert.equal(calls.length, 0);
  });

  it('caches detection per site to dedupe concurrent probes', async () => {
    const calls = stubFetch('true');
    const [a, b] = await Promise.all([
      getAdminClientForSite({ org: 'cached', site: 's' }),
      getAdminClientForSite({ org: 'cached', site: 's' }),
    ]);
    assert.deepEqual(a, { clientId: 'aem-admin' });
    assert.deepEqual(b, { clientId: 'aem-admin' });
    assert.equal(calls.length, 1);
  });

  it('treats a network error as not-Helix6, returning the H5 client', async () => {
    stubFetch(null, { throws: true });
    const client = await getAdminClientForSite({ org: 'err', site: 's' });
    assert.deepEqual(client, { clientId: 'helix-admin' });
  });
});
