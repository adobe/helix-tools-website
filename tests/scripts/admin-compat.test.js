/* eslint-env node */
import {
  describe, it, afterEach,
} from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as nextTurn } from 'node:timers/promises';
import h5Admin from '../../scripts/helix-admin.js';
import h6Admin from '../../scripts/aem-admin.js';

const {
  default: getAdminClient,
  getAdminClientForSite,
  getAdminClientForOrg,
} = await import('../../scripts/admin-compat.js');

describe('getAdminClient()', () => {
  afterEach(() => {
    window.localStorage.removeItem('use-h6-api');
  });

  it('returns the H5 client when use-h6-api is absent', async () => {
    const client = await getAdminClient();
    assert.equal(client, h5Admin);
  });

  it('returns the H6 client when use-h6-api is present with an empty value', async () => {
    window.localStorage.setItem('use-h6-api', '');
    const client = await getAdminClient();
    assert.equal(client, h6Admin);
  });

  it('returns the H6 client regardless of the key\'s value', async () => {
    window.localStorage.setItem('use-h6-api', 'true');
    const client = await getAdminClient();
    assert.equal(client, h6Admin);
  });
});

// getAdminClientForSite() is the only public entry point for per-site H5/H6
// selection and binding. Probe requests are intercepted; resources use the real adapters.
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

  [
    { backend: 'H5', header: null, admin: h5Admin },
    { backend: 'H6', header: 'true', admin: h6Admin },
  ].forEach(({ backend, header, admin }) => {
    it(`binds every ${backend} resource to an immutable snapshot of the supplied target`, async () => {
      const calls = stubFetch(header);
      const coords = { org: `bound-${backend}`, site: 'docs', ref: 'dev' };
      const expected = { ...coords };
      const pending = getAdminClientForSite(coords);
      coords.org = 'changed';
      coords.site = 'changed';
      coords.ref = 'changed';
      const client = await pending;

      assert.deepEqual(client.coords, expected);
      assert.equal(calls[0].url, `https://admin.hlx.page/sidekick/${expected.org}/docs/dev/config.json`);
      assert.equal(Object.isFrozen(client), true);
      assert.equal(Object.isFrozen(client.coords), true);
      assert.throws(() => { client.coords.site = 'another'; }, TypeError);
      assert.throws(() => { client.coords = coords; }, TypeError);

      const operations = [
        'status', 'preview', 'live', 'code', 'log', 'index',
        'sitemap', 'job', 'psi', 'snapshot', 'sidekick', 'medialog',
      ];
      operations.forEach((operation) => {
        const segment = backend === 'H6' && operation === 'job' ? 'jobs' : operation;
        const url = backend === 'H5'
          ? `https://admin.hlx.page/${operation}/${expected.org}/docs/dev`
          : `https://api.aem.live/${expected.org}/sites/docs/${segment}`;
        assert.equal(client[operation]().url, url, operation);
      });
      assert.equal(
        client.config().url,
        backend === 'H5'
          ? `https://admin.hlx.page/config/${expected.org}/sites/docs.json`
          : `https://api.aem.live/${expected.org}/sites/docs/config.json`,
      );
      assert.deepEqual(client.suggestions(), admin.suggestions(expected));
    });

    it(`exposes a read-only ${backend} aggregated config bound to the site`, async () => {
      stubFetch(header);
      const client = await getAdminClientForSite({ org: `agg-${backend}`, site: 'docs', ref: 'dev' });

      assert.equal(typeof client.aggregated, 'function');
      assert.equal(
        client.aggregated().url,
        backend === 'H5'
          ? `https://admin.hlx.page/config/agg-${backend}/aggregated/docs.json`
          : `https://api.aem.live/agg-${backend}/sites/docs/config.json?aggregated=true`,
      );
      assert.throws(() => client.aggregated({ org: 'other', site: 'other' }), TypeError);
    });
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

  it('uses main for detection while retaining ref null for unversioned H5 operation URLs', async () => {
    const calls = stubFetch(null);
    const client = await getAdminClientForSite({ org: 'no-ref', site: 'docs', ref: null });
    assert.equal(calls[0].url, 'https://admin.hlx.page/sidekick/no-ref/docs/main/config.json');
    assert.equal(client.coords.ref, null);
    assert.equal(client.status().url, 'https://admin.hlx.page/status/no-ref/docs');
  });

  it('short-circuits to the H6 client on the use-h6-api override without a network call', async () => {
    window.localStorage.setItem('use-h6-api', '');
    const calls = stubFetch('false');
    const client = await getAdminClientForSite({ org: 'o', site: 'override-site' });
    assert.equal(client.status().url, 'https://api.aem.live/o/sites/override-site/status');
    assert.equal(calls.length, 0);
  });

  it('respects override changes without reusing a client selected under a different policy', async () => {
    const calls = stubFetch(null);
    const coords = { org: 'override-cache', site: 'docs' };
    const detected = await getAdminClientForSite(coords);
    assert.equal(detected.status().url, 'https://admin.hlx.page/status/override-cache/docs/main');

    window.localStorage.setItem('use-h6-api', '');
    const forced = await getAdminClientForSite(coords);
    assert.notEqual(forced, detected);
    assert.equal(forced.status().url, 'https://api.aem.live/override-cache/sites/docs/status');
    assert.equal(await getAdminClientForSite(coords), forced);

    window.localStorage.removeItem('use-h6-api');
    assert.equal(await getAdminClientForSite(coords), detected);
    assert.equal(calls.length, 1);
  });

  it('rejects invalid binding coordinates before probing, including when H6 is forced', async () => {
    const calls = stubFetch('true');
    window.localStorage.setItem('use-h6-api', '');
    const invalid = [
      undefined,
      null,
      {},
      { org: 'o' },
      { org: '', site: 's' },
      { org: 'o', site: ' ' },
      { org: 7, site: 's' },
      { org: 'o', site: {} },
      { org: 'o', site: 's', ref: 7 },
      { org: 'o', site: 's', ref: '' },
    ];
    await Promise.all(invalid.map((coords) => assert.rejects(
      getAdminClientForSite(coords),
      { name: 'TypeError', message: /non-empty/ },
    )));
    assert.equal(calls.length, 0);
  });

  it('reuses cached clients across concurrent and settled calls with the same normalized target', async () => {
    const calls = stubFetch('true');
    const [a, b] = await Promise.all([
      getAdminClientForSite({ org: 'cached', site: 's' }),
      getAdminClientForSite({ org: 'cached', site: 's', ref: 'main' }),
    ]);
    assert.equal(a, b);
    assert.equal(await getAdminClientForSite({ org: 'cached', site: 's' }), a);
    assert.equal(a.status().url, 'https://api.aem.live/cached/sites/s/status');
    const targets = [
      { org: 'other', site: 's', ref: 'main' },
      { org: 'cached', site: 'other', ref: 'main' },
      { org: 'cached', site: 's', ref: 'dev' },
    ];
    const clients = await Promise.all(targets.map((coords) => getAdminClientForSite(coords)));
    clients.forEach((client, i) => {
      assert.notEqual(client, a);
      assert.deepEqual(client.coords, targets[i]);
    });
    assert.equal(calls.length, 4);
  });

  it('rejects arguments to bound resource accessors instead of silently ignoring old coordinates', async () => {
    const calls = stubFetch(null);
    const client = await getAdminClientForSite({ org: 'no-retarget', site: 'docs' });
    const accessors = [
      'config', 'status', 'preview', 'live', 'code', 'log', 'index',
      'sitemap', 'job', 'psi', 'snapshot', 'sidekick', 'medialog', 'suggestions',
    ];
    accessors.forEach((name) => {
      assert.throws(
        () => client[name]({ org: 'another', site: 'site' }),
        { name: 'TypeError', message: /does not accept arguments/ },
      );
    });
    assert.equal(calls.length, 1);
  });

  [
    { backend: 'H5', header: null, versionParam: 'hlx-admin-version' },
    { backend: 'H6', header: 'true', versionParam: 'aem-api-version' },
  ].forEach(({ backend, header, versionParam }) => {
    it(`keeps ${backend} derived clients bound while forwarding defaults, version pins, and raw URLs`, async () => {
      const calls = stubFetch(header);
      const coords = { org: `derived-${backend}`, site: 'docs', ref: 'branch' };
      const base = await getAdminClientForSite(coords);
      const defaults = base.withRequestInit({
        credentials: 'include',
        headers: new Headers({ 'x-client': 'derived' }),
        params: { tenant: 'shared' },
      });
      const pinned = defaults.pinVersion('revision');
      const unpinned = pinned.pinVersion();

      [defaults, pinned, unpinned].forEach((client) => {
        assert.deepEqual(client.coords, coords);
        assert.equal(client.status().url, base.status().url);
      });
      const root = base.status().url;
      const rawUrl = `${base.job().url}/api-returned-job`;
      calls.length = 0;
      await base.status().get('/base');
      await defaults.status().get('/defaults');
      await pinned.status().update('/pinned', '{}');
      await unpinned.status().get('/unpinned');
      await pinned.raw('GET', rawUrl);

      assert.deepEqual(calls.map(({ url }) => url), [
        `${root}/base`,
        `${root}/defaults?tenant=shared`,
        `${root}/pinned?tenant=shared&${versionParam}=revision`,
        `${root}/unpinned?tenant=shared`,
        `${rawUrl}?tenant=shared&${versionParam}=revision`,
      ]);
      assert.equal(calls[0].init.credentials, undefined);
      assert.equal(calls[2].init.credentials, 'include');
      assert.equal(calls[2].init.method, 'POST');
      assert.equal(calls[2].init.body, '{}');
      assert.equal(calls[2].init.headers.get('x-client'), 'derived');
      assert.equal(await getAdminClientForSite(coords), base);
    });
  });

  [
    { backend: 'H5', header: null },
    { backend: 'H6', header: 'true' },
  ].forEach(({ backend, header }) => {
    it(`rejects raw URLs outside the ${backend} target before fetching, including on derived clients`, async () => {
      const calls = stubFetch(header);
      const org = `raw-scope-${backend}`;
      const base = await getAdminClientForSite({ org, site: 'docs', ref: 'branch' });
      const root = base.job().url;
      const config = base.config().url;
      const invalid = [
        root.replace(new URL(root).origin, 'https://example.com'),
        root.replace(new URL(root).origin, backend === 'H5'
          ? 'https://api.aem.live' : 'https://admin.hlx.page'),
        root.replace('https:', 'http:'),
        root.replace(`/${org}/`, '/another-org/'),
        root.replace('/docs', '/docs-extra'),
        config.replace(`/${org}/`, '/another-org/'),
        config.replace('/docs', '/docs-extra'),
        `${root}/../../another-site`,
        `${root}/%2e%2e/%2e%2e/another-site`,
        `${root}/%2e%2e%2f%2e%2e%2fanother-site`,
        `${root}/..%5c..%5canother-site`,
        `${root}#fragment`,
        `${root}#`,
        root.replace('https://', 'https://user:password@'),
        ...(backend === 'H5' ? [
          root.replace('/branch', '/another-ref'),
          root.replace('/branch', '/branch-extra'),
          `https://admin.hlx.page/config/${org}.json`,
          `https://admin.hlx.page/config/${org}/profiles/profile.json`,
          `https://admin.hlx.page/%63onfig/${org}/docs/branch`,
        ] : [
          `https://api.aem.live/${org}/config.json`,
          `https://api.aem.live/${org}/profiles/profile/config.json`,
          `https://api.aem.live/${org}/sites/docs.json/jobs`,
        ]),
      ];
      const pinned = base.pinVersion('revision');
      const clients = [
        base,
        base.withRequestInit({ credentials: 'include' }),
        pinned,
        pinned.pinVersion(),
      ];
      calls.length = 0;
      const outcomes = await Promise.all(clients.flatMap((client) => invalid.map(async (url) => {
        try {
          await client.raw('DELETE', url);
          return { url, rejected: false };
        } catch (error) {
          return { url, rejected: error instanceof TypeError };
        }
      })));

      assert.deepEqual(
        { outcomes, calls },
        {
          outcomes: clients.flatMap(() => invalid.map((url) => ({ url, rejected: true }))),
          calls: [],
        },
      );
    });
  });

  [
    {
      backend: 'H5', header: null, ref: 'branch', versionParam: 'hlx-admin-version',
    },
    {
      backend: 'H5', header: null, ref: null, versionParam: 'hlx-admin-version',
    },
    {
      backend: 'H6', header: 'true', ref: 'branch', versionParam: 'aem-api-version',
    },
  ].forEach(({
    backend, header, ref, versionParam,
  }) => {
    it(`accepts in-scope absolute and root-relative ${backend} raw URLs with ref ${ref}`, async () => {
      const calls = stubFetch(header);
      const org = `raw-paths-${backend}-${ref}`;
      const base = await getAdminClientForSite({ org, site: 'docs', ref });
      const client = base.withRequestInit({
        credentials: 'include',
        headers: new Headers({ 'x-client': 'raw' }),
        params: { tenant: 'shared' },
      }).pinVersion('default-revision');
      const operation = backend === 'H5'
        ? `/custom-operation/${org}/docs${ref ? `/${ref}` : ''}/nested.json?server=1`
        : `/${org}/sites/docs/custom-operation/nested.json?server=1`;
      const urls = [
        operation,
        ...['json', 'yaml', 'yml', 'txt', 'html'].map(
          (extension) => client.config().url.replace(/\.json$/, `.${extension}`),
        ),
        new URL(client.config().select('access.yaml').url).pathname,
        `${client.job().url}/api-returned-job`,
        `${client.job().url}/folder%2Fjob`,
        `${client.job().url}/folder%5Cjob`,
      ];
      const { origin } = new URL(client.config().url);
      const expectedURLs = urls.map((url) => {
        const absolute = new URL(url, origin).href;
        return `${absolute}${absolute.includes('?') ? '&' : '?'}tenant=shared&${versionParam}=call-revision`;
      });
      calls.length = 0;
      const responses = [];
      await assert.doesNotReject(async () => {
        responses.push(...await Promise.all(urls.map((url) => client.raw('PATCH', url, 'payload', {
          contentType: 'text/yaml',
          params: { [versionParam]: 'call-revision' },
        }))));
      });

      assert.deepEqual(calls.map(({ url, init }) => ({
        url,
        method: init.method,
        body: init.body,
        credentials: init.credentials,
        headers: [...init.headers],
      })), expectedURLs.map((url) => ({
        url,
        method: 'PATCH',
        body: 'payload',
        credentials: 'include',
        headers: [['content-type', 'text/yaml'], ['x-client', 'raw']],
      })));
      assert.deepEqual(
        responses.map(({ ok, status, request }) => ({ ok, status, request })),
        expectedURLs.map((url) => ({ ok: true, status: 200, request: { method: 'PATCH', url } })),
      );
    });
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
    assert.equal((await pending).status().url, 'https://api.aem.live/retry-network/sites/s/status');
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
      assert.equal(client.status().url, `https://api.aem.live/recover-${failure}/sites/s/status`);
      assert.equal(fetchMock.mock.callCount(), expectedAttempts + 1);
    });
  });
});

