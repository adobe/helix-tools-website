/* eslint-env node */
import {
  describe, it, before, beforeEach, afterEach, mock,
} from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import createMockAemApi from '../../helpers/mock-aem-api.js';

let loginCalls = [];
let toolReady;

// Page bootstrap and login are out of scope; same seams as the bulk tests. The org/site
// config helper stays real (only its stylesheet load, which never settles in jsdom, is stubbed)
// so the tests see what a request persists to the URL and the recent projects.
mock.module('../../../scripts/scripts.js', {
  exports: { registerToolReady: (ready) => { toolReady = ready; } },
});
mock.module('../../../scripts/aem.js', {
  exports: { loadCSS: async () => {} },
});
mock.module('../../../blocks/profile/profile.js', {
  exports: {
    ensureLogin: async (org, site) => {
      loginCalls.push([org, site]);
      return true;
    },
  },
});

const robotsUrl = (site) => `https://api.aem.live/myorg/sites/${site}/config/robots.txt`;
const savedBodies = (calls) => calls
  .filter(({ operationId }) => operationId === 'updateConfigSiteSub')
  .map(({ body }) => body);

async function waitFor(check, tries = 200) {
  if (check()) return;
  if (!tries) throw new Error('timed out waiting for the tool');
  await new Promise((resolve) => { setTimeout(resolve, 5); });
  await waitFor(check, tries - 1);
}

