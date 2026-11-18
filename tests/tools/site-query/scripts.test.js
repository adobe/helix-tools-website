/* eslint-env node */
import {
  afterEach, beforeEach, describe, it, mock,
} from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import createMockAemApi from '../../helpers/mock-aem-api.js';

let ready;
let sequence = 0;
let signedIn;
let loginCalls;
let opened;
let requests;
let responses;
let unexpected;
let mocks;
let detections;
let probes;
const api = createMockAemApi();
const BASE = 'https://admin.hlx.page';
const STATUS = `${BASE}/status/acme/docs/main`;
const HOST_STATUS = `${STATUS}/index.html`;
const LIVE = 'https://published.example.com';
const HOSTS = { live: { url: `${LIVE}/` } };
const INDEX = `${LIVE}/query-index.json?offset=0&limit=512`;
const EMPTY_INDEX = `${LIVE}/query-index.json?offset=512&limit=512`;

mock.module('../../../scripts/scripts.js', {
  exports: { registerToolReady: (promise) => { ready = promise; } },
});
mock.module('../../../utils/config/config.js', {
  exports: { initConfigField: async () => {}, updateConfig: () => {} },
});
mock.module('../../../blocks/profile/profile.js', {
  exports: {
    ensureLogin: async (org, site) => {
      loginCalls.push([org, site]);
      if (!signedIn) {
        setTimeout(() => window.dispatchEvent(new window.Event('profile-cancelled')), 0);
      }
      return signedIn;
    },
  },
});

function respond(url, body, status = 200, headers = {}) {
  const queue = responses.get(url) || [];
  queue.push({ body, status, headers });
  responses.set(url, queue);
}

async function waitFor(predicate) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > 3000) throw new Error('Timed out waiting for Site Query');
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => { setTimeout(resolve, 10); });
  }
}

const urls = () => requests.map(({ url }) => url);
const rows = () => [...document.querySelectorAll('tbody.results > tr')];
const visible = (name) => document.querySelector(`tbody.${name}`).getAttribute('aria-hidden') === 'false';

async function load() {
  sequence += 1;
  await import(`../../../tools/site-query/scripts.js?test=${sequence}`);
  await ready;
  document.getElementById('org').value = 'acme';
  document.getElementById('site').value = 'docs';
  document.getElementById('query').value = '.hero';
  document.getElementById('sitemap').value = '/query-index.json';
}

async function submit() {
  const form = document.getElementById('search-form');
  const button = form.querySelector('button[type="submit"]');
  form.dispatchEvent(new window.SubmitEvent('submit', { cancelable: true, submitter: button }));
  await waitFor(() => !button.disabled);
}

function searchPage() {
  respond(HOST_STATUS, HOSTS);
  respond(INDEX, { data: [{ path: '/guide' }] });
  respond(EMPTY_INDEX, { data: [] });
  respond(`${LIVE}/guide`, '<main><div class="hero">Hello hello</div></main>');
}

