/* eslint-env node */
import {
  describe, it, beforeEach, afterEach,
} from 'node:test';
import assert from 'node:assert/strict';

const realFetch = global.fetch;

/**
 * Run the shared behavioral contract tests against an admin client instance.
 * Call this inside a describe() block in each client's test file.
 * Registers its own beforeEach/afterEach fetch spy at the call-site scope.
 */
export function runSharedBehaviorTests(admin) {
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

  describe('admin.config(coords) shape', () => {
    it('exposes select + CRUD on a site-scoped context', () => {
      const cfg = admin.config({ org: 'adobe', site: 'x' });
      assert.equal(typeof cfg.select, 'function');
      assert.equal(typeof cfg.read, 'function');
      assert.equal(typeof cfg.update, 'function');
      assert.equal(typeof cfg.create, 'function');
      assert.equal(typeof cfg.remove, 'function');
    });

    it('exposes select + CRUD on an org-only context', () => {
      const cfg = admin.config({ org: 'adobe' });
      assert.equal(typeof cfg.select, 'function');
      assert.equal(typeof cfg.read, 'function');
    });

    it('exposes select + CRUD on a profile-scoped context', () => {
      const cfg = admin.config({ org: 'adobe', profile: 'p' });
      assert.equal(typeof cfg.select, 'function');
      assert.equal(typeof cfg.read, 'function');
    });

    it('throws when coords include both site and profile', () => {
      assert.throws(
        () => admin.config({ org: 'adobe', site: 'x', profile: 'p' }),
        /cannot include both site and profile/,
      );
    });

    it('exposes .url as a string on config nodes', () => {
      assert.equal(typeof admin.config({ org: 'adobe', site: 'x' }).url, 'string');
      assert.equal(typeof admin.config({ org: 'adobe' }).url, 'string');
    });
  });

  describe('admin.config(coords).select()', () => {
    it('descends and produces a URL ending with the selected leaf', async () => {
      await admin.config({ org: 'adobe', site: 'x' }).select('robots.txt').read();
      assert.ok(new URL(calls[0].url).pathname.endsWith('/robots.txt'));
    });

    it('descends nested via chained .select() calls', async () => {
      await admin.config({ org: 'adobe', site: 'x' }).select('cdn').select('prod.json').read();
      assert.ok(new URL(calls[0].url).pathname.endsWith('/cdn/prod.json'));
    });

    it('accepts embedded slashes as shorthand for nested selects', async () => {
      await admin.config({ org: 'adobe', site: 'x' }).select('content/sitemap.yaml').read();
      assert.ok(new URL(calls[0].url).pathname.endsWith('/content/sitemap.yaml'));
    });

    it('strips leading and trailing slashes on the segment', async () => {
      await admin.config({ org: 'adobe', site: 'x' }).select('/cdn/').select('/prod.json/').read();
      assert.ok(new URL(calls[0].url).pathname.endsWith('/cdn/prod.json'));
    });

    it('strips the leaf extension when descending', async () => {
      await admin.config({ org: 'adobe', site: 'x' }).select('cdn.json').select('prod.json').read();
      assert.ok(new URL(calls[0].url).pathname.endsWith('/cdn/prod.json'));
    });

    it('.url on the descended node matches the URL used for requests', async () => {
      const node = admin.config({ org: 'adobe', site: 'x' }).select('cdn.json');
      await node.read();
      assert.equal(node.url, calls[0].url);
    });

    it('returns a reusable handle — supports multiple ops on the same node', async () => {
      const cdn = admin.config({ org: 'adobe', site: 'x' }).select('cdn.json');
      await cdn.read();
      await cdn.select('prod.json').update('{"host":"example.com"}');
      assert.equal(calls[0].init.method, 'GET');
      assert.equal(calls[1].init.method, 'POST');
      assert.ok(new URL(calls[1].url).pathname.endsWith('/cdn/prod.json'));
    });
  });

  describe('CRUD operations', () => {
    it('.read() GETs with no body', async () => {
      await admin.config({ org: 'adobe', site: 'x' }).select('robots.txt').read();
      assert.equal(calls[0].init.method, 'GET');
      assert.equal(calls[0].init.body, undefined);
    });

    it('.update(body) POSTs the body', async () => {
      await admin.config({ org: 'adobe', site: 'x' }).select('content/sitemap.yaml').update('version: 1\n');
      assert.equal(calls[0].init.method, 'POST');
      assert.equal(calls[0].init.body, 'version: 1\n');
    });

    it('.create(body) PUTs the body', async () => {
      await admin.config({ org: 'adobe', site: 'x' }).select('headers.json').create('{}');
      assert.equal(calls[0].init.method, 'PUT');
      assert.equal(calls[0].init.body, '{}');
    });

    it('.remove() DELETEs with no body', async () => {
      await admin.config({ org: 'adobe', site: 'x' }).select('headers.json').remove();
      assert.equal(calls[0].init.method, 'DELETE');
      assert.equal(calls[0].init.body, undefined);
    });
  });

  describe('write content-type derivation', () => {
    const cases = [
      ['robots.txt', 'text/plain'],
      ['headers.json', 'application/json'],
      ['content/query.yaml', 'text/yaml'],
      ['foo.yml', 'text/yaml'],
      ['foo.html', 'text/html'],
    ];
    cases.forEach(([path, expected]) => {
      it(`derives ${expected} from ${path}`, async () => {
        await admin.config({ org: 'adobe', site: 'x' }).select(path).update('x');
        assert.equal(calls[0].init.headers.get('content-type'), expected);
      });
    });

    it('throws on unknown extension', () => {
      assert.throws(
        () => admin.config({ org: 'adobe', site: 'x' }).select('foo.xyz').update('data'),
        /cannot derive content-type/,
      );
      assert.equal(calls.length, 0);
    });

    it('throws on extensionless leaf', () => {
      assert.throws(
        () => admin.config({ org: 'adobe', site: 'x' }).select('robots').update('data'),
        /cannot derive content-type/,
      );
    });
  });

  describe('opts.params (query string)', () => {
    it('.read({ params }) appends the query string', async () => {
      await admin.config({ org: 'adobe', site: 'x' }).select('versions/3.json').read({ params: { detail: 'full' } });
      assert.equal(new URL(calls[0].url).searchParams.get('detail'), 'full');
      assert.equal(calls[0].init.method, 'GET');
    });

    it('.remove({ params }) appends the query string', async () => {
      await admin.config({ org: 'adobe', site: 'x' }).select('versions/3.json').remove({ params: { force: 'true' } });
      assert.equal(new URL(calls[0].url).searchParams.get('force'), 'true');
      assert.equal(calls[0].init.method, 'DELETE');
    });

    it('.update(body, { params }) appends params and still derives content-type', async () => {
      await admin.config({ org: 'adobe', site: 'x' }).select('versions/3.json').update('{"name":"v1"}', { params: { name: 'v1' } });
      assert.equal(new URL(calls[0].url).searchParams.get('name'), 'v1');
      assert.equal(calls[0].init.method, 'POST');
      assert.equal(calls[0].init.body, '{"name":"v1"}');
      assert.equal(calls[0].init.headers.get('content-type'), 'application/json');
    });

    it('.create(body, { params }) appends params and derives content-type', async () => {
      await admin.config({ org: 'adobe', site: 'x' }).select('headers.json').create('{}', { params: { versionName: 'init' } });
      assert.equal(new URL(calls[0].url).searchParams.get('versionName'), 'init');
      assert.equal(calls[0].init.method, 'PUT');
      assert.equal(calls[0].init.body, '{}');
      assert.equal(calls[0].init.headers.get('content-type'), 'application/json');
    });

    it('encodes special characters via URLSearchParams', async () => {
      await admin.config({ org: 'adobe', site: 'x' }).select('versions/3.json').update('x', { params: { name: 'v 1 & co' } });
      assert.ok(calls[0].url.includes('name=v+1+%26+co'));
    });

    it('serializes multiple params with &', async () => {
      await admin.config({ org: 'adobe', site: 'x' }).read({ params: { foo: 'a', bar: 'b' } });
      const u = new URL(calls[0].url);
      assert.equal(u.searchParams.get('foo'), 'a');
      assert.equal(u.searchParams.get('bar'), 'b');
    });

    it('coerces number values to strings', async () => {
      await admin.config({ org: 'adobe', site: 'x' }).update(null, { params: { restoreVersion: 5 } });
      assert.equal(new URL(calls[0].url).searchParams.get('restoreVersion'), '5');
    });

    it('echoes the final URL with params on the request descriptor', async () => {
      const result = await admin.config({ org: 'adobe', site: 'x' }).read({ params: { foo: 'bar' } });
      assert.equal(new URL(result.request.url).searchParams.get('foo'), 'bar');
    });
  });

  describe('write with no body (action-style POST/PUT)', () => {
    it('.update(undefined) sends no body and skips content-type', async () => {
      await admin.config({ org: 'adobe', site: 'x' }).update(undefined, { params: { restoreVersion: 3 } });
      assert.equal(calls[0].init.method, 'POST');
      assert.equal(calls[0].init.body, undefined);
      assert.equal(calls[0].init.headers, undefined);
    });

    it('.update(\'\') is a real empty body and still derives content-type', async () => {
      await admin.config({ org: 'adobe', site: 'x' }).select('robots.txt').update('');
      assert.equal(calls[0].init.method, 'POST');
      assert.equal(calls[0].init.body, '');
      assert.equal(calls[0].init.headers.get('content-type'), 'text/plain');
    });

    it('.update(undefined) does not throw on an extensionless leaf', async () => {
      await admin.config({ org: 'adobe', site: 'x' }).select('versions').update(undefined, { params: { something: 'x' } });
      assert.equal(calls[0].init.method, 'POST');
    });

    it('.create(null) sends no body and skips content-type', async () => {
      await admin.config({ org: 'adobe', site: 'x' }).create(null, { params: { foo: 'bar' } });
      assert.equal(calls[0].init.method, 'PUT');
      assert.equal(calls[0].init.body, undefined);
    });
  });

  describe('bindOperation — shared behaviours', () => {
    it('path with leading slash and without produce the same URL', async () => {
      await admin.job({ org: 'adobe', site: 'x' }).get('/index/job-1');
      await admin.job({ org: 'adobe', site: 'x' }).get('index/job-1');
      assert.equal(calls[0].url, calls[1].url);
    });

    it('update with body sets application/json content-type by default', async () => {
      await admin.index({ org: 'adobe', site: 'x' }).update('/*', JSON.stringify({ paths: ['/'] }));
      assert.equal(calls[0].init.headers.get('content-type'), 'application/json');
    });

    it('update with body respects opts.contentType override', async () => {
      await admin.index({ org: 'adobe', site: 'x' }).update('/*', 'data', { contentType: 'text/plain' });
      assert.equal(calls[0].init.headers.get('content-type'), 'text/plain');
    });

    it('update without body sends no content-type', async () => {
      await admin.preview({ org: 'adobe', site: 'x' }).update('/page');
      assert.equal(calls[0].init.headers, undefined);
    });

    it('update({ params }) appends query string', async () => {
      await admin.status({ org: 'adobe', site: 'x' }).update('/page', undefined, { params: { force: 'true' } });
      assert.equal(new URL(calls[0].url).searchParams.get('force'), 'true');
      assert.equal(calls[0].init.method, 'POST');
    });

    it('exposes .url as a string on every operation resource', () => {
      const coords = { org: 'adobe', site: 'x' };
      [
        admin.status(coords),
        admin.preview(coords),
        admin.live(coords),
        admin.code(coords),
        admin.log(coords),
        admin.index(coords),
        admin.sitemap(coords),
        admin.job(coords),
        admin.psi(coords),
        admin.snapshot(coords),
        admin.sidekick(coords),
      ].forEach((r) => assert.equal(typeof r.url, 'string'));
    });

    it('.url matches the base URL used by .get(\'\')', async () => {
      const resource = admin.preview({ org: 'adobe', site: 'x' });
      await resource.get('');
      assert.equal(resource.url, calls[0].url);
    });
  });

  describe('operation cap enforcement', () => {
    it('status does not expose .remove', () => {
      assert.equal(admin.status({ org: 'adobe', site: 'x' }).remove, undefined);
    });

    it('sitemap does not expose .get or .remove', () => {
      const sm = admin.sitemap({ org: 'adobe', site: 'x' });
      assert.equal(sm.get, undefined);
      assert.equal(sm.remove, undefined);
    });

    it('job does not expose .update', () => {
      assert.equal(admin.job({ org: 'adobe', site: 'x' }).update, undefined);
    });

    it('log does not expose .remove', () => {
      assert.equal(admin.log({ org: 'adobe', site: 'x' }).remove, undefined);
    });

    it('psi does not expose .update or .remove', () => {
      const p = admin.psi({ org: 'adobe', site: 'x' });
      assert.equal(p.update, undefined);
      assert.equal(p.remove, undefined);
    });
  });

  describe('admin.raw(method, urlOrPath, body?, opts?)', () => {
    it('path starting with / is resolved against the admin base', async () => {
      await admin.raw('GET', '/foo/bar');
      assert.ok(calls[0].url.endsWith('/foo/bar'));
      assert.ok(calls[0].url.startsWith('https://'));
      assert.equal(calls[0].init.method, 'GET');
    });

    it('absolute URL is passed through unchanged', async () => {
      await admin.raw('GET', 'https://example.com/api/test');
      assert.equal(calls[0].url, 'https://example.com/api/test');
    });

    it('forwards the method as-is', async () => {
      await admin.raw('DELETE', '/foo/bar');
      assert.equal(calls[0].init.method, 'DELETE');
    });

    it('no body → no content-type header', async () => {
      await admin.raw('GET', '/foo/bar');
      assert.equal(calls[0].init.body, undefined);
      assert.equal(calls[0].init.headers, undefined);
    });

    it('body present → defaults to application/json', async () => {
      await admin.raw('POST', '/foo/bar', '{"paths":["/"]}');
      assert.equal(calls[0].init.body, '{"paths":["/"]}');
      assert.equal(calls[0].init.headers.get('content-type'), 'application/json');
    });

    it('opts.contentType overrides the default', async () => {
      await admin.raw('POST', '/foo/bar', 'body', { contentType: 'text/plain' });
      assert.equal(calls[0].init.headers.get('content-type'), 'text/plain');
    });

    it('opts.params appended as query string', async () => {
      await admin.raw('GET', '/foo/bar', undefined, { params: { editUrl: 'auto' } });
      assert.equal(new URL(calls[0].url).searchParams.get('editUrl'), 'auto');
    });

    it('null body treated same as undefined — no content-type', async () => {
      await admin.raw('POST', '/foo/bar', null);
      assert.equal(calls[0].init.body, undefined);
      assert.equal(calls[0].init.headers, undefined);
    });

    it('returns a normalized AdminResponse envelope', async () => {
      const result = await admin.raw('GET', '/foo/bar');
      assert.equal(typeof result.ok, 'boolean');
      assert.equal(typeof result.status, 'number');
      assert.equal(typeof result.text, 'function');
      assert.equal(typeof result.json, 'function');
      assert.equal(result.error, '');
      assert.equal(result.request.method, 'GET');
    });

    it('propagates withRequestInit defaults', async () => {
      const a = admin.withRequestInit({ credentials: 'include' });
      await a.raw('GET', '/foo/bar');
      assert.equal(calls[0].init.credentials, 'include');
    });
  });

  describe('admin.suggestions(coords)', () => {
    it('returns an array of {url, label} objects', () => {
      const items = admin.suggestions({ org: 'adobe' });
      assert.ok(Array.isArray(items));
      assert.ok(items.length > 0);
      assert.ok(items.every(({ url, label }) => typeof url === 'string' && typeof label === 'string'));
    });

    it('all suggestion URLs start with https://', () => {
      const items = admin.suggestions({ org: 'adobe', site: 'x' });
      assert.ok(items.every(({ url }) => url.startsWith('https://')));
    });

    it('returns more items when site is provided than when only org is provided', () => {
      const orgOnly = admin.suggestions({ org: 'adobe' });
      const withSite = admin.suggestions({ org: 'adobe', site: 'x' });
      assert.ok(withSite.length > orgOnly.length);
    });
  });

  describe('admin.coordsFromURL(url)', () => {
    it('returns nulls for an invalid URL', () => {
      assert.deepEqual(admin.coordsFromURL('not-a-url'), { org: null, site: null });
    });

    it('is available as a function on withRequestInit-derived clients', () => {
      const a = admin.withRequestInit({ credentials: 'include' });
      assert.equal(typeof a.coordsFromURL, 'function');
    });
  });

  describe('network error handling', () => {
    it('returns ok=false with status=0 when fetch throws', async () => {
      respond = () => { throw new TypeError('Failed to fetch'); };
      const result = await admin.config({ org: 'adobe', site: 'x' }).read();
      assert.equal(result.ok, false);
      assert.equal(result.status, 0);
    });

    it('sets error to the thrown message', async () => {
      respond = () => { throw new TypeError('Failed to fetch'); };
      const result = await admin.config({ org: 'adobe', site: 'x' }).read();
      assert.equal(result.error, 'Failed to fetch');
    });

    it('echoes method and url on the request descriptor despite the error', async () => {
      respond = () => { throw new TypeError('Failed to fetch'); };
      const result = await admin.config({ org: 'adobe', site: 'x' }).read();
      assert.equal(result.request.method, 'GET');
      assert.ok(result.request.url.startsWith('https://'));
    });

    it('json() rejects with the original error', async () => {
      respond = () => { throw new TypeError('Failed to fetch'); };
      const result = await admin.config({ org: 'adobe', site: 'x' }).read();
      await assert.rejects(() => result.json(), /Failed to fetch/);
    });

    it('text() rejects with the original error', async () => {
      respond = () => { throw new TypeError('Failed to fetch'); };
      const result = await admin.config({ org: 'adobe', site: 'x' }).read();
      await assert.rejects(() => result.text(), /Failed to fetch/);
    });
  });

  describe('response envelope', () => {
    it('exposes ok=true and the response status on success', async () => {
      respond = () => new Response('hello', { status: 200 });
      const result = await admin.config({ org: 'adobe', site: 'x' }).select('robots.txt').read();
      assert.equal(result.ok, true);
      assert.equal(result.status, 200);
      assert.equal(result.error, '');
    });

    it('exposes ok=false and the x-error header on failure', async () => {
      respond = () => new Response('', { status: 401, headers: { 'x-error': '[admin] not authenticated' } });
      const result = await admin.config({ org: 'adobe', site: 'x' }).select('robots.txt').read();
      assert.equal(result.ok, false);
      assert.equal(result.status, 401);
      assert.equal(result.error, '[admin] not authenticated');
    });

    it('error is empty string (not null) when x-error is absent', async () => {
      respond = () => new Response('', { status: 500 });
      const result = await admin.config({ org: 'adobe', site: 'x' }).select('robots.txt').read();
      assert.equal(result.error, '');
    });

    it('text() reads the response body', async () => {
      respond = () => new Response('User-agent: *', { status: 200 });
      const result = await admin.config({ org: 'adobe', site: 'x' }).select('robots.txt').read();
      assert.equal(await result.text(), 'User-agent: *');
    });

    it('echoes method and url on the request descriptor', async () => {
      const result = await admin.config({ org: 'adobe', site: 'x' }).select('robots.txt').update('x');
      assert.equal(result.request.method, 'POST');
      assert.ok(result.request.url.endsWith('/robots.txt'));
    });
  });

  describe('admin.withRequestInit(extra)', () => {
    it('merges fetch-init defaults into every request', async () => {
      const a = admin.withRequestInit({ credentials: 'include', cache: 'no-cache' });
      await a.config({ org: 'adobe', site: 'x' }).select('robots.txt').read();
      assert.equal(calls[0].init.credentials, 'include');
      assert.equal(calls[0].init.cache, 'no-cache');
    });

    it('does not affect calls through the unwrapped client', async () => {
      admin.withRequestInit({ credentials: 'include' });
      await admin.config({ org: 'adobe', site: 'x' }).select('robots.txt').read();
      assert.equal(calls[0].init.credentials, undefined);
    });

    it('chains — later .withRequestInit overrides earlier values', async () => {
      const a = admin
        .withRequestInit({ credentials: 'include', cache: 'no-cache' })
        .withRequestInit({ cache: 'no-store' });
      await a.config({ org: 'adobe', site: 'x' }).select('robots.txt').read();
      assert.equal(calls[0].init.credentials, 'include');
      assert.equal(calls[0].init.cache, 'no-store');
    });

    it('preserves method/body/content-type on top of init defaults', async () => {
      const a = admin.withRequestInit({ credentials: 'include' });
      await a.config({ org: 'adobe', site: 'x' }).select('robots.txt').update('User-agent: *');
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
      await a.config({ org: 'adobe', site: 'x' }).select('robots.txt').update('User-agent: *');
      assert.deepEqual(Object.fromEntries(calls[0].init.headers), {
        authorization: 'token abc',
        'content-type': 'text/plain',
      });
    });

    it('preserves a Headers instance passed via withRequestInit', async () => {
      const a = admin.withRequestInit({
        headers: new Headers({ authorization: 'token abc' }),
      });
      await a.config({ org: 'adobe', site: 'x' }).select('robots.txt').update('User-agent: *');
      assert.equal(calls[0].init.headers.get('authorization'), 'token abc');
      assert.equal(calls[0].init.headers.get('content-type'), 'text/plain');
    });

    it('preserves headers passed as [name, value] tuples', async () => {
      const a = admin.withRequestInit({
        headers: [['authorization', 'token abc']],
      });
      await a.config({ org: 'adobe', site: 'x' }).select('robots.txt').update('User-agent: *');
      assert.equal(calls[0].init.headers.get('authorization'), 'token abc');
      assert.equal(calls[0].init.headers.get('content-type'), 'text/plain');
    });

    it('applies defaults to operational namespaces', async () => {
      const a = admin.withRequestInit({ credentials: 'include' });
      await a.preview({ org: 'adobe', site: 'x' }).update('/page');
      assert.equal(calls[0].init.credentials, 'include');
      assert.equal(calls[0].init.method, 'POST');
    });
  });
}
