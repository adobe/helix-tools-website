import { fetchProfileEmail, ensureSecret, wacApi } from './session.js';
import { promptForSecret } from './modal.js';
import {
  deliveryUrl,
  htmlFilesForWac,
  pickDefaultHtmlFile,
  buildMagicBannerClipboard,
  escapeHtml,
  parentFolder,
  browsePageUrl,
  toApiPath,
  displayPath,
  scopeToWacRoot,
} from './utils.js';

const ui = {
  backWrapper: document.getElementById('wac-editor-back-wrapper'),
  status: document.getElementById('wac-editor-status'),
  panelToggle: document.getElementById('panel-toggle'),
  panelBody: document.getElementById('panel-body'),
  preview: document.getElementById('preview'),
  previewFile: document.getElementById('preview-file'),
  btnOpen: document.getElementById('btn-open'),
  contentText: document.getElementById('content-text'),
  contentStatus: document.getElementById('content-status'),
  btnCopyBlock: document.getElementById('btn-copy-block'),
};

/** @type {{ org: string, site: string, email: string, secret: string } | null} */
let session = null;
let wac = null;
let previewBaseUrl = null;
let originalContentText = null;
let contentLoadToken = 0;
let contentReloadTimer = 0;

function readParams() {
  const params = new URLSearchParams(window.location.search);
  return {
    org: params.get('org') || '',
    site: params.get('site') || '',
    path: params.get('path') || '',
  };
}

function setBackLink(org, site, folder) {
  ui.backWrapper.querySelector('a').href = browsePageUrl(window.location.origin, org, site, folder);
}

function setPanelOpen(open) {
  document.body.classList.toggle('panel-collapsed', !open);
  ui.panelToggle.setAttribute('aria-expanded', String(open));
  ui.panelToggle.textContent = open ? '‹' : '›';
}

ui.panelToggle.addEventListener('click', () => {
  setPanelOpen(document.body.classList.contains('panel-collapsed'));
});

