import { sampleRUM } from '../../scripts/aem.js';
import { registerToolReady } from '../../scripts/scripts.js';
import { createModal } from '../../blocks/modal/modal.js';
import escapeHtml from '../../utils/html.js';
import {
  parseHostList,
  KEY_PRESETS,
  DEFAULT_PRESET_IDS,
  buildKeys,
  parseList,
  parsePaths,
  summarizePurgeLog,
} from './bulk-purge-utils.js';

const API = 'https://helix-cache-debug.adobeaem.workers.dev';
const RESOLVE_CONCURRENCY = 4;

/** @type {string} */
let authKey;

// get key from storage or ask for it
if (localStorage.getItem('cache-debug-key')) {
  authKey = localStorage.getItem('cache-debug-key');
} else {
  // eslint-disable-next-line no-alert
  authKey = prompt('Enter your cache superuser key');
  if (authKey) {
    localStorage.setItem('cache-debug-key', authKey);
  }
}

const hostsInput = document.querySelector('#hosts-input');
const customKeysInput = document.querySelector('#custom-keys-input');
const pathsInput = document.querySelector('#paths-input');
const purgeOrgInput = document.querySelector('#purge-org');
const purgeHeadInput = document.querySelector('#purge-head');
const delayInput = document.querySelector('#delay-input');
const presetsList = document.querySelector('#presets-list');
const keysPanel = document.querySelector('#keys-panel');
const pathsPanel = document.querySelector('#paths-panel');
const configPanel = document.querySelector('#config-panel');
const resolveButton = document.querySelector('#resolve-button');
const purgeButton = document.querySelector('#purge-button');
const stopButton = document.querySelector('#stop-button');
const downloadButton = document.querySelector('#download-button');
const inputMessages = document.querySelector('#input-messages');
const progress = document.querySelector('#progress');
const resultsBody = document.querySelector('#results-body');
const selectAllInput = document.querySelector('#select-all');

/** @type {Array<object>} row state, one per resolved site */
let rows = [];
let resolving = false;
let running = false;
let stopRequested = false;
/** @type {(() => void)|null} aborts the current inter-site delay, if any */
let sleepAbort = null;

const authHeader = () => ['bearer', authKey].join(' ');

const authHeaders = () => ({
  'content-type': 'application/json',
  authorization: authHeader(),
});

/**
 * Handles a 403 "invalid authorization" response by clearing the stored key.
 * @param {Response} resp
 * @returns {boolean} true if the key was cleared because of this response
 */
const handleAuthError = (resp) => {
  if (resp.status === 403 && resp.headers.get('x-error') === 'invalid authorization') {
    authKey = undefined;
    localStorage.removeItem('cache-debug-key');
    if (!inputMessages.querySelector('.auth-error')) {
      const p = document.createElement('p');
      p.className = 'error auth-error';
      p.textContent = 'Invalid authorization key. Please reload the page and re-enter your key.';
      inputMessages.appendChild(p);
    }
    return true;
  }
  return false;
};

/**
 * Extracts a human-readable error message from a non-2xx response.
 * @param {Response} resp
 * @returns {Promise<string>}
 */
const errorMessage = async (resp) => resp.headers.get('x-error') || (await resp.text()) || `HTTP ${resp.status}`;

const resolveSite = (host) => fetch(`${API}/resolve?host=${encodeURIComponent(host)}`, {
  headers: { authorization: authHeader() },
});

const purgeKeysOrPaths = (liveHost, keys, paths) => fetch(`${API}/purge`, {
  method: 'POST',
  body: JSON.stringify({ liveHost, keys, paths }),
  headers: authHeaders(),
});

const purgeConfig = (liveHost, purgeOrg, purgeHead) => fetch(`${API}/purge-config`, {
  method: 'POST',
  body: JSON.stringify({ liveHost, purgeOrg, purgeHead }),
  headers: authHeaders(),
});

const showLogModal = async (liveHost, log) => {
  const heading = document.createElement('h2');
  heading.id = `purge-log-title-${crypto.randomUUID()}`;
  heading.textContent = `Purge Log: ${liveHost}`;
  const content = document.createElement('pre');
  content.textContent = log;
  const { block, showModal } = await createModal([heading, content]);
  block.querySelector('dialog').setAttribute('aria-labelledby', heading.id);
  showModal();
};

/**
 * @returns {'keys'|'paths'|'config'} the currently selected purge mode
 */
const getMode = () => document.querySelector('input[name="mode"]:checked').value;

