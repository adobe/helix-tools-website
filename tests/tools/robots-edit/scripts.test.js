/* eslint-env node */
import {
  describe, it, before, beforeEach, afterEach, mock,
} from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import createMockAemApi from '../../helpers/mock-aem-api.js';

let loginCalls = [];

// Page bootstrap, login and the org/site picker are out of scope; same seams as the bulk tests.
mock.module('../../../scripts/scripts.js', {
  exports: { registerToolReady: () => {} },
});
mock.module('../../../blocks/profile/profile.js', {
  exports: {
    ensureLogin: async (org, site) => {
      loginCalls.push([org, site]);
      return true;
    },
  },
});
mock.module('../../../utils/config/config.js', {
  exports: { initConfigField: async () => {}, updateConfig: () => {} },
});

const robotsUrl = (site) => `https://api.aem.live/myorg/sites/${site}/config/robots.txt`;

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
    await import('../../../tools/robots-edit/robots-edit.js');
    await new Promise((resolve) => { setTimeout(resolve, 0); }); // let init() attach listeners
  });

  beforeEach(() => {
    api.install();
    probes = [];
    probeStatus = 401; // an anonymous visitor on an H6 site
    loginCalls = [];
    const specFetch = global.fetch;
    // Backend detection hits the legacy host, which the spec-routed fake does not serve.
    global.fetch = async (url, init) => {
      if (String(url).startsWith('https://admin.hlx.page/sidekick/')) {
        probes.push(String(url));
        return new Response(null, {
          status: probeStatus,
          headers: { 'x-api-upgrade-available': 'true' },
        });
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

    const saves = api.calls.filter(({ operationId }) => operationId === 'updateConfigSiteSub');
    assert.deepEqual(saves.map(({ url }) => url), [robotsUrl('unfetchedsite'), robotsUrl('nextsite')]);
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

    const save = api.calls.find(({ operationId }) => operationId === 'updateConfigSiteSub');
    assert.equal(save.url, robotsUrl('siteb'));
    assert.equal(save.body, 'User-agent: *\nAllow: /');
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

    const [[status, method, target, error]] = rows();
    assert.deepEqual([status, method, target], ['500', 'GET', 'myorg/unknownsite']);
    assert.match(error, /Admin backend detection failed .* HTTP 404/);
    assert.deepEqual(api.calls, []);
    assert.deepEqual(loginCalls, []);
  });
});
