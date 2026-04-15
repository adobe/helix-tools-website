import {
  describe, it, beforeEach, afterEach,
} from 'node:test';
import assert from 'node:assert/strict';
import {
  adminFetch,
  ADMIN_API_BASE,
  createAdminClient,
  extractOrgSiteFromURL,
} from '../utils/admin-fetch.js';

const ORG = 'myorg';
const SITE = 'mysite';
const BASE = `${ADMIN_API_BASE}/config/${ORG}`;
const SITE_BASE = `${BASE}/sites/${SITE}`;

// --- adminFetch ---

describe('adminFetch', () => {
  let fetchCalls;
  let savedFetch;

  beforeEach(() => {
    fetchCalls = [];
    savedFetch = globalThis.fetch;
    globalThis.fetch = async (...args) => {
      fetchCalls.push(args);
      return new Response(null, { status: 200 });
    };
  });

  afterEach(() => {
    globalThis.fetch = savedFetch;
  });

  it('prepends ADMIN_API_BASE to path', async () => {
    await adminFetch('/config/myorg.json');
    assert.strictEqual(fetchCalls[0][0], `${ADMIN_API_BASE}/config/myorg.json`);
  });

  it('accepts a full admin URL without double-prefixing', async () => {
    await adminFetch(`${ADMIN_API_BASE}/job/myorg/mysite/main/status/123`, {
      params: { verbose: 'true' },
    });
    assert.strictEqual(fetchCalls[0][0], `${ADMIN_API_BASE}/job/myorg/mysite/main/status/123?verbose=true`);
  });

  it('appends params as query string', async () => {
    await adminFetch('/config/myorg.json', { params: { restoreVersion: 'abc123' } });
    assert.strictEqual(fetchCalls[0][0], `${ADMIN_API_BASE}/config/myorg.json?restoreVersion=abc123`);
  });

  it('params are not forwarded to fetch', async () => {
    await adminFetch('/test', { params: { foo: 'bar' }, method: 'POST' });
    const [, opts] = fetchCalls[0];
    assert.strictEqual(opts.params, undefined);
    assert.strictEqual(opts.method, 'POST');
  });

  it('calls logFn with status, method, url, and x-error', async () => {
    const logCalls = [];
    await adminFetch('/config/myorg.json', {}, (...args) => logCalls.push(args));
    assert.deepStrictEqual(logCalls[0], [200, ['GET', `${ADMIN_API_BASE}/config/myorg.json`, '']]);
  });

  it('no logFn by default — no error thrown', async () => {
    assert.ok(await adminFetch('/config/myorg.json'));
  });
});

// --- createAdminClient URL structure ---

describe('createAdminClient URLs', () => {
  const admin = createAdminClient({ org: ORG, site: SITE });

  describe('org', () => {
    it('org.url', () => assert.strictEqual(admin.org.url, `${BASE}.json`));
    it('org.versions().url', () => assert.strictEqual(admin.org.versions().url, `${BASE}/versions.json`));
    it('org.sites().url', () => assert.strictEqual(admin.org.sites().url, `${BASE}/sites.json`));
    it('org.users().url', () => assert.strictEqual(admin.org.users().url, `${BASE}/users.json`));
    it('org.profiles().url', () => assert.strictEqual(admin.org.profiles().url, `${BASE}/profiles.json`));
    it('org.profile(name).url', () => assert.strictEqual(admin.org.profile('myprofile').url, `${BASE}/profiles/myprofile.json`));
    it('org.profile(name).versions().url', () => assert.strictEqual(admin.org.profile('myprofile').versions().url, `${BASE}/profiles/myprofile/versions.json`));
    it('org.aggregated().url uses default site', () => assert.strictEqual(admin.org.aggregated().url, `${BASE}/aggregated/${SITE}.json`));
    it('org.aggregated(name).url', () => assert.strictEqual(admin.org.aggregated('other').url, `${BASE}/aggregated/other.json`));
  });

  describe('profile', () => {
    it('profile().url uses default site', () => assert.strictEqual(admin.profile().url, `${ADMIN_API_BASE}/profile/${ORG}/${SITE}`));
    it('profile(name).url', () => assert.strictEqual(admin.profile('other').url, `${ADMIN_API_BASE}/profile/${ORG}/other`));
  });

  describe('site', () => {
    it('site().url', () => assert.strictEqual(admin.site().url, `${SITE_BASE}.json`));
    it('site().versions().url', () => assert.strictEqual(admin.site().versions().url, `${SITE_BASE}/versions.json`));
    it('site().access().url', () => assert.strictEqual(admin.site().access().url, `${SITE_BASE}/access.json`));
    it('site().cdn().url', () => assert.strictEqual(admin.site().cdn().url, `${SITE_BASE}/cdn.json`));
    it('site().code().url', () => assert.strictEqual(admin.site().code().url, `${SITE_BASE}/code.json`));
    it('site().headers().url', () => assert.strictEqual(admin.site().headers().url, `${SITE_BASE}/headers.json`));
    it('site().robots().url', () => assert.strictEqual(admin.site().robots().url, `${SITE_BASE}/robots.txt`));
    it('site().secrets().url', () => assert.strictEqual(admin.site().secrets().url, `${SITE_BASE}/secrets.json`));
    it('site().apiKeys().url', () => assert.strictEqual(admin.site().apiKeys().url, `${SITE_BASE}/apiKeys.json`));
    it('site(name).url overrides default', () => assert.strictEqual(admin.site('other').url, `${BASE}/sites/other.json`));
  });

  describe('no default site', () => {
    const adminNoSite = createAdminClient({ org: ORG });
    it('site() throws without a site name', () => {
      assert.throws(() => adminNoSite.site());
    });
  });
});

