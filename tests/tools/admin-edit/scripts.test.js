/* eslint-env node */
import {
  describe, it, before, beforeEach, mock,
} from 'node:test';
import assert from 'node:assert/strict';

mock.module('../../../blocks/profile/profile.js', {
  exports: { ensureLogin: async () => true },
});
mock.module('../../../scripts/scripts.js', {
  exports: { registerToolReady: () => {} },
});
mock.module('../../../blocks/console/console.js', {
  exports: { logResponse: () => {} },
});
mock.module('../../../vendor/codemirror/codemirror.js', {
  defaultExport: () => ({ getValue: () => '', setValue: () => {}, setLanguage: () => {} }),
});

const waitFor = async (predicate, timeoutMs = 3000) => {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('timed out waiting for the tool');
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => { setTimeout(resolve, 10); });
  }
};

describe('admin-edit:admin-edit.js', () => {
  let adminURL;

  before(async () => {
    document.body.innerHTML = `
      <form id="admin-form"><input id="admin-url" /><p class="api-upgrade-hint" hidden></p></form>
      <datalist id="admin-url-list"></datalist>
      <form id="body-form"><button id="save"></button></form>
      <div id="editor"></div><span id="editor-label"></span>
      <div class="picker-field"><input id="method" value="GET" /><ul><li>GET</li></ul></div>
      <div class="console"></div>`;
    global.localStorage = window.localStorage;
    window.localStorage.removeItem('admin-url');
    window.localStorage.removeItem('use-h6-api');
    await import('../../../tools/admin-edit/admin-edit.js');
    adminURL = document.getElementById('admin-url');
    await waitFor(() => adminURL.value);
  });

  const typeURL = (url) => {
    adminURL.value = url;
    adminURL.dispatchEvent(new window.Event('input'));
  };
  const suggestionHosts = () => [
    ...new Set([...document.querySelectorAll('#admin-url-list option')]
      .map((o) => new URL(o.value).hostname)),
  ];

  it('defaults to an H6 admin URL', () => {
    assert.equal(new URL(adminURL.value).hostname, 'api.aem.live');
  });

  it('suggests H6 URLs for an H6 admin URL', () => {
    typeURL('https://api.aem.live/myorg/sites/mysite/status/main');
    assert.deepEqual(suggestionHosts(), ['api.aem.live']);
  });

  it('suggests H5 URLs for an H5 admin URL', () => {
    typeURL('https://admin.hlx.page/status/myorg/mysite/main');
    assert.deepEqual(suggestionHosts(), ['admin.hlx.page']);
  });

  describe('H5 URL for a site on H6', () => {
    const h5URL = 'https://admin.hlx.page/config/myorg/sites/mysite.json';
    const h6URL = 'https://api.aem.live/myorg/sites/mysite/config.json';
    const detectURL = 'https://admin.hlx.page/sidekick/myorg/mysite/main/config.json';
    let requested;
    let detectResponse;
    const hint = () => document.querySelector('.api-upgrade-hint');
    const submit = (id) => document.getElementById(id)
      .dispatchEvent(new window.Event('submit', { cancelable: true }));

    beforeEach(() => {
      requested = [];
      detectResponse = () => new Response('', { status: 401, headers: { 'x-api-upgrade-available': 'true' } });
      const fetchMock = async (url) => {
        const href = String(url instanceof Request ? url.url : url);
        if (href === detectURL) return detectResponse();
        requested.push(href);
        return new Response('{}', { status: 200 });
      };
      global.fetch = fetchMock;
      window.fetch = fetchMock;
      hint().hidden = true;
      hint().textContent = '';
    });

    ['admin-form', 'body-form'].forEach((form) => {
      describe(form, () => {
        it('shows the upgrade hint and sends nothing', async () => {
          typeURL(h5URL);
          submit(form);
          await waitFor(() => !hint().hidden || requested.length > 0);
          assert.match(hint().textContent, /This site has been upgraded to the AEM API, please use that endpoint instead\./);
          assert.equal(hint().querySelector('a')?.href, 'https://www.aem.live/docs/api.html');
          assert.deepEqual(requested, []);
        });

        it('shows an error and sends nothing when detection fails', async () => {
          detectResponse = () => new Response('', { status: 403 });
          typeURL(h5URL);
          submit(form);
          await waitFor(() => !hint().hidden || requested.length > 0);
          assert.match(hint().textContent, /Could not check whether this site has been upgraded to the AEM API\./);
          assert.deepEqual(requested, []);
        });

        it('hides the hint on a later request', async () => {
          hint().hidden = false;
          typeURL(h6URL);
          submit(form);
          await waitFor(() => requested.length > 0);
          assert.equal(hint().hidden, true);
        });
      });
    });

    it('hides the hint on reset', () => {
      hint().hidden = false;
      document.getElementById('admin-form')
        .dispatchEvent(new window.Event('reset'));
      assert.equal(hint().hidden, true);
    });
  });
});
