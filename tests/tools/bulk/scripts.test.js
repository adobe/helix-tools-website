/* eslint-env node */
import {
  describe, it, before, beforeEach, afterEach, mock,
} from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import createMockAemApi from '../../helpers/mock-aem-api.js';

let loginCalls = [];
let signedIn = true;

// Login and config refresh are out of scope for the bulk tool; the real
// ensureLogin opens the profile modal. Same seam as tests/utils/admin-request.test.js.
mock.module('../../../blocks/profile/profile.js', {
  exports: {
    ensureLogin: async (org, site) => {
      loginCalls.push([org, site]);
      return signedIn;
    },
  },
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

const report = (state, resources, total = 2) => ({
  status: 200,
  body: {
    state,
    progress: { processed: resources.length, total },
    startTime: '2026-01-01T00:00:00.000Z',
    stopTime: '2026-01-01T00:00:03.000Z',
    data: { resources },
  },
});

const POLL_MS = 1000;
const API_VERSION = '1.2.3';
const waitFor = async (predicate, timeoutMs = 5000) => {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('timed out waiting for the tool');
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => { setTimeout(resolve, 50); });
  }
};

const targetKey = ({ org, site, ref }) => `${org}/${site}/${ref}`;

// Target attributes keep these assertions independent of layout and label wording.
const visibleBuckets = () => [
  ...document.querySelectorAll('#results-container [data-org][data-site][data-ref]'),
];
const visibleTargetKeys = () => visibleBuckets().map(({ dataset }) => targetKey(dataset)).sort();
const requestKey = ({ method, url, body }) => JSON.stringify([method, url, body?.paths]);
const sortedRequests = (requests) => [...requests]
  .sort((a, b) => requestKey(a).localeCompare(requestKey(b)));

const targetFixtures = (operation) => [
  {
    org: `${operation}-first`, site: 'docs', ref: 'feature', h6: false, paths: ['/shared', '/second'],
  },
  {
    org: `${operation}-other`, site: 'docs', ref: 'feature', h6: true, paths: ['/shared'],
  },
  {
    org: `${operation}-first`, site: 'docs', ref: 'main', h6: false, paths: ['/shared'],
  },
  {
    org: `${operation}-first`, site: 'shop', ref: 'feature', h6: true, paths: ['/shop'],
  },
  {
    org: `${operation}-other`, site: 'docs', ref: 'main', h6: true, paths: ['/main'],
  },
];

const inputUrl = ({ org, site, ref }, path, suffix = 'page') => (
  `https://${ref}--${site}--${org}.aem.${suffix}${path}`
);
const versionedUrl = (url, h6) => (
  `${url}?${h6 ? 'aem-api-version' : 'hlx-admin-version'}=${API_VERSION}`
);

