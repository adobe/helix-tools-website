import { registerToolReady } from '../../scripts/scripts.js';
import { loadScript } from '../../scripts/aem.js';
import { ensureLogin } from '../../blocks/profile/profile.js';
import { logResponse } from '../../blocks/console/console.js';
import {
  adminFetch, ADMIN_API_BASE, createAdminClient, extractOrgSiteFromURL,
} from '../../utils/admin-fetch.js';

const adminForm = document.getElementById('admin-form');
const adminURL = document.getElementById('admin-url');
const adminURLList = document.getElementById('admin-url-list');
const bodyForm = document.getElementById('body-form');
const bodyWrapper = document.querySelector('.body-wrapper');
const body = document.getElementById('body');
const previewWrapper = document.getElementById('preview-wrapper');
const preview = document.getElementById('preview');
const reqMethod = document.getElementById('method');
const methodDropdown = document.querySelector('.picker-field ul');
const methodOptions = methodDropdown.querySelectorAll('li');
const consoleBlock = document.querySelector('.console');

let prismReady;

// load Prism.js libraries (and remove event listeners to prevent reloading)
async function loadPrism() {
  adminForm.removeEventListener('submit', loadPrism);
  body.removeEventListener('focus', loadPrism);
  if (!prismReady) {
    prismReady = (async () => {
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/prism.min.js');
      await loadScript('../admin-edit/line-highlight.js');
    })();
  }
  await prismReady;

  /**
   * Tracks the mouse position to check if hovering over a `.line-highlight` element.
   * @param {MouseEvent} e - Mousemove event
   */
  bodyWrapper.addEventListener('mousemove', (e) => {
    const highlight = bodyWrapper.querySelector('.line-highlight');
    if (highlight) {
      // get mouse position relative to .body-wrapper
      const rect = e.target.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      // check if mouse is inside highlight
      const highlightRect = highlight.getBoundingClientRect();
      const highlightX = highlightRect.left - rect.left;
      const highlightY = highlightRect.top - rect.top;
      const highlightWidth = highlightRect.width;
      const highlightHeight = highlightRect.height;

      // check if mouse is within bounding box of highlight
      if (
        x >= highlightX
        && x <= highlightX + highlightWidth
        && y >= highlightY
        && y <= highlightY + highlightHeight
      ) {
        highlight.classList.remove('error-hover');
      } else {
        highlight.classList.add('error-hover');
      }
    }
  });
}

/**
 * Validates a JSON string and updates error information.
 * @param {string} code - JSON string to validate
 */
function validateJSON(code) {
  try {
    const isYamlEndpoint = adminURL && adminURL.value && adminURL.value.endsWith('.yaml');
    if (!isYamlEndpoint) {
      // eslint-disable-next-line no-unused-vars
      const json = JSON.parse(code);
    }
    previewWrapper.removeAttribute('data-line');
    previewWrapper.removeAttribute('data-error');
    document.getElementById('save').disabled = false;
    document.getElementById('body').classList.remove('error');
  } catch (error) {
    document.getElementById('save').disabled = true;
    document.getElementById('body').classList.add('error');
    // json is INVALID
    const { message } = error;
    // extract line of error (if it exists)
    const match = message.match(/line (\d+)/);
    if (match) {
      let line = parseInt(match[1], 10);
      const prevLineErrors = ['after property value', 'after array element'];
      if (prevLineErrors.some((err) => message.includes(err)) && line > 1) {
        // subtract 1 from line number if error is suspected on previous line
        line -= 1;
      }
      previewWrapper.dataset.line = line;

      // find the first matching split substring in the message
      const splits = [' after JSON', ' in JSON', ' ('];
      const foundSplit = splits.find((split) => message.includes(split));
      const splitMessage = foundSplit ? message.split(foundSplit)[0].trim() : message;

      previewWrapper.dataset.error = splitMessage;
    }
  }
}

/**
 * "Creating an Editable Textarea That Supports Syntax Highlighted Code" by Oliver Geer
 * Published on CSS-Tricks: https://css-tricks.com/creating-an-editable-textarea-that-supports-syntax-highlighted-code/
 */

