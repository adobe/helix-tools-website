/* eslint-env node */
import {
  describe, it, before, beforeEach, afterEach, mock,
} from 'node:test';
import assert from 'node:assert/strict';
import createMockAemApi from '../../helpers/mock-aem-api.js';

// Login and config refresh are out of scope for the bulk tool; the real
// ensureLogin opens the profile modal. Same seam as tests/utils/admin-request.test.js.
mock.module('../../../blocks/profile/profile.js', {
  exports: { ensureLogin: async () => true },
});
mock.module('../../../utils/config/config.js', {
  exports: { updateConfig: () => {} },
});

const JOBS = 'https://api.aem.live/myorg/sites/mysite/jobs/preview';
const URLS = 'https://main--mysite--myorg.aem.page/a\nhttps://main--mysite--myorg.aem.page/b';

const startResponse = {
  status: 202,
  body: {
    messageId: 'm1',
    job: {
      topic: 'preview', user: 'u', name: 'job-1', state: 'created',
    },
    links: { list: `${JOBS}/`, self: `${JOBS}/job-1` },
  },
};

const statusResponse = (links) => ({
  status: 202,
  body: { job: { topic: 'preview', name: 'job-1', state: 'running' }, links },
});

const report = (state, resources) => ({
  status: 200,
  body: {
    state,
    progress: { processed: resources.length, total: 2 },
    startTime: '2026-01-01T00:00:00.000Z',
    stopTime: '2026-01-01T00:00:03.000Z',
    data: { resources },
  },
});

const POLL_MS = 1000;
const waitFor = async (predicate, timeoutMs = 5000) => {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('timed out waiting for the tool');
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => { setTimeout(resolve, 50); });
  }
};

describe('bulk:scripts.js doBulkOperation', () => {
  const api = createMockAemApi();
  let form;
  let run;
  let messages;

  before(async () => {
    document.body.innerHTML = `
      <form id="urls-form">
        <textarea id="urls"></textarea>
        <div>
          <input id="operation" data-value="preview" value="preview" />
          <ul><li data-value="preview">preview</li><li data-value="live">publish</li></ul>
        </div>
        <button type="submit" id="run">Run</button>
        <input type="checkbox" id="slow" />
        <input type="checkbox" id="force" />
      </form>
      <div id="results-container"></div>`;
    window.HTMLElement.prototype.scrollIntoView = () => {};
    window.localStorage.setItem('use-h6-api', 'true');
    await import('../../../tools/bulk/scripts.js');
  });

  beforeEach(() => {
    api.install();
    document.getElementById('results-container').innerHTML = '';
    document.getElementById('urls').value = URLS;
    document.getElementById('operation').dataset.value = 'preview';
    form = document.getElementById('urls-form');
    run = document.getElementById('run');
    messages = () => [...document.querySelectorAll('.run-messages p')].map((p) => p.textContent);
  });

  afterEach(() => {
    const { violations } = api;
    api.uninstall();
    api.reset();
    assert.deepEqual(violations, []);
  });

  const submit = () => form.dispatchEvent(new window.Event('submit', { cancelable: true }));
  const finished = () => !run.disabled;

  it('fetches the job status for the details link when the start response has none', async () => {
    api.respond('bulkPreview', startResponse);
    api.respond('getJob', statusResponse({
      self: `${JOBS}/job-1`, details: `${JOBS}/job-1/report`,
    }));
    api.respond('getJobReport', report('stopped', [
      { path: '/a', status: 200 },
      { path: '/b', status: 404 },
    ]));

    submit();
    await waitFor(finished);

    assert.deepEqual(
      api.calls.map((c) => c.operationId),
      ['bulkPreview', 'getJob', 'getJobReport'],
    );
    assert.deepEqual(api.calls[0].body, { paths: ['/a', '/b'], forceUpdate: false, forceAsync: true });
    assert.deepEqual(api.violations, []);
    const results = [...document.querySelectorAll('.results-list li')].map((li) => li.textContent);
    assert.deepEqual(results.sort(), ['/a (200)', '/b (404)']);
    assert.ok(messages().includes('Bulk preview completed in 3s'));
  });

  it('skips the status fetch when the start response already has details', async () => {
    api.respond('bulkPreview', {
      ...startResponse,
      body: {
        ...startResponse.body,
        links: { ...startResponse.body.links, details: `${JOBS}/job-1/report` },
      },
    });
    api.respond('getJobReport', report('stopped', [{ path: '/a', status: 200 }]));

    submit();
    await waitFor(finished);

    assert.deepEqual(api.calls.map((c) => c.operationId), ['bulkPreview', 'getJobReport']);
    assert.ok(messages().includes('Bulk preview completed in 3s'));
  });

  it('keeps polling until the job stops and logs each result once', async () => {
    api.respond('bulkPreview', startResponse);
    api.respond('getJob', statusResponse({ details: `${JOBS}/job-1/report` }));
    api.respond('getJobReport', [
      report('running', [{ path: '/a', status: 200 }, { path: '/b', status: 0 }]),
      report('stopped', [{ path: '/a', status: 200 }, { path: '/b', status: 200 }]),
    ]);

    submit();
    await waitFor(finished, 3 * POLL_MS + 2000);

    assert.equal(api.calls.filter((c) => c.operationId === 'getJobReport').length, 2);
    const results = [...document.querySelectorAll('.results-list li')].map((li) => li.textContent);
    assert.deepEqual(results, ['/a (200)', '/b (200)']);
  });

  it('reports a missing status link when neither response has details', async () => {
    api.respond('bulkPreview', startResponse);
    api.respond('getJob', statusResponse({ self: `${JOBS}/job-1` }));

    submit();
    await waitFor(finished);

    assert.deepEqual(api.calls.map((c) => c.operationId), ['bulkPreview', 'getJob']);
    assert.ok(messages().some((m) => m.includes('API returned no status link')));
  });

  it('shows the API error when the bulk start is rejected', async () => {
    api.respond('bulkPreview', { status: 400, body: { message: 'bad paths' } });

    submit();
    await waitFor(finished);

    assert.deepEqual(api.calls.map((c) => c.operationId), ['bulkPreview']);
    assert.ok(messages().some((m) => m.startsWith('Failed to bulk preview 2 URLs on myorg/mysite')));
  });
});
