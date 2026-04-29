/* eslint-env node */
import {
  describe, it, beforeEach, afterEach,
} from 'node:test';
import assert from 'node:assert/strict';
import admin from '../../scripts/helix-admin.js';

// Thin fetch spy: captures calls and returns whatever `respond` is set to.
// We're testing the wrapper itself, so the spy IS the system under test from
// the wrapper's perspective — no risk of mock-vs-real-API drift.
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

describe('helix-admin.js', () => {
  describe('site-only resource gating', () => {
    it('robots is present on a site-scoped context', () => {
      const cfg = admin.config({ org: 'adobe', site: 'x' });
      assert.equal(typeof cfg.robots, 'function');
    });

    it('robots is absent on an org-only context', () => {
      // Calling admin.config({org}).robots() should be a TypeError at the
      // call site, not a runtime check inside the wrapper. This pins that.
      const cfg = admin.config({ org: 'adobe' });
      assert.equal(cfg.robots, undefined);
    });

    it('headers is present on a site-scoped context', () => {
      const cfg = admin.config({ org: 'adobe', site: 'x' });
      assert.equal(typeof cfg.headers, 'function');
      assert.equal(typeof cfg.headers.remove, 'function');
    });

    it('headers is absent on an org-only context', () => {
      const cfg = admin.config({ org: 'adobe' });
      assert.equal(cfg.headers, undefined);
    });

    it('index is present on a site-scoped context', () => {
      const cfg = admin.config({ org: 'adobe', site: 'x' });
      assert.equal(typeof cfg.index, 'function');
    });

    it('index is absent on an org-only context', () => {
      const cfg = admin.config({ org: 'adobe' });
      assert.equal(cfg.index, undefined);
    });
  });

  describe('admin.config(coords).robots()', () => {
    it('GETs the site-scoped URL when no body is passed', async () => {
      await admin.config({ org: 'adobe', site: 'helix-tools-website' }).robots();
      assert.equal(calls.length, 1);
      assert.equal(
        calls[0].url,
        'https://admin.hlx.page/config/adobe/sites/helix-tools-website/robots.txt',
      );
      assert.equal(calls[0].init.method, 'GET');
      assert.equal(calls[0].init.body, undefined);
    });

    it('POSTs with text/plain when a body is passed', async () => {
      await admin.config({ org: 'adobe', site: 'x' }).robots('User-agent: *\nDisallow:');
      assert.equal(calls[0].init.method, 'POST');
      assert.equal(calls[0].init.body, 'User-agent: *\nDisallow:');
      assert.deepEqual(
        Object.fromEntries(calls[0].init.headers),
        { 'content-type': 'text/plain' },
      );
    });

    it('treats an empty-string body as POST, not GET', async () => {
      // Clearing the file content is not the same as deleting the resource,
      // so the empty string must POST. A truthiness check would silently turn
      // this into a GET — pinning to catch that regression.
      await admin.config({ org: 'adobe', site: 'x' }).robots('');
      assert.equal(calls[0].init.method, 'POST');
      assert.equal(calls[0].init.body, '');
    });
  });

  describe('admin.config(coords).headers()', () => {
    it('GETs headers.json when no data is passed', async () => {
      await admin.config({ org: 'adobe', site: 'helix-tools-website' }).headers();
      assert.equal(
        calls[0].url,
        'https://admin.hlx.page/config/adobe/sites/helix-tools-website/headers.json',
      );
      assert.equal(calls[0].init.method, 'GET');
    });

    it('POSTs application/json with the JSON-stringified data', async () => {
      const data = { '/**': [{ key: 'cache-control', value: 'no-cache' }] };
      await admin.config({ org: 'adobe', site: 'x' }).headers(data);
      assert.equal(calls[0].init.method, 'POST');
      assert.equal(calls[0].init.body, JSON.stringify(data));
      assert.deepEqual(
        Object.fromEntries(calls[0].init.headers),
        { 'content-type': 'application/json' },
      );
    });

    it('POSTs an empty object as `{}`, not as a delete', async () => {
      // Setting headers to {} is conceptually different from deleting the
      // resource — callers who want delete must use .remove(). Pin that.
      await admin.config({ org: 'adobe', site: 'x' }).headers({});
      assert.equal(calls[0].init.method, 'POST');
      assert.equal(calls[0].init.body, '{}');
    });

    it('.remove() DELETEs the resource', async () => {
      await admin.config({ org: 'adobe', site: 'x' }).headers.remove();
      assert.equal(calls[0].init.method, 'DELETE');
      assert.equal(
        calls[0].url,
        'https://admin.hlx.page/config/adobe/sites/x/headers.json',
      );
      assert.equal(calls[0].init.body, undefined);
    });
  });

  describe('admin.config(coords).index', () => {
    it('GETs content/query.yaml when no body is passed', async () => {
      await admin.config({ org: 'adobe', site: 'x' }).index();
      assert.equal(
        calls[0].url,
        'https://admin.hlx.page/config/adobe/sites/x/content/query.yaml',
      );
      assert.equal(calls[0].init.method, 'GET');
      assert.equal(calls[0].init.body, undefined);
    });

    it('POSTs with text/yaml when a body is passed', async () => {
      await admin.config({ org: 'adobe', site: 'x' }).index('indices: {}\n');
      assert.equal(calls[0].init.method, 'POST');
      assert.equal(calls[0].init.body, 'indices: {}\n');
      assert.deepEqual(
        Object.fromEntries(calls[0].init.headers),
        { 'content-type': 'text/yaml' },
      );
    });

    it('treats an empty-string body as POST, not GET', async () => {
      // Same regression-pin as robots: a truthiness check would silently
      // turn a clear-content POST into a GET.
      await admin.config({ org: 'adobe', site: 'x' }).index('');
      assert.equal(calls[0].init.method, 'POST');
      assert.equal(calls[0].init.body, '');
    });
  });

  describe('admin.index(coords)', () => {
    it('.bulk(payload) POSTs application/json with the JSON-stringified payload', async () => {
      const payload = { paths: ['/'], indexNames: ['default'] };
      await admin.index({ org: 'adobe', site: 'x' }).bulk(payload);
      assert.equal(
        calls[0].url,
        'https://admin.hlx.page/index/adobe/x/main/*',
      );
      assert.equal(calls[0].init.method, 'POST');
      assert.equal(calls[0].init.body, JSON.stringify(payload));
      assert.deepEqual(
        Object.fromEntries(calls[0].init.headers),
        { 'content-type': 'application/json' },
      );
    });
  });

  describe('admin.job(coords)', () => {
    it('.list(topic) GETs /job/{org}/{site}/main/{topic}', async () => {
      await admin.job({ org: 'adobe', site: 'x' }).list('index');
      assert.equal(calls[0].url, 'https://admin.hlx.page/job/adobe/x/main/index');
      assert.equal(calls[0].init.method, 'GET');
    });

    it('.get(topic, name) GETs /job/{org}/{site}/main/{topic}/{name}', async () => {
      await admin.job({ org: 'adobe', site: 'x' }).get('index', 'job-123');
      assert.equal(
        calls[0].url,
        'https://admin.hlx.page/job/adobe/x/main/index/job-123',
      );
      assert.equal(calls[0].init.method, 'GET');
    });

    it('.details(topic, name) GETs the .../details suffix', async () => {
      await admin.job({ org: 'adobe', site: 'x' }).details('index', 'job-123');
      assert.equal(
        calls[0].url,
        'https://admin.hlx.page/job/adobe/x/main/index/job-123/details',
      );
      assert.equal(calls[0].init.method, 'GET');
    });

    it('.stop(topic, name) DELETEs /job/{org}/{site}/main/{topic}/{name}', async () => {
      await admin.job({ org: 'adobe', site: 'x' }).stop('index', 'job-123');
      assert.equal(
        calls[0].url,
        'https://admin.hlx.page/job/adobe/x/main/index/job-123',
      );
      assert.equal(calls[0].init.method, 'DELETE');
      assert.equal(calls[0].init.body, undefined);
    });
  });

  describe('response envelope', () => {
    it('exposes ok=true and the response status on success', async () => {
      respond = () => new Response('hello', { status: 200 });
      const result = await admin.config({ org: 'adobe', site: 'x' }).robots();
      assert.equal(result.ok, true);
      assert.equal(result.status, 200);
      assert.equal(result.error, '');
    });

    it('exposes ok=false and the x-error header on failure', async () => {
      respond = () => new Response('', { status: 401, headers: { 'x-error': '[admin] not authenticated' } });
      const result = await admin.config({ org: 'adobe', site: 'x' }).robots();
      assert.equal(result.ok, false);
      assert.equal(result.status, 401);
      assert.equal(result.error, '[admin] not authenticated');
    });

    it('error is empty string (not null) when x-error is absent', async () => {
      // Tools log `result.error` directly into the console block — null would
      // render as the literal string "null", '' renders as empty.
      respond = () => new Response('', { status: 500 });
      const result = await admin.config({ org: 'adobe', site: 'x' }).robots();
      assert.equal(result.error, '');
    });

    it('text() reads the response body', async () => {
      respond = () => new Response('User-agent: *', { status: 200 });
      const result = await admin.config({ org: 'adobe', site: 'x' }).robots();
      assert.equal(await result.text(), 'User-agent: *');
    });

    it('echoes method and url on the request descriptor for logging', async () => {
      const result = await admin.config({ org: 'adobe', site: 'helix-tools-website' }).robots('x');
      assert.equal(result.request.method, 'POST');
      assert.equal(
        result.request.url,
        'https://admin.hlx.page/config/adobe/sites/helix-tools-website/robots.txt',
      );
    });
  });

  describe('admin.withRequestInit(extra)', () => {
    it('merges fetch-init defaults into every request', async () => {
      const a = admin.withRequestInit({ credentials: 'include', cache: 'no-cache' });
      await a.config({ org: 'adobe', site: 'x' }).robots();
      assert.equal(calls[0].init.credentials, 'include');
      assert.equal(calls[0].init.cache, 'no-cache');
    });

    it('does not affect calls through the unwrapped client', async () => {
      admin.withRequestInit({ credentials: 'include' });
      await admin.config({ org: 'adobe', site: 'x' }).robots();
      assert.equal(calls[0].init.credentials, undefined);
    });

    it('chains — later .withRequestInit overrides earlier values', async () => {
      const a = admin
        .withRequestInit({ credentials: 'include', cache: 'no-cache' })
        .withRequestInit({ cache: 'no-store' });
      await a.config({ org: 'adobe', site: 'x' }).robots();
      assert.equal(calls[0].init.credentials, 'include');
      assert.equal(calls[0].init.cache, 'no-store');
    });

    it('preserves method/body/content-type on top of init defaults', async () => {
      const a = admin.withRequestInit({ credentials: 'include' });
      await a.config({ org: 'adobe', site: 'x' }).robots('User-agent: *');
      assert.equal(calls[0].init.method, 'POST');
      assert.equal(calls[0].init.body, 'User-agent: *');
      assert.equal(calls[0].init.credentials, 'include');
      assert.deepEqual(
        Object.fromEntries(calls[0].init.headers),
        { 'content-type': 'text/plain' },
      );
    });

    it('merges headers from defaults with the per-call content-type', async () => {
      const a = admin.withRequestInit({ headers: { authorization: 'token abc' } });
      await a.config({ org: 'adobe', site: 'x' }).robots('User-agent: *');
      assert.deepEqual(Object.fromEntries(calls[0].init.headers), {
        authorization: 'token abc',
        'content-type': 'text/plain',
      });
    });

    it('preserves a Headers instance passed via withRequestInit', async () => {
      // RequestInit.headers legally accepts a Headers instance; a naive
      // object spread would drop the entries silently.
      const a = admin.withRequestInit({
        headers: new Headers({ authorization: 'token abc' }),
      });
      await a.config({ org: 'adobe', site: 'x' }).robots('User-agent: *');
      assert.equal(calls[0].init.headers.get('authorization'), 'token abc');
      assert.equal(calls[0].init.headers.get('content-type'), 'text/plain');
    });

    it('preserves headers passed as [name, value] tuples', async () => {
      const a = admin.withRequestInit({
        headers: [['authorization', 'token abc']],
      });
      await a.config({ org: 'adobe', site: 'x' }).robots('User-agent: *');
      assert.equal(calls[0].init.headers.get('authorization'), 'token abc');
      assert.equal(calls[0].init.headers.get('content-type'), 'text/plain');
    });
  });
});
