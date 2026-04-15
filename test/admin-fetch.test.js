import {
  describe, test, expect, beforeEach, afterEach, vi,
} from 'vitest';
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
  let fetchMock;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(
      new Response(null, { status: 200 }),
    );
    globalThis.fetch = fetchMock;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('prepends ADMIN_API_BASE to path', async () => {
    await adminFetch('/config/myorg.json');
    expect(fetchMock.mock.calls[0][0]).toBe(`${ADMIN_API_BASE}/config/myorg.json`);
  });

  test('appends params as query string', async () => {
    await adminFetch('/config/myorg.json', { params: { restoreVersion: 'abc123' } });
    expect(fetchMock.mock.calls[0][0]).toBe(`${ADMIN_API_BASE}/config/myorg.json?restoreVersion=abc123`);
  });

  test('params are not forwarded to fetch', async () => {
    await adminFetch('/test', { params: { foo: 'bar' }, method: 'POST' });
    const [, opts] = fetchMock.mock.calls[0];
    expect(opts.params).toBeUndefined();
    expect(opts.method).toBe('POST');
  });

  test('calls logFn with status, method, url, and x-error', async () => {
    const logFn = vi.fn();
    await adminFetch('/config/myorg.json', {}, logFn);
    expect(logFn).toHaveBeenCalledWith(200, ['GET', `${ADMIN_API_BASE}/config/myorg.json`, '']);
  });

  test('no logFn by default — no error thrown', async () => {
    await expect(adminFetch('/config/myorg.json')).resolves.toBeDefined();
  });
});

// --- createAdminClient URL structure ---

describe('createAdminClient URLs', () => {
  const admin = createAdminClient({ org: ORG, site: SITE });

  describe('org', () => {
    test('org.url', () => expect(admin.org.url).toBe(`${BASE}.json`));
    test('org.versions().url', () => expect(admin.org.versions().url).toBe(`${BASE}.versions.json`));
    test('org.sites().url', () => expect(admin.org.sites().url).toBe(`${BASE}/sites.json`));
    test('org.users().url', () => expect(admin.org.users().url).toBe(`${BASE}/users.json`));
    test('org.profiles().url', () => expect(admin.org.profiles().url).toBe(`${BASE}/profiles.json`));
    test('org.aggregated().url uses default site', () => expect(admin.org.aggregated().url).toBe(`${BASE}/aggregated/${SITE}.json`));
    test('org.aggregated(name).url', () => expect(admin.org.aggregated('other').url).toBe(`${BASE}/aggregated/other.json`));
  });

  describe('profile', () => {
    test('profile().url uses default site', () => expect(admin.profile().url).toBe(`${ADMIN_API_BASE}/profile/${ORG}/${SITE}`));
    test('profile(name).url', () => expect(admin.profile('other').url).toBe(`${ADMIN_API_BASE}/profile/${ORG}/other`));
  });

  describe('site', () => {
    test('site().url', () => expect(admin.site().url).toBe(`${SITE_BASE}.json`));
    test('site().versions().url', () => expect(admin.site().versions().url).toBe(`${SITE_BASE}.versions.json`));
    test('site().access().url', () => expect(admin.site().access().url).toBe(`${SITE_BASE}/access.json`));
    test('site().cdn().url', () => expect(admin.site().cdn().url).toBe(`${SITE_BASE}/cdn.json`));
    test('site().code().url', () => expect(admin.site().code().url).toBe(`${SITE_BASE}/code.json`));
    test('site().headers().url', () => expect(admin.site().headers().url).toBe(`${SITE_BASE}/headers.json`));
    test('site().robots().url', () => expect(admin.site().robots().url).toBe(`${SITE_BASE}/robots.txt`));
    test('site().secrets().url', () => expect(admin.site().secrets().url).toBe(`${SITE_BASE}/secrets.json`));
    test('site().apiKeys().url', () => expect(admin.site().apiKeys().url).toBe(`${SITE_BASE}/apiKeys.json`));
    test('site(name).url overrides default', () => expect(admin.site('other').url).toBe(`${BASE}/sites/other.json`));
  });

  describe('no default site', () => {
    const adminNoSite = createAdminClient({ org: ORG });
    test('site() throws without a site name', () => {
      expect(() => adminNoSite.site()).toThrow();
    });
  });
});

// --- extractOrgSiteFromURL ---

describe('extractOrgSiteFromURL', () => {
  test('org config URL', () => {
    expect(extractOrgSiteFromURL(`${ADMIN_API_BASE}/config/${ORG}.json`))
      .toEqual({ org: ORG, site: null });
  });

  test('org sites collection — no site', () => {
    expect(extractOrgSiteFromURL(`${ADMIN_API_BASE}/config/${ORG}/sites.json`))
      .toEqual({ org: ORG, site: null });
  });

  test('specific site config', () => {
    expect(extractOrgSiteFromURL(`${ADMIN_API_BASE}/config/${ORG}/sites/${SITE}.json`))
      .toEqual({ org: ORG, site: SITE });
  });

  test('site sub-resource', () => {
    expect(extractOrgSiteFromURL(`${ADMIN_API_BASE}/config/${ORG}/sites/${SITE}/access.json`))
      .toEqual({ org: ORG, site: SITE });
  });

  test('status URL', () => {
    expect(extractOrgSiteFromURL(`${ADMIN_API_BASE}/status/${ORG}/${SITE}/main`))
      .toEqual({ org: ORG, site: SITE });
  });

  test('status URL — no site segment', () => {
    expect(extractOrgSiteFromURL(`${ADMIN_API_BASE}/status/${ORG}`))
      .toEqual({ org: ORG, site: null });
  });

  test('invalid URL returns nulls', () => {
    expect(extractOrgSiteFromURL('not-a-url')).toEqual({ org: null, site: null });
  });

  test('empty string returns nulls', () => {
    expect(extractOrgSiteFromURL('')).toEqual({ org: null, site: null });
  });
});
