import { registerToolReady } from '../../scripts/scripts.js';
import { logResponse } from '../../blocks/console/console.js';
import { coordsFromURL } from '../../scripts/admin-compat.js';
import h6Admin from '../../scripts/aem-admin.js';
import { executeAdminRequest, AuthMode } from '../../utils/admin-request.js';
import adminForURL, { movedToH6 } from './utils.js';

const adminForm = document.getElementById('admin-form');
const adminURL = document.getElementById('admin-url');
const adminURLList = document.getElementById('admin-url-list');
const bodyForm = document.getElementById('body-form');
const editorEl = document.getElementById('editor');
const editorLabel = document.getElementById('editor-label');
const reqMethod = document.getElementById('method');
const methodDropdown = document.querySelector('.picker-field ul');
const methodOptions = methodDropdown.querySelectorAll('li');
const consoleBlock = document.querySelector('.console');
const saveButton = document.getElementById('save');
const apiUpgradeHint = document.querySelector('.api-upgrade-hint');

let editorPromise;

/**
 * @returns {'json'|'yaml'}
 */
function currentLanguage() {
  return adminURL.value && adminURL.value.endsWith('.yaml') ? 'yaml' : 'json';
}

/**
 * Updates the save button state based on the editor contents. YAML endpoints
 * bypass parse validation (mirroring the previous tool's behavior).
 * @param {string} doc - Current editor document
 */
function updateSaveState(doc) {
  if (!doc.trim() || currentLanguage() === 'yaml') {
    saveButton.disabled = false;
    return;
  }
  try {
    JSON.parse(doc);
    saveButton.disabled = false;
  } catch {
    saveButton.disabled = true;
  }
}

/**
 * Lazily loads the CodeMirror bundle and creates the editor on first
 * interaction. Subsequent calls return the same instance. On failure the
 * promise is cleared so a subsequent interaction can retry.
 */
function ensureEditor() {
  if (!editorPromise) {
    editorPromise = import('../../vendor/codemirror/codemirror.js')
      .then(({ default: createEditor }) => createEditor({
        parent: editorEl,
        doc: '',
        language: currentLanguage(),
        onChange: updateSaveState,
        labelledBy: editorLabel.id,
        describedBy: 'editor-hint',
      }))
      .catch((err) => {
        editorPromise = null;
        // eslint-disable-next-line no-console
        console.error('Failed to load CodeMirror', err);
        logResponse(consoleBlock, 0, ['EDITOR LOAD', '', err.message || String(err)]);
        throw err;
      });
  }
  return editorPromise;
}

/**
 * Updates the admin URL datalist with well-known config locations.
 * @param {{org: string|null, site: string|null}} coords
 */
function updateAdminURLSuggestions({ org, site }) {
  if (!org) {
    adminURLList.innerHTML = '';
    return;
  }
  adminURLList.innerHTML = adminForURL(adminURL.value).suggestions({ org, site })
    .map(({ url, label }) => `<option value="${url}" label="${label}"></option>`)
    .join('');
}

/**
 * Blocks H5 requests for sites already upgraded to the AEM API, showing a
 * hint under the URL field. Also blocks when the upgrade check itself fails.
 * @returns {Promise<boolean>} true if the request may proceed
 */
async function checkAPIUpgrade() {
  let moved;
  try {
    moved = await movedToH6(adminURL.value);
  } catch {
    apiUpgradeHint.textContent = 'Could not check whether this site has been upgraded to the AEM API.';
    apiUpgradeHint.hidden = false;
    return false;
  }
  if (!moved) {
    apiUpgradeHint.hidden = true;
    return true;
  }
  const link = document.createElement('a');
  link.href = 'https://www.aem.live/docs/api.html';
  link.target = '_blank';
  link.textContent = 'aem.live/docs/api';
  apiUpgradeHint.replaceChildren(
    'This site has been upgraded to the AEM API, please use that endpoint instead. (',
    link,
    ')',
  );
  apiUpgradeHint.hidden = false;
  return false;
}

async function init() {
  adminURL.value = localStorage.getItem('admin-url') || h6Admin.status({ org: 'adobe', site: 'aem-boilerplate' }).url;

  updateAdminURLSuggestions(coordsFromURL(adminURL.value));

  adminURL.addEventListener('input', () => {
    updateAdminURLSuggestions(coordsFromURL(adminURL.value));
    if (editorPromise) {
      editorPromise.then((editor) => {
        editor.setLanguage(currentLanguage());
        updateSaveState(editor.getValue());
      });
    }
  });

  // Kicks off the CodeMirror bundle load in parallel with the first Fetch
  // request, so it's likely already resolved by the time the response comes
  // back and the admin-form submit handler below calls ensureEditor().
  adminForm.addEventListener('submit', ensureEditor, { once: true });

  /**
   * Handles body form submission (Save).
   * @param {Event} e - Submit event
   */
  bodyForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!await checkAPIUpgrade()) return;
    localStorage.setItem('admin-url', adminURL.value);

    let editor;
    try { editor = await ensureEditor(); } catch { return; }
    const bodyValue = editor.getValue() || undefined;
    const contentType = bodyValue && adminURL.value.endsWith('.yaml') ? 'text/yaml' : undefined;
    const resp = await adminForURL(adminURL.value).raw(
      reqMethod.value,
      adminURL.value,
      bodyValue,
      bodyValue ? { contentType } : undefined,
    );
    logResponse(consoleBlock, resp.status, [reqMethod.value, adminURL.value, resp.error]);
  });

  reqMethod.addEventListener('click', () => {
    const expanded = reqMethod.getAttribute('aria-expanded') === 'true';
    reqMethod.setAttribute('aria-expanded', !expanded);
    methodDropdown.hidden = expanded;
  });

  methodOptions.forEach((option) => {
    option.addEventListener('click', () => {
      reqMethod.value = option.textContent;
      reqMethod.setAttribute('aria-expanded', false);
      methodDropdown.hidden = true;
      methodOptions.forEach((o) => o.setAttribute('aria-selected', o === option));
    });
  });

  /**
   * Handles admin form submission (Fetch).
   * @param {Event} e - Submit event
   */
  adminForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!await checkAPIUpgrade()) return;
    const { org, site } = coordsFromURL(adminURL.value);
    const result = await executeAdminRequest(
      () => adminForURL(adminURL.value).raw('GET', adminURL.value),
      { org, site, policy: AuthMode.RETRY_ON_401 },
    );
    if (!result) return; // login cancelled

    localStorage.setItem('admin-url', adminURL.value);

    const text = await result.text();
    logResponse(consoleBlock, result.status, ['GET', adminURL.value, result.error]);
    let editor;
    try { editor = await ensureEditor(); } catch { return; }
    editor.setLanguage(currentLanguage());
    editor.setValue(text);
  });

  adminForm.addEventListener('reset', () => {
    apiUpgradeHint.hidden = true;
    if (editorPromise) {
      editorPromise.then((editor) => editor.setValue(''));
    }
  });
}

registerToolReady(init());
