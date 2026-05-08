import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fetchDomainKey } from '../../../../tools/optel/oversight/elements/incognito-checkbox.js';

const ORIGINAL_FETCH = global.fetch;
const ORIGINAL_LOCALSTORAGE = global.localStorage;

function mockLocalStorage(token) {
  global.localStorage = {
    getItem: (k) => (k === 'rum-bundler-token' ? token : null),
    setItem: () => {},
    removeItem: () => {},
  };
}

function mockFetch(handler) {
  const calls = [];
  global.fetch = async (url, opts) => {
    calls.push({ url, opts });
    return handler(url, opts);
  };
  return calls;
}

describe('optel/oversight: fetchDomainKey', () => {
  beforeEach(() => {
    mockLocalStorage('test-token');
  });
  afterEach(() => {
    global.fetch = ORIGINAL_FETCH;
    global.localStorage = ORIGINAL_LOCALSTORAGE;
  });

  it('issues key for plain domain', async () => {
    const calls = mockFetch(async () => ({
      status: 200,
      json: async () => ({ domainkey: 'KEY-FOR-EXAMPLE' }),
    }));
    const key = await fetchDomainKey('www.example.com');
    assert.strictEqual(calls[0].url, 'https://bundles.aem.page/domainkey/www.example.com');
    assert.strictEqual(key, 'KEY-FOR-EXAMPLE');
  });

  it('preserves the port when issuing key for localhost:5710', async () => {
    const calls = mockFetch(async () => ({
      status: 200,
      json: async () => ({ domainkey: 'KEY-FOR-LOCALHOST-5710' }),
    }));
    const key = await fetchDomainKey('localhost:5710');
    assert.strictEqual(
      calls[0].url,
      'https://bundles.aem.page/domainkey/localhost:5710',
      'fetch URL must include the port — bundler distinguishes localhost from localhost:5710',
    );
    assert.strictEqual(key, 'KEY-FOR-LOCALHOST-5710');
  });

  it('uses orgs/{org}/key only for :all suffix', async () => {
    const calls = mockFetch(async () => ({
      status: 200,
      json: async () => ({ orgkey: 'ORG-KEY' }),
    }));
    const key = await fetchDomainKey('adobe:all');
    assert.strictEqual(calls[0].url, 'https://bundles.aem.page/orgs/adobe/key');
    assert.strictEqual(key, 'ORG-KEY');
  });

  it('does not treat localhost:5710 as an org', async () => {
    const calls = mockFetch(async () => ({
      status: 200,
      json: async () => ({ domainkey: 'KEY' }),
    }));
    await fetchDomainKey('localhost:5710');
    assert.ok(
      !calls[0].url.includes('/orgs/'),
      `should not hit /orgs/ for localhost:5710 — got ${calls[0].url}`,
    );
  });
});