const getCheckedPresetIds = () => [...presetsList.querySelectorAll('input[type="checkbox"]:checked')]
  .map((cb) => cb.value);

const updatePanelVisibility = () => {
  const mode = getMode();
  keysPanel.hidden = mode !== 'keys';
  pathsPanel.hidden = mode !== 'paths';
  configPanel.hidden = mode !== 'config';
};

const renderPresets = () => {
  presetsList.innerHTML = KEY_PRESETS.map((preset) => {
    const checked = DEFAULT_PRESET_IDS.includes(preset.id) ? 'checked' : '';
    const previewNote = preset.preview ? ' (+ preview)' : '';
    return /* html */`
      <label>
        <input type="checkbox" value="${escapeHtml(preset.id)}" ${checked} />
        ${escapeHtml(preset.label)} <code>${escapeHtml(preset.template)}</code>${previewNote}
      </label>
    `;
  }).join('');
};

/**
 * Renders the invalid-path warning in #input-messages for the paths mode, if any.
 * @param {string[]} invalid
 */
const renderInvalidPaths = (invalid) => {
  const existing = inputMessages.querySelector('.invalid-paths');
  if (existing) existing.remove();
  if (!invalid.length) return;
  const p = document.createElement('p');
  p.className = 'error invalid-paths';
  p.textContent = `Ignoring ${invalid.length} invalid path(s) (must start with /): ${invalid.join(', ')}`;
  inputMessages.appendChild(p);
};

/**
 * Computes the "to purge" cell content for a single row given the current mode/options.
 * @param {object} row
 * @returns {{html: string}|{error: string}}
 */
const computeToPurge = (row) => {
  const mode = getMode();
  try {
    if (mode === 'keys') {
      const keys = buildKeys({
        presetIds: getCheckedPresetIds(),
        customKeys: parseList(customKeysInput.value),
      }, row);
      if (!keys.length) return { html: '' };
      return { html: keys.map((k) => `<span class="pill">${escapeHtml(k)}</span>`).join('') };
    }
    if (mode === 'paths') {
      const { paths, invalid } = parsePaths(pathsInput.value);
      renderInvalidPaths(invalid);
      if (!paths.length) return { html: '' };
      return { html: paths.map((p) => `<span class="pill">${escapeHtml(p)}</span>`).join('') };
    }
    // config mode
    const scope = purgeOrgInput.checked ? 'org' : 'site';
    const head = purgeHeadInput.checked ? ' + head' : '';
    return { html: `<span class="pill">config (${scope})${escapeHtml(head)}</span>` };
  } catch (e) {
    return { error: e.message };
  }
};

const recomputeToPurge = (row) => {
  if (row.resolveError || row.status === 'resolving') {
    row.el.toPurgeCell.innerHTML = '';
    return;
  }
  const result = computeToPurge(row);
  if (result.error) {
    row.el.toPurgeCell.innerHTML = `<span class="error">${escapeHtml(result.error)}</span>`;
  } else {
    row.el.toPurgeCell.innerHTML = result.html;
  }
};

const recomputeAllToPurge = () => {
  if (getMode() === 'paths') renderInvalidPaths(parsePaths(pathsInput.value).invalid);
  rows.forEach(recomputeToPurge);
};

const STATUS_LABELS = {
  resolving: { text: 'resolving', cls: '' },
  ready: { text: 'ready', cls: 'good' },
  error: { text: 'error', cls: 'bad' },
  purging: { text: 'purging', cls: 'warn' },
  ok: { text: 'ok', cls: 'good' },
  partial: { text: 'partial', cls: 'warn' },
  failed: { text: 'failed', cls: 'bad' },
  skipped: { text: 'skipped', cls: '' },
};

const setStatus = (row, status, title) => {
  row.status = status;
  const { text, cls } = STATUS_LABELS[status] ?? { text: status, cls: '' };
  const pill = row.el.statusCell.querySelector('.pill') ?? (() => {
    const span = document.createElement('span');
    row.el.statusCell.appendChild(span);
    return span;
  })();
  pill.className = `pill${cls ? ` ${cls}` : ''}`;
  pill.textContent = text;
  if (title) pill.title = title;
  else pill.removeAttribute('title');
};

/**
 * Updates the Purge button's enabled state: enabled once at least one row
 * resolved successfully, disabled while resolving or running.
 */
const updatePurgeButtonState = () => {
  const hasReady = rows.some((row) => !row.resolveError && row.status !== 'resolving');
  purgeButton.disabled = resolving || running || !hasReady;
};

