import { registerToolReady } from '../../scripts/scripts.js';
import { initConfigField, updateConfig } from '../../utils/config/config.js';
import { loadIcon, icon, showToast } from '../../utils/card-ui/card-ui.js';
import {
  ensureSidekickLogin, fetchProfileEmail, ensureSecret, wacApi, wacApiWithProgress, fetchSiteConfig,
} from './session.js';
import {
  createModal, showConfirmDialog, promptForFolderName, promptForSecret,
} from './modal.js';
import openUploadModal from './upload-modal.js';
import showUploadProgress from './upload-progress.js';
import inspectZip from './zip.js';
import {
  containerMetaText,
  buildTree,
  getTreeNode,
  listChildEntries,
  editorPageUrl,
  toApiPath,
  displayPath,
  scopeToWacRoot,
  isZipFile,
  kebabFromZipName,
  isMixerConfigured,
  mixerConfigSnippet,
  escapeHtml,
} from './utils.js';

const ui = {
  connect: document.getElementById('wac-connect'),
  connectForm: document.getElementById('wac-connect-form'),
  connectError: document.getElementById('wac-connect-error'),
  connectSubmit: document.getElementById('wac-connect-submit'),
  org: document.getElementById('org'),
  site: document.getElementById('site'),
  workspace: document.getElementById('wac-workspace'),
  siteLabel: document.getElementById('wac-site-label'),
  breadcrumb: document.getElementById('wac-breadcrumb'),
  listStatus: document.getElementById('list-status'),
  list: document.getElementById('wac-list'),
  btnRefresh: document.getElementById('btn-refresh'),
  btnNewFolder: document.getElementById('btn-new-folder'),
  btnUpload: document.getElementById('btn-upload'),
  btnSwitchSite: document.getElementById('btn-switch-site'),
};

/** @type {{ org: string, site: string, email: string, secret: string } | null} */
let session = null;
let wacs = [];

function readFolderPath() {
  return new URLSearchParams(window.location.search).get('path') || '';
}

function writeFolderPath(folder) {
  const url = new URL(window.location.href);
  if (folder) url.searchParams.set('path', folder);
  else url.searchParams.delete('path');
  window.history.replaceState({}, document.title, url.href);
}

function showWorkspace() {
  ui.connect.hidden = true;
  ui.workspace.hidden = false;
  ui.siteLabel.textContent = `${session.org}/${session.site}`;
}

function showConnectForm() {
  ui.workspace.hidden = true;
  ui.connect.hidden = false;
  session = null;
  wacs = [];
}

function renderBreadcrumb(folder) {
  ui.breadcrumb.innerHTML = '';
  const parts = folder.split('/').filter(Boolean);

  const makeCrumb = (label, targetFolder, isCurrent) => {
    if (isCurrent) {
      const span = document.createElement('span');
      span.className = 'crumb current';
      span.textContent = label;
      return span;
    }
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'crumb';
    btn.textContent = label;
    // eslint-disable-next-line no-use-before-define -- breadcrumb/list/navigate recurse
    btn.addEventListener('click', () => navigateToFolder(targetFolder));
    return btn;
  };

  ui.breadcrumb.append(makeCrumb('Containers', '', parts.length === 0));
  parts.forEach((part, i) => {
    const sep = document.createElement('span');
    sep.className = 'crumb-sep';
    sep.textContent = '/';
    sep.setAttribute('aria-hidden', 'true');
    ui.breadcrumb.append(sep);
    const targetFolder = parts.slice(0, i + 1).join('/');
    ui.breadcrumb.append(makeCrumb(part, targetFolder, i === parts.length - 1));
  });
}

function closeRowMenu() {
  document.querySelector('.wac-row-menu')?.remove();
}

/**
 * @param {{ label: string, danger?: boolean, onClick: () => void|Promise<void> }[]} actions
 */
function openRowMenu(anchor, actions) {
  closeRowMenu();
  const menu = document.createElement('div');
  menu.className = 'wac-row-menu';
  const rect = anchor.getBoundingClientRect();
  menu.style.top = `${window.scrollY + rect.bottom + 4}px`;
  menu.style.left = `${window.scrollX + rect.right - 160}px`;

  actions.forEach(({ label, danger, onClick }) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    if (danger) btn.className = 'danger';
    btn.textContent = label;
    btn.addEventListener('click', () => {
      closeRowMenu();
      onClick();
    });
    menu.append(btn);
  });

  document.body.append(menu);

  const onOutsideClick = (e) => {
    if (!menu.contains(e.target)) {
      closeRowMenu();
      document.removeEventListener('click', onOutsideClick, true);
    }
  };
  document.addEventListener('click', onOutsideClick, true);
}

