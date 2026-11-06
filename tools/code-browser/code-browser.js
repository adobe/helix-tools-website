import { registerToolReady } from '../../scripts/scripts.js';
import { initConfigField, updateConfig } from '../../utils/config/config.js';
import {
  codeRoot, codeURL, parseBranches, parseListing, filterEntries, folderBreadcrumbs, liveURL,
} from './utils.js';

const form = document.getElementById('code-browser-form');
const configFields = document.getElementById('config-fields');
const org = document.getElementById('org');
const site = document.getElementById('site');
const workspace = document.getElementById('browser-workspace');
const status = document.getElementById('browser-status');
const error = document.getElementById('browser-error');
const branch = document.getElementById('branch');
const filter = document.getElementById('filter');
const entriesBody = document.getElementById('entries');
const downloadZip = document.getElementById('download-zip');
const DOWNLOAD_CONCURRENCY = 40;

let root;
let folder;
let entries = [];
let busy = false;

async function getJSON(url, signal) {
  const response = await fetch(codeURL(url, root), {
    method: 'GET',
    credentials: 'include',
    redirect: 'error',
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(60000)])
      : AbortSignal.timeout(60000),
  });
  if (!response.ok) {
    const messages = {
      401: 'Sign in to this organization with AEM Sidekick, then try again.',
      403: 'You do not have permission to read this codebus repository.',
      404: 'No code was found at this path. Check the organization, site, and branch.',
      429: 'Too many requests. Wait a moment, then try again.',
    };
    const reason = messages[response.status] || response.headers.get('x-error') || response.statusText;
    throw new Error(`Code API ${response.status}: ${reason}`);
  }
  return response.json();
}

function renderEntries() {
  const visible = filterEntries(entries, filter.value);
  const rows = visible.map((entry) => {
    const row = document.createElement('tr');
    const nameCell = document.createElement('td');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'entry-button';
    button.textContent = `${entry.name}${entry.type === 'folder' ? '/' : ''}`;
    button.dataset.url = entry.url;
    button.dataset.type = entry.type;
    button.disabled = busy;
    nameCell.append(button);
    row.append(nameCell);
    const modified = entry.lastModified ? new Date(entry.lastModified) : null;
    const values = [
      entry.type === 'folder' ? 'Folder' : entry.contentType || 'File',
      typeof entry.size === 'number' ? `${entry.size.toLocaleString()} B` : '-',
      modified && !Number.isNaN(modified.getTime()) ? modified.toLocaleString() : '-',
    ];
    values.forEach((value) => {
      const cell = document.createElement('td');
      cell.textContent = value;
      row.append(cell);
    });
    return row;
  });
  entriesBody.replaceChildren(...rows);
  document.getElementById('entry-count').textContent = `${visible.length} shown / ${entries.length} entries${visible.length ? '' : ' - No matching entries.'}`;
}

function renderBreadcrumbs() {
  const nav = document.getElementById('breadcrumbs');
  const crumbs = folderBreadcrumbs(folder, branch.value).map((crumb, index, all) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = crumb.name;
    button.dataset.url = crumb.url;
    if (index === all.length - 1) button.setAttribute('aria-current', 'page');
    return button;
  });
  nav.replaceChildren(...crumbs);
}

async function listFolder(url) {
  const allEntries = new Map();
  const seenCursors = new Set();
  let cursor = null;
  do {
    const requestURL = codeURL(url, root);
    requestURL.searchParams.set('limit', '1000');
    if (cursor) requestURL.searchParams.set('cursor', cursor);
    // Pages are sequential because each response supplies the next cursor.
    // eslint-disable-next-line no-await-in-loop
    const data = parseListing(await getJSON(requestURL.href), url, root);
    data.entries.forEach((entry) => allEntries.set(entry.url, entry));
    cursor = data.cursor;
    if (cursor) {
      if (seenCursors.has(cursor)) {
        throw new Error('The code API returned a repeated pagination cursor. Refresh the folder.');
      }
      seenCursors.add(cursor);
    }
    status.textContent = `Loading folder... ${allEntries.size} entries found.`;
  } while (cursor);
  return [...allEntries.values()];
}

async function loadFolder(url) {
  const listing = await listFolder(url);
  folder = url;
  entries = listing;
  filter.value = '';
  renderBreadcrumbs();
  renderEntries();
}