const createRow = (site) => {
  const tr = document.createElement('tr');
  tr.innerHTML = /* html */`
    <td><input type="checkbox" class="row-select" disabled aria-label="Select ${escapeHtml(site.input)}" /></td>
    <td>
      <div>${escapeHtml(site.input)}</div>
      <div class="live-host">resolving…</div>
    </td>
    <td class="cbid-cell"></td>
    <td class="cdn-cell"></td>
    <td class="to-purge-cell"></td>
    <td class="status-cell"></td>
    <td class="log-cell"></td>
  `;
  resultsBody.appendChild(tr);
  const row = {
    ...site,
    liveHost: undefined,
    ref: undefined,
    site: undefined,
    org: undefined,
    contentBusId: undefined,
    cdn: undefined,
    resolveError: undefined,
    status: 'resolving',
    log: undefined,
    el: {
      tr,
      checkbox: tr.querySelector('.row-select'),
      liveHostCell: tr.querySelector('.live-host'),
      cbidCell: tr.querySelector('.cbid-cell'),
      cdnCell: tr.querySelector('.cdn-cell'),
      toPurgeCell: tr.querySelector('.to-purge-cell'),
      statusCell: tr.querySelector('.status-cell'),
      logCell: tr.querySelector('.log-cell'),
    },
  };
  setStatus(row, 'resolving');
  return row;
};

/**
 * Resolves a single site against the worker's /resolve endpoint and updates its row.
 * @param {object} row
 */
const resolveRow = async (row) => {
  try {
    const resp = await resolveSite(row.host);
    if (handleAuthError(resp)) {
      row.resolveError = 'Invalid authorization, please reload the page';
      row.el.liveHostCell.textContent = '';
      setStatus(row, 'error', row.resolveError);
      return;
    }
    if (!resp.ok) {
      row.resolveError = await errorMessage(resp);
      row.el.liveHostCell.textContent = '';
      setStatus(row, 'error', row.resolveError);
      return;
    }
    const data = await resp.json();
    row.liveHost = data.liveHost;
    row.ref = data.ref;
    row.site = data.site;
    row.org = data.org;
    row.contentBusId = data.contentBusId;
    row.cdn = data.cdn;
    row.el.liveHostCell.textContent = data.liveHost;
    row.el.cbidCell.textContent = data.contentBusId ?? '';
    row.el.cdnCell.textContent = data.cdn ? `${data.cdn.type} (${data.cdn.host})` : '';
    row.el.checkbox.setAttribute('aria-label', `Select ${data.liveHost}`);
    row.el.checkbox.disabled = false;
    row.el.checkbox.checked = true;
    setStatus(row, 'ready');
  } catch (e) {
    row.resolveError = e.message;
    row.el.liveHostCell.textContent = '';
    setStatus(row, 'error', row.resolveError);
  } finally {
    recomputeToPurge(row);
  }
};

/**
 * Resolves all given rows with a small worker pool for concurrency.
 * @param {object[]} rowsToResolve
 */
const resolveAll = async (rowsToResolve) => {
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next;
      next += 1;
      if (i >= rowsToResolve.length) return;
      // eslint-disable-next-line no-await-in-loop
      await resolveRow(rowsToResolve[i]);
    }
  };
  const workers = Array.from(
    { length: Math.min(RESOLVE_CONCURRENCY, rowsToResolve.length) },
    () => worker(),
  );
  await Promise.all(workers);
};

const clearResults = () => {
  rows = [];
  resultsBody.innerHTML = '';
  downloadButton.disabled = true;
  selectAllInput.checked = true;
};

const renderInputMessages = (rejected, duplicates) => {
  inputMessages.innerHTML = '';
  if (rejected.length) {
    const p = document.createElement('p');
    p.className = 'error';
    p.textContent = `Rejected ${rejected.length} host(s): ${rejected.map((r) => `${r.input} (${r.reason})`).join(', ')}`;
    inputMessages.appendChild(p);
  }
  if (duplicates.length) {
    const p = document.createElement('p');
    p.textContent = `Ignored ${duplicates.length} duplicate host(s): ${duplicates.map((d) => d.input).join(', ')}`;
    inputMessages.appendChild(p);
  }
};

const onResolveClick = async () => {
  const { sites, rejected, duplicates } = parseHostList(hostsInput.value);
  renderInputMessages(rejected, duplicates);
  clearResults();
  if (!sites.length) {
    const p = document.createElement('p');
    p.textContent = 'No valid hosts to resolve.';
    inputMessages.appendChild(p);
    return;
  }

  resolving = true;
  resolveButton.disabled = true;
  updatePurgeButtonState();
  try {
    rows = sites.map(createRow);
    await resolveAll(rows);
  } finally {
    resolving = false;
    resolveButton.disabled = false;
    updatePurgeButtonState();
  }
};

