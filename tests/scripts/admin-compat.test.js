/* eslint-env node */
import {
  describe, it, afterEach, mock,
} from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as nextTurn } from 'node:timers/promises';

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

  const stubFetch = (headerValue) => {
    const calls = [];
    global.fetch = async (url, init) => {
      calls.push({ url, init });
      return new Response(null, {
        headers: headerValue === null ? {} : { 'x-api-upgrade-available': headerValue },
      });
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

  it('retries a network failure after one second before selecting the backend', async (t) => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 });
    const attempts = [];
    t.mock.method(global, 'fetch', async (url, init) => {
      attempts.push({
        url, credentials: init.credentials, cache: init.cache, time: Date.now(),
      });
      if (attempts.length === 1) throw new TypeError('Failed to fetch');
      return new Response(null, {
        status: 401,
        headers: { 'x-api-upgrade-available': 'true' },
      });
    });

    const pending = getAdminClientForSite({ org: 'retry-network', site: 's', ref: 'dev' });
    await nextTurn();
    t.mock.timers.tick(999);
    await nextTurn();
    const attemptsBeforeDelay = attempts.length;
    t.mock.timers.tick(1);
    await nextTurn();

    const probe = {
      url: 'https://admin.hlx.page/sidekick/retry-network/s/dev/config.json',
      credentials: 'omit',
      cache: 'no-store',
    };
    assert.deepEqual(
      { attemptsBeforeDelay, attempts },
      {
        attemptsBeforeDelay: 1,
        attempts: [{ ...probe, time: 0 }, { ...probe, time: 1000 }],
      },
    );
    assert.deepEqual(await pending, { clientId: 'aem-admin' });
  });

  [400, 403, 404, 500, 501, 505].forEach((status) => {
    it(`fails immediately on HTTP ${status} instead of selecting a backend`, async (t) => {
      const fetchMock = t.mock.method(global, 'fetch', async () => new Response(null, {
        status,
        headers: { 'x-api-upgrade-available': 'true' },
      }));
      await assert.rejects(
        getAdminClientForSite({ org: `nonretry-${status}`, site: 's' }),
        new RegExp(`HTTP ${status}`),
      );
      assert.equal(fetchMock.mock.callCount(), 1);
    });
  });

  ['permanent', 'timeout'].forEach((failure) => {
    it(`shares a ${failure} failure but allows a fresh detection afterwards`, async (t) => {
      t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 });
      let recover = false;
      const fetchMock = t.mock.method(global, 'fetch', async () => {
        if (recover) {
          return new Response(null, { headers: { 'x-api-upgrade-available': 'true' } });
        }
        return new Response(null, { status: failure === 'permanent' ? 500 : 503 });
      });
      const coords = { org: `recover-${failure}`, site: 's' };
      const pending = Promise.allSettled([
        getAdminClientForSite(coords),
        getAdminClientForSite(coords),
      ]);
      await nextTurn();
      if (failure === 'timeout') {
        const delays = [1000, 2000, 4000, 8000, 8000, 7000];
        for (let i = 0; i < delays.length; i += 1) {
          t.mock.timers.tick(delays[i]);
          // eslint-disable-next-line no-await-in-loop
          await nextTurn();
        }
      }
      const results = await pending;
      assert.deepEqual(results.map(({ status }) => status), ['rejected', 'rejected']);
      assert.equal(results[0].reason, results[1].reason);
      const expectedAttempts = failure === 'permanent' ? 1 : 6;
      assert.equal(fetchMock.mock.callCount(), expectedAttempts);
      recover = true;
      const client = await getAdminClientForSite(coords).catch((error) => error);
      assert.deepEqual(client, { clientId: 'aem-admin' });
      assert.equal(fetchMock.mock.callCount(), expectedAttempts + 1);
    });
  });
});