async function downloadBranch() {
  const { zipSync } = await import('../../vendor/fflate/fflate.js');
  const branchURL = branch.value;
  const branchPath = new URL(branchURL).pathname;
  const project = new URL(root).pathname.split('/');
  const branchName = decodeURIComponent(branchPath.slice(new URL(root).pathname.length).replace(/\/$/, ''));
  const archiveName = `${project[1]}-${project[3]}-${branchName}`;
  const folders = [{ url: branchURL, path: '' }];
  const files = Object.create(null);
  const downloads = [];
  while (folders.length) {
    const current = folders.pop();
    // Discover folders sequentially; file downloads use a bounded worker pool below.
    // eslint-disable-next-line no-await-in-loop
    const listing = await listFolder(current.url);
    for (let index = 0; index < listing.length; index += 1) {
      const entry = listing[index];
      const path = `${current.path}${entry.name}`;
      const archivePath = `${archiveName}/${path}`;
      if (entry.type === 'folder') {
        files[`${archivePath}/`] = new Uint8Array(0);
        folders.push({ url: entry.url, path: `${path}/` });
      } else {
        downloads.push({ url: entry.url, path, archivePath });
      }
    }
  }
  if (!downloads.length) throw new Error('This branch has no non-hidden files to download.');
  const controller = new AbortController();
  let nextIndex = 0;
  let count = 0;
  let failure;
  async function worker() {
    while (!controller.signal.aborted && nextIndex < downloads.length) {
      const entry = downloads[nextIndex];
      nextIndex += 1;
      let { url } = entry;
      let fetchingLive = false;
      try {
        // Each worker completes one file before claiming another.
        // eslint-disable-next-line no-await-in-loop
        url = liveURL(await getJSON(entry.url, controller.signal));
        fetchingLive = true;
        // Do not send API credentials to the live host.
        // eslint-disable-next-line no-await-in-loop
        const response = await fetch(url, {
          credentials: 'omit',
          redirect: 'error',
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(60000)]),
        });
        if (!response.ok) throw new Error(`Live URL returned HTTP ${response.status}.`);
        // eslint-disable-next-line no-await-in-loop
        files[entry.archivePath] = new Uint8Array(await response.arrayBuffer());
        count += 1;
        status.textContent = `Downloading branch... ${count} / ${downloads.length} files downloaded.`;
      } catch (err) {
        if (!failure) {
          const hint = fetchingLive && err instanceof TypeError
            ? 'This may be a CORS issue or a network failure. If the browser console reports CORS blocking, install a trusted CORS-unblocking extension (CORS blocker), enable it only for this download, then disable it afterward.'
            : 'Check network access and the host response.';
          failure = new Error(`Could not download ${entry.path} from ${url}. ${hint} ${err.message}`);
          controller.abort();
        }
      }
    }
  }
  status.textContent = `Downloading branch... 0 / ${downloads.length} files downloaded.`;
  await Promise.all(Array.from(
    { length: Math.min(DOWNLOAD_CONCURRENCY, downloads.length) },
    () => worker(),
  ));
  if (failure) throw failure;
  status.textContent = `Creating ZIP with ${count} files...`;
  // Store bytes without recompression to keep ZIP creation responsive.
  const blob = new Blob([zipSync(files, { level: 0 })], { type: 'application/zip' });
  const href = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = href;
  link.download = `${archiveName}.zip`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(href), 60000);
}

async function run(action, message) {
  if (busy) return;
  busy = true;
  error.hidden = true;
  status.textContent = message;
  workspace.setAttribute('aria-busy', 'true');
  configFields.disabled = true;
  workspace.querySelectorAll('button, select').forEach((control) => { control.disabled = true; });
  try {
    await action();
    status.textContent = 'Ready.';
  } catch (err) {
    error.textContent = err.message;
    error.hidden = false;
    status.textContent = 'Request failed. Please try again.';
  } finally {
    busy = false;
    configFields.disabled = false;
    site.disabled = !org.value.trim();
    workspace.setAttribute('aria-busy', 'false');
    workspace.querySelectorAll('button, select').forEach((control) => { control.disabled = false; });
    branch.disabled = branch.options.length === 0;
    downloadZip.disabled = branch.options.length === 0;
    document.getElementById('refresh').disabled = !folder;
  }
}

async function init() {
  entriesBody.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-url]');
    if (!button || busy) return;
    const { url } = button.dataset;
    if (button.dataset.type === 'folder') {
      run(() => loadFolder(url), 'Loading folder...');
    } else {
      run(async () => {
        const data = await getJSON(url);
        window.location.assign(liveURL(data));
      }, 'Opening file...');
    }
  });
  document.getElementById('breadcrumbs').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-url]');
    if (button) run(() => loadFolder(button.dataset.url), 'Loading folder...');
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    run(async () => {
      workspace.hidden = true;
      folder = null;
      entries = [];
      filter.value = '';
      org.value = org.value.trim();
      site.value = site.value.trim();
      root = codeRoot(org.value, site.value);
      const branches = parseBranches(await getJSON(root), root);
      updateConfig();
      branch.replaceChildren(...branches.map((item) => {
        const option = document.createElement('option');
        option.value = item.url;
        option.textContent = item.name;
        return option;
      }));
      document.getElementById('project-title').textContent = `${org.value} / ${site.value}`;
      if (!branches.length) {
        document.getElementById('entry-count').textContent = 'No branches are stored in codebus.';
        entriesBody.replaceChildren();
        document.getElementById('breadcrumbs').replaceChildren();
      } else {
        branch.value = branches.find((item) => item.name === 'main')?.url || branches[0].url;
        await loadFolder(branch.value);
      }
      workspace.hidden = false;
    }, 'Loading codebus branches...');
  });
  branch.addEventListener('change', () => {
    const selected = branch.value;
    const previous = folder ? folderBreadcrumbs(folder, root)[1]?.url : null;
    run(async () => {
      try {
        await loadFolder(selected);
      } catch (err) {
        if (previous) branch.value = previous;
        throw err;
      }
    }, 'Loading branch...');
  });
  document.getElementById('refresh').addEventListener('click', () => {
    run(() => loadFolder(folder), 'Refreshing folder...');
  });
  downloadZip.addEventListener('click', () => run(downloadBranch, 'Preparing branch ZIP...'));
  filter.addEventListener('input', renderEntries);
  org.addEventListener('input', () => { site.disabled = !org.value.trim(); });
  await initConfigField();
}

registerToolReady(init());
