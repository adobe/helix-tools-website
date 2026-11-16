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

const HEADERS_URL = 'https://api.aem.live/myorg/sites/mysite/config/headers.json';

async function waitFor(check, tries = 200) {
  if (check()) return;
  if (!tries) throw new Error('timed out waiting for the tool');
  await new Promise((resolve) => { setTimeout(resolve, 5); });
  await waitFor(check, tries - 1);
}

describe('headers-edit:headers-edit.js', () => {
  const api = createMockAemApi();
  let probes;
  let probeStatus;
  const rows = () => [...document.querySelectorAll('.console tbody tr')]
    .map((tr) => [...tr.cells].slice(0, 4).map((cell) => cell.textContent));
  const submit = (id) => document.getElementById(id)
    .dispatchEvent(new window.Event('submit', { cancelable: true }));
  const fetchHeaders = async () => {
    submit('admin-form');
    await waitFor(() => rows().length === 1);
  };
  const editorShown = () => document.querySelector('.path-selector').getAttribute('aria-hidden') === 'false'
    && document.querySelector('.button-bar').getAttribute('aria-hidden') === 'false';

  before(async () => {
    const html = await readFile(new URL('../../../tools/headers-edit/index.html', import.meta.url), 'utf8');
    [document.body.innerHTML] = html.match(/<main>[\s\S]*<\/main>/);
    document.querySelector('.console').innerHTML = '<table><tbody></tbody></table>';
    await import('../../../tools/headers-edit/headers-edit.js');
    await new Promise((resolve) => { setTimeout(resolve, 0); }); // let init() attach listeners
  });

  beforeEach(() => {
    api.install();
    probes = [];
    probeStatus = 401;
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
    document.getElementById('org').value = 'myorg';
    document.getElementById('site').value = 'mysite';
    document.querySelector('.path-selector').setAttribute('aria-hidden', 'true');
    document.querySelector('.button-bar').setAttribute('aria-hidden', 'true');
  });

  afterEach(() => {
    const { violations } = api;
    api.uninstall();
    api.reset();
    document.querySelector('.console tbody').innerHTML = '';
    assert.deepEqual(violations, []);
  });

  it('fetches headers from the H6 API after detecting H6 and the login preflight', async () => {
    api.respond('getConfigSiteSub', { body: { '/**': [{ key: 'x-a', value: '1' }] } });

    await fetchHeaders();

    assert.deepEqual(probes, ['https://admin.hlx.page/sidekick/myorg/mysite/main/config.json']);
    assert.deepEqual(loginCalls, [['myorg', 'mysite']]);
    assert.deepEqual(rows(), [['200', 'GET', HEADERS_URL, '']]);
    assert.equal(document.querySelector('#headers-list .header-key').value, 'x-a');
    assert.ok(editorShown());
  });

  it('treats a 404 as no headers configured', async () => {
    document.getElementById('site').value = 'no-headers';
    api.respond('getConfigSiteSub', { status: 404 });

    await fetchHeaders();

    const [[status, method, url]] = rows();
    assert.deepEqual(
      [status, method, url],
      ['404', 'GET', 'https://api.aem.live/myorg/sites/no-headers/config/headers.json'],
    );
    assert.equal(document.getElementById('path-select').value, '/**');
    assert.equal(document.querySelectorAll('#headers-list .header-item').length, 0);
    assert.ok(editorShown());
  });

  it('saves edited headers to the fetched site even after the org/site inputs change', async () => {
    api.respond('getConfigSiteSub', { body: { '/**': [{ key: 'x-a', value: '1' }] } });
    api.respond('updateConfigSiteSub', { body: {} });
    await fetchHeaders();

    document.getElementById('org').value = 'otherorg';
    document.getElementById('site').value = 'othersite';
    document.querySelector('#headers-list .header-value').value = '2';
    submit('headers-form');
    await waitFor(() => rows().length === 2);

    const save = api.calls.find((call) => call.operationId === 'updateConfigSiteSub');
    assert.equal(save.url, HEADERS_URL);
    assert.deepEqual(save.body, { '/**': [{ key: 'x-a', value: '2' }] });
    assert.ok(probes.every((url) => !url.includes('othersite')));
  });

  it('deletes the headers config when every header is removed', async () => {
    api.respond('getConfigSiteSub', { body: { '/**': [{ key: 'x-a', value: '1' }] } });
    api.respond('deleteConfigSiteSub', { status: 204 });
    await fetchHeaders();

    document.querySelector('#headers-list .remove-header').click();
    submit('headers-form');
    await waitFor(() => rows().length === 2);

    assert.deepEqual(rows()[0], ['204', 'DELETE', HEADERS_URL, '']);
  });

  it('logs a backend detection failure instead of calling the API', async () => {
    document.getElementById('site').value = 'detect-fails';
    probeStatus = 404;

    await fetchHeaders();

    const [[status, method, target, error]] = rows();
    assert.deepEqual([status, method, target], ['500', 'GET', 'myorg/detect-fails']);
    assert.match(error, /Admin backend detection failed .* HTTP 404/);
    assert.deepEqual(api.calls, []);
    assert.deepEqual(loginCalls, []);
  });
});