// Org-scoped clients are always H6, so no backend detection request is made.
describe('getAdminClientForOrg()', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    window.localStorage.removeItem('use-h6-api');
    global.fetch = originalFetch;
  });

  const stubFetch = () => {
    const calls = [];
    global.fetch = async (url, init) => {
      calls.push({ url, init });
      return new Response('{}');
    };
    return calls;
  };

  it('binds the H6 org config to an immutable snapshot without probing a backend', async () => {
    const calls = stubFetch();
    const coords = { org: 'org-only' };
    const pending = getAdminClientForOrg(coords);
    coords.org = 'changed';
    const client = await pending;

    assert.deepEqual(client.coords, { org: 'org-only' });
    assert.equal(client.config().url, 'https://api.aem.live/org-only/config.json');
    assert.equal(
      client.config().select('users/abc.json').url,
      'https://api.aem.live/org-only/config/users/abc.json',
    );
    assert.equal(Object.isFrozen(client), true);
    assert.equal(Object.isFrozen(client.coords), true);
    assert.throws(() => { client.coords.org = 'another'; }, TypeError);
    assert.equal(calls.length, 0);
  });

  it('binds only the operations org-level tools use', async () => {
    const client = await getAdminClientForOrg({ org: 'only-config' });
    assert.deepEqual(
      Object.keys(client).sort(),
      ['config', 'coords', 'pinVersion', 'withRequestInit'],
    );
  });

  it('rejects arguments to config() instead of silently ignoring a retarget', async () => {
    const client = await getAdminClientForOrg({ org: 'no-retarget' });
    assert.throws(
      () => client.config({ org: 'another' }),
      { name: 'TypeError', message: /does not accept arguments/ },
    );
  });

  it('rejects invalid or site-bearing coordinates before any request', async () => {
    const calls = stubFetch();
    const invalid = [undefined, null, {}, { org: '' }, { org: ' ' }, { org: 7 }];
    await Promise.all(invalid.map((coords) => assert.rejects(
      getAdminClientForOrg(coords),
      { name: 'TypeError', message: /non-empty/ },
    )));
    await assert.rejects(
      getAdminClientForOrg({ org: 'o', site: 'docs' }),
      { name: 'TypeError', message: /org-only/ },
    );
    assert.equal(calls.length, 0);
  });

  it('reuses one client per org, regardless of the use-h6-api override', async () => {
    const a = await getAdminClientForOrg({ org: 'cached-org' });
    assert.equal(await getAdminClientForOrg({ org: 'cached-org' }), a);
    window.localStorage.setItem('use-h6-api', '');
    assert.equal(await getAdminClientForOrg({ org: 'cached-org' }), a);
    const other = await getAdminClientForOrg({ org: 'other-org' });
    assert.notEqual(other, a);
    assert.deepEqual(other.coords, { org: 'other-org' });
  });

  it('keeps derived clients bound while forwarding defaults and version pins', async () => {
    const calls = stubFetch();
    const base = await getAdminClientForOrg({ org: 'derived-org' });
    const derived = base
      .withRequestInit({ credentials: 'include', params: { tenant: 'shared' } })
      .pinVersion('revision');

    assert.deepEqual(derived.coords, { org: 'derived-org' });
    assert.equal(derived.config().url, base.config().url);
    await derived.config().read();
    assert.equal(
      calls[0].url,
      'https://api.aem.live/derived-org/config.json?tenant=shared&aem-api-version=revision',
    );
    assert.equal(calls[0].init.credentials, 'include');
    assert.equal(await getAdminClientForOrg({ org: 'derived-org' }), base);
  });
});