describe('robots-edit:robots-edit.js', () => {
  const api = createMockAemApi();
  let probes;
  let probeStatus;
  let probeUpgrade;
  let legacyCalls;
  const rows = () => [...document.querySelectorAll('.console tbody tr')]
    .map((tr) => [...tr.cells].slice(0, 4).map((cell) => cell.textContent));
  const submit = async (id, count) => {
    document.getElementById(id).dispatchEvent(new window.Event('submit', { cancelable: true }));
    await waitFor(() => rows().length === count);
  };

  before(async () => {
    const html = await readFile(new URL('../../../tools/robots-edit/index.html', import.meta.url), 'utf8');
    [document.body.innerHTML] = html.match(/<main>[\s\S]*<\/main>/);
    document.querySelector('.console').innerHTML = '<table><tbody></tbody></table>';
    global.localStorage = window.localStorage;
    await import('../../../tools/robots-edit/robots-edit.js');
    await toolReady; // init() has attached the listeners
  });

  beforeEach(() => {
    api.install();
    probes = [];
    probeStatus = 401; // an anonymous visitor on an H6 site
    probeUpgrade = true;
    legacyCalls = [];
    loginCalls = [];
    const specFetch = global.fetch;
    // Detection and H5 calls hit the legacy host, which the spec-routed fake does not serve.
    global.fetch = async (url, init) => {
      if (String(url).startsWith('https://admin.hlx.page/sidekick/')) {
        probes.push(String(url));
        return new Response(null, {
          status: probeStatus,
          headers: probeUpgrade ? { 'x-api-upgrade-available': 'true' } : {},
        });
      }
      if (String(url).startsWith('https://admin.hlx.page/config/')) {
        legacyCalls.push({ url: String(url), init });
        return new Response('{}', { status: 200 });
      }
      return specFetch(url, init);
    };
    window.localStorage.removeItem('use-h6-api');
    document.getElementById('org').value = 'myorg';
    document.getElementById('body').value = '';
  });

  afterEach(() => {
    const { violations } = api;
    api.uninstall();
    api.reset();
    document.querySelector('.console tbody').innerHTML = '';
    window.localStorage.removeItem('aem-projects');
    window.history.replaceState({}, '', '/tools/robots-edit/index.html');
    assert.deepEqual(violations, []);
  });

  // getAdminClientForSite caches clients per org/site, so each test uses its own site
  // to observe a fresh detection probe.
  it('saves to the current inputs when nothing was fetched', async () => {
    api.respond('updateConfigSiteSub', { body: {} });
    document.getElementById('site').value = 'unfetchedsite';
    document.getElementById('body').value = 'User-agent: *';
    await submit('body-form', 1);

    document.getElementById('site').value = 'nextsite';
    await submit('body-form', 2);

    assert.deepEqual(rows().map(([status]) => status), ['200', '200']);
    const saves = api.calls.filter(({ operationId }) => operationId === 'updateConfigSiteSub');
    assert.deepEqual(saves.map(({ url }) => url), [robotsUrl('unfetchedsite'), robotsUrl('nextsite')]);
    assert.deepEqual(savedBodies(api.calls), [{ body: 'User-agent: *' }, { body: 'User-agent: *' }]);
    assert.deepEqual(saves.map(({ headers }) => headers['content-type']), ['application/json', 'application/json']);
  });

  it('fetches robots.txt from the H6 API after detecting H6 and the login preflight', async () => {
    document.getElementById('site').value = 'fetchsite';
    api.respond('getConfigSiteSub', { body: 'User-agent: *\nDisallow: /drafts/' });

    await submit('admin-form', 1);

    assert.deepEqual(probes, ['https://admin.hlx.page/sidekick/myorg/fetchsite/main/config.json']);
    assert.deepEqual(loginCalls, [['myorg', 'fetchsite']]);
    assert.deepEqual(rows(), [['200', 'GET', robotsUrl('fetchsite'), '']]);
    assert.equal(document.getElementById('body').value, 'User-agent: *\nDisallow: /drafts/');
  });

  it('saves to the org/site currently in the form', async () => {
    document.getElementById('site').value = 'sitea';
    api.respond('getConfigSiteSub', { body: 'User-agent: *' });
    api.respond('updateConfigSiteSub', { body: {} });
    await submit('admin-form', 1);

    document.getElementById('site').value = 'siteb';
    document.getElementById('body').value = 'User-agent: *\nAllow: /';
    await submit('body-form', 2);

    assert.deepEqual(rows()[0], ['200', 'POST', robotsUrl('siteb'), '']);
    const save = api.calls.find(({ operationId }) => operationId === 'updateConfigSiteSub');
    assert.equal(save.url, robotsUrl('siteb'));
    assert.deepEqual(save.body, { body: 'User-agent: *\nAllow: /' });
  });

  it('persists the saved org/site to the URL and the recent projects', async () => {
    document.getElementById('site').value = 'persista';
    api.respond('getConfigSiteSub', { body: 'User-agent: *' });
    api.respond('updateConfigSiteSub', { body: {} });
    await submit('admin-form', 1);
    assert.equal(new URL(window.location.href).searchParams.get('site'), 'persista');

    document.getElementById('org').value = 'otherorg';
    document.getElementById('site').value = 'persistb';
    document.getElementById('body').value = 'User-agent: *\nDisallow: /';
    await submit('body-form', 2);

    const save = api.calls.find(({ operationId }) => operationId === 'updateConfigSiteSub');
    assert.equal(save.url, 'https://api.aem.live/otherorg/sites/persistb/config/robots.txt');
    assert.deepEqual(save.body, { body: 'User-agent: *\nDisallow: /' });
    const params = new URL(window.location.href).searchParams;
    assert.deepEqual([params.get('org'), params.get('site')], ['otherorg', 'persistb']);
    const projects = JSON.parse(window.localStorage.getItem('aem-projects'));
    assert.deepEqual(projects.orgs, ['otherorg', 'myorg']);
    assert.deepEqual(projects.sites, { myorg: ['persista'], otherorg: ['persistb'] });
  });

  it('saves robots.txt as plain text on an H5 site', async () => {
    probeStatus = 200;
    probeUpgrade = false;
    document.getElementById('site').value = 'h5site';
    document.getElementById('body').value = 'User-agent: *';
    await submit('body-form', 1);

    assert.deepEqual(rows(), [['200', 'POST', 'https://admin.hlx.page/config/myorg/sites/h5site/robots.txt', '']]);
    const [{ init }] = legacyCalls;
    assert.equal(init.body, 'User-agent: *');
    assert.equal(new Headers(init.headers).get('content-type'), 'text/plain');
    assert.deepEqual(api.calls, []);
  });

  it('treats a 404 as no custom robots.txt', async () => {
    document.getElementById('site').value = 'norobotssite';
    document.getElementById('body').value = 'User-agent: *\nDisallow: /previous/';
    api.respond('getConfigSiteSub', { status: 404 });

    await submit('admin-form', 1);

    assert.deepEqual(rows(), [['404', 'GET', robotsUrl('norobotssite'), '']]);
    assert.equal(document.getElementById('body').value, '');
  });

  it('logs a backend detection failure instead of calling the API', async () => {
    probeStatus = 404;
    document.getElementById('site').value = 'unknownsite';

    await submit('admin-form', 1);

    const [[level, source, target, error]] = rows();
    assert.deepEqual([level, source, target], ['ERROR', 'Backend detection', 'myorg/unknownsite']);
    assert.match(error, /Admin backend detection failed .* HTTP 404/);
    assert.deepEqual(api.calls, []);
    assert.deepEqual(loginCalls, []);
  });
});