async function deleteAtPath(path, { isFolder = false } = {}) {
  const label = isFolder ? 'folder' : 'container';
  const ok = await showConfirmDialog(
    `Delete ${displayPath(path)}${isFolder ? ' and everything inside it' : ''}? This cannot be undone.`,
    { confirmText: `Delete ${label}`, danger: true },
  );
  if (!ok) return;
  try {
    await wacApi(session, promptForSecret, `/${session.org}/${session.site}/${toApiPath(path)}.wac`, { method: 'DELETE' });
    showToast(`${isFolder ? 'Folder' : 'Container'} deleted`);
    // eslint-disable-next-line no-use-before-define -- refreshList/renderList/openRowMenu recurse
    await refreshList();
  } catch (err) {
    showToast(err.message || 'Delete failed', 'error');
  }
}

function containerRowActions(wac) {
  return [
    {
      label: 'Delete…',
      danger: true,
      onClick: () => deleteAtPath(wac.path),
    },
  ];
}

function folderRowActions(folderPath) {
  return [
    {
      label: 'Delete folder…',
      danger: true,
      onClick: () => deleteAtPath(folderPath, { isFolder: true }),
    },
  ];
}

function folderIcon() {
  const span = document.createElement('span');
  span.className = 'row-icon icon';
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = icon('folder');
  return span;
}

function fileIcon() {
  const span = document.createElement('span');
  span.className = 'row-icon icon';
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = icon('file-text');
  return span;
}

function renderFolderRow(entry, folder) {
  const folderPath = folder ? `${folder}/${entry.name}` : entry.name;

  const row = document.createElement('div');
  row.className = 'wac-row folder-row';
  const link = document.createElement('button');
  link.type = 'button';
  link.className = 'row-link';
  const name = document.createElement('span');
  name.className = 'row-name';
  name.textContent = entry.name;
  const chevron = document.createElement('span');
  chevron.className = 'row-chevron';
  chevron.setAttribute('aria-hidden', 'true');
  chevron.textContent = '›';
  link.append(folderIcon(), name, chevron);
  link.addEventListener('click', () => {
    // eslint-disable-next-line no-use-before-define -- list/folder-row/navigate recurse
    navigateToFolder(folderPath);
  });

  const menuBtn = document.createElement('button');
  menuBtn.type = 'button';
  menuBtn.className = 'row-menu-btn';
  menuBtn.setAttribute('aria-label', `Actions for ${entry.name}`);
  menuBtn.textContent = '⋯';
  menuBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    openRowMenu(menuBtn, folderRowActions(folderPath));
  });

  row.append(link, menuBtn);
  return row;
}

function renderContainerRow(entry) {
  const row = document.createElement('div');
  row.className = 'wac-row container-row';
  const link = document.createElement('a');
  link.className = 'row-link';
  link.href = editorPageUrl(window.location.origin, session.org, session.site, entry.wac.path);
  const name = document.createElement('span');
  name.className = 'row-name';
  name.textContent = entry.name;
  const meta = document.createElement('span');
  meta.className = 'row-meta';
  meta.textContent = containerMetaText(entry.wac);
  link.append(fileIcon(), name, meta);

  const menuBtn = document.createElement('button');
  menuBtn.type = 'button';
  menuBtn.className = 'row-menu-btn';
  menuBtn.setAttribute('aria-label', `Actions for ${entry.name}`);
  menuBtn.textContent = '⋯';
  menuBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    openRowMenu(menuBtn, containerRowActions(entry.wac));
  });

  row.append(link, menuBtn);
  return row;
}

function renderList() {
  const folder = readFolderPath();
  renderBreadcrumb(folder);

  ui.list.innerHTML = '';
  const root = buildTree(wacs);
  const node = getTreeNode(root, folder);
  const entries = listChildEntries(node);

  if (!entries.length) {
    ui.list.innerHTML = folder
      ? '<p class="list-empty">No containers here yet.</p>'
      : '<p class="list-empty">No Web Asset Containers yet. Upload a zip to create one.</p>';
    return;
  }

  entries.forEach((entry) => {
    ui.list.append(entry.isContainer ? renderContainerRow(entry) : renderFolderRow(entry, folder));
  });
}

function navigateToFolder(folder) {
  writeFolderPath(folder);
  renderList();
}