/**
 * Validates the current mode's options against resolvable rows.
 * @returns {string|null} an error message, or null if valid
 */
const validateSelection = () => {
  const mode = getMode();
  if (mode === 'keys') {
    const keys = getCheckedPresetIds();
    const custom = parseList(customKeysInput.value);
    if (!keys.length && !custom.length) return 'Select at least one preset or enter a custom key.';
  } else if (mode === 'paths') {
    const { paths, invalid } = parsePaths(pathsInput.value);
    renderInvalidPaths(invalid);
    if (!paths.length) return 'Enter at least one valid path (must start with /).';
  }
  return null;
};

const getSelectedRows = () => rows.filter((row) => !row.resolveError && row.el.checkbox.checked);

const confirmPurge = (selected) => {
  const mode = getMode();
  let details;
  if (mode === 'keys') {
    const presetIds = getCheckedPresetIds();
    const presets = KEY_PRESETS.filter((p) => presetIds.includes(p.id)).map((p) => p.label);
    const custom = parseList(customKeysInput.value);
    details = `keys: ${[...presets, ...custom].join(', ')}`;
  } else if (mode === 'paths') {
    details = `paths: ${parsePaths(pathsInput.value).paths.join(', ')}`;
  } else {
    details = `config (${purgeOrgInput.checked ? 'org' : 'site'}${purgeHeadInput.checked ? ' + head' : ''})`;
  }
  // eslint-disable-next-line no-alert
  return window.confirm(`Purge ${selected.length} site(s) using ${mode} mode?\n${details}`);
};

const setFormDisabled = (disabled) => {
  [
    hostsInput, customKeysInput, pathsInput, purgeOrgInput, purgeHeadInput,
    delayInput, resolveButton, selectAllInput,
  ].forEach((el) => { el.disabled = disabled; });
  document.querySelectorAll('input[name="mode"]').forEach((el) => { el.disabled = disabled; });
  presetsList.querySelectorAll('input[type="checkbox"]').forEach((el) => { el.disabled = disabled; });
  rows.forEach((row) => { row.el.checkbox.disabled = disabled || !!row.resolveError; });
  purgeButton.disabled = disabled || resolving || running;
};

const sleep = (ms) => new Promise((resolve) => {
  const timer = setTimeout(() => { sleepAbort = null; resolve(); }, ms);
  sleepAbort = () => { clearTimeout(timer); sleepAbort = null; resolve(); };
});

const addViewLogButton = (row) => {
  row.el.logCell.innerHTML = '';
  const btn = document.createElement('button');
  btn.className = 'button';
  btn.type = 'button';
  btn.textContent = 'View';
  btn.addEventListener('click', async () => {
    try {
      await showLogModal(row.liveHost, row.log ?? '');
    } catch (e) {
      const p = document.createElement('p');
      p.className = 'error';
      p.setAttribute('role', 'alert');
      p.textContent = `Failed to open purge log: ${e.message || 'Failed to load the dialog.'}`;
      inputMessages.appendChild(p);
    }
  });
  row.el.logCell.appendChild(btn);
};

/**
 * Purges a single resolved row according to the given purge job snapshot.
 * @param {object} row
 * @param {{mode: string, presetIds: string[], customKeys: string[], paths: string[],
 *   purgeOrg: boolean, purgeHead: boolean}} job
 */
const purgeRow = async (row, job) => {
  setStatus(row, 'purging');
  try {
    let resp;
    if (job.mode === 'config') {
      resp = await purgeConfig(row.liveHost, job.purgeOrg, job.purgeHead);
    } else {
      const keys = job.mode === 'keys'
        ? buildKeys({ presetIds: job.presetIds, customKeys: job.customKeys }, row)
        : [];
      const paths = job.mode === 'paths' ? job.paths : [];
      resp = await purgeKeysOrPaths(row.liveHost, keys, paths);
    }
    if (handleAuthError(resp)) {
      row.log = 'Invalid authorization, please reload the page';
      setStatus(row, 'failed');
      stopRequested = true;
      return;
    }
    const text = await resp.text();
    row.log = text;
    if (!resp.ok) {
      setStatus(row, 'failed');
      return;
    }
    const { errors, warnings } = summarizePurgeLog(text);
    if (errors > 0) {
      setStatus(row, 'partial', `${errors} error(s)${warnings ? `, ${warnings} warning(s)` : ''}`);
    } else {
      setStatus(row, 'ok', warnings ? `${warnings} warning(s)` : undefined);
    }
  } catch (e) {
    row.log = e.message;
    setStatus(row, 'failed');
  } finally {
    addViewLogButton(row);
    downloadButton.disabled = false;
  }
};

