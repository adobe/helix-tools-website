/* eslint-env node */
import {
  afterEach, before, beforeEach, describe, it, mock,
} from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import createMockAemApi from '../../helpers/mock-aem-api.js';

let ready;
let signIns;
let imsToken;
let completeSignIn;
let editorDocuments;
let requests;
let unexpected;
let responses;
let fetchMocks;
let probes;
const api = createMockAemApi();

mock.module('../../../scripts/scripts.js', {
  exports: { registerToolReady: (promise) => { ready = promise; } },
});
mock.module('../../../utils/config/config.js', {
  exports: { initConfigField: async () => {}, updateConfig: () => {} },
});
// The Adobe sign-in (utils/ims.js) completes at once, storing a token, unless cancelled.
mock.module('../../../utils/ims.js', {
  exports: {
    getImsToken: () => imsToken,
    isImsTokenFresh: () => !!imsToken,
    loadIms: async () => {},
    signIn: async () => {
      signIns += 1;
      if (completeSignIn) imsToken = 'ims-token';
      return completeSignIn;
    },
  },
});
mock.module('../../../blocks/modal/modal.js', {
  exports: { createModal: async () => ({ showModal: () => {} }) },
});
mock.module('../../../vendor/codemirror/codemirror.js', {
  exports: { default: ({ doc }) => { editorDocuments.push(JSON.parse(doc)); } },
});

const BASE = 'https://admin.hlx.page';
const STATUS = `${BASE}/status/acme/docs/main/index.html`;
const LOG = `${BASE}/log/acme/docs/main`;
const HOSTS = {
  live: { url: 'https://published.example.com/' },
  preview: { url: 'https://preview.example.com/' },
};
const entry = (path, extra = {}) => ({
  timestamp: 1699368094644,
  route: 'preview',
  path,
  ...extra,
});
const waitFor = async (predicate) => {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > 3000) throw new Error('Timed out waiting for log viewer');
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => { setTimeout(resolve, 10); });
  }
};
const respond = (url, body, status = 200, headers = {}) => {
  const queue = responses.get(url) || [];
  queue.push({ body, status, headers });
  responses.set(url, queue);
};
const detect = (org, site, ref, h6) => {
  const url = `${BASE}/sidekick/${org}/${site}/${ref}/config.json`;
  respond(url, {}, 200, { 'x-api-upgrade-available': String(h6) });
  return url;
};
const urls = () => requests.map(({ url }) => url);
const rows = () => [...document.querySelectorAll('tbody.results > tr')];
const visible = (name) => document.querySelector(`tbody.${name}`).getAttribute('aria-hidden') === 'false';

async function submit() {
  const form = document.getElementById('timeframe-form');
  const button = form.querySelector('button[type="submit"]');
  form.dispatchEvent(new window.SubmitEvent('submit', { cancelable: true, submitter: button }));
  await waitFor(() => !button.disabled);
}