describe('site-query request compatibility', () => {
  beforeEach(async () => {
    document.documentElement.innerHTML = await readFile(
      new URL('../../../tools/site-query/index.html', import.meta.url),
      'utf8',
    );
    global.DOMParser = window.DOMParser;
    window.localStorage.clear();
    window.history.replaceState(null, '', '/');
    signedIn = true;
    loginCalls = [];
    opened = [];
    requests = [];
    responses = new Map();
    unexpected = [];
    mocks = [];
    detections = new Map();
    probes = [];
    api.reset();
    api.install();
    const h6Fetch = global.fetch;
    api.uninstall();
    mocks.push(mock.method(window, 'open', (url) => { opened.push(url); }));
    mocks.push(mock.method(console, 'error', () => {}));
    mocks.push(mock.method(global, 'fetch', async (url, init = {}) => {
      const parsed = new URL(url);
      const probe = parsed.pathname.startsWith('/sidekick/')
        && init.cache === 'no-store';
      if (probe) {
        probes.push(String(url));
        const detection = detections.get(parsed.pathname);
        return new Response('{}', {
          status: detection?.status || 200,
          headers: { 'x-api-upgrade-available': detection?.h6 ? 'true' : 'false' },
        });
      }
      requests.push({ url: String(url), method: init.method || 'GET' });
      if (parsed.origin === 'https://api.aem.live') return h6Fetch(url, init);
      const queue = responses.get(String(url));
      if (!queue?.length) {
        unexpected.push(String(url));
        throw new Error(`Unexpected Site Query request: ${url}`);
      }
      const { body, status, headers } = queue.length > 1 ? queue.shift() : queue[0];
      if (body instanceof Error) throw body;
      return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
        status, headers,
      });
    }));
  });

  afterEach(() => {
    mocks.reverse().forEach((item) => item.mock.restore());
    assert.deepEqual(unexpected, []);
    assert.deepEqual(api.violations, []);
  });

  it('searches a paginated query index, applies the path filter and counts selector matches', async () => {
    await load();
    document.getElementById('path').value = '/guide';
    respond(HOST_STATUS, HOSTS);
    respond(INDEX, { data: [{ path: '/guide' }, { path: '/skip' }] });
    respond(EMPTY_INDEX, { data: [] });
    respond(`${LIVE}/guide`, '<main><div class="hero"></div><div class="hero"></div></main>');
    await submit();
    assert.equal(visible('results'), true);
    assert.equal(rows().length, 1);
    assert.equal(rows()[0].lastElementChild.textContent.trim(), '2');
    assert.deepEqual(urls().sort(), [HOST_STATUS, INDEX, EMPTY_INDEX, `${LIVE}/guide`].sort());
    assert.deepEqual(loginCalls, [['acme', 'docs']]);
  });

  it('recurses through sitemaps and uses the selected site host for page URLs', async () => {
    await load();
    document.getElementById('sitemap').value = '/sitemap-index.xml';
    respond(HOST_STATUS, HOSTS);
    respond(`${LIVE}/sitemap-index.xml`, '<sitemapindex><sitemap><loc>https://old.example.com/sitemap.xml</loc></sitemap></sitemapindex>');
    respond(`${LIVE}/sitemap.xml`, '<urlset><url><loc>https://old.example.com/guide</loc></url></urlset>');
    respond(`${LIVE}/guide`, '<div class="hero"></div>');
    await submit();
    assert.equal(rows()[0].querySelector('a').href, `${LIVE}/guide`);
    assert.deepEqual(urls(), [HOST_STATUS, `${LIVE}/sitemap-index.xml`, `${LIVE}/sitemap.xml`, `${LIVE}/guide`]);
  });

  it('preserves case-insensitive text regex matching', async () => {
    await load();
    searchPage();
    document.getElementById('queryType').value = 'Text';
    document.getElementById('query').value = 'hel+o';
    await submit();
    assert.equal(rows()[0].lastElementChild.textContent.trim(), '2');
  });

  it('matches image-source substrings', async () => {
    await load();
    respond(HOST_STATUS, HOSTS);
    respond(INDEX, { data: [{ path: '/guide' }] });
    respond(EMPTY_INDEX, { data: [] });
    respond(`${LIVE}/guide`, '<img src="/media_abc.png"><img src="/media_abc.webp"><img src="/other.png">');
    document.getElementById('queryType').value = 'media';
    document.getElementById('query').value = 'media_abc';
    await submit();
    assert.equal(rows()[0].lastElementChild.textContent.trim(), '2');
  });

  it('shows no results for a search without matches', async () => {
    await load();
    searchPage();
    document.getElementById('query').value = '.missing';
    await submit();
    assert.equal(visible('no-results'), true);
    assert.equal(rows().length, 0);
  });

  it('does not fetch content after preflight login is cancelled', async () => {
    await load();
    signedIn = false;
    await submit();
    assert.deepEqual(urls(), []);
  });

  it('stops after host discovery is denied and restores the form', async () => {
    await load();
    respond(HOST_STATUS, {}, 403);
    await submit();
    assert.deepEqual(urls(), [HOST_STATUS]);
    assert.equal(visible('error'), true);
    assert.match(document.querySelector('.error-title').textContent, /Forbidden/);
  });

  it('shows sitemap errors and restores the form', async () => {
    await load();
    respond(HOST_STATUS, HOSTS);
    respond(INDEX, {}, 404);
    await submit();
    assert.equal(visible('error'), true);
    assert.match(document.querySelector('.error-title').textContent, /404/);
  });

  it('retries edit status with the original target and reuses a resolved edit URL', async () => {
    await load();
    searchPage();
    const status = `${STATUS}/guide?editUrl=auto`;
    respond(status, {}, 401);
    respond(status, { edit: { url: 'https://editor.example.com/guide' } });
    await submit();
    document.getElementById('org').value = 'changed';
    window.localStorage.setItem('use-h6-api', 'true');
    const link = document.querySelector('a.edit-link');
    link.click();
    await waitFor(() => opened.length === 1);
    link.click();
    assert.deepEqual(opened, ['https://editor.example.com/guide', 'https://editor.example.com/guide']);
    assert.deepEqual(urls().filter((url) => url.includes('editUrl=')), [status, status]);
    assert.deepEqual(loginCalls, [['acme', 'docs'], ['acme', 'docs']]);
  });

  it('retains the Sidekick edit-pattern fallback and its substitutions', async () => {
    await load();
    searchPage();
    const status = `${STATUS}/guide?editUrl=auto`;
    const config = `${BASE}/sidekick/acme/docs/main/config.json`;
    respond(status, {});
    respond(config, { editUrl: 'https://editor.example.com/{{org}}/{{site}}{{pathname}}' });
    await submit();
    document.querySelector('a.edit-link').click();
    await waitFor(() => opened.length === 1);
    assert.deepEqual(opened, ['https://editor.example.com/acme/docs/guide']);
    assert.deepEqual(urls().slice(-2), [status, config]);
  });

  it('visibly reports an unresolved edit URL instead of opening a broken link', async () => {
    await load();
    searchPage();
    respond(`${STATUS}/guide?editUrl=auto`, {});
    respond(`${BASE}/sidekick/acme/docs/main/config.json`, {});
    await submit();
    const link = document.querySelector('a.edit-link');
    link.click();
    await waitFor(() => link.classList.contains('disabled'));
    assert.equal(link.textContent, 'Error opening edit link');
    assert.deepEqual(opened, []);
  });

  it('does not open an editor after edit authentication is cancelled', async () => {
    await load();
    searchPage();
    respond(`${STATUS}/guide?editUrl=auto`, {}, 401);
    await submit();
    signedIn = false;
    document.querySelector('a.edit-link').click();
    await waitFor(() => loginCalls.length === 2);
    await new Promise((resolve) => { setTimeout(resolve, 10); });
    assert.deepEqual(opened, []);
  });

  it('detects H6 per submission and uses documented status paths for search and edit', async () => {
    await load();
    document.getElementById('site').value = 'h6-search';
    const probe = '/sidekick/acme/h6-search/main/config.json';
    detections.set(probe, { h6: true, status: 401 });
    api.respond('status', { body: HOSTS });
    respond(INDEX, { data: [{ path: '/guide' }] });
    respond(EMPTY_INDEX, { data: [] });
    respond(`${LIVE}/guide`, '<div class="hero"></div>');
    await submit();
    assert.equal(rows().length, 1);
    assert.deepEqual(probes, [`${BASE}${probe}`]);
    assert.equal(api.calls[0].url, 'https://api.aem.live/acme/sites/h6-search/status/index.html');
    assert.equal(api.calls[0].method, 'GET');
    document.getElementById('org').value = 'changed';
    window.localStorage.setItem('use-h6-api', 'true');
    api.respond('status', { body: { edit: { url: 'https://editor.example.com/h6' } } });
    document.querySelector('a.edit-link').click();
    await waitFor(() => opened.length === 1);
    assert.deepEqual(opened, ['https://editor.example.com/h6']);
    assert.equal(api.calls[1].url, 'https://api.aem.live/acme/sites/h6-search/status/guide?editUrl=auto');
    assert.deepEqual(loginCalls, [['acme', 'h6-search']]);
  });

  it('resolves H6 fallback config with auth retry and pins all requests to the submitted version', async () => {
    await load();
    window.localStorage.setItem('use-h6-api', 'true');
    window.history.replaceState(null, '', '/?hlx-admin-version=release-1');
    api.respond('status', [{ body: HOSTS }, { body: {} }]);
    api.respond('getConfigSite', [
      { status: 401 },
      {
        body: {
          content: { source: { type: 'markup', url: 'https://editor.example.com' } },
          sidekick: { editUrlPattern: '{{contentSourceUrl}}/{{org}}/{{site}}{{pathname}}' },
        },
      },
    ]);
    respond(INDEX, { data: [{ path: '/guide' }] });
    respond(EMPTY_INDEX, { data: [] });
    respond(`${LIVE}/guide`, '<div class="hero"></div>');
    await submit();
    window.history.replaceState(null, '', '/?hlx-admin-version=release-2');
    document.getElementById('site').value = 'changed';
    window.localStorage.clear();
    document.querySelector('a.edit-link').click();
    await waitFor(() => opened.length === 1);
    assert.deepEqual(opened, ['https://editor.example.com/acme/docs/guide']);
    assert.deepEqual(api.calls.map(({ url, method }) => [url, method]), [
      ['https://api.aem.live/acme/sites/docs/status/index.html?aem-api-version=release-1', 'GET'],
      ['https://api.aem.live/acme/sites/docs/status/guide?aem-api-version=release-1&editUrl=auto', 'GET'],
      ['https://api.aem.live/acme/sites/docs/config.json?aggregated=true&aem-api-version=release-1', 'GET'],
      ['https://api.aem.live/acme/sites/docs/config.json?aggregated=true&aem-api-version=release-1', 'GET'],
    ]);
    assert.deepEqual(loginCalls, [['acme', 'docs'], ['acme', 'docs']]);
  });

  it('retains the H5 version parameter for host, edit status and fallback requests', async () => {
    await load();
    window.history.replaceState(null, '', '/?hlx-admin-version=legacy-1');
    respond(`${HOST_STATUS}?hlx-admin-version=legacy-1`, HOSTS);
    respond(INDEX, { data: [{ path: '/guide' }] });
    respond(EMPTY_INDEX, { data: [] });
    respond(`${LIVE}/guide`, '<div class="hero"></div>');
    respond(`${STATUS}/guide?hlx-admin-version=legacy-1&editUrl=auto`, {});
    respond(`${BASE}/sidekick/acme/docs/main/config.json?hlx-admin-version=legacy-1`, {
      editUrl: 'https://editor.example.com{{pathname}}',
    });
    await submit();
    document.querySelector('a.edit-link').click();
    await waitFor(() => opened.length === 1);
    assert.deepEqual(opened, ['https://editor.example.com/guide']);
    assert.deepEqual(urls().filter((url) => url.startsWith(BASE)), [
      `${HOST_STATUS}?hlx-admin-version=legacy-1`,
      `${STATUS}/guide?hlx-admin-version=legacy-1&editUrl=auto`,
      `${BASE}/sidekick/acme/docs/main/config.json?hlx-admin-version=legacy-1`,
    ]);
    assert.ok(requests.every(({ method }) => method === 'GET'));
  });

  it('shows backend detection failures without attempting a search', async () => {
    await load();
    document.getElementById('site').value = 'denied-detection';
    detections.set('/sidekick/acme/denied-detection/main/config.json', { status: 403 });
    await submit();
    assert.equal(visible('error'), true);
    assert.deepEqual(urls(), []);
    assert.equal(probes.length, 1);
  });

  it('shows edit HTTP failures without trying a config fallback', async () => {
    await load();
    searchPage();
    respond(`${STATUS}/guide?editUrl=auto`, {}, 403);
    await submit();
    const link = document.querySelector('a.edit-link');
    link.click();
    await waitFor(() => link.classList.contains('disabled'));
    assert.equal(link.textContent, 'Error opening edit link');
    assert.deepEqual(opened, []);
    assert.equal(urls().at(-1), `${STATUS}/guide?editUrl=auto`);
  });

  it('retains the not-found error for a missing host status resource', async () => {
    await load();
    respond(HOST_STATUS, {}, 404);
    await submit();
    assert.equal(visible('error'), true);
    assert.match(document.querySelector('.error-title').textContent, /404/);
    assert.deepEqual(urls(), [HOST_STATUS]);
  });

  it('substitutes every occurrence in a fallback edit pattern', async () => {
    await load();
    searchPage();
    respond(`${STATUS}/guide?editUrl=auto`, {});
    respond(`${BASE}/sidekick/acme/docs/main/config.json`, {
      editUrl: 'https://editor.example.com/{{org}}/{{site}}{{pathname}}?path={{pathname}}&org={{org}}',
    });
    await submit();
    const link = document.querySelector('a.edit-link');
    link.click();
    await waitFor(() => link.classList.contains('disabled') || opened.length > 0);
    assert.deepEqual(opened, ['https://editor.example.com/acme/docs/guide?path=/guide&org=acme']);
  });

  it('rejects fallback patterns with unresolved placeholders', async () => {
    await load();
    searchPage();
    respond(`${STATUS}/guide?editUrl=auto`, {});
    respond(`${BASE}/sidekick/acme/docs/main/config.json`, {
      editUrl: '{{contentSourceUrl}}{{pathname}}',
    });
    await submit();
    const link = document.querySelector('a.edit-link');
    link.click();
    await waitFor(() => link.classList.contains('disabled') || opened.length > 0);
    assert.deepEqual(opened, []);
    assert.equal(link.textContent, 'Error opening edit link');
  });
});
