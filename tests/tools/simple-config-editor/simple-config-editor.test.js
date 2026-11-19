/* eslint-env node */
import {
  afterEach, before, beforeEach, describe, it, mock,
} from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import createMockAemApi from '../../helpers/mock-aem-api.js';

let ready;
let logs;
const api = createMockAemApi();

mock.module('../../../scripts/scripts.js', {
  exports: { registerToolReady: (promise) => { ready = promise; } },
});
mock.module('../../../utils/config/config.js', {
  exports: { initConfigField: async () => {}, updateConfig: () => {} },
});
mock.module('../../../blocks/profile/profile.js', {
  exports: { ensureLogin: async () => true },
});
mock.module('../../../blocks/console/console.js', {
  exports: {
    logMessage: (block, level, parts) => { logs.push({ level, parts }); },
    logResponse: () => {},
  },
});
mock.module('../../../blocks/modal/modal.js', {
  exports: {
    createModal: async () => ({
      showModal: () => {},
      block: document.createElement('dialog'),
    }),
  },
});

const CONFIG = { cdn: { prod: { type: 'fastly', host: 'www.acme.com', serviceId: 'svc' } } };
const AGGREGATE = { ...CONFIG, headers: {} };

const waitFor = async (predicate) => {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > 3000) throw new Error('Timed out waiting for config editor');
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => { setTimeout(resolve, 10); });
  }
};
const outcome = (step, levels = ['success', 'warning', 'error']) => logs
  .find(({ level, parts }) => parts[0] === step && levels.includes(level));
const respondConfig = (cfg, aggregate) => api.respond(
  'getConfigSite',
  (call) => (call.query.aggregated === 'true' ? aggregate : cfg),
);

async function load() {
  document.getElementById('org').value = 'acme';
  document.getElementById('site').value = 'docs';
  const form = document.getElementById('config-selection-form');
  form.dispatchEvent(new window.SubmitEvent('submit', { cancelable: true }));
  // A missing config logs a warning before the load settles
  await waitFor(() => outcome('LOAD', ['success', 'error']));
  return outcome('LOAD', ['success', 'error']);
}

async function save() {
  document.getElementById('save-all-changes').click();
  await waitFor(() => outcome('SAVE'));
  return outcome('SAVE');
}

describe('simple-config-editor on Helix 6', () => {
  before(async () => {
    document.documentElement.innerHTML = await readFile(
      new URL('../../../tools/simple-config-editor/index.html', import.meta.url),
      'utf8',
    );
    global.Node = window.Node;
    window.localStorage.setItem('use-h6-api', '');
    logs = [];
    api.install();
    await import('../../../tools/simple-config-editor/simple-config-editor.js');
    await ready;
    api.uninstall();
  });

  beforeEach(() => {
    logs = [];
    api.reset();
    api.install();
    window.confirm = () => true;
  });

  afterEach(() => {
    api.uninstall();
    assert.deepEqual(api.violations, []);
  });

  it('loads the site config and its aggregate from the site config endpoint', async () => {
    respondConfig({ body: CONFIG }, { body: AGGREGATE });

    const result = await load();

    assert.deepEqual(result, { level: 'success', parts: ['LOAD', 'Configuration loaded successfully', ''] });
    assert.deepEqual(
      api.calls.map(({ operationId, query }) => [operationId, query]),
      [['getConfigSite', {}], ['getConfigSite', { aggregated: 'true' }]],
    );
    assert.ok(api.calls.every(({ pathParams }) => pathParams.org === 'acme' && pathParams.site === 'docs'));
    assert.equal(document.getElementById('config-editor').hasAttribute('aria-hidden'), false);
  });

  it('reports a failed aggregate read', async () => {
    respondConfig({ body: CONFIG }, { status: 500 });

    const result = await load();

    assert.deepEqual(result, {
      level: 'error',
      parts: ['LOAD', 'Failed to load configuration: Failed to load aggregate config: HTTP 500', ''],
    });
  });

  it('does not request a migration when the site has no config', async () => {
    respondConfig({ status: 404 }, { body: AGGREGATE });

    const result = await load();

    assert.deepEqual(result, {
      level: 'error',
      parts: ['LOAD', 'Failed to load configuration: aem-admin: config migrate is not supported on Helix 6', ''],
    });
    assert.ok(api.calls.every(({ query }) => !('migrate' in query)));
  });

  it('saves a removed property back to the site config', async () => {
    respondConfig({ body: CONFIG }, { body: AGGREGATE });
    api.respond('updateConfigSite', { status: 200 });
    await load();

    document.querySelector('.remove-property[data-key="serviceId"][data-path="cdn.prod"]').click();
    const result = await save();

    assert.deepEqual(result, { level: 'success', parts: ['SAVE', 'Successfully saved 1 changes', ''] });
    const [read, update] = api.calls.slice(2);
    assert.equal(read.operationId, 'getConfigSite');
    assert.deepEqual(read.query, {});
    assert.equal(update.operationId, 'updateConfigSite');
    assert.deepEqual(update.pathParams, { org: 'acme', site: 'docs' });
    assert.deepEqual(update.body, { cdn: { prod: { type: 'fastly', host: 'www.acme.com' } } });
  });

  it('does not write when there are no changes', async () => {
    respondConfig({ body: CONFIG }, { body: AGGREGATE });
    await load();

    const result = await save();

    assert.deepEqual(result, { level: 'warning', parts: ['SAVE', 'No changes to save', ''] });
    assert.equal(api.calls.length, 2);
  });
});