describe('log-viewer request compatibility', () => {
  before(async () => {
    document.documentElement.innerHTML = await readFile(
      new URL('../../../tools/log-viewer/index.html', import.meta.url),
      'utf8',
    );
    global.Node = window.Node;
    const interval = mock.method(global, 'setInterval', () => 0);
    await import('../../../tools/log-viewer/scripts.js');
    await ready;
    interval.mock.restore();
  });

  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState(null, '', '/');
    signIns = 0;
    imsToken = undefined;
    completeSignIn = true;
    editorDocuments = [];
    requests = [];
    probes = [];
    unexpected = [];
    responses = new Map();
    detect('acme', 'docs', 'main', false);
    detect('acme', 'docs', 'feature', false);
    fetchMocks = [];
    api.reset();
    api.install();
    const h6Fetch = global.fetch;
    api.uninstall();
    document.querySelector('#timeframe-form button[type="reset"]').click();
    document.getElementById('org').value = 'acme';
    document.getElementById('site').value = 'docs';
    fetchMocks.push(mock.method(global, 'fetch', async (url, init = {}) => {
      const call = { url, method: init.method, signIns };
      if (new URL(url).pathname.startsWith('/sidekick/')) probes.push(call);
      else requests.push(call);
      if (new URL(url).origin === 'https://api.aem.live') return h6Fetch(url, init);
      const queue = responses.get(url);
      if (!queue?.length) {
        unexpected.push(url);
        throw new Error(`Unexpected log-viewer request: ${url}`);
      }
      const { body, status, headers } = queue.length > 1 ? queue.shift() : queue[0];
      if (body instanceof Error) throw body;
      return new Response(JSON.stringify(body), { status, headers });
    }));
  });

  afterEach(() => {
    fetchMocks.reverse().forEach((fetchMock) => fetchMock.mock.restore());
    assert.deepEqual(unexpected, []);
    assert.deepEqual(api.violations, []);
  });

  it('loads hosts and every log page, preserving timespan, token encoding and auth ordering', async () => {
    respond(STATUS, HOSTS);
    respond(`${LOG}?since=24h`, { entries: [entry('/first')], nextToken: 'AB+/==' });
    respond(`${LOG}?since=24h&nextToken=AB%2B%2F%3D%3D`, { entries: [entry('/second')] });

    await submit();

    assert.deepEqual(requests, [
      { url: STATUS, method: 'GET', signIns: 1 },
      { url: `${LOG}?since=24h`, method: 'GET', signIns: 1 },
      { url: `${LOG}?since=24h&nextToken=AB%2B%2F%3D%3D`, method: 'GET', signIns: 1 },
    ]);
    assert.equal(visible('results'), true);
    assert.deepEqual(rows().map((row) => row.querySelector('a').href), [
      'https://preview.example.com/second', 'https://preview.example.com/first',
    ]);
    assert.equal(document.getElementById('download-csv').classList.contains('disabled'), false);
  });

  it('preserves custom date bounds on subsequent pages', async () => {
    document.querySelector('[data-value="custom"]').click();
    document.getElementById('date-from').value = '2026-01-03T12:00';
    document.getElementById('date-to').value = '2026-01-02T12:00';
    const params = new URLSearchParams({
      from: new Date('2026-01-02T12:00').toISOString(),
      to: new Date('2026-01-03T12:00').toISOString(),
    });
    respond(STATUS, HOSTS);
    respond(`${LOG}?${params}`, { entries: [], nextToken: 'next' });
    respond(`${LOG}?${params}&nextToken=next`, { entries: [entry('/custom')] });

    await submit();

    assert.deepEqual(urls(), [STATUS, `${LOG}?${params}`, `${LOG}?${params}&nextToken=next`]);
    assert.equal(rows().length, 1);
  });

  it('renders empty logs without enabling CSV export', async () => {
    respond(STATUS, HOSTS);
    respond(`${LOG}?since=24h`, { entries: [] });
    await submit();
    assert.equal(visible('no-results'), true);
    assert.equal(document.getElementById('download-csv').classList.contains('disabled'), true);
  });

  it('stops before fetching logs when host discovery fails', async () => {
    respond(STATUS, {}, 403);
    await submit();
    assert.deepEqual(urls(), [STATUS]);
    assert.equal(visible('error'), true);
    assert.match(document.querySelector('tbody.error').textContent, /403 Error/);
  });

  it('does not display partial results when a later log page fails', async () => {
    respond(STATUS, HOSTS);
    respond(`${LOG}?since=24h`, { entries: [entry('/partial')], nextToken: 'next' });
    respond(`${LOG}?since=24h&nextToken=next`, {}, 404);
    await submit();
    assert.equal(visible('error'), true);
    assert.equal(rows().length, 0);
    assert.match(document.querySelector('tbody.error').textContent, /404 Error/);
  });

  it('reports transport failures rather than rendering successful empty results', async () => {
    respond(STATUS, HOSTS);
    respond(`${LOG}?since=24h`, new TypeError('Network unavailable'));
    await submit();
    assert.equal(visible('error'), true);
    assert.match(document.querySelector('tbody.error').textContent, /0 Error/);
  });

  it('signs in again and retries a log page whose token expired, with the same target and query', async () => {
    respond(STATUS, HOSTS);
    respond(`${LOG}?since=24h`, {}, 401);
    respond(`${LOG}?since=24h`, { entries: [entry('/retried')] });
    const { fetch } = global;
    fetchMocks.push(mock.method(global, 'fetch', async (...args) => {
      const res = await fetch(...args);
      if (res.status === 401) imsToken = undefined;
      return res;
    }));
    await submit();
    assert.deepEqual(urls(), [STATUS, `${LOG}?since=24h`, `${LOG}?since=24h`]);
    assert.equal(signIns, 2);
    assert.equal(visible('results'), true);
  });

  it('makes no request after preflight login is cancelled', async () => {
    completeSignIn = false;
    await submit();
    assert.deepEqual(urls(), []);
    assert.equal(visible('login'), true);
  });

  it('stops pagination after login is cancelled', async () => {
    respond(STATUS, HOSTS);
    respond(`${LOG}?since=24h`, { entries: [entry('/partial')], nextToken: 'next' });
    respond(`${LOG}?since=24h&nextToken=next`, {}, 401);
    const { fetch } = global;
    fetchMocks.push(mock.method(global, 'fetch', async (...args) => {
      const res = await fetch(...args);
      if (res.status === 401) {
        imsToken = undefined;
        completeSignIn = false;
      }
      return res;
    }));
    await submit();
    assert.deepEqual(urls(), [STATUS, `${LOG}?since=24h`, `${LOG}?since=24h&nextToken=next`]);
    assert.equal(visible('login'), true);
    assert.equal(rows().length, 0);
  });

  [
    {
      name: 'config',
      log: entry('/config.json', { route: 'config', org: 'acme', site: 'docs' }),
      url: `${BASE}/config/acme/sites/docs.json`,
    },
    {
      name: 'job',
      log: entry('preview/job-123', {
        route: 'preview-job', org: 'acme', site: 'docs', ref: 'feature',
      }),
      url: `${BASE}/job/acme/docs/feature/preview/job-123/details`,
    },
    {
      name: 'snapshot job',
      log: entry('/snapshot', {
        route: 'snapshot', org: 'acme', site: 'docs', ref: 'feature', job: 'snapshot/job-123',
      }),
      url: `${BASE}/job/acme/docs/feature/snapshot/job-123/details`,
    },
    {
      name: 'status',
      log: entry('/guide', {
        route: 'status', owner: 'acme', repo: 'docs', ref: 'feature',
      }),
      url: `${BASE}/status/acme/docs/feature/guide`,
    },
  ].forEach(({ name, log, url }) => {
    it(`loads ${name} details through the real H5 adapter`, async () => {
      const detail = { result: name };
      respond(STATUS, HOSTS);
      respond(`${LOG}?since=24h`, { entries: [log] });
      const job = name.includes('job') ? url.replace(/\/details$/, '') : null;
      if (job) respond(job, { links: { details: url } });
      respond(url, detail);
      await submit();
      const button = document.querySelector('tbody.results button');
      button.click();
      await waitFor(() => !button.disabled);
      assert.deepEqual(urls(), [STATUS, `${LOG}?since=24h`, ...(job ? [job] : []), url]);
      assert.equal(requests.at(-1).method, 'GET');
      assert.deepEqual(editorDocuments, [detail]);
    });
  });

  it('loads H6 logs and host links using a documented resource status path', async () => {
    window.localStorage.setItem('use-h6-api', 'true');
    api.respond('status', { body: HOSTS });
    api.respond('getLogs', { body: { entries: [entry('/h6-page')] } });

    await submit();

    assert.equal(visible('results'), true);
    assert.deepEqual(urls(), [
      'https://api.aem.live/acme/sites/docs/status/index.html',
      'https://api.aem.live/acme/sites/docs/log?since=24h',
    ]);
    assert.equal(rows()[0].querySelector('a').href, 'https://preview.example.com/h6-page');
  });

  it('detects the backend independently for successive site submissions without the override', async () => {
    const h6Probe = detect('detected-h6', 'docs', 'main', true);
    const h5Probe = detect('detected-h5', 'legacy', 'main', false);
    api.respond('status', { body: HOSTS });
    api.respond('getLogs', { body: { entries: [entry('/modern')] } });
    document.getElementById('org').value = 'detected-h6';
    await submit();
    assert.equal(visible('results'), true);

    document.getElementById('org').value = 'detected-h5';
    document.getElementById('site').value = 'legacy';
    const status = `${BASE}/status/detected-h5/legacy/main/index.html`;
    const log = `${BASE}/log/detected-h5/legacy/main?since=24h`;
    respond(status, HOSTS);
    respond(log, { entries: [entry('/legacy')] });
    await submit();

    assert.deepEqual(probes.map(({ url }) => url), [h6Probe, h5Probe]);
    assert.deepEqual(urls(), [
      'https://api.aem.live/detected-h6/sites/docs/status/index.html',
      'https://api.aem.live/detected-h6/sites/docs/log?since=24h',
      status, log,
    ]);
    assert.equal(signIns, 1);
    assert.equal(rows()[0].querySelector('a').href, 'https://preview.example.com/legacy');
  });

  it('follows the H6 job report link and retains the submitted target when the form changes', async () => {
    window.localStorage.setItem('use-h6-api', 'true');
    const job = 'https://api.aem.live/acme/sites/docs/jobs/preview/job-456';
    const report = `${job}/report?view=full`;
    const details = { state: 'stopped', data: { paths: ['/guide'] } };
    api.respond('status', { body: HOSTS });
    api.respond('getLogs', { body: { entries: [entry('preview/job-456', { route: 'preview-job' })] } });
    api.respond('getJob', { status: 202, body: { links: { details: report } } });
    api.respond('getJobReport', { body: details });
    await submit();
    document.getElementById('org').value = 'changed-org';
    document.getElementById('site').value = 'changed-site';

    const button = document.querySelector('tbody.results button');
    button.click();
    await waitFor(() => !button.disabled);

    assert.deepEqual(urls(), [
      'https://api.aem.live/acme/sites/docs/status/index.html',
      'https://api.aem.live/acme/sites/docs/log?since=24h',
      job, report,
    ]);
    assert.deepEqual(editorDocuments, [details]);
    assert.equal(signIns, 1);
  });

  it('surfaces detection failures and restores the submit button', async () => {
    document.getElementById('org').value = 'failed-detection';
    respond(`${BASE}/sidekick/failed-detection/docs/main/config.json`, {}, 404);
    await submit();
    assert.equal(visible('error'), true);
    assert.match(document.querySelector('tbody.error').textContent, /404/);
    assert.deepEqual(urls(), []);
  });

  it('follows H6 log pagination links without reconstructing the next query', async () => {
    window.localStorage.setItem('use-h6-api', 'true');
    const next = 'https://api.aem.live/acme/sites/docs/log?nextToken=opaque%2B%3D&limit=2';
    api.respond('status', { body: HOSTS });
    api.respond('getLogs', [
      { body: { entries: [entry('/first')], links: { next } } },
      { body: { entries: [entry('/second')] } },
    ]);

    await submit();

    assert.deepEqual(urls(), [
      'https://api.aem.live/acme/sites/docs/status/index.html',
      'https://api.aem.live/acme/sites/docs/log?since=24h',
      next,
    ]);
    assert.equal(rows().length, 2);
    assert.equal(signIns, 1);
  });

  it('does not duplicate the version pin when an H6 pagination link already carries it', async () => {
    window.history.replaceState(null, '', '?hlx-admin-version=1.2.3');
    window.localStorage.setItem('use-h6-api', 'true');
    const next = 'https://api.aem.live/acme/sites/docs/log?aem-api-version=1.2.3&nextToken=opaque&limit=2';
    api.respond('status', { body: HOSTS });
    api.respond('getLogs', [
      { body: { entries: [entry('/first')], links: { next } } },
      { body: { entries: [entry('/second')] } },
    ]);

    await submit();

    assert.equal(urls().at(-1), next);
  });

  it('pins host, log and detail calls using each backend version parameter', async () => {
    window.history.replaceState(null, '', '?hlx-admin-version=1.2.3');
    respond(`${STATUS}?hlx-admin-version=1.2.3`, HOSTS);
    respond(`${LOG}?hlx-admin-version=1.2.3&since=24h`, {
      entries: [entry('/config.json', { route: 'config', org: 'acme', site: 'docs' })],
    });
    const config = `${BASE}/config/acme/sites/docs.json?hlx-admin-version=1.2.3`;
    respond(config, { version: 5 });
    await submit();
    assert.equal(visible('results'), true);
    let button = document.querySelector('tbody.results button');
    button.click();
    await waitFor(() => !button.disabled);
    assert.deepEqual(urls(), [
      `${STATUS}?hlx-admin-version=1.2.3`,
      `${LOG}?hlx-admin-version=1.2.3&since=24h`,
      config,
    ]);

    window.localStorage.setItem('use-h6-api', 'true');
    api.respond('status', { body: HOSTS });
    api.respond('getLogs', { body: { entries: [entry('/config.json', { route: 'config' })] } });
    api.respond('getConfigSite', { body: { version: 6 } });
    await submit();
    button = document.querySelector('tbody.results button');
    button.click();
    await waitFor(() => !button.disabled);
    assert.deepEqual(urls().slice(3), [
      'https://api.aem.live/acme/sites/docs/status/index.html?aem-api-version=1.2.3',
      'https://api.aem.live/acme/sites/docs/log?aem-api-version=1.2.3&since=24h',
      'https://api.aem.live/acme/sites/docs/config.json?aem-api-version=1.2.3',
    ]);
    assert.deepEqual(editorDocuments, [{ version: 5 }, { version: 6 }]);
  });

  it('preserves explicitly ref-less H5 status detail requests', async () => {
    respond(STATUS, HOSTS);
    respond(`${LOG}?since=24h`, {
      entries: [entry('/guide', {
        route: 'status', owner: 'acme', repo: 'docs', ref: null,
      })],
    });
    const status = `${BASE}/status/acme/docs/guide`;
    respond(status, { path: '/guide' });
    await submit();
    const button = document.querySelector('tbody.results button');
    button.click();
    await waitFor(() => !button.disabled);
    assert.deepEqual(urls(), [STATUS, `${LOG}?since=24h`, status]);
    assert.deepEqual(editorDocuments, [{ path: '/guide' }]);
  });

  it('shows a detail error without guessing a report URL when the job has no details link', async () => {
    window.localStorage.setItem('use-h6-api', 'true');
    api.respond('status', { body: HOSTS });
    api.respond('getLogs', { body: { entries: [entry('preview/job-456', { route: 'job' })] } });
    api.respond('getJob', { status: 202, body: { links: {} } });
    await submit();
    const button = document.querySelector('tbody.results button');
    button.click();
    await waitFor(() => !button.disabled);
    assert.equal(button.textContent, 'Error loading details');
    assert.equal(button.title, 'API returned no job details link');
    assert.deepEqual(editorDocuments, []);
    assert.deepEqual(api.calls.map(({ operationId }) => operationId), ['status', 'getLogs', 'getJob']);

    api.respond('getJob', { body: { links: { details: 'https://api.aem.live/acme/sites/docs/jobs/preview/job-456/report' } } });
    api.respond('getJobReport', { body: { paths: ['/guide'] } });
    button.click();
    await waitFor(() => !button.disabled);
    assert.equal(button.textContent, 'preview/job-456');
    assert.equal(button.title, 'preview/job-456');
    assert.deepEqual(editorDocuments, [{ paths: ['/guide'] }]);
  });
});
