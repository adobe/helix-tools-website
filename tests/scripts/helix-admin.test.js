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
      // Org-only is a real config root (/config/{org}); future tools (e.g.
      // cdn-setup's aggregated/{site}.json) live under it via .select().
      const cfg = admin.config({ org: 'adobe' });
      assert.equal(typeof cfg.select, 'function');
      assert.equal(typeof cfg.read, 'function');
    });
  });

  describe('admin.config(coords).select()', () => {
    it('descends one segment (strips the root .json before appending)', async () => {
      // Root URL is /config/adobe/sites/x.json — descent strips that
      // extension, then appends robots.txt → /config/adobe/sites/x/robots.txt.
      await admin.config({ org: 'adobe', site: 'x' }).select('robots.txt').read();
      assert.equal(
        calls[0].url,
        'https://admin.hlx.page/config/adobe/sites/x/robots.txt',
      );
    });

    it('descends from an org-only root', async () => {
      await admin.config({ org: 'adobe' }).select('aggregated/x.json').read();
      assert.equal(
        calls[0].url,
        'https://admin.hlx.page/config/adobe/aggregated/x.json',
      );
    });

    it('descends nested via chained .select() calls', async () => {
      await admin.config({ org: 'adobe', site: 'x' })
        .select('cdn')
        .select('prod.json')
        .read();
      assert.equal(
        calls[0].url,
        'https://admin.hlx.page/config/adobe/sites/x/cdn/prod.json',
      );
    });

    it('accepts embedded slashes as shorthand for nested selects', async () => {
      await admin.config({ org: 'adobe', site: 'x' })
        .select('content/sitemap.yaml')
        .read();
      assert.equal(
        calls[0].url,
        'https://admin.hlx.page/config/adobe/sites/x/content/sitemap.yaml',
      );
    });

    it('strips leading and trailing slashes on the segment', async () => {
      await admin.config({ org: 'adobe', site: 'x' })
        .select('/cdn/')
        .select('/prod.json/')
        .read();
      assert.equal(
        calls[0].url,
        'https://admin.hlx.page/config/adobe/sites/x/cdn/prod.json',
      );
    });

    it('strips the leaf extension when descending', async () => {
      // The AEM admin convention treats `cdn.json` (file view) and `cdn/`
      // (directory view) as two views of the same node, so chaining
      // .select('cdn.json').select('prod.json') resolves to /cdn/prod.json.
      // This unlocks the pattern: read parent aggregate, then drill into
      // a child via the same handle.
      await admin.config({ org: 'adobe', site: 'x' })
        .select('cdn.json')
        .select('prod.json')
        .read();
      assert.equal(
        calls[0].url,
        'https://admin.hlx.page/config/adobe/sites/x/cdn/prod.json',
      );
    });

    it('returns a reusable handle — read parent, then descend to update child', async () => {
      // Two payoffs of the recursive shape in one test: same handle for
      // multiple ops AND descent past the file/dir boundary.
      const cdn = admin.config({ org: 'adobe', site: 'x' }).select('cdn.json');
      await cdn.read();
      await cdn.select('prod.json').update('{"host":"example.com"}');
      assert.equal(calls[0].init.method, 'GET');
      assert.equal(calls[0].url, 'https://admin.hlx.page/config/adobe/sites/x/cdn.json');
      assert.equal(calls[1].init.method, 'POST');
      assert.equal(calls[1].url, 'https://admin.hlx.page/config/adobe/sites/x/cdn/prod.json');
    });
  });

  describe('CRUD operations', () => {
    it('.read() GETs the bound URL', async () => {
      await admin.config({ org: 'adobe', site: 'x' }).select('robots.txt').read();
      assert.equal(calls[0].init.method, 'GET');
      assert.equal(calls[0].init.body, undefined);
    });

    it('.read() does not require a known extension on the leaf', async () => {
      // GETs read whatever the server serves; the content-type rule only
      // applies to writes. Pin that an extensionless URL still GETs cleanly.
      await admin.config({ org: 'adobe', site: 'x' }).select('weird').read();
      assert.equal(calls[0].init.method, 'GET');
    });

    it('.read() at the bound site root reads {site}.json', async () => {
      // The root config endpoint is /config/{org}/sites/{site}.json; the
      // extension-strip on .select() means descents drop the .json before
      // appending, so this stays consistent.
      await admin.config({ org: 'adobe', site: 'x' }).read();
      assert.equal(calls[0].url, 'https://admin.hlx.page/config/adobe/sites/x.json');
      assert.equal(calls[0].init.method, 'GET');
    });

    it('.read() at the bound org root reads {org}.json', async () => {
      await admin.config({ org: 'adobe' }).read();
      assert.equal(calls[0].url, 'https://admin.hlx.page/config/adobe.json');
      assert.equal(calls[0].init.method, 'GET');
    });

    it('.update(body) POSTs the body to the bound URL', async () => {
      await admin.config({ org: 'adobe', site: 'x' })
        .select('content/sitemap.yaml')
        .update('version: 1\n');
      assert.equal(calls[0].init.method, 'POST');
      assert.equal(calls[0].init.body, 'version: 1\n');
    });

    it('.update(body) treats empty string as a real POST, not GET', async () => {
      // Clearing the file content is not the same as deleting it. A
      // truthiness check would silently turn this into a GET — pin that.
      await admin.config({ org: 'adobe', site: 'x' }).select('robots.txt').update('');
      assert.equal(calls[0].init.method, 'POST');
      assert.equal(calls[0].init.body, '');
    });

    it('.create(body) PUTs the body to the bound URL', async () => {
      await admin.config({ org: 'adobe', site: 'x' })
        .select('headers.json')
        .create('{}');
      assert.equal(calls[0].init.method, 'PUT');
      assert.equal(calls[0].init.body, '{}');
    });

    it('.remove() DELETEs the bound URL', async () => {
      await admin.config({ org: 'adobe', site: 'x' }).select('headers.json').remove();
      assert.equal(calls[0].init.method, 'DELETE');
      assert.equal(
        calls[0].url,
        'https://admin.hlx.page/config/adobe/sites/x/headers.json',
      );
      assert.equal(calls[0].init.body, undefined);
    });

    it('.remove() does not require a known extension on the leaf', async () => {
      // DELETEs send no body, so no content-type to derive.
      await admin.config({ org: 'adobe', site: 'x' }).select('weird').remove();
      assert.equal(calls[0].init.method, 'DELETE');
    });
  });

  describe('write content-type derivation', () => {
    // .update and .create share this rule. Tests use .update as the
    // representative; if .create's derivation diverges we'll find out via
    // the .create CRUD test, which exercises the same code path.
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

  describe('admin.index(coords)', () => {
    it('.bulk(payload) POSTs application/json with the JSON-stringified payload', async () => {
      const payload = { paths: ['/'], indexNames: ['default'] };
      await admin.index({ org: 'adobe', site: 'x' }).bulk(payload);
      assert.equal(calls[0].url, 'https://admin.hlx.page/index/adobe/x/main/*');
      assert.equal(calls[0].init.method, 'POST');
      assert.equal(calls[0].init.body, JSON.stringify(payload));
      assert.deepEqual(
        Object.fromEntries(calls[0].init.headers),
        { 'content-type': 'application/json' },
      );
    });
  });

  describe('admin.sitemap(coords)', () => {
    it('.generate(path) POSTs /sitemap/{org}/{site}/main{path} with no body', async () => {
      await admin.sitemap({ org: 'adobe', site: 'x' }).generate('/sitemap.xml');
      assert.equal(
        calls[0].url,
        'https://admin.hlx.page/sitemap/adobe/x/main/sitemap.xml',
      );
      assert.equal(calls[0].init.method, 'POST');
      assert.equal(calls[0].init.body, undefined);
    });

    it('.generate(path) handles nested destinations', async () => {
      await admin.sitemap({ org: 'adobe', site: 'x' }).generate('/en/sitemap.xml');
      assert.equal(
        calls[0].url,
        'https://admin.hlx.page/sitemap/adobe/x/main/en/sitemap.xml',
      );
    });
  });

  describe('admin.job(coords)', () => {
    it('.list(topic) GETs /job/{org}/{site}/main/{topic}', async () => {
      await admin.job({ org: 'adobe', site: 'x' }).list('index');
      assert.equal(calls[0].url, 'https://admin.hlx.page/job/adobe/x/main/index');
      assert.equal(calls[0].init.method, 'GET');
    });

    it('.status(topic, name) GETs /job/{org}/{site}/main/{topic}/{name}', async () => {
      await admin.job({ org: 'adobe', site: 'x' }).status('index', 'job-123');
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
      // Tools log `result.error` directly into the console block — null would
      // render as the literal string "null", '' renders as empty.
      respond = () => new Response('', { status: 500 });
      const result = await admin.config({ org: 'adobe', site: 'x' }).select('robots.txt').read();
      assert.equal(result.error, '');
    });

    it('text() reads the response body', async () => {
      respond = () => new Response('User-agent: *', { status: 200 });
      const result = await admin.config({ org: 'adobe', site: 'x' }).select('robots.txt').read();
      assert.equal(await result.text(), 'User-agent: *');
    });

    it('echoes method and url on the request descriptor for logging', async () => {
      const result = await admin.config({ org: 'adobe', site: 'x' })
        .select('robots.txt')
        .update('x');
      assert.equal(result.request.method, 'POST');
      assert.equal(
        result.request.url,
        'https://admin.hlx.page/config/adobe/sites/x/robots.txt',
      );
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
      await a.config({ org: 'adobe', site: 'x' })
        .select('robots.txt')
        .update('User-agent: *');
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
      await a.config({ org: 'adobe', site: 'x' })
        .select('robots.txt')
        .update('User-agent: *');
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
      await a.config({ org: 'adobe', site: 'x' })
        .select('robots.txt')
        .update('User-agent: *');
      assert.equal(calls[0].init.headers.get('authorization'), 'token abc');
      assert.equal(calls[0].init.headers.get('content-type'), 'text/plain');
    });

    it('preserves headers passed as [name, value] tuples', async () => {
      const a = admin.withRequestInit({
        headers: [['authorization', 'token abc']],
      });
      await a.config({ org: 'adobe', site: 'x' })
        .select('robots.txt')
        .update('User-agent: *');
      assert.equal(calls[0].init.headers.get('authorization'), 'token abc');
      assert.equal(calls[0].init.headers.get('content-type'), 'text/plain');
    });
  });
});
