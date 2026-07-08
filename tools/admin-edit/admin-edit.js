import { registerToolReady } from '../../scripts/scripts.js';
import { logResponse } from '../../blocks/console/console.js';
import getAdminClient from '../../scripts/admin-compat.js';
import { executeAdminRequest, AuthMode } from '../../utils/admin-request.js';

let admin;

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
  adminURLList.innerHTML = admin.suggestions({ org, site })
    .map(({ url, label }) => `<option value="${url}" label="${label}"></option>`)
    .join('');
}

async function init() {
  admin = await getAdminClient();
  adminURL.value = localStorage.getItem('admin-url') || admin.status({ org: 'adobe', site: 'aem-boilerplate' }).url;

  updateAdminURLSuggestions(admin.coordsFromURL(adminURL.value));

  adminURL.addEventListener('input', () => {
    updateAdminURLSuggestions(admin.coordsFromURL(adminURL.value));
    if (editorPromise) {
      editorPromise.then((editor) => {
        editor.setLanguage(currentLanguage());
        updateSaveState(editor.getValue());
      });
    }
  });

  // Lazy-load CodeMirror on first interaction. `focusin` on the empty #editor
  // <div> can never fire before CM mounts (no focusable descendants), so we
  // trigger from `click` on the host — which fires on any element — and hand
  // focus to CM's textbox after it mounts so the user's first click lands
  // where they expect.
  editorEl.addEventListener('click', async () => {
    try {
      const editor = await ensureEditor();
      editor.view.focus();
    } catch {
      // ensureEditor already surfaced the error via logResponse
    }
  }, { once: true });
  adminForm.addEventListener('submit', ensureEditor, { once: true });

  /**
   * Handles body form submission (Save).
   * @param {Event} e - Submit event
   */
  bodyForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    localStorage.setItem('admin-url', adminURL.value);

    let editor;
    try { editor = await ensureEditor(); } catch { return; }
    const bodyValue = editor.getValue() || undefined;
    const contentType = bodyValue && adminURL.value.endsWith('.yaml') ? 'text/yaml' : undefined;
    const resp = await admin.raw(
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
    const { org, site } = admin.coordsFromURL(adminURL.value);
    const result = await executeAdminRequest(
      () => admin.raw('GET', adminURL.value),
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
    if (editorPromise) {
      editorPromise.then((editor) => editor.setValue(''));
    }
  });
}

registerToolReady(init());