/**
 * Formats, sanitizes, and syntax-highlights text in code element.
 * @param {HTMLElement} code - Code element to update
 * @param {string} text - Text content to insert into code element
 */
async function formatCode(code, text) {
  // check if last character in text is newline
  if (text[text.length - 1] === '\n') {
    // add space to avoid formatting/code rendering issues with trailing newlines
    // eslint-disable-next-line no-param-reassign
    text += ' ';
  }

  // sanitize text to prevent HTML injection
  code.innerHTML = text.replace(/&/g, '&amp;').replace(/</g, '&lt;');

  validateJSON(code.textContent);

  if (prismReady) {
    await prismReady;
    // eslint-disable-next-line no-undef
    Prism.highlightElement(code);
  }
}

/**
 * Insert two-space "tab" at current cursor position.
 * @param {HTMLElement} input - Input element where tab will be inserted
 * @param {HTMLElement} wrapper - Element where updated/formatted code will be displayed
 */
function addTab(input, wrapper) {
  const code = input.value;
  // split input before/after current cursor position
  const beforeTab = code.slice(0, input.selectionStart);
  const afterTab = code.slice(input.selectionEnd, input.value.length);
  const cursorPosition = input.selectionStart + 2;
  // insert "tab" at current cursor position
  input.value = `${beforeTab}  ${afterTab}`;
  // move cursor after inserted "tab"
  input.selectionStart = cursorPosition;
  input.selectionEnd = cursorPosition;

  formatCode(wrapper, input.value);
}

/**
 * Synchronizes scroll position of target element with scroll position of another element.
 * @param {HTMLElement} target - Target element to which the scroll position will be synced
 * @param {HTMLElement} el - Element whose scroll position will be used to update the target element
 */
function syncScroll(target, el) {
  target.scrollTop = el.scrollTop;
  target.scrollLeft = el.scrollLeft;
}

/**
 * Updates the admin URL datalist using the admin client structure as the source of truth.
 * @param {string} org - Organization name
 * @param {string|null} site - Site name (enables site-scoped suggestions when present)
 */
function updateAdminURLSuggestions(org, site) {
  if (!org) {
    adminURLList.innerHTML = '';
    return;
  }

  const admin = createAdminClient({ org, site });
  const configBase = `${ADMIN_API_BASE}/config/${org}`;
  const suggestions = [
    { url: admin.org.url, label: 'Org Config' },
    { url: admin.org.versions().url, label: 'Org Versions' },
    { url: admin.org.sites().url, label: 'Org Sites' },
    { url: admin.org.users().url, label: 'Org Users' },
    { url: `${configBase}/users/{id}.json`, label: 'Org User' },
    { url: admin.org.profiles().url, label: 'Org Profiles' },
    { url: `${configBase}/profiles/{name}.json`, label: 'Org Profile' },
    { url: site ? admin.org.aggregated().url : `${configBase}/aggregated/{site}.json`, label: 'Org Aggregated' },
  ];

  if (site) {
    const siteBase = `${configBase}/sites/${site}`;
    suggestions.push(
      { url: admin.site().url, label: 'Site Config' },
      { url: admin.site().versions().url, label: 'Site Versions' },
      { url: admin.site().access().url, label: 'Site Access' },
      { url: admin.site().cdn().url, label: 'Site CDN' },
      { url: admin.site().code().url, label: 'Site Code' },
      { url: admin.site().headers().url, label: 'Site Headers' },
      { url: admin.site().secrets().url, label: 'Site Secrets' },
      { url: `${siteBase}/secrets/{id}.json`, label: 'Site Secret' },
      { url: admin.site().apiKeys().url, label: 'Site API Keys' },
      { url: `${siteBase}/apiKeys/{id}.json`, label: 'Site API Key' },
    );
  }

  adminURLList.innerHTML = suggestions
    .map(({ url, label }) => `<option value="${url}" label="${label}"></option>`)
    .join('');
}