// --- site().index() and site().sitemap() ---

describe('createAdminClient index and sitemap', () => {
  let fetchCalls;
  let savedFetch;

  beforeEach(() => {
    fetchCalls = [];
    savedFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts) => {
      fetchCalls.push([url, opts ?? {}]);
      return new Response(null, { status: 200 });
    };
  });

  afterEach(() => {
    globalThis.fetch = savedFetch;
  });

  const admin = () => createAdminClient({ org: ORG, site: SITE });

  it('index().read() GETs query.yaml', async () => {
    await admin().site().index().read();
    assert.strictEqual(fetchCalls[0][0], `${SITE_BASE}/content/query.yaml`);
    assert.strictEqual(fetchCalls[0][1].method ?? 'GET', 'GET');
  });

  it('index().update() POSTs query.yaml with text/yaml', async () => {
    await admin().site().index().update('indices: {}');
    assert.strictEqual(fetchCalls[0][0], `${SITE_BASE}/content/query.yaml`);
    assert.strictEqual(fetchCalls[0][1].method, 'POST');
    assert.strictEqual(fetchCalls[0][1].headers['content-type'], 'text/yaml');
    assert.strictEqual(fetchCalls[0][1].body, 'indices: {}');
  });

  it('index().reindex() POSTs to /index/{org}/{site}/main/*', async () => {
    await admin().site().index().reindex({ paths: ['/*'], indexNames: ['default'] });
    assert.strictEqual(fetchCalls[0][0], `${ADMIN_API_BASE}/index/${ORG}/${SITE}/main/*`);
    assert.strictEqual(fetchCalls[0][1].method, 'POST');
    assert.strictEqual(fetchCalls[0][1].headers['content-type'], 'application/json');
  });

  it('sitemap().read() GETs sitemap.yaml', async () => {
    await admin().site().sitemap().read();
    assert.strictEqual(fetchCalls[0][0], `${SITE_BASE}/content/sitemap.yaml`);
    assert.strictEqual(fetchCalls[0][1].method ?? 'GET', 'GET');
  });

  it('sitemap().update() POSTs sitemap.yaml with text/yaml', async () => {
    await admin().site().sitemap().update('sitemaps: {}');
    assert.strictEqual(fetchCalls[0][0], `${SITE_BASE}/content/sitemap.yaml`);
    assert.strictEqual(fetchCalls[0][1].method, 'POST');
    assert.strictEqual(fetchCalls[0][1].headers['content-type'], 'text/yaml');
  });

  it('sitemap().generate() POSTs to /sitemap/{org}/{site}/main{destination}', async () => {
    await admin().site().sitemap().generate('/sitemap.xml');
    assert.strictEqual(fetchCalls[0][0], `${ADMIN_API_BASE}/sitemap/${ORG}/${SITE}/main/sitemap.xml`);
    assert.strictEqual(fetchCalls[0][1].method, 'POST');
  });

  it('site(name).index() uses overridden site name', async () => {
    await admin().site('other').index().reindex({ paths: ['/*'] });
    assert.ok(fetchCalls[0][0].includes(`/index/${ORG}/other/main/*`));
  });
});

// --- extractOrgSiteFromURL ---

describe('extractOrgSiteFromURL', () => {
  it('org config URL', () => {
    assert.deepStrictEqual(
      extractOrgSiteFromURL(`${ADMIN_API_BASE}/config/${ORG}.json`),
      { org: ORG, site: null },
    );
  });

  it('org versions URL', () => {
    assert.deepStrictEqual(
      extractOrgSiteFromURL(`${ADMIN_API_BASE}/config/${ORG}/versions.json`),
      { org: ORG, site: null },
    );
  });

  it('site versions URL', () => {
    assert.deepStrictEqual(
      extractOrgSiteFromURL(`${ADMIN_API_BASE}/config/${ORG}/sites/${SITE}/versions.json`),
      { org: ORG, site: SITE },
    );
  });

  it('org sites collection — no site', () => {
    assert.deepStrictEqual(
      extractOrgSiteFromURL(`${ADMIN_API_BASE}/config/${ORG}/sites.json`),
      { org: ORG, site: null },
    );
  });

  it('specific site config', () => {
    assert.deepStrictEqual(
      extractOrgSiteFromURL(`${ADMIN_API_BASE}/config/${ORG}/sites/${SITE}.json`),
      { org: ORG, site: SITE },
    );
  });

  it('site sub-resource', () => {
    assert.deepStrictEqual(
      extractOrgSiteFromURL(`${ADMIN_API_BASE}/config/${ORG}/sites/${SITE}/access.json`),
      { org: ORG, site: SITE },
    );
  });

  it('aggregated site config URL', () => {
    assert.deepStrictEqual(
      extractOrgSiteFromURL(`${ADMIN_API_BASE}/config/${ORG}/aggregated/${SITE}.json`),
      { org: ORG, site: SITE },
    );
  });

  it('status URL', () => {
    assert.deepStrictEqual(
      extractOrgSiteFromURL(`${ADMIN_API_BASE}/status/${ORG}/${SITE}/main`),
      { org: ORG, site: SITE },
    );
  });

  it('status URL — no site segment', () => {
    assert.deepStrictEqual(
      extractOrgSiteFromURL(`${ADMIN_API_BASE}/status/${ORG}`),
      { org: ORG, site: null },
    );
  });

  it('invalid URL returns nulls', () => {
    assert.deepStrictEqual(extractOrgSiteFromURL('not-a-url'), { org: null, site: null });
  });

  it('empty string returns nulls', () => {
    assert.deepStrictEqual(extractOrgSiteFromURL(''), { org: null, site: null });
  });
});
