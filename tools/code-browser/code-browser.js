import { registerToolReady } from '../../scripts/scripts.js';
import { initConfigField, updateConfig } from '../../utils/config/config.js';
import { saveDownload } from '../../utils/zip-download.js';
import { getCodeJSON, listCodeFolder, zipCodeBranch } from './code-api.js';
import {
  codeRoot, parseBranches, filterEntries, folderBreadcrumbs, liveURL,
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

let root;
let folder;
let entries = [];
let busy = false;

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

async function loadFolder(url) {
  const listing = await listCodeFolder(url, root, (count) => {
    status.textContent = `Loading folder... ${count} entries found.`;
  });
  folder = url;
  entries = listing;
  filter.value = '';
  renderBreadcrumbs();
  renderEntries();
}

async function downloadBranch() {
  const { blob, filename } = await zipCodeBranch(root, branch.value, (message) => {
    status.textContent = message;
  });
  saveDownload(blob, filename);
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
        const data = await getCodeJSON(url, root);
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
      const branches = parseBranches(await getCodeJSON(root, root), root);
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