async function refreshList() {
  ui.listStatus.textContent = 'Loading…';
  ui.listStatus.classList.remove('bad');
  try {
    const data = await wacApi(session, promptForSecret, `/${session.org}/${session.site}/index.json`);
    wacs = scopeToWacRoot(data.wacs);
    ui.listStatus.textContent = '';
    renderList();
  } catch (err) {
    ui.listStatus.textContent = 'Failed to load';
    ui.listStatus.classList.add('bad');
    showToast(err.message || 'Failed to load containers', 'error');
  }
}

/**
 * Warn that a site's published config has no mixerConfig routing
 * `/wac/**` to the WAC worker, with instructions for adding it via the
 * admin-edit tool. Resolves true if the user wants to proceed anyway.
 * @param {string} org
 * @param {string} site
 * @returns {Promise<boolean>}
 */
function showMixerConfigWarning(org, site) {
  return new Promise((resolve) => {
    const {
      dialog, body, footer, closeModal,
    } = createModal('Site not set up for WAC', { className: 'mixer-warning-modal' });
    const snippet = JSON.stringify(mixerConfigSnippet(org, site), null, 2);

    body.innerHTML = `
      <p>
        <strong>${escapeHtml(org)}/${escapeHtml(site)}</strong> doesn't look set up to serve Web Asset
        Containers yet — its published configuration has no <code>mixerConfig</code> routing
        <code>/wac/**</code> to the WAC worker.
      </p>
      <details id="mixer-instructions">
        <summary>Show instructions</summary>
        <ol>
          <li>
            Open <a href="/tools/admin-edit/index.html" target="_blank" rel="noopener noreferrer">admin-edit</a>
            on tools.aem.live.
          </li>
          <li>
            Type <code>${escapeHtml(org)}</code> into the Admin URL field, pick the
            <strong>Site Config</strong> suggestion for <code>${escapeHtml(site)}</code>, and click Fetch.
          </li>
          <li>
            Merge the following into the document's <code>public</code> key (admin-edit saves the
            whole document as-is, so don't remove anything else already there):
          </li>
        </ol>
        <pre id="mixer-snippet">${escapeHtml(snippet)}</pre>
        <p class="button-wrapper">
          <button type="button" class="button outline" id="mixer-copy">Copy snippet</button>
        </p>
        <ol start="4">
          <li>Click Save.</li>
        </ol>
      </details>
    `;

    body.querySelector('#mixer-copy').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(snippet);
        showToast('Snippet copied');
      } catch {
        showToast('Could not copy — select and copy manually', 'error');
      }
    });

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'button outline';
    cancelBtn.textContent = 'Cancel';
    const continueBtn = document.createElement('button');
    continueBtn.type = 'button';
    continueBtn.className = 'button';
    continueBtn.textContent = 'Continue anyway';
    footer.append(cancelBtn, continueBtn);

    const finish = (result) => { closeModal(); resolve(result); };
    cancelBtn.addEventListener('click', () => finish(false));
    continueBtn.addEventListener('click', () => finish(true));
    dialog.addEventListener('cancel', () => resolve(false), { once: true });
  });
}

ui.connectForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  ui.connectError.textContent = '';
  const org = ui.org.value.trim();
  const site = ui.site.value.trim();
  if (!org || !site) return;

  ui.connectSubmit.disabled = true;
  ui.connectSubmit.textContent = 'Connecting…';
  try {
    const folder = readFolderPath(); // updateConfig() below clears the whole query string

    // Checked first, before sidekick login — it's an unauthenticated read
    // of the site's published config, so there's no reason to make the
    // user sign in first if the site isn't even set up for WAC.
    const config = await fetchSiteConfig(org, site);
    if (!isMixerConfigured(config, org, site)) {
      const proceed = await showMixerConfigWarning(org, site);
      if (!proceed) return;
    }

    const signedIn = await ensureSidekickLogin(org, site);
    if (!signedIn) {
      ui.connectError.textContent = 'Sign-in was cancelled.';
      return;
    }

    const email = await fetchProfileEmail(org, site);
    session = {
      org, site, email, secret: null,
    };
    if (!(await ensureSecret(session, promptForSecret))) {
      session = null;
      ui.connectError.textContent = 'Sign-in was cancelled.';
      return;
    }
    updateConfig();
    writeFolderPath(folder);
    showWorkspace();
    await refreshList();
  } catch (err) {
    ui.connectError.textContent = err.message || 'Failed to connect';
  } finally {
    ui.connectSubmit.disabled = false;
    ui.connectSubmit.textContent = 'Connect';
  }
});