function installTargetResponses(api, targets, {
  operation, endpoint, method, bulk, operationId, rejectFirst, rejectFirstDetection,
}) {
  const h6Fetch = global.fetch;
  const routes = new Map();
  const calls = [];
  const unexpected = [];
  const writes = [];
  const probes = [];
  const reports = [];
  const register = (request, response, specOperation) => {
    routes.set(requestKey(request), { response, specOperation });
  };

  targets.forEach((target, i) => {
    const {
      org, site, ref, h6, paths,
    } = target;
    const probe = {
      method: 'GET', url: `https://admin.hlx.page/sidekick/${org}/${site}/${ref}/config.json`,
    };
    probes.push(probe.url);
    register(probe, {
      status: rejectFirstDetection && i === 0 ? 404 : 200,
      headers: { 'x-api-upgrade-available': String(h6) },
      body: {},
    });
    if (rejectFirstDetection && i === 0) return;

    const base = h6
      ? `https://api.aem.live/${org}/sites/${site}`
      : 'https://admin.hlx.page';
    const resource = h6 ? `${base}/${endpoint}` : `${base}/${endpoint}/${org}/${site}/${ref}`;
    if (!bulk) {
      paths.forEach((path) => {
        const request = { method, url: versionedUrl(`${resource}${path}`, h6), body: undefined };
        writes.push(request);
        register(request, { status: 200, body: {} });
      });
      return;
    }

    const request = {
      method,
      url: versionedUrl(`${resource}/${h6 ? '' : '*'}`, h6),
      body: { paths, forceUpdate: true, ...(h6 ? { forceAsync: true } : {}) },
    };
    writes.push(request);
    if (rejectFirst && i === 0) {
      register(
        request,
        { status: 400, body: { message: 'bad paths' } },
        h6 ? operationId : undefined,
      );
      return;
    }
    const name = `job-${i}`;
    const self = h6
      ? `${base}/jobs/${operation}/${name}`
      : `${base}/job/${org}/${site}/${ref}/${operation}/${name}`;
    const details = `${self}/${h6 ? 'report' : 'details'}`;
    register(request, {
      status: 202,
      body: { job: { name, topic: operation, state: 'created' }, links: { self, details } },
    }, h6 ? operationId : undefined);
    const resources = paths.map((path) => (h6
      ? { resourcePath: path, status: 200 }
      : { path, status: 200 }));
    const reportUrl = versionedUrl(details, h6);
    register(
      { method: 'GET', url: reportUrl },
      report('stopped', resources, paths.length),
      h6 ? 'getJobReport' : undefined,
    );
    reports.push(reportUrl);
  });

  // Keep H6 jobs spec-routed; exact routes cover H5 and direct dispatch contracts.
  mock.method(global, 'fetch', async (input, init = {}) => {
    const request = {
      method: init.method || 'GET',
      url: typeof input === 'string' ? input : input.url,
      body: init.body ? JSON.parse(init.body) : undefined,
    };
    calls.push({
      ...request,
      buckets: visibleTargetKeys(),
      logins: [...loginCalls],
    });
    const route = routes.get(requestKey(request));
    if (!route) {
      unexpected.push(request);
      throw new Error(`Unexpected Bulk test request: ${request.method} ${request.url}`);
    }
    if (route.specOperation) {
      api.respond(route.specOperation, route.response);
      return h6Fetch(input, init);
    }
    const { status, headers, body } = route.response;
    return new Response(JSON.stringify(body), {
      status, headers: { 'content-type': 'application/json', ...headers },
    });
  });

  return {
    calls, unexpected, writes, probes, reports,
  };
}