async function init() {
  adminURL.value = localStorage.getItem('admin-url') || 'https://admin.hlx.page/status/adobe/aem-boilerplate/main/';

  // populate datalist with well-known config locations on load
  const { org: initialOrg, site: initialSite } = extractOrgSiteFromURL(adminURL.value);
  updateAdminURLSuggestions(initialOrg, initialSite);

  // update datalist when admin URL changes
  adminURL.addEventListener('input', () => {
    const { org, site } = extractOrgSiteFromURL(adminURL.value);
    updateAdminURLSuggestions(org, site);
  });

  /**
   * Handles body form submission.
   * @param {Event} e - Submit event
   */
  bodyForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    localStorage.setItem('admin-url', adminURL.value);

    const headers = {};
    if (body.value) {
      headers['content-type'] = adminURL.value.endsWith('.yaml') ? 'text/yaml' : 'application/json';
    }

    const resp = await adminFetch(adminURL.value.replace(ADMIN_API_BASE, ''), {
      method: reqMethod.value,
      body: body.value,
      headers,
    });
    logResponse(consoleBlock, resp.status, [reqMethod.value, adminURL.value, resp.headers.get('x-error') || '']);
  });

  // loads Prism.js libraries when #body focus event is fired for the first time
  body.addEventListener('focus', loadPrism, { once: true });

  /**
   * Formats code in preview element and synchronizes scroll positions.
   * @param {InputEvent} e - Input event
   */
  body.addEventListener('input', (e) => {
    const { value } = e.target;
    formatCode(preview, value);
    syncScroll(previewWrapper, body);
  });

  // synchronizes scroll positions between body and preview wrapper
  body.addEventListener('scroll', () => {
    syncScroll(previewWrapper, body);
  });

  /**
   * Replaces default "Tab" behavior to instead insert a two-space "tab" at current cursor position.
   * @param {KeyboardEvent} e - Keyboard event
   */
  body.addEventListener('keydown', (e) => {
    const { key } = e;
    if (key === 'Tab') {
      e.preventDefault();
      addTab(e.target, preview);
    }
  });

  // toggles the request method dropdown
  reqMethod.addEventListener('click', () => {
    const expanded = reqMethod.getAttribute('aria-expanded') === 'true';
    reqMethod.setAttribute('aria-expanded', !expanded);
    methodDropdown.hidden = expanded;
  });

  // handles the selection of a method option from the dropdown
  methodOptions.forEach((option) => {
    option.addEventListener('click', () => {
      reqMethod.value = option.textContent;
      reqMethod.setAttribute('aria-expanded', false);
      methodDropdown.hidden = true;
      methodOptions.forEach((o) => o.setAttribute('aria-selected', o === option));
    });
  });

  // loads the Prism.js libraries when #admin-form submit event is fired for the first time
  adminForm.addEventListener('submit', loadPrism, { once: true });

  /**
   * Handles admin form submission.
   * @param {Event} e - Submit event
   */
  adminForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const { org, site } = extractOrgSiteFromURL(adminURL.value);
    if (!await ensureLogin(org, site)) {
      // not logged in yet, listen for profile-update event
      window.addEventListener('profile-update', ({ detail: loginInfo }) => {
        // check if user is logged in now
        if (loginInfo.includes(org)) {
          // logged in, restart action (e.g. resubmit form)
          e.target.querySelector('button[type="submit"]').click();
        }
      }, { once: true });
      // abort action
      return;
    }

    localStorage.setItem('admin-url', adminURL.value);

    const resp = await adminFetch(adminURL.value.replace(ADMIN_API_BASE, ''));
    const text = await resp.text();
    body.value = text;
    formatCode(preview, text);
    logResponse(consoleBlock, resp.status, ['GET', adminURL.value, resp.headers.get('x-error') || '']);
  });

  // handles admin form reset, clearing the body field
  adminForm.addEventListener('reset', () => {
    body.value = '';
    formatCode(preview, '');
  });
}

registerToolReady(init());
