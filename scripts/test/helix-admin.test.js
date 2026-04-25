/* eslint-env node */
import {
  describe, it, beforeEach, afterEach,
} from 'node:test';
import assert from 'node:assert/strict';
import admin from '../helix-admin.js';

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
  describe('admin.config(coords).url', () => {
    it('exposes the site-scoped URL prefix', () => {
      const cfg = admin.config({ org: 'adobe', site: 'helix-tools-website' });
      assert.equal(cfg.url, 'https://admin.hlx.page/config/adobe/sites/helix-tools-website');
    });

    it('exposes the org-scoped URL prefix when site is omitted', () => {
      assert.equal(
        admin.config({ org: 'adobe' }).url,
        'https://admin.hlx.page/config/adobe',
      );
    });

    it('navigates to a profile sub-scope via .profile(name)', () => {
      assert.equal(
        admin.config({ org: 'adobe' }).profile('corp').url,
        'https://admin.hlx.page/config/adobe/profiles/corp',
      );
    });

    it('site-scoped context does not expose .profile() or .profiles()', () => {
      // Both are only present on the org-level context.
      const cfg = admin.config({ org: 'adobe', site: 'x' });
      assert.equal(cfg.profile, undefined);
      assert.equal(cfg.profiles, undefined);
    });

    it('.profiles() GETs /config/{org}/profiles.json', async () => {
      await admin.config({ org: 'adobe' }).profiles();
      assert.equal(calls[0].url, 'https://admin.hlx.page/config/adobe/profiles.json');
      assert.equal(calls[0].init.method, 'GET');
    });
  });

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
  });

  describe('admin.config(coords).robots.url', () => {
    it('exposes the canonical URL of the resource', () => {
      const cfg = admin.config({ org: 'adobe', site: 'helix-tools-website' });
      assert.equal(
        cfg.robots.url,
        'https://admin.hlx.page/config/adobe/sites/helix-tools-website/robots.txt',
      );
    });
  });

  describe('admin.config(coords).versions', () => {
    it('list() GETs /versions.json on a site-scoped context', async () => {
      await admin.config({ org: 'adobe', site: 'x' }).versions.list();
      assert.equal(calls[0].url, 'https://admin.hlx.page/config/adobe/sites/x/versions.json');
      assert.equal(calls[0].init.method, 'GET');
    });

    it('list() GETs /versions.json on an org-scoped context', async () => {
      await admin.config({ org: 'adobe' }).versions.list();
      assert.equal(calls[0].url, 'https://admin.hlx.page/config/adobe/versions.json');
    });

    it('list() GETs /versions.json on a profile-scoped context', async () => {
      await admin.config({ org: 'adobe' }).profile('p').versions.list();
      assert.equal(calls[0].url, 'https://admin.hlx.page/config/adobe/profiles/p/versions.json');
    });

    it('get(id) GETs /versions/{id}.json', async () => {
      await admin.config({ org: 'adobe', site: 'x' }).versions.get(42);
      assert.equal(calls[0].url, 'https://admin.hlx.page/config/adobe/sites/x/versions/42.json');
      assert.equal(calls[0].init.method, 'GET');
    });

    it('update(id, name) POSTs with name in both query param and body', async () => {
      // Original tool sent the name in both places — preserved verbatim
      // since server may read either form.
      await admin.config({ org: 'adobe', site: 'x' }).versions.update(7, 'release-A');
      assert.equal(
        calls[0].url,
        'https://admin.hlx.page/config/adobe/sites/x/versions/7.json?name=release-A',
      );
      assert.equal(calls[0].init.method, 'POST');
      assert.deepEqual(JSON.parse(calls[0].init.body), { name: 'release-A' });
      assert.deepEqual(
        Object.fromEntries(calls[0].init.headers),
        { 'content-type': 'application/json' },
      );
    });

    it('update(id, name) URL-encodes the name in the query param', async () => {
      await admin.config({ org: 'adobe', site: 'x' }).versions.update(7, 'foo bar/baz');
      assert.equal(
        calls[0].url,
        'https://admin.hlx.page/config/adobe/sites/x/versions/7.json?name=foo%20bar%2Fbaz',
      );
      assert.equal(JSON.parse(calls[0].init.body).name, 'foo bar/baz');
    });

    it('remove(id) DELETEs /versions/{id}.json', async () => {
      await admin.config({ org: 'adobe', site: 'x' }).versions.remove(7);
      assert.equal(calls[0].url, 'https://admin.hlx.page/config/adobe/sites/x/versions/7.json');
      assert.equal(calls[0].init.method, 'DELETE');
    });

    it('restore(id) POSTs to {base}.json?restoreVersion={id} at site scope', async () => {
      await admin.config({ org: 'adobe', site: 'x' }).versions.restore(42);
      assert.equal(
        calls[0].url,
        'https://admin.hlx.page/config/adobe/sites/x.json?restoreVersion=42',
      );
      assert.equal(calls[0].init.method, 'POST');
      assert.equal(calls[0].init.body, undefined);
    });

    it('restore(id) POSTs at org scope with no /sites segment', async () => {
      await admin.config({ org: 'adobe' }).versions.restore(42);
      assert.equal(calls[0].url, 'https://admin.hlx.page/config/adobe.json?restoreVersion=42');
    });

    it('restore(id) POSTs at profile scope', async () => {
      await admin.config({ org: 'adobe' }).profile('p').versions.restore(42);
      assert.equal(
        calls[0].url,
        'https://admin.hlx.page/config/adobe/profiles/p.json?restoreVersion=42',
      );
    });
  });

  describe('admin.config(coords).headers.url', () => {
    it('exposes the canonical URL of the resource', () => {
      const cfg = admin.config({ org: 'adobe', site: 'helix-tools-website' });
      assert.equal(
        cfg.headers.url,
        'https://admin.hlx.page/config/adobe/sites/helix-tools-website/headers.json',
      );
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

  describe('admin.status(coords)', () => {
    it('binds a /status/{org}/{site}/{ref} prefix', () => {
      const s = admin.status({ org: 'adobe', site: 'x', ref: 'feat' });
      assert.equal(s.url, 'https://admin.hlx.page/status/adobe/x/feat');
    });

    it('defaults ref to main', () => {
      const s = admin.status({ org: 'adobe', site: 'x' });
      assert.equal(s.url, 'https://admin.hlx.page/status/adobe/x/main');
    });

    it('get() with no path GETs the prefix URL', async () => {
      await admin.status({ org: 'adobe', site: 'x' }).get();
      assert.equal(calls[0].url, 'https://admin.hlx.page/status/adobe/x/main');
      assert.equal(calls[0].init.method, 'GET');
    });

    it('get(path) appends the path', async () => {
      await admin.status({ org: 'adobe', site: 'x' }).get('/foo/bar');
      assert.equal(calls[0].url, 'https://admin.hlx.page/status/adobe/x/main/foo/bar');
      assert.equal(calls[0].init.method, 'GET');
    });

    it('bulk() POSTs to /* with JSON body', async () => {
      await admin.status({ org: 'adobe', site: 'x' }).bulk({
        paths: ['/a', '/b'],
        select: ['edit', 'preview', 'live'],
      });
      assert.equal(calls[0].url, 'https://admin.hlx.page/status/adobe/x/main/*');
      assert.equal(calls[0].init.method, 'POST');
      assert.deepEqual(JSON.parse(calls[0].init.body), {
        paths: ['/a', '/b'],
        select: ['edit', 'preview', 'live'],
      });
      assert.deepEqual(
        Object.fromEntries(calls[0].init.headers),
        { 'content-type': 'application/json' },
      );
    });

    it('bulk.url is the canonical bulk URL', () => {
      assert.equal(
        admin.status({ org: 'adobe', site: 'x' }).bulk.url,
        'https://admin.hlx.page/status/adobe/x/main/*',
      );
    });
  });

  describe('admin.job(coords)', () => {
    it('binds a /job/{org}/{site}/{ref} prefix', () => {
      const j = admin.job({ org: 'adobe', site: 'x' });
      assert.equal(j.url, 'https://admin.hlx.page/job/adobe/x/main');
    });

    it('list(topic) GETs /job/{r}/{topic}', async () => {
      await admin.job({ org: 'adobe', site: 'x' }).list('status');
      assert.equal(calls[0].url, 'https://admin.hlx.page/job/adobe/x/main/status');
      assert.equal(calls[0].init.method, 'GET');
    });

    it('get(topic, name) GETs /job/{r}/{topic}/{name}', async () => {
      await admin.job({ org: 'adobe', site: 'x' }).get('status', 'job-abc');
      assert.equal(calls[0].url, 'https://admin.hlx.page/job/adobe/x/main/status/job-abc');
      assert.equal(calls[0].init.method, 'GET');
    });

    it('details(topic, name) GETs /job/{r}/{topic}/{name}/details', async () => {
      await admin.job({ org: 'adobe', site: 'x' }).details('status', 'job-abc');
      assert.equal(calls[0].url, 'https://admin.hlx.page/job/adobe/x/main/status/job-abc/details');
      assert.equal(calls[0].init.method, 'GET');
    });

    it('stop(topic, name) DELETEs /job/{r}/{topic}/{name}', async () => {
      await admin.job({ org: 'adobe', site: 'x' }).stop('status', 'job-abc');
      assert.equal(calls[0].url, 'https://admin.hlx.page/job/adobe/x/main/status/job-abc');
      assert.equal(calls[0].init.method, 'DELETE');
      assert.equal(calls[0].init.body, undefined);
    });

    it('threads through a non-default ref', async () => {
      await admin.job({ org: 'adobe', site: 'x', ref: 'feat' }).get('publish', 'j1');
      assert.equal(calls[0].url, 'https://admin.hlx.page/job/adobe/x/feat/publish/j1');
    });
  });

  describe('admin.preview(coords) and admin.live(coords)', () => {
    // Both share contentBusFactory; one round of tests against preview is
    // enough for the URL/method/body shape, plus a parity check on live.

    it('preview.url binds the prefix', () => {
      const p = admin.preview({ org: 'adobe', site: 'x' });
      assert.equal(p.url, 'https://admin.hlx.page/preview/adobe/x/main');
    });

    it('live.url binds the prefix', () => {
      const l = admin.live({ org: 'adobe', site: 'x' });
      assert.equal(l.url, 'https://admin.hlx.page/live/adobe/x/main');
    });

    it('get(path) GETs the path', async () => {
      await admin.preview({ org: 'adobe', site: 'x' }).get('/foo.md');
      assert.equal(calls[0].url, 'https://admin.hlx.page/preview/adobe/x/main/foo.md');
      assert.equal(calls[0].init.method, 'GET');
    });

    it('update(path) POSTs the path', async () => {
      await admin.preview({ org: 'adobe', site: 'x' }).update('/foo');
      assert.equal(calls[0].url, 'https://admin.hlx.page/preview/adobe/x/main/foo');
      assert.equal(calls[0].init.method, 'POST');
      assert.equal(calls[0].init.body, undefined);
    });

    it('remove(path) DELETEs the path', async () => {
      await admin.preview({ org: 'adobe', site: 'x' }).remove('/foo');
      assert.equal(calls[0].url, 'https://admin.hlx.page/preview/adobe/x/main/foo');
      assert.equal(calls[0].init.method, 'DELETE');
    });

    it('bulk(body) POSTs /* with JSON-stringified body', async () => {
      await admin.preview({ org: 'adobe', site: 'x' }).bulk({
        paths: ['/a', '/b'],
        delete: true,
      });
      assert.equal(calls[0].url, 'https://admin.hlx.page/preview/adobe/x/main/*');
      assert.equal(calls[0].init.method, 'POST');
      assert.deepEqual(JSON.parse(calls[0].init.body), { paths: ['/a', '/b'], delete: true });
      assert.deepEqual(
        Object.fromEntries(calls[0].init.headers),
        { 'content-type': 'application/json' },
      );
    });

    it('bulk.url is the canonical bulk URL', () => {
      assert.equal(
        admin.preview({ org: 'adobe', site: 'x' }).bulk.url,
        'https://admin.hlx.page/preview/adobe/x/main/*',
      );
    });

    it('live shares the same surface, only the path family changes', async () => {
      await admin.live({ org: 'adobe', site: 'x' }).remove('/foo');
      assert.equal(calls[0].url, 'https://admin.hlx.page/live/adobe/x/main/foo');
      assert.equal(calls[0].init.method, 'DELETE');
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
