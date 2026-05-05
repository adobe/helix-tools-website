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
  });

  describe('coord-vs-select equivalence', () => {
    // Both shapes resolve to identical wire calls. Documenting the
    // equivalence in a test guards against future refactors breaking one
    // path silently.
    it('config({org, site}) ≡ config({org}).select(`sites/{site}.json`)', async () => {
      await admin.config({ org: 'adobe', site: 'x' }).read();
      await admin.config({ org: 'adobe' }).select('sites/x.json').read();
      assert.equal(calls[0].url, calls[1].url);
    });

    it('config({org, profile}) ≡ config({org}).select(`profiles/{profile}.json`)', async () => {
      await admin.config({ org: 'adobe', profile: 'p' }).read();
      await admin.config({ org: 'adobe' }).select('profiles/p.json').read();
      assert.equal(calls[0].url, calls[1].url);
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

    it('.read() at the bound profile root reads /profiles/{profile}.json', async () => {
      await admin.config({ org: 'adobe', profile: 'p' }).read();
      assert.equal(
        calls[0].url,
        'https://admin.hlx.page/config/adobe/profiles/p.json',
      );
      assert.equal(calls[0].init.method, 'GET');
    });

    it('.update(body) POSTs the body to the bound URL', async () => {
      await admin.config({ org: 'adobe', site: 'x' })
        .select('content/sitemap.yaml')
        .update('version: 1\n');
      assert.equal(calls[0].init.method, 'POST');
      assert.equal(calls[0].init.body, 'version: 1\n');
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

  describe('opts.params (query string)', () => {
    it('.read({ params }) appends the query string', async () => {
      await admin.config({ org: 'adobe', site: 'x' })
        .select('versions/3.json')
        .read({ params: { detail: 'full' } });
      assert.equal(
        calls[0].url,
        'https://admin.hlx.page/config/adobe/sites/x/versions/3.json?detail=full',
      );
      assert.equal(calls[0].init.method, 'GET');
    });

    it('.remove({ params }) appends the query string', async () => {
      await admin.config({ org: 'adobe', site: 'x' })
        .select('versions/3.json')
        .remove({ params: { force: 'true' } });
      assert.equal(
        calls[0].url,
        'https://admin.hlx.page/config/adobe/sites/x/versions/3.json?force=true',
      );
      assert.equal(calls[0].init.method, 'DELETE');
    });

    it('.update(body, { params }) appends params and still derives content-type', async () => {
      // The version-rename case: ?name=<encoded> AND a JSON body — the
      // server today wants both.
      await admin.config({ org: 'adobe', site: 'x' })
        .select('versions/3.json')
        .update('{"name":"v1"}', { params: { name: 'v1' } });
      assert.equal(
        calls[0].url,
        'https://admin.hlx.page/config/adobe/sites/x/versions/3.json?name=v1',
      );
      assert.equal(calls[0].init.method, 'POST');
      assert.equal(calls[0].init.body, '{"name":"v1"}');
      assert.equal(calls[0].init.headers.get('content-type'), 'application/json');
    });

    it('.create(body, { params }) appends params and derives content-type', async () => {
      await admin.config({ org: 'adobe', site: 'x' })
        .select('headers.json')
        .create('{}', { params: { versionName: 'init' } });
      assert.equal(
        calls[0].url,
        'https://admin.hlx.page/config/adobe/sites/x/headers.json?versionName=init',
      );
      assert.equal(calls[0].init.method, 'PUT');
      assert.equal(calls[0].init.body, '{}');
      assert.equal(calls[0].init.headers.get('content-type'), 'application/json');
    });

    it('encodes special characters via URLSearchParams', async () => {
      await admin.config({ org: 'adobe', site: 'x' })
        .select('versions/3.json')
        .update('{"name":"v 1 & co"}', { params: { name: 'v 1 & co' } });
      // URLSearchParams encodes ' ' as '+' and '&' as '%26'.
      assert.equal(
        calls[0].url,
        'https://admin.hlx.page/config/adobe/sites/x/versions/3.json?name=v+1+%26+co',
      );
    });

    it('serializes multiple params with &', async () => {
      await admin.config({ org: 'adobe', site: 'x' })
        .read({ params: { foo: 'a', bar: 'b' } });
      assert.equal(
        calls[0].url,
        'https://admin.hlx.page/config/adobe/sites/x.json?foo=a&bar=b',
      );
    });

    it('coerces number values to strings', async () => {
      await admin.config({ org: 'adobe', site: 'x' })
        .update(null, { params: { restoreVersion: 5 } });
      assert.equal(
        calls[0].url,
        'https://admin.hlx.page/config/adobe/sites/x.json?restoreVersion=5',
      );
    });

    it('echoes the final URL with params on the request descriptor', async () => {
      const result = await admin.config({ org: 'adobe', site: 'x' })
        .read({ params: { foo: 'bar' } });
      assert.equal(
        result.request.url,
        'https://admin.hlx.page/config/adobe/sites/x.json?foo=bar',
      );
    });
  });

  describe('write with no body (action-style POST/PUT)', () => {
    // Carries state via opts.params instead of a body. Used today for
    // version-restore (?restoreVersion=N on the config root).
    it('.update(undefined) sends no body and skips content-type (null behaves the same)', async () => {
      await admin.config({ org: 'adobe', site: 'x' })
        .update(undefined, { params: { restoreVersion: 3 } });
      assert.equal(calls[0].init.method, 'POST');
      assert.equal(calls[0].init.body, undefined);
      assert.equal(calls[0].init.headers, undefined);
    });

    it('.update(\'\') is a real empty body and still derives content-type', async () => {
      // Empty string is a valid body for an empty file write — keep this
      // distinct from undefined/null.
      await admin.config({ org: 'adobe', site: 'x' }).select('robots.txt').update('');
      assert.equal(calls[0].init.method, 'POST');
      assert.equal(calls[0].init.body, '');
      assert.equal(calls[0].init.headers.get('content-type'), 'text/plain');
    });

    it('.update(undefined) does not throw on an extensionless leaf', async () => {
      // No body → no content-type derivation → no throw. The HTTP request
      // goes through; the server decides what to do.
      await admin.config({ org: 'adobe', site: 'x' })
        .select('versions')
        .update(undefined, { params: { something: 'x' } });
      assert.equal(calls[0].init.method, 'POST');
    });

    it('.create(null) sends no body and skips content-type', async () => {
      await admin.config({ org: 'adobe', site: 'x' })
        .create(null, { params: { foo: 'bar' } });
      assert.equal(calls[0].init.method, 'PUT');
      assert.equal(calls[0].init.body, undefined);
    });
  });

  describe('admin.status(coords)', () => {
    it('.get() GETs the root status endpoint', async () => {
      await admin.status({ org: 'adobe', site: 'x' }).get('');
      assert.equal(calls[0].url, 'https://admin.hlx.page/status/adobe/x/main');
      assert.equal(calls[0].init.method, 'GET');
    });

    it('.get(path) appends the path', async () => {
      await admin.status({ org: 'adobe', site: 'x' }).get('/en/index');
      assert.equal(calls[0].url, 'https://admin.hlx.page/status/adobe/x/main/en/index');
    });

    it('.get(path, { params }) appends query string', async () => {
      await admin.status({ org: 'adobe', site: 'x' }).get('/page', { params: { editUrl: 'auto' } });
      assert.equal(calls[0].url, 'https://admin.hlx.page/status/adobe/x/main/page?editUrl=auto');
    });

    it('.update(path) POSTs a status update trigger', async () => {
      await admin.status({ org: 'adobe', site: 'x' }).update('/en/index');
      assert.equal(calls[0].url, 'https://admin.hlx.page/status/adobe/x/main/en/index');
      assert.equal(calls[0].init.method, 'POST');
    });

    it('does not expose .remove', () => {
      assert.equal(admin.status({ org: 'adobe', site: 'x' }).remove, undefined);
    });
  });

  describe('admin.raw(method, urlOrPath, body?, opts?)', () => {
    it('path starting with / is resolved against ADMIN_BASE', async () => {
      await admin.raw('GET', '/sidekick/adobe/x/main/config.json');
      assert.equal(calls[0].url, 'https://admin.hlx.page/sidekick/adobe/x/main/config.json');
      assert.equal(calls[0].init.method, 'GET');
    });

    it('absolute URL is passed through unchanged', async () => {
      await admin.raw('GET', 'https://admin.hlx.page/sidekick/adobe/x/main/config.json');
      assert.equal(calls[0].url, 'https://admin.hlx.page/sidekick/adobe/x/main/config.json');
    });

    it('forwards the method as-is', async () => {
      await admin.raw('DELETE', '/preview/adobe/x/main/page');
      assert.equal(calls[0].init.method, 'DELETE');
    });

    it('no body → no content-type header', async () => {
      await admin.raw('GET', '/status/adobe/x/main');
      assert.equal(calls[0].init.body, undefined);
      assert.equal(calls[0].init.headers, undefined);
    });

    it('body present → defaults to application/json', async () => {
      await admin.raw('POST', '/preview/adobe/x/main/*', '{"paths":["/"]}');
      assert.equal(calls[0].init.body, '{"paths":["/"]}');
      assert.equal(calls[0].init.headers.get('content-type'), 'application/json');
    });

    it('opts.contentType overrides the default', async () => {
      await admin.raw('POST', '/preview/adobe/x/main/page', 'body', { contentType: 'text/plain' });
      assert.equal(calls[0].init.headers.get('content-type'), 'text/plain');
    });

    it('opts.params appended as query string', async () => {
      await admin.raw('GET', '/status/adobe/x/main', undefined, { params: { editUrl: 'auto' } });
      const u = new URL(calls[0].url);
      assert.equal(u.searchParams.get('editUrl'), 'auto');
    });

    it('null body treated same as undefined — no content-type', async () => {
      await admin.raw('POST', '/preview/adobe/x/main/page', null);
      assert.equal(calls[0].init.body, undefined);
      assert.equal(calls[0].init.headers, undefined);
    });

    it('returns a normalized AdminResponse envelope', async () => {
      const result = await admin.raw('GET', '/status/adobe/x/main');
      assert.equal(typeof result.ok, 'boolean');
      assert.equal(typeof result.status, 'number');
      assert.equal(typeof result.text, 'function');
      assert.equal(typeof result.json, 'function');
      assert.equal(result.error, '');
      assert.equal(result.request.method, 'GET');
      assert.equal(result.request.url, 'https://admin.hlx.page/status/adobe/x/main');
    });

    it('propagates withRequestInit defaults', async () => {
      const a = admin.withRequestInit({ credentials: 'include' });
      await a.raw('GET', '/status/adobe/x/main');
      assert.equal(calls[0].init.credentials, 'include');
    });
  });

  describe('admin.suggestions(coords)', () => {
    it('returns org-level URLs when only org provided', () => {
      const items = admin.suggestions({ org: 'adobe' });
      assert.ok(Array.isArray(items));
      assert.ok(items.length > 0);
      assert.ok(items.every(({ url, label }) => typeof url === 'string' && typeof label === 'string'));
      assert.ok(items.every(({ url }) => url.startsWith('https://admin.hlx.page/')));
    });

    it('includes org config URL', () => {
      const items = admin.suggestions({ org: 'adobe' });
      assert.ok(items.some(({ url }) => url === 'https://admin.hlx.page/config/adobe.json'));
    });

    it('includes site-level URLs when site provided', () => {
      const items = admin.suggestions({ org: 'adobe', site: 'x' });
      assert.ok(items.some(({ url }) => url === 'https://admin.hlx.page/config/adobe/sites/x.json'));
      assert.ok(items.some(({ url }) => url.includes('/status/adobe/x/main')));
      assert.ok(items.some(({ url }) => url.includes('/preview/adobe/x/main')));
    });

    it('does not include site-level URLs when site omitted', () => {
      const items = admin.suggestions({ org: 'adobe' });
      assert.ok(items.every(({ url }) => !url.includes('/sites/x')));
    });
  });


  describe('admin.preview(coords)', () => {
    it('.get(path) GETs the preview status', async () => {
      await admin.preview({ org: 'adobe', site: 'x' }).get('/en/index');
      assert.equal(calls[0].url, 'https://admin.hlx.page/preview/adobe/x/main/en/index');
      assert.equal(calls[0].init.method, 'GET');
    });

    it('.update(path) POSTs a bodyless trigger', async () => {
      await admin.preview({ org: 'adobe', site: 'x' }).update('/en/index');
      assert.equal(calls[0].url, 'https://admin.hlx.page/preview/adobe/x/main/en/index');
      assert.equal(calls[0].init.method, 'POST');
      assert.equal(calls[0].init.body, undefined);
    });

    it('.remove(path) DELETEs the preview', async () => {
      await admin.preview({ org: 'adobe', site: 'x' }).remove('/en/index');
      assert.equal(calls[0].url, 'https://admin.hlx.page/preview/adobe/x/main/en/index');
      assert.equal(calls[0].init.method, 'DELETE');
    });
  });

  describe('admin.live(coords)', () => {
    it('.get(path) GETs the live status', async () => {
      await admin.live({ org: 'adobe', site: 'x' }).get('/en/index');
      assert.equal(calls[0].url, 'https://admin.hlx.page/live/adobe/x/main/en/index');
      assert.equal(calls[0].init.method, 'GET');
    });

    it('.update(path) POSTs a bodyless publish trigger', async () => {
      await admin.live({ org: 'adobe', site: 'x' }).update('/en/index');
      assert.equal(calls[0].url, 'https://admin.hlx.page/live/adobe/x/main/en/index');
      assert.equal(calls[0].init.method, 'POST');
    });

    it('.remove(path) DELETEs (unpublishes) the page', async () => {
      await admin.live({ org: 'adobe', site: 'x' }).remove('/en/index');
      assert.equal(calls[0].url, 'https://admin.hlx.page/live/adobe/x/main/en/index');
      assert.equal(calls[0].init.method, 'DELETE');
    });
  });

  describe('admin.log(coords)', () => {
    it('.get(path) GETs logs', async () => {
      await admin.log({ org: 'adobe', site: 'x' }).get('');
      assert.equal(calls[0].url, 'https://admin.hlx.page/log/adobe/x/main');
      assert.equal(calls[0].init.method, 'GET');
    });

    it('.update(path) POSTs a log update', async () => {
      await admin.log({ org: 'adobe', site: 'x' }).update('');
      assert.equal(calls[0].url, 'https://admin.hlx.page/log/adobe/x/main');
      assert.equal(calls[0].init.method, 'POST');
    });

    it('does not expose .remove', () => {
      assert.equal(admin.log({ org: 'adobe', site: 'x' }).remove, undefined);
    });
  });

  describe('admin.index(coords)', () => {
    it('.update("/*", body) POSTs application/json to the bulk index endpoint', async () => {
      const payload = { paths: ['/'], indexNames: ['default'] };
      await admin.index({ org: 'adobe', site: 'x' }).update('/*', JSON.stringify(payload));
      assert.equal(calls[0].url, 'https://admin.hlx.page/index/adobe/x/main/*');
      assert.equal(calls[0].init.method, 'POST');
      assert.equal(calls[0].init.body, JSON.stringify(payload));
      assert.deepEqual(
        Object.fromEntries(calls[0].init.headers),
        { 'content-type': 'application/json' },
      );
    });

    it('.get(path) GETs the index state for a path', async () => {
      await admin.index({ org: 'adobe', site: 'x' }).get('/en/index');
      assert.equal(calls[0].url, 'https://admin.hlx.page/index/adobe/x/main/en/index');
      assert.equal(calls[0].init.method, 'GET');
    });

    it('.remove(path) DELETEs from the index', async () => {
      await admin.index({ org: 'adobe', site: 'x' }).remove('/en/index');
      assert.equal(calls[0].url, 'https://admin.hlx.page/index/adobe/x/main/en/index');
      assert.equal(calls[0].init.method, 'DELETE');
    });
  });

  describe('admin.sitemap(coords)', () => {
    it('.update(path) POSTs /sitemap/{org}/{site}/main/{path} with no body', async () => {
      await admin.sitemap({ org: 'adobe', site: 'x' }).update('/sitemap.xml');
      assert.equal(
        calls[0].url,
        'https://admin.hlx.page/sitemap/adobe/x/main/sitemap.xml',
      );
      assert.equal(calls[0].init.method, 'POST');
      assert.equal(calls[0].init.body, undefined);
    });

    it('.update(path) handles nested destinations', async () => {
      await admin.sitemap({ org: 'adobe', site: 'x' }).update('/en/sitemap.xml');
      assert.equal(
        calls[0].url,
        'https://admin.hlx.page/sitemap/adobe/x/main/en/sitemap.xml',
      );
    });

    it('does not expose .get or .remove', () => {
      const sm = admin.sitemap({ org: 'adobe', site: 'x' });
      assert.equal(sm.get, undefined);
      assert.equal(sm.remove, undefined);
    });
  });

  describe('admin.job(coords)', () => {
    it('.get(topic) GETs /job/{org}/{site}/main/{topic}', async () => {
      await admin.job({ org: 'adobe', site: 'x' }).get('index');
      assert.equal(calls[0].url, 'https://admin.hlx.page/job/adobe/x/main/index');
      assert.equal(calls[0].init.method, 'GET');
    });

    it('.get("topic/name") GETs the job status', async () => {
      await admin.job({ org: 'adobe', site: 'x' }).get('index/job-123');
      assert.equal(
        calls[0].url,
        'https://admin.hlx.page/job/adobe/x/main/index/job-123',
      );
      assert.equal(calls[0].init.method, 'GET');
    });

    it('.get("topic/name/details") GETs the details suffix', async () => {
      await admin.job({ org: 'adobe', site: 'x' }).get('index/job-123/details');
      assert.equal(
        calls[0].url,
        'https://admin.hlx.page/job/adobe/x/main/index/job-123/details',
      );
      assert.equal(calls[0].init.method, 'GET');
    });

    it('.remove("topic/name") DELETEs the job', async () => {
      await admin.job({ org: 'adobe', site: 'x' }).remove('index/job-123');
      assert.equal(
        calls[0].url,
        'https://admin.hlx.page/job/adobe/x/main/index/job-123',
      );
      assert.equal(calls[0].init.method, 'DELETE');
      assert.equal(calls[0].init.body, undefined);
    });

    it('does not expose .update', () => {
      assert.equal(admin.job({ org: 'adobe', site: 'x' }).update, undefined);
    });
  });

  describe('bindOperation — shared behaviours', () => {
    it('path with leading slash and without produce the same URL', async () => {
      await admin.job({ org: 'adobe', site: 'x' }).get('/index/job-1');
      await admin.job({ org: 'adobe', site: 'x' }).get('index/job-1');
      assert.equal(calls[0].url, calls[1].url);
    });

    it('update with body sets application/json content-type by default', async () => {
      const body = JSON.stringify({ paths: ['/'] });
      await admin.index({ org: 'adobe', site: 'x' }).update('/*', body);
      assert.equal(calls[0].init.headers.get('content-type'), 'application/json');
    });

    it('update with body respects opts.contentType override', async () => {
      await admin.index({ org: 'adobe', site: 'x' })
        .update('/*', 'data', { contentType: 'text/plain' });
      assert.equal(calls[0].init.headers.get('content-type'), 'text/plain');
    });

    it('update without body sends no content-type', async () => {
      await admin.preview({ org: 'adobe', site: 'x' }).update('/page');
      assert.equal(calls[0].init.headers, undefined);
    });

    it('update({ params }) appends query string', async () => {
      await admin.status({ org: 'adobe', site: 'x' }).update('/page', undefined, { params: { force: 'true' } });
      assert.equal(calls[0].url, 'https://admin.hlx.page/status/adobe/x/main/page?force=true');
      assert.equal(calls[0].init.method, 'POST');
    });

    it('ref: null omits the ref segment (Helix 6 compat)', async () => {
      await admin.status({ org: 'adobe', site: 'x', ref: null }).get('');
      assert.equal(calls[0].url, 'https://admin.hlx.page/status/adobe/x');
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

    it('applies defaults to operational namespaces', async () => {
      const a = admin.withRequestInit({ credentials: 'include' });
      await a.preview({ org: 'adobe', site: 'x' }).update('/page');
      assert.equal(calls[0].init.credentials, 'include');
      assert.equal(calls[0].init.method, 'POST');
    });
  });
});