async function openUploadForCurrentFolder() {
  const folder = readFolderPath();
  const result = await openUploadModal(session, {
    pathPrefix: folder ? `${folder}/` : '',
    existingPaths: wacs.map((w) => w.path),
  });
  if (result) await refreshList();
}

/**
 * Upload a dropped zip immediately — no review modal, just a progress bar
 * — since dragging a file onto the list is a single, deliberate gesture.
 * The container is named after the zip and lands in the current folder;
 * an existing container at that path still gets a quick overwrite
 * confirmation (unlike the review modal, which this replaces). If the zip
 * has no index.html, the first HTML file found is used as the default
 * page — no picker.
 */
async function uploadFileDirectly(file) {
  if (!isZipFile(file)) {
    showToast('Not a zip file', 'error');
    return;
  }

  const folder = readFolderPath();
  const pathPrefix = folder ? `${folder}/` : '';

  let inspected;
  try {
    inspected = await inspectZip(file);
  } catch (err) {
    showToast(err.message || 'Invalid zip', 'error');
    return;
  }

  let defaultAsset = null;
  if (!inspected.hasIndex) {
    [defaultAsset] = inspected.files.filter((f) => /\.html?$/i.test(f));
    if (!defaultAsset) {
      showToast('Zip has no HTML files', 'error');
      return;
    }
  }

  const path = `${pathPrefix}${kebabFromZipName(file.name)}`;
  if (wacs.some((w) => w.path === path)) {
    const overwrite = await showConfirmDialog(
      `A container already exists at ${displayPath(path)}. Overwrite it?`,
      { confirmText: 'Overwrite', danger: true },
    );
    if (!overwrite) return;
  }

  const progress = showUploadProgress(file.name);
  try {
    const headers = { 'Content-Type': 'application/zip' };
    if (defaultAsset) headers['X-WAC-Default'] = defaultAsset;
    await wacApiWithProgress(session, promptForSecret, `/${session.org}/${session.site}/${toApiPath(path)}.wac`, {
      method: 'POST',
      headers,
      body: inspected.bytes,
      onProgress: progress.update,
    });
    progress.done();
    await refreshList();
  } catch (err) {
    progress.fail(err.message);
  }
}

ui.btnSwitchSite.addEventListener('click', showConnectForm);
ui.btnRefresh.addEventListener('click', () => refreshList());
ui.btnUpload.addEventListener('click', () => openUploadForCurrentFolder());

ui.btnNewFolder.addEventListener('click', async () => {
  const folder = readFolderPath();
  const name = await promptForFolderName(displayPath(folder));
  if (!name) return;
  navigateToFolder(folder ? `${folder}/${name}` : name);
});

// Let a zip be dropped anywhere on the list, not just inside the upload
// modal's own dropzone — it uploads immediately with a progress bar
// (see uploadFileDirectly()) instead of opening the review modal.
function hasFilePayload(e) {
  return [...(e.dataTransfer?.types || [])].includes('Files');
}

function canAcceptDrop() {
  return !!session && !ui.workspace.hidden && !document.querySelector('dialog.wac-modal');
}

let dragDepth = 0;

window.addEventListener('dragenter', (e) => {
  if (!canAcceptDrop() || !hasFilePayload(e)) return;
  e.preventDefault();
  dragDepth += 1;
  ui.workspace.classList.add('drag-over');
});

window.addEventListener('dragover', (e) => {
  if (!canAcceptDrop() || !hasFilePayload(e)) return;
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
});

window.addEventListener('dragleave', () => {
  if (!canAcceptDrop()) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) ui.workspace.classList.remove('drag-over');
});

window.addEventListener('drop', async (e) => {
  dragDepth = 0;
  ui.workspace.classList.remove('drag-over');
  if (!canAcceptDrop() || !hasFilePayload(e)) return;
  e.preventDefault();
  const file = e.dataTransfer?.files?.[0];
  if (file) await uploadFileDirectly(file);
});

async function init() {
  await Promise.all([
    initConfigField(),
    ...['folder', 'file-text', 'refresh'].map(loadIcon),
  ]);

  // Auto-connect when org/site were supplied as URL query params (as
  // opposed to being autofilled from localStorage or the sidekick) —
  // initConfigField() tags the field with how it was filled.
  if (ui.org.dataset.autofill === 'params' && ui.site.dataset.autofill === 'params') {
    ui.connectForm.requestSubmit();
  }
}

registerToolReady(init());