describe('bulk:scripts.js', () => {
  const api = createMockAemApi();
  let form;
  let run;
  let messages;
  let intervals;

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
    const previousUrl = window.location.href;
    window.history.replaceState(null, '', `?hlx-admin-version=${API_VERSION}`);
    try {
      await import('../../../tools/bulk/scripts.js');
    } finally {
      window.history.replaceState(null, '', previousUrl);
    }
  });

  beforeEach(() => {
    api.install();
    intervals = [];
    const startInterval = window.setInterval.bind(window);
    mock.method(window, 'setInterval', (...args) => {
      const id = startInterval(...args);
      intervals.push(id);
      return id;
    });
    loginCalls = [];
    signedIn = true;
    window.localStorage.setItem('use-h6-api', 'true');
    document.getElementById('results-container').innerHTML = '';
    document.getElementById('urls').value = URLS;
    document.getElementById('operation').dataset.value = 'preview';
    document.getElementById('force').checked = false;
    document.getElementById('slow').checked = false;
    form = document.getElementById('urls-form');
    run = document.getElementById('run');
    messages = () => [...document.querySelectorAll('.run-messages p')].map((p) => p.textContent);
  });

  afterEach(() => {
    const { violations } = api;
    // Stop unfinished polls before restoring fetch, even when an assertion fails.
    intervals.forEach((id) => window.clearInterval(id));
    mock.restoreAll();
    api.uninstall();
    api.reset();
    assert.deepEqual(violations, []);
  });

  const submit = () => form.dispatchEvent(new window.Event('submit', { cancelable: true }));
  const finished = () => !run.disabled;

  it('keeps a backend detection error in the run summary after another bucket succeeds', async () => {
    const targets = targetFixtures('detection-failure').slice(0, 2);
    window.localStorage.removeItem('use-h6-api');
    document.getElementById('force').checked = true;
    document.getElementById('urls').value = targets.flatMap(
      (target) => target.paths.map((path) => inputUrl(target, path)),
    ).join('\n');
    const transport = installTargetResponses(api, targets, {
      operation: 'preview',
      endpoint: 'preview',
      method: 'POST',
      bulk: true,
      operationId: 'bulkPreview',
      rejectFirstDetection: true,
    });

    submit();
    await waitFor(finished);

    assert.deepEqual(transport.unexpected, []);
    assert.deepEqual(
      transport.calls.map(({ method, url, body }) => ({ method, url, body })),
      [
        ...transport.probes.map((url) => ({ method: 'GET', url, body: undefined })),
        ...transport.writes,
        ...transport.reports.map((url) => ({ method: 'GET', url, body: undefined })),
      ],
    );
    const buckets = visibleBuckets();
    assert.ok(buckets[0].textContent.includes('HTTP 404'));
    assert.equal(buckets[0].querySelectorAll('.results-list li').length, 0);
    assert.equal(buckets[1].querySelector('.results-list li').textContent, '/shared (200)');
    assert.equal(
      document.querySelector('#results-container > .run-result > summary').textContent,
      'Preview finished with errors 1 of 3 - 0 failed, 1 succeeded',
    );
  });

  it('validates every target before backend detection or submission', async () => {
    window.localStorage.removeItem('use-h6-api');
    document.getElementById('urls').value = [
      'https://main--docs--valid-before-invalid.aem.page/first',
      'https://example.com/other',
    ].join('\n');
    const requests = [];
    mock.method(global, 'fetch', async (url) => {
      requests.push(url);
      return new Response('{}', { headers: { 'x-api-upgrade-available': 'true' } });
    });

    submit();
    await waitFor(finished);

    assert.deepEqual(requests, [], 'invalid later targets must prevent all network requests');
    assert.ok(messages().some((message) => message.includes('https://example.com/other')));
  });

  ['preview', 'index'].forEach((operation) => {
    it(`marks later ${operation} buckets skipped when sign-in is cancelled`, async () => {
      signedIn = false;
      document.getElementById('operation').dataset.value = operation;
      document.getElementById('urls').value = [
        `https://main--docs--cancel-${operation}-first.aem.page/first`,
        `https://main--docs--cancel-${operation}-other.aem.page/other`,
      ].join('\n');

      submit();
      await waitFor(() => loginCalls.length === 1);
      window.dispatchEvent(new window.Event('profile-cancelled'));
      await waitFor(finished);

      assert.deepEqual(loginCalls, [[`cancel-${operation}-first`, 'docs']]);
      assert.deepEqual(api.calls, [], 'cancellation must prevent writes and later sign-in prompts');
      assert.match(
        document.querySelector('#results-container > .run-result > summary').textContent,
        /\bcancelled\b/,
      );
      const buckets = visibleBuckets();
      assert.equal(buckets.length, 2);
      assert.ok(buckets[0].textContent.includes('Sign-in cancelled'));
      assert.ok(buckets[1].textContent.includes('Skipped because sign-in was cancelled'));
    });
  });

  [
    {
      operation: 'preview',
      endpoint: 'preview',
      method: 'POST',
      bulk: true,
      operationId: 'bulkPreview',
      rejectFirst: true,
    },
    {
      operation: 'live', endpoint: 'live', method: 'POST', bulk: true, operationId: 'bulkPublish',
    },
    {
      operation: 'index', endpoint: 'index', method: 'POST', bulk: false,
    },
    {
      operation: 'unpublish', endpoint: 'live', method: 'DELETE', bulk: false,
    },
    {
      operation: 'unpreview', endpoint: 'preview', method: 'DELETE', bulk: false,
    },
  ].forEach((operation) => {
    it(`plans and displays every org/site/ref bucket before requests for ${operation.operation}`, async () => {
      const targets = targetFixtures(operation.operation);
      const expectedTargets = targets.map(targetKey).sort();
      window.localStorage.removeItem('use-h6-api');
      document.getElementById('operation').dataset.value = operation.operation;
      document.getElementById('force').checked = true;
      document.getElementById('urls').value = [
        ...targets.map((target) => inputUrl(target, target.paths[0])),
        inputUrl(targets[0], targets[0].paths[1], 'live'),
      ].join('\n');
      const transport = installTargetResponses(api, targets, operation);

      submit();
      await waitFor(finished);

      assert.ok(transport.calls.length > 0, 'the run must reach backend detection');
      assert.deepEqual(
        transport.calls[0].buckets,
        expectedTargets,
        'all target buckets must be displayed before the first network request',
      );
      assert.deepEqual(visibleTargetKeys(), expectedTargets);
      const writes = transport.calls.filter((call) => call.method !== 'GET');
      assert.deepEqual(
        sortedRequests(writes.map(({ method, url, body }) => ({ method, url, body }))),
        sortedRequests(transport.writes),
        'each target must receive only its own paths, using its backend and method',
      );
      assert.deepEqual(
        transport.calls.filter((call) => call.method === 'GET').map((call) => call.url).sort(),
        [...transport.probes, ...transport.reports].sort(),
        'detection must preserve refs and each job must follow its own report link',
      );
      assert.deepEqual(transport.unexpected, []);
      targets.forEach((target, i) => {
        const bucket = visibleBuckets().find(
          ({ dataset }) => targetKey(dataset) === targetKey(target),
        );
        [target.org, target.site, target.ref].forEach((part) => {
          assert.ok(bucket.textContent.includes(part), `bucket must visibly identify ${part}`);
        });
        if (operation.rejectFirst && i === 0) {
          assert.ok(bucket.textContent.includes('bad paths'), 'show the error in the rejected bucket');
          assert.equal(bucket.querySelectorAll('.results-list li').length, 0);
          return;
        }
        target.paths.forEach((path) => {
          assert.ok(
            [...bucket.querySelectorAll('.results-list li')].some((li) => (
              operation.bulk ? li.textContent === `${path} (200)` : li.textContent.includes(path)
            )),
            `result for ${targetKey(target)}${path} must appear inside its own bucket`,
          );
        });
      });
      writes.forEach((request) => {
        const target = targets.find((candidate) => {
          if (candidate.h6) {
            return request.url.startsWith(
              `https://api.aem.live/${candidate.org}/sites/${candidate.site}/`,
            );
          }
          return request.url.includes(`/${candidate.org}/${candidate.site}/${candidate.ref}/`);
        });
        assert.ok(
          request.logins.some(([org, site]) => org === target.org && site === target.site),
          `authenticate ${target.org}/${target.site} before submitting its operation`,
        );
      });
    });
  });

  it('does not advertise or offer cache purge in the actual tool page', async () => {
    const html = await readFile(new URL('../../../tools/bulk/index.html', import.meta.url), 'utf8');
    const page = new window.DOMParser().parseFromString(html, 'text/html');
    assert.deepEqual(
      [...page.querySelectorAll('#operation-menu [data-value]')].map((option) => option.dataset.value),
      ['preview', 'live', 'index', 'unpublish', 'unpreview'],
    );
    assert.doesNotMatch(page.querySelector('h1').parentElement.textContent, /\bpurge\b/i);
  });

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
    assert.equal(document.querySelectorAll('.results-list li').length, 0);
    assert.equal(
      document.querySelector('#results-container > .run-result > summary').textContent,
      'Preview finished with errors 0 of 2 - 0 failed, 0 succeeded',
    );
  });

  it('shows the API error when the bulk start is rejected', async () => {
    api.respond('bulkPreview', { status: 400, body: { message: 'bad paths' } });

    submit();
    await waitFor(finished);

    assert.deepEqual(api.calls.map((c) => c.operationId), ['bulkPreview']);
    assert.ok(messages().some((m) => m.startsWith('Failed to bulk preview 2 URLs on myorg/mysite')));
  });
});