const buildDownloadLog = (purgedRows, job) => {
  const header = `Bulk purge run: ${new Date().toISOString()}\nMode: ${job.mode}\n`
    + `Options: ${JSON.stringify(job)}\n\n`;
  const body = purgedRows
    .map((row) => `=== ${row.liveHost} (${row.status}) ===\n${row.log ?? ''}\n`)
    .join('\n');
  return header + body;
};

let lastJob = null;
let lastPurgedRows = [];

const onDownloadClick = () => {
  if (!lastPurgedRows.length) return;
  const text = buildDownloadLog(lastPurgedRows, lastJob ?? { mode: getMode() });
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `bulk-purge-${new Date().toISOString().replace(/[:.]/g, '-')}.log`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

const onPurgeClick = async () => {
  inputMessages.querySelectorAll('.purge-error').forEach((el) => el.remove());

  const validationError = validateSelection();
  if (validationError) {
    const p = document.createElement('p');
    p.className = 'error purge-error';
    p.textContent = validationError;
    inputMessages.appendChild(p);
    return;
  }

  const selected = getSelectedRows();
  if (!selected.length) {
    const p = document.createElement('p');
    p.className = 'error purge-error';
    p.textContent = 'Select at least one resolved site to purge.';
    inputMessages.appendChild(p);
    return;
  }

  if (!confirmPurge(selected)) return;

  const mode = getMode();
  const job = {
    mode,
    presetIds: getCheckedPresetIds(),
    customKeys: parseList(customKeysInput.value),
    paths: parsePaths(pathsInput.value).paths,
    purgeOrg: purgeOrgInput.checked,
    purgeHead: purgeHeadInput.checked,
  };

  running = true;
  stopRequested = false;
  setFormDisabled(true);
  stopButton.hidden = false;
  stopButton.disabled = false;
  lastJob = job;
  lastPurgedRows = [];

  try {
    for (let i = 0; i < selected.length; i += 1) {
      const row = selected[i];
      if (stopRequested) {
        setStatus(row, 'skipped');
      } else {
        progress.textContent = `Purging ${i + 1} / ${selected.length}: ${row.liveHost}`;
        // eslint-disable-next-line no-await-in-loop
        await purgeRow(row, job);
        lastPurgedRows.push(row);
        if (i < selected.length - 1 && !stopRequested) {
          // eslint-disable-next-line no-await-in-loop
          await sleep(Number(delayInput.value || 0) * 1000);
        }
      }
    }
    const counts = selected.reduce((acc, row) => {
      acc[row.status] = (acc[row.status] ?? 0) + 1;
      return acc;
    }, {});
    progress.textContent = `Done: ${counts.ok ?? 0} ok, ${counts.partial ?? 0} partial, `
      + `${counts.failed ?? 0} failed, ${counts.skipped ?? 0} skipped`;
  } finally {
    running = false;
    stopRequested = false;
    stopButton.hidden = true;
    setFormDisabled(false);
  }
};

const onStopClick = () => {
  stopRequested = true;
  stopButton.disabled = true;
  if (sleepAbort) sleepAbort();
};

async function init() {
  renderPresets();
  updatePanelVisibility();

  document.querySelectorAll('input[name="mode"]').forEach((el) => {
    el.addEventListener('change', () => {
      updatePanelVisibility();
      recomputeAllToPurge();
    });
  });
  presetsList.addEventListener('change', recomputeAllToPurge);
  customKeysInput.addEventListener('input', recomputeAllToPurge);
  pathsInput.addEventListener('input', recomputeAllToPurge);
  purgeOrgInput.addEventListener('change', recomputeAllToPurge);
  purgeHeadInput.addEventListener('change', recomputeAllToPurge);

  selectAllInput.addEventListener('change', () => {
    rows.forEach((row) => {
      if (!row.resolveError) row.el.checkbox.checked = selectAllInput.checked;
    });
  });

  resolveButton.addEventListener('click', onResolveClick);
  purgeButton.addEventListener('click', onPurgeClick);
  stopButton.addEventListener('click', onStopClick);
  downloadButton.addEventListener('click', onDownloadClick);

  updatePurgeButtonState();
  sampleRUM.enhance();
}

registerToolReady(init());
