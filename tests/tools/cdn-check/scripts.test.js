/* eslint-env node */
import {
  describe, it, beforeEach, afterEach, mock,
} from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import createMockAemApi from '../../helpers/mock-aem-api.js';

mock.module('../../../blocks/profile/profile.js', {
  exports: { ensureLogin: async () => true },
});

const html = readFileSync(new URL('../../../tools/cdn-check/index.html', import.meta.url), 'utf8');
const body = html.match(/<body[^>]*>([\s\S]*)<\/body>/)[1].replace(/<script[\s\S]*?<\/script>/g, '');

const json = (status, payload) => new Response(JSON.stringify(payload), {
  status,
  headers: { 'content-type': 'application/json' },
});

const waitFor = async (predicate, timeoutMs = 10000) => {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('timed out waiting for the tool');
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => { setTimeout(resolve, 20); });
  }
};

let importCount = 0;

describe('cdn-check:cdn-check.js', () => {
  const realFetch = global.fetch;
  let adminCalls;

  // Loads a fresh copy of the tool for the given site and waits for the run to finish.
  const runCheck = async (org, site) => {
    document.body.innerHTML = body;
    window.history.pushState({}, '', `/?url=${encodeURIComponent(`https://main--${site}--${org}.aem.live/`)}`);
    importCount += 1;
    await import(`../../../tools/cdn-check/cdn-check.js?run=${importCount}`);
    const submit = document.querySelector('#cdn-check-form button[type="submit"]');
    const status = document.querySelector('#check-cdn-config .check-status');
    await waitFor(() => status.textContent !== 'Pending');
    await waitFor(() => submit.textContent === 'Run CDN Check');
  };

  const configCheck = () => ({
    status: document.querySelector('#check-cdn-config .check-status').textContent,
    lines: [...document.querySelectorAll('#check-cdn-config .result-line')].map((l) => l.textContent),
  });

  beforeEach(() => {
    adminCalls = [];
  });

  afterEach(() => {
    global.fetch = realFetch;
    window.history.pushState({}, '', '/');
  });

  describe('on the legacy (H5) backend', () => {
    beforeEach(() => {
      global.fetch = async (input, init = {}) => {
        const url = new URL(typeof input === 'string' ? input : input.url);
        if (url.pathname.startsWith('/sidekick/')) {
          return new Response('{}', { status: 200, headers: { 'x-api-upgrade-available': 'false' } });
        }
        if (url.origin === 'https://admin.hlx.page') {
          adminCalls.push(`${init.method || 'GET'} ${url.pathname}`);
          if (url.pathname === '/config/h5org/aggregated/h5site.json') {
            return json(200, { cdn: { prod: { type: 'managed' } } });
          }
        }
        return json(404, {});
      };
    });

    it('reads the aggregated config and reports the cdn', async () => {
      await runCheck('h5org', 'h5site');

      assert.deepEqual(adminCalls, ['GET /config/h5org/aggregated/h5site.json']);
      assert.equal(configCheck().status, 'Managed');
    });
  });

  describe('when the backend cannot be detected', () => {
    it('reports the detection error in the cdn config check', async () => {
      global.fetch = async () => json(404, {});

      await runCheck('failorg', 'failsite');

      assert.equal(configCheck().status, 'Error');
      assert.match(configCheck().lines.join('\n'), /backend detection failed for failorg\/failsite/);
    });
  });

  describe('on the Helix 6 backend', () => {
    const api = createMockAemApi();
    let legacyCalls;

    beforeEach(() => {
      legacyCalls = [];
      api.install();
      const h6Fetch = global.fetch;
      global.fetch = async (input, init) => {
        const href = typeof input === 'string' ? input : input.url;
        if (href.startsWith('https://admin.hlx.page/sidekick/')) {
          return new Response('{}', { status: 200, headers: { 'x-api-upgrade-available': 'true' } });
        }
        if (href.startsWith('https://api.aem.live/')) return h6Fetch(input, init);
        if (href.startsWith('https://admin.hlx.page/')) {
          legacyCalls.push(`${init?.method || 'GET'} ${new URL(href).pathname}`);
        }
        return json(404, {});
      };
    });

    afterEach(() => {
      api.uninstall();
      api.reset();
    });

    it('reads the aggregated config from the spec route and reports the cdn', async () => {
      api.respond('getAggregatedConfigSite', json(200, { cdn: { prod: { type: 'managed' } } }));

      await runCheck('h6org', 'h6site');

      assert.deepEqual(legacyCalls, []);
      assert.deepEqual(api.violations, []);
      assert.deepEqual(
        api.calls.map(({ method, pathname }) => `${method} ${pathname}`),
        ['GET /h6org/aggregated/h6site/config.json'],
      );
      assert.equal(configCheck().status, 'Managed');
    });
  });
});
