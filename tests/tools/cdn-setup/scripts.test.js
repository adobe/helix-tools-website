/* eslint-env node */
import {
  describe, it, before, beforeEach, afterEach, mock,
} from 'node:test';
import assert from 'node:assert/strict';
import createMockAemApi from '../../helpers/mock-aem-api.js';

mock.module('../../../scripts/scripts.js', {
  exports: { registerToolReady: (...promises) => Promise.all(promises) },
});
mock.module('../../../utils/config/config.js', {
  exports: { initConfigField: async () => {}, updateConfig: () => {} },
});
mock.module('../../../blocks/console/console.js', {
  exports: {
    logResponse: (...args) => { global.cdnSetupLogs.push(args.slice(1)); },
    logMessage: (...args) => { global.cdnSetupLogs.push(args.slice(1)); },
  },
});
global.cdnSetupLogs = [];
mock.module('../../../blocks/profile/profile.js', {
  exports: { ensureLogin: async () => true },
});

const waitFor = async (predicate, timeoutMs = 5000) => {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('timed out waiting for the tool');
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => { setTimeout(resolve, 20); });
  }
};

const json = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' },
});

describe('cdn-setup:cdn-setup.js', () => {
  const realFetch = global.fetch;
  let calls;
  let routes;
  const alerts = [];

  before(async () => {
    document.body.innerHTML = `
      <form id="admin-form">
        <input id="org" /><input id="site" />
        <button type="submit" id="fetch">Fetch</button>
      </form>
      <form id="cdn-form" aria-hidden="true" disabled>
        <ul class="cdn-type-list">
          <li data-cdn="fastly"><input id="cdn-fastly" name="cdn-type" value="fastly" type="radio" /></li>
          <li data-cdn="managed"><input id="cdn-managed" name="cdn-type" value="managed" type="radio" /></li>
        </ul>
        <input id="host" name="host" />
        <div id="cdn-fields"></div>
        <div id="validation-results"></div>
        <button type="button" id="validate">Validate</button>
        <button type="submit" id="save">Save</button>
      </form>
      <div class="console"></div>`;
    window.alert = (message) => { alerts.push(message); };
    global.alert = window.alert;
    // Node's FormData cannot read a jsdom form.
    global.FormData = window.FormData;
    await import('../../../tools/cdn-setup/cdn-setup.js');
    await new Promise((resolve) => { setTimeout(resolve, 50); });
  });

  beforeEach(() => {
    calls = [];
    alerts.length = 0;
    global.cdnSetupLogs.length = 0;
    routes = new Map();
    global.fetch = async (input, init = {}) => {
      const url = new URL(typeof input === 'string' ? input : input.url);
      const method = init.method || 'GET';
      if (url.pathname.startsWith('/sidekick/')) {
        return new Response('{}', { status: 200, headers: { 'x-api-upgrade-available': 'false' } });
      }
      calls.push({ method, url: url.origin + url.pathname, body: init.body });
      return routes.get(`${method} ${url.origin}${url.pathname}`) || json(404, {});
    };
    window.localStorage.removeItem('use-h6-api');
    document.getElementById('org').value = 'myorg';
    document.getElementById('site').value = 'mysite';
    document.getElementById('host').value = '';
    document.getElementById('cdn-form').setAttribute('aria-hidden', 'true');
    document.querySelectorAll('input[name="cdn-type"]').forEach((radio) => {
      radio.checked = false;
      radio.disabled = false;
    });
  });

  afterEach(() => {
    global.fetch = realFetch;
  });

  const fetchConfig = async () => {
    document.getElementById('admin-form').dispatchEvent(new window.Event('submit', { cancelable: true }));
    await waitFor(() => document.getElementById('cdn-form').getAttribute('aria-hidden') === 'false');
  };

  describe('on the legacy (H5) backend', () => {
    it('reads the aggregated and site config and fills the form', async () => {
      routes.set('GET https://admin.hlx.page/config/myorg/aggregated/mysite.json', json(200, {
        cdn: { prod: { type: 'fastly', serviceId: 'inherited-service' } },
      }));
      routes.set('GET https://admin.hlx.page/config/myorg/sites/mysite.json', json(200, {
        cdn: { prod: { host: 'www.example.com' } },
      }));

      await fetchConfig();

      assert.deepEqual(
        calls.map(({ method, url }) => `${method} ${url}`).sort(),
        [
          'GET https://admin.hlx.page/config/myorg/aggregated/mysite.json',
          'GET https://admin.hlx.page/config/myorg/sites/mysite.json',
        ],
      );
      assert.equal(document.getElementById('host').value, 'www.example.com');
      assert.equal(document.getElementById('cdn-fastly').checked, true);
      assert.equal(document.getElementById('serviceId').value, 'inherited-service');
      assert.equal(document.getElementById('serviceId').disabled, true);
    });

    it('saves the cdn config to the site cdn/prod.json', async () => {
      routes.set('GET https://admin.hlx.page/config/myorg/aggregated/mysite.json', json(200, {}));
      routes.set('GET https://admin.hlx.page/config/myorg/sites/mysite.json', json(200, {}));
      routes.set('POST https://admin.hlx.page/config/myorg/sites/mysite/cdn/prod.json', json(200, {}));
      await fetchConfig();
      document.getElementById('cdn-fastly').checked = true;
      document.getElementById('cdn-fastly').dispatchEvent(new window.Event('change'));
      document.getElementById('serviceId').value = 'svc';
      document.getElementById('authToken').value = 'tok';
      document.getElementById('host').value = 'www.example.com';
      calls.length = 0;

      document.getElementById('cdn-form').dispatchEvent(new window.Event('submit', { cancelable: true }));
      await waitFor(() => calls.length > 0);

      assert.deepEqual(calls, [{
        method: 'POST',
        url: 'https://admin.hlx.page/config/myorg/sites/mysite/cdn/prod.json',
        body: JSON.stringify({
          type: 'fastly', serviceId: 'svc', authToken: 'tok', host: 'www.example.com',
        }),
      }]);
    });

    it('saves to the fetched site even after the org/site inputs change', async () => {
      routes.set('GET https://admin.hlx.page/config/myorg/aggregated/mysite.json', json(200, {}));
      routes.set('GET https://admin.hlx.page/config/myorg/sites/mysite.json', json(200, {}));
      routes.set('POST https://admin.hlx.page/config/myorg/sites/mysite/cdn/prod.json', json(200, {}));
      await fetchConfig();
      document.getElementById('org').value = 'otherorg';
      document.getElementById('site').value = 'othersite';
      document.getElementById('cdn-fastly').checked = true;
      document.getElementById('cdn-fastly').dispatchEvent(new window.Event('change'));
      document.getElementById('serviceId').value = 'svc';
      document.getElementById('authToken').value = 'tok';
      document.getElementById('host').value = 'www.example.com';
      calls.length = 0;

      document.getElementById('cdn-form').dispatchEvent(new window.Event('submit', { cancelable: true }));
      await waitFor(() => calls.length > 0);

      assert.deepEqual(
        calls.map(({ method, url }) => `${method} ${url}`),
        ['POST https://admin.hlx.page/config/myorg/sites/mysite/cdn/prod.json'],
      );
    });
  });

  describe('when the backend cannot be detected', () => {
    beforeEach(() => {
      document.getElementById('org').value = 'failorg';
      document.getElementById('site').value = 'failsite';
      global.fetch = async () => json(404, {});
    });

    it('tells the user and logs an error when fetching the config', async () => {
      document.getElementById('admin-form').dispatchEvent(new window.Event('submit', { cancelable: true }));
      await waitFor(() => alerts.length > 0);

      assert.equal(alerts.length, 1);
      assert.match(alerts[0], /backend detection failed for failorg\/failsite/);
      assert.deepEqual(global.cdnSetupLogs.map(([level]) => level), ['error']);
      assert.equal(global.cdnSetupLogs[0][1][1], 'failorg/failsite');
      assert.match(global.cdnSetupLogs[0][1].at(-1), /backend detection failed/);
    });
  });

  describe('on the Helix 6 backend', () => {
    const api = createMockAemApi();

    let legacyCalls;

    beforeEach(() => {
      legacyCalls = [];
      // The client caches the detected backend per org/site, so H6 uses its own.
      document.getElementById('org').value = 'h6org';
      document.getElementById('site').value = 'h6site';
      api.install();
      const h6Fetch = global.fetch;
      global.fetch = async (input, init) => {
        const href = typeof input === 'string' ? input : input.url;
        if (href.startsWith('https://admin.hlx.page/sidekick/')) {
          return new Response('{}', { status: 200, headers: { 'x-api-upgrade-available': 'true' } });
        }
        if (href.startsWith('https://admin.hlx.page/')) {
          legacyCalls.push(`${init?.method || 'GET'} ${new URL(href).pathname}`);
          return json(404, {});
        }
        return h6Fetch(input, init);
      };
    });

    afterEach(() => {
      api.uninstall();
      api.reset();
    });

    it('reads the aggregated and site config from spec routes and fills the form', async () => {
      api.respond('getConfigSite', ({ query }) => (query.aggregated === 'true'
        ? json(200, { cdn: { prod: { type: 'fastly', serviceId: 'inherited-service' } } })
        : json(200, { cdn: { prod: { host: 'www.example.com' } } })));

      await fetchConfig();

      assert.deepEqual(api.violations, []);
      assert.deepEqual(
        api.calls.map(({ method, url }) => `${method} ${url}`).sort(),
        [
          'GET https://api.aem.live/h6org/sites/h6site/config.json',
          'GET https://api.aem.live/h6org/sites/h6site/config.json?aggregated=true',
        ],
      );
      assert.equal(document.getElementById('host').value, 'www.example.com');
      assert.equal(document.getElementById('cdn-fastly').checked, true);
      assert.equal(document.getElementById('serviceId').value, 'inherited-service');
    });

    it('saves the cdn config through the site cdn/prod.json spec route', async () => {
      api.respond('getConfigSite', () => json(200, {}));
      api.respond('updateConfigSiteSub', json(200, {}));
      await fetchConfig();
      document.getElementById('cdn-fastly').checked = true;
      document.getElementById('cdn-fastly').dispatchEvent(new window.Event('change'));
      document.getElementById('serviceId').value = 'svc';
      document.getElementById('authToken').value = 'tok';
      document.getElementById('host').value = 'www.example.com';
      api.calls.length = 0;

      document.getElementById('cdn-form').dispatchEvent(new window.Event('submit', { cancelable: true }));
      await waitFor(() => api.calls.length > 0 || legacyCalls.length > 0);

      assert.deepEqual(legacyCalls, []);
      assert.deepEqual(api.violations, []);
      assert.deepEqual(
        api.calls.map(({ method, pathname, body }) => ({ method, pathname, body })),
        [{
          method: 'POST',
          pathname: '/h6org/sites/h6site/config/cdn/prod.json',
          body: {
            type: 'fastly', serviceId: 'svc', authToken: 'tok', host: 'www.example.com',
          },
        }],
      );
    });
  });
});
