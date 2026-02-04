import { registerToolReady } from '../../scripts/scripts.js';
import { loadScript } from '../../scripts/aem.js';
import { ensureLogin } from '../../blocks/profile/profile.js';
import { logResponse } from '../../blocks/console/console.js';

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

// load Prism.js libraries (and remove event listeners to prevent reloading)
async function loadPrism() {
  adminForm.removeEventListener('submit', loadPrism);
  body.removeEventListener('focus', loadPrism);
  await loadScript('https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/prism.min.js');
  await loadScript('../admin-edit/line-highlight.js');

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
function formatCode(code, text) {
  // check if last character in text is newline
  if (text[text.length - 1] === '\n') {
    // add space to avoid formatting/code rendering issues with trailing newlines
    // eslint-disable-next-line no-param-reassign
    text += ' ';
  }

  // sanitize text to prevent HTML injection
  code.innerHTML = text.replace(/&/g, '&amp;').replace(/</g, '&lt;');

  validateJSON(code.textContent);

  // eslint-disable-next-line no-undef
  Prism.highlightElement(code);
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
 * Extracts the organization from an admin URL.
 * @param {string} url - URL to extract org from
 * @returns {string|null} The organization name or null if not found
 */
function extractOrgFromURL(url) {
  try {
    const urlObj = new URL(url);
    const pathParts = urlObj.pathname.split('/').filter((part) => part);
    if (pathParts[0] === 'config' && pathParts.length > 1) {
      // config URL: /config/org.json or /config/org/...
      let org = pathParts[1];
      if (org.endsWith('.json')) {
        org = org.slice(0, -5);
      }
      return org;
    }
    if (pathParts.length > 1) {
      // admin API URL: /status/org/site/ref or similar
      return pathParts[1];
    }
  } catch (e) {
    // invalid URL
  }
  return null;
}

/**
 * Updates the admin URL datalist with well-known config locations.
 * @param {string} org - Organization name to use in the suggestions
 */
function updateAdminURLSuggestions(org) {
  if (!org) {
    adminURLList.innerHTML = '';
    return;
  }

  const suggestions = [
    { url: `https://admin.hlx.page/config/${org}.json`, label: 'Org Config' },
    { url: `https://admin.hlx.page/config/${org}/profiles.json`, label: 'Profiles' },
    { url: `https://admin.hlx.page/config/${org}/sites.json`, label: 'Sites' },
  ];

  adminURLList.innerHTML = suggestions
    .map(({ url, label }) => `<option value="${url}" label="${label}"></option>`)
    .join('');
}

async function init() {
  adminURL.value = localStorage.getItem('admin-url') || 'https://admin.hlx.page/status/adobe/aem-boilerplate/main/';

  // populate datalist with well-known config locations on load
  const initialOrg = extractOrgFromURL(adminURL.value);
  updateAdminURLSuggestions(initialOrg);

  // update datalist when admin URL changes
  adminURL.addEventListener('input', () => {
    const org = extractOrgFromURL(adminURL.value);
    updateAdminURLSuggestions(org);
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

    const resp = await fetch(adminURL.value, {
      method: reqMethod.value,
      body: body.value,
      headers,
    });

    resp.text().then(() => {
      logResponse(consoleBlock, resp.status, [reqMethod.value, adminURL.value, resp.headers.get('x-error') || '']);
    });
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
    const extractOrgAndSite = (url) => {
      const urlObj = new URL(url);
      const pathParts = urlObj.pathname.split('/');
      if (pathParts[1] === 'config') {
        let org = pathParts[2];
        if (org.endsWith('.json')) {
          org = org.slice(0, -5);
        }
        let site = pathParts[4] ? pathParts[4] : null;
        if (site && site.endsWith('.json')) {
          site = site.slice(0, -5);
        }
        return { org, site };
      }
      const org = pathParts[2];
      const site = pathParts[3];
      return { org, site };
    };

    const { org, site } = extractOrgAndSite(adminURL.value);
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

    const resp = await fetch(adminURL.value);
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