function htmlToPlainLines(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script, style, noscript, template, svg').forEach((el) => el.remove());
  const root = doc.body || doc.documentElement;
  if (!root) return [];

  const blockSelector = [
    'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'li', 'dt', 'dd', 'blockquote', 'pre', 'figcaption',
    'th', 'td', 'caption', 'summary', 'address',
    'span', 'div', 'a', 'label', 'button',
  ].join(',');

  const lines = [];
  root.querySelectorAll(blockSelector).forEach((el) => {
    if (el.querySelector(blockSelector)) return;
    const text = (el.textContent || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
    if (text) lines.push(text);
  });

  if (!lines.length) {
    return (root.textContent || '')
      .replace(/\u00a0/g, ' ')
      .split(/\r?\n/)
      .map((l) => l.replace(/\s+/g, ' ').trim())
      .filter(Boolean);
  }
  return lines;
}

async function loadHtmlFileContent(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Failed to fetch ${url} (${res.status})`);
  const html = await res.text();
  return htmlToPlainLines(html).join('\n');
}

function applyContentPreview(text) {
  if (!previewBaseUrl) return;
  const trimmed = String(text || '');
  if (!trimmed.trim()) {
    ui.preview.src = previewBaseUrl;
    return;
  }
  const next = new URL(previewBaseUrl);
  next.searchParams.set('content', trimmed);
  ui.preview.src = next.href;
}

function scheduleContentPreview() {
  window.clearTimeout(contentReloadTimer);
  contentReloadTimer = window.setTimeout(() => {
    applyContentPreview(ui.contentText.value);
  }, 350);
}

function populatePreviewFileSelect(htmlFiles, selected) {
  if (!htmlFiles.length) {
    ui.previewFile.innerHTML = '<option value="">(no .html files listed)</option>';
    ui.previewFile.disabled = true;
    return;
  }
  ui.previewFile.innerHTML = htmlFiles.map((f) => `<option value="${escapeHtml(f)}">${escapeHtml(f)}</option>`).join('');
  ui.previewFile.value = selected || htmlFiles[0];
  ui.previewFile.disabled = false;
}

function showPreviewFile(filePath) {
  const url = deliveryUrl(session.org, session.site, toApiPath(wac.path), filePath);
  previewBaseUrl = url;
  originalContentText = null;
  contentLoadToken += 1;
  const token = contentLoadToken;

  ui.preview.hidden = false;
  ui.btnOpen.disabled = false;
  ui.contentText.disabled = true;
  ui.contentText.value = '';
  ui.contentStatus.textContent = 'Loading…';
  ui.contentStatus.className = 'status';
  ui.btnCopyBlock.disabled = true;
  ui.preview.src = url;

  loadHtmlFileContent(url).then((text) => {
    if (token !== contentLoadToken) return;
    originalContentText = text;
    ui.contentText.value = text;
    ui.contentText.disabled = false;
    ui.btnCopyBlock.disabled = false;
    ui.contentStatus.textContent = '';
  }).catch((err) => {
    if (token !== contentLoadToken) return;
    originalContentText = '';
    ui.contentText.value = '';
    ui.contentText.disabled = false;
    ui.btnCopyBlock.disabled = false;
    ui.contentStatus.textContent = 'Load failed';
    ui.contentStatus.className = 'status bad';
    // eslint-disable-next-line no-console
    console.error(err);
  });
}

/**
 * Put HTML + plain text on the clipboard so Docs/DA keep the table.
 */
async function copyRichClipboard(html, plain) {
  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    const item = new ClipboardItem({
      'text/html': new Blob([html], { type: 'text/html' }),
      'text/plain': new Blob([plain], { type: 'text/plain' }),
    });
    await navigator.clipboard.write([item]);
    return;
  }
  const host = document.createElement('div');
  host.setAttribute('contenteditable', 'true');
  host.style.cssText = 'position:fixed;left:-9999px;top:0;';
  host.innerHTML = html;
  document.body.appendChild(host);
  const range = document.createRange();
  range.selectNodeContents(host);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  const ok = document.execCommand('copy');
  sel.removeAllRanges();
  host.remove();
  if (!ok) throw new Error('Clipboard unavailable');
}

ui.previewFile.addEventListener('change', () => {
  window.clearTimeout(contentReloadTimer);
  showPreviewFile(ui.previewFile.value || null);
});

ui.btnOpen.addEventListener('click', () => {
  if (!previewBaseUrl) return;
  const text = ui.contentText.value;
  const unchanged = originalContentText != null && text === originalContentText;
  if (!unchanged && text.trim()) {
    const next = new URL(previewBaseUrl);
    next.searchParams.set('content', text);
    window.open(next.href, '_blank', 'noopener');
    return;
  }
  window.open(previewBaseUrl, '_blank', 'noopener');
});

ui.contentText.addEventListener('input', () => {
  if (!previewBaseUrl || ui.contentText.disabled) return;
  ui.contentStatus.textContent = '';
  ui.contentStatus.className = 'status';
  scheduleContentPreview();
});

ui.btnCopyBlock.addEventListener('click', async () => {
  if (!previewBaseUrl) return;
  ui.btnCopyBlock.disabled = true;
  ui.btnCopyBlock.textContent = 'Copying…';
  try {
    const current = ui.contentText.value;
    const unchanged = originalContentText != null && current === originalContentText;
    const { html, plain } = buildMagicBannerClipboard(unchanged ? '' : current, previewBaseUrl);
    await copyRichClipboard(html, plain);
    ui.btnCopyBlock.textContent = 'Copied';
    setTimeout(() => {
      ui.btnCopyBlock.textContent = 'Copy block';
      ui.btnCopyBlock.disabled = !previewBaseUrl;
    }, 1200);
  } catch (err) {
    ui.btnCopyBlock.textContent = 'Copy failed';
    ui.contentStatus.textContent = err.message || 'Copy failed';
    ui.contentStatus.className = 'status bad';
    ui.btnCopyBlock.disabled = !previewBaseUrl;
  }
});

async function init() {
  const { org, site, path } = readParams();
  setBackLink(org, site, parentFolder(path));

  if (!org || !site || !path) {
    ui.status.textContent = 'Missing org, site, or container path — go back and pick a container to open.';
    ui.status.classList.add('bad');
    return;
  }

  document.title = `${displayPath(path)} — Web Asset Container`;
  ui.status.textContent = 'Connecting…';

  // This page is only ever reached via a link generated by the browse page
  // (tools/wac/), which already gates the regular sidekick org/site
  // sign-in — so here we only need the shared secret, not another sidekick
  // challenge (which also wouldn't have anywhere to render: this page has
  // no header/profile block).
  const email = await fetchProfileEmail(org, site);
  session = {
    org, site, email, secret: null,
  };
  const ok = await ensureSecret(session, promptForSecret);
  if (!ok) {
    ui.status.textContent = 'Sign-in was cancelled.';
    return;
  }

  ui.status.textContent = 'Loading…';
  let data;
  try {
    data = await wacApi(session, promptForSecret, `/${org}/${site}/index.json`);
  } catch (err) {
    ui.status.textContent = err.message || 'Failed to load container';
    ui.status.classList.add('bad');
    return;
  }

  wac = scopeToWacRoot(data.wacs).find((w) => w.path === path);
  if (!wac) {
    ui.status.textContent = `Container not found: ${displayPath(path)}`;
    ui.status.classList.add('bad');
    return;
  }

  ui.status.textContent = '';
  ui.panelBody.hidden = false;

  const htmlFiles = htmlFilesForWac(wac);
  const initial = pickDefaultHtmlFile(wac, htmlFiles);
  populatePreviewFileSelect(htmlFiles, initial);
  showPreviewFile(initial);
}

init();
