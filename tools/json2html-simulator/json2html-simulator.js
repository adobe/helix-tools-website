/**
 * JSON2HTML Simulator — interactive tool for experimenting with Mustache
 * templates. Editing surfaces are CodeMirror instances (lazy-loaded from
 * the shared vendor bundle); rendering happens via the server-side
 * /simulator endpoint.
 */

import escapeHtml from '../../utils/html.js';
import { examples } from './example-data.js';

const ENDPOINTS = {
  production: 'https://json2html.adobeaem.workers.dev/simulator',
  ci: 'https://json2html-ci.adobeaem.workers.dev/simulator',
  local: 'http://localhost:8787/simulator',
};

function getSimulatorEndpoint() {
  const params = new URLSearchParams(window.location.search);
  const endpoint = params.get('endpoint');
  return ENDPOINTS[endpoint] || ENDPOINTS.production;
}

const SIMULATOR_ENDPOINT = getSimulatorEndpoint();

const DEFAULT_JSON = `{
  "title": "Welcome to JSON2HTML",
  "description": "This simulator helps you experiment with Mustache templates.",
  "features": [
    { "name": "Live Preview", "enabled": true },
    { "name": "Syntax Highlighting", "enabled": true },
    { "name": "Error Detection", "enabled": true }
  ],
  "author": {
    "name": "AEM Developer",
    "role": "Content Engineer"
  }
}`;

const DEFAULT_TEMPLATE = `<!DOCTYPE html>
<html lang="en">
  <head>
    <title>{{title}}</title>
  </head>
  <body>
    <header></header>
    <main>
      <div>
        <h1>{{title}}</h1>
        <p>{{description}}</p>
      </div>
      <div>
        <h2>Features</h2>
        <ul>
          {{#features}}
          <li>
            {{name}}{{#enabled}} ✓{{/enabled}}
          </li>
          {{/features}}
        </ul>
      </div>
      <div>
        <p>Created by <strong>{{author.name}}</strong></p>
        <p>{{author.role}}</p>
      </div>
    </main>
    <footer></footer>
  </body>
</html>`;

// DOM
const jsonEditorEl = document.getElementById('json-editor');
const templateEditorEl = document.getElementById('template-editor');
const sourceEditorEl = document.getElementById('source-editor');
const previewFrame = document.getElementById('preview-frame');
const jsonStatus = document.getElementById('json-status');
const templateStatus = document.getElementById('template-status');
const previewStatus = document.getElementById('preview-status');
const validationDetails = document.getElementById('validation-details');

const previewTabs = document.querySelectorAll('.preview-tab');
const previewViews = document.querySelectorAll('.preview-view');

const examplesModal = document.getElementById('examples-modal');
const helpModal = document.getElementById('help-modal');
const examplesBtn = document.getElementById('examples-btn');
const helpBtn = document.getElementById('help-btn');

const optionsPanel = document.getElementById('options-panel');
const optionsToggleBtn = document.getElementById('options-toggle-btn');
const optionArrayKey = document.getElementById('option-arrayKey');
const optionPathKey = document.getElementById('option-pathKey');
const optionTestPath = document.getElementById('option-testPath');
const optionRelativeURLPrefix = document.getElementById('option-relativeURLPrefix');
const optionGenericFallback = document.getElementById('option-genericFallback');

let jsonEditor;
let templateEditor;
let sourceEditor;
let debounceTimer = null;
let validationDelayTimer = null;
let abortController = null;
const DEBOUNCE_DELAY = 300;
const VALIDATION_DELAY = 200;

/**
 * Converts a character offset in a string to a 1-based line/column.
 * Used when humanizing render error positions reported by Mustache.
 */
function positionToLineCol(text, pos) {
  const before = text.substring(0, pos);
  const lines = before.split('\n');
  return { line: lines.length, col: lines[lines.length - 1].length + 1 };
}

/**
 * Find the last unclosed {{#section}} opening using a stack. Handles nested
 * sections of the same name correctly.
 */
function findUnclosedSectionOpening(text, escapedName, limit) {
  const re = new RegExp(`\\{\\{([#^/])\\s*${escapedName}\\s*\\}\\}`, 'g');
  const stack = [];
  let m = re.exec(text);
  while (m !== null && (limit === undefined || m.index < limit)) {
    if (m[1] === '#' || m[1] === '^') stack.push(m.index);
    else if (stack.length > 0) stack.pop();
    m = re.exec(text);
  }
  return stack.length > 0 ? stack[stack.length - 1] : -1;
}

function sectionSigilAt(text, charIndex) {
  const after = text.slice(charIndex + 2).trimStart();
  return after.startsWith('^') ? '^' : '#';
}

function showToast(message) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  const main = document.querySelector('main');
  (main || document.body).appendChild(toast);
  setTimeout(() => toast.remove(), 2000);
}

function getStatusIcon(type) {
  if (type === 'ok') return '✓';
  if (type === 'error') return '✗';
  return '⚠';
}

function updateStatus(statusEl, type, message) {
  if (!statusEl) return;
  const icon = statusEl.querySelector('.status-icon');
  const text = statusEl.querySelector('.status-text');
  if (icon) {
    icon.className = `status-icon status-${type}`;
    icon.textContent = getStatusIcon(type);
  }
  if (text) text.textContent = message;
}

function updatePreviewStatus(type, message) {
  updateStatus(previewStatus, type, message);
}

/**
 * Validates the JSON editor content. Updates the status bar and returns the
 * parsed object (or `null` on parse error). CodeMirror's JSON linter handles
 * inline squiggles; this function exists for status-bar messaging and to
 * give callers the parsed object.
 */
function validateJson() {
  const value = jsonEditor ? jsonEditor.getValue() : '';
  if (!value.trim()) {
    updateStatus(jsonStatus, 'warning', 'Empty JSON');
    return null;
  }
  try {
    const parsed = JSON.parse(value);
    updateStatus(jsonStatus, 'ok', 'Valid JSON');
    return parsed;
  } catch (e) {
    const match = e.message.match(/position (\d+)/);
    if (match) {
      const { line } = positionToLineCol(value, parseInt(match[1], 10));
      updateStatus(jsonStatus, 'error', `Invalid JSON at line ${line}`);
    } else {
      updateStatus(jsonStatus, 'error', 'Invalid JSON');
    }
    return null;
  }
}

function formatJson() {
  const parsed = validateJson();
  if (parsed && jsonEditor) {
    jsonEditor.setValue(JSON.stringify(parsed, null, 2));
    updateStatus(jsonStatus, 'ok', 'Formatted');
  }
}

function getNestedValue(obj, path) {
  if (!path || !obj) return obj;
  return path.split('.').reduce((current, key) => (current != null ? current[key] : undefined), obj);
}

function getSimulatorOptions() {
  const options = {};
  const arrayKey = optionArrayKey?.value?.trim();
  const pathKey = optionPathKey?.value?.trim();
  const testPath = optionTestPath?.value?.trim();
  const relativeURLPrefix = optionRelativeURLPrefix?.value?.trim();
  const genericFallback = optionGenericFallback?.checked;
  if (arrayKey) options.arrayKey = arrayKey;
  if (pathKey) options.pathKey = pathKey;
  if (testPath) options.testPath = testPath;
  if (relativeURLPrefix) options.relativeURLPrefix = relativeURLPrefix;
  if (genericFallback) options.genericFallback = true;
  return options;
}

function validateOptionsTemplateCompatibility(jsonData, options, template) {
  if (!jsonData || !options || !template?.trim()) return null;

  if (options.arrayKey) {
    const arrayData = getNestedValue(jsonData, options.arrayKey);
    if (arrayData === undefined) {
      return {
        type: 'invalid_path',
        title: 'Invalid arrayKey Path',
        message: `The path "${options.arrayKey}" doesn't exist in your JSON data.`,
        suggestion: 'Check your JSON structure and verify the arrayKey path is correct.',
      };
    }
    if (Array.isArray(arrayData)) {
      const isFilteringToSingleItem = options.pathKey && options.testPath;
      if (!isFilteringToSingleItem) {
        const hasArrayIteration = /\{\{#\s*\.\s*\}\}/.test(template);
        if (!hasArrayIteration) {
          const safeKey = escapeHtml(options.arrayKey);
          return {
            type: 'array_iteration_missing',
            title: 'Template Missing Array Iteration',
            message: `Your arrayKey "${options.arrayKey}" points to an array with ${arrayData.length} item${arrayData.length === 1 ? '' : 's'}, but your template doesn't iterate over it.`,
            suggestion: 'Wrap your template in <code>{{#.}}...{{/.}}</code>'
              + ' to loop over array items.<br><br>'
              + '<strong>Example:</strong><br>'
              + '<code>{{#.}}<br>'
              + '&nbsp;&nbsp;&lt;h1&gt;{{name}}&lt;/h1&gt;<br>'
              + '&nbsp;&nbsp;&lt;p&gt;{{description}}&lt;/p&gt;<br>'
              + '{{/.}}</code><br><br>'
              + '<strong>Alternative:</strong> Remove arrayKey and use '
              + `<code>{{#${safeKey}}}...{{/${safeKey}}}</code>`
              + ' in your template instead.',
            arrayLength: arrayData.length,
          };
        }
      }
    }
  }

  if ((options.pathKey || options.testPath) && !options.arrayKey) {
    return {
      type: 'missing_arrayKey',
      title: 'Missing arrayKey Option',
      message: 'You\'re using pathKey or testPath without arrayKey.',
      suggestion: 'The pathKey and testPath options work together with arrayKey to filter arrays. Add an arrayKey option to specify which array to filter.',
    };
  }
  return null;
}

function setLoadingState(show) {
  const renderButton = document.getElementById('render-btn');
  if (renderButton) {
    renderButton.disabled = show;
    renderButton.textContent = show ? '⏳ Rendering...' : '▶ Render';
  }
  if (show) updatePreviewStatus('ok', 'Rendering…');
}

function displayValidationError(error) {
  if (validationDelayTimer) clearTimeout(validationDelayTimer);
  validationDelayTimer = setTimeout(() => {
    const validationContainer = document.getElementById('validation-message');
    const validationTitle = document.getElementById('validation-title');
    const validationText = document.getElementById('validation-text');
    const validationSuggestion = document.getElementById('validation-suggestion');
    if (!validationContainer || !validationTitle
      || !validationText || !validationSuggestion) return;
    validationTitle.textContent = error.title;
    validationText.textContent = error.message;
    validationSuggestion.innerHTML = `<strong>💡 How to fix:</strong>${error.suggestion}`;
    validationContainer.hidden = false;
    updateStatus(templateStatus, 'warning', `Validation: ${error.title}`);
  }, VALIDATION_DELAY);
}

function hideValidationError() {
  if (validationDelayTimer) {
    clearTimeout(validationDelayTimer);
    validationDelayTimer = null;
  }
  const validationContainer = document.getElementById('validation-message');
  if (validationContainer) validationContainer.hidden = true;
}

function collapseValidationDetails() {
  if (validationDetails) {
    validationDetails.hidden = true;
    validationDetails.innerHTML = '';
  }
  if (previewStatus) {
    previewStatus.classList.remove('has-details', 'expanded');
    previewStatus.removeAttribute('role');
    previewStatus.removeAttribute('tabindex');
    previewStatus.removeAttribute('aria-expanded');
    previewStatus.removeAttribute('aria-controls');
  }
}

/**
 * Hides the HTML validation status, clears source diagnostics, and shows a
 * neutral message when no preview is available.
 */
function hideHtmlValidation() {
  updatePreviewStatus('error', 'No preview — fix errors above');
  collapseValidationDetails();
  if (sourceEditor) sourceEditor.setDiagnostics([]);
}

function formatValidationStatus(results) {
  if (results.length === 0) return { type: 'ok', message: 'Valid EDS HTML' };
  const errors = results.filter((r) => r.severity === 'error');
  const worst = errors.length > 0 ? errors[0] : results[0];
  const type = errors.length > 0 ? 'error' : 'warning';
  let msg = worst.message;
  if (worst.line) msg += ` (line ${worst.line})`;
  const remaining = results.length - 1;
  if (remaining > 0) msg += ` (+${remaining} more)`;
  return { type, message: msg };
}

/**
 * Populates the expandable validation detail list. Each row shows severity
 * icon, message, and line number. Clicking a row scrolls the source editor.
 */
function buildValidationDetails(results) {
  if (!validationDetails || results.length < 2) {
    collapseValidationDetails();
    return;
  }
  validationDetails.replaceChildren();
  results.forEach((r) => {
    const row = document.createElement('button');
    row.className = 'validation-detail-row';
    row.type = 'button';
    const severity = document.createElement('span');
    severity.className = 'detail-severity';
    severity.textContent = r.severity === 'error' ? '✗' : '⚠';
    row.appendChild(severity);
    const msg = document.createElement('span');
    msg.className = 'detail-msg';
    msg.textContent = r.message;
    row.appendChild(msg);
    if (r.line) {
      const lineLabel = document.createElement('span');
      lineLabel.className = 'detail-line';
      lineLabel.textContent = `line ${r.line}`;
      row.appendChild(lineLabel);
      row.addEventListener('click', () => sourceEditor?.scrollToLine(r.line));
    }
    validationDetails.appendChild(row);
  });
  validationDetails.hidden = true;
  if (previewStatus) {
    previewStatus.classList.remove('expanded');
    previewStatus.classList.add('has-details');
    previewStatus.setAttribute('role', 'button');
    previewStatus.setAttribute('tabindex', '0');
    previewStatus.setAttribute('aria-expanded', 'false');
    previewStatus.setAttribute('aria-controls', 'validation-details');
  }
}

function displayHtmlValidation(validation) {
  if (!validation || !Array.isArray(validation.results)) {
    collapseValidationDetails();
    if (sourceEditor) sourceEditor.setDiagnostics([]);
    if (!validation) updatePreviewStatus('ok', 'HTML');
    return;
  }
  const { results } = validation;
  const { type, message } = formatValidationStatus(results);
  updatePreviewStatus(type, message);
  if (sourceEditor) {
    sourceEditor.setDiagnostics(results.filter((r) => r.line).map((r) => ({
      line: r.line,
      severity: r.severity === 'error' ? 'error' : 'warning',
      message: r.message,
    })));
  }
  buildValidationDetails(results);
}

function updatePreview(html) {
  if (previewFrame) {
    const doc = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            line-height: 1.5;
            padding: 20px;
            margin: 0;
            color: #333;
            background: white;
          }
          h1 { font-size: 24px; margin: 0 0 16px; }
          h2 { font-size: 20px; margin: 24px 0 12px; }
          p { margin: 0 0 12px; }
          ul { padding-left: 20px; }
          li { margin: 8px 0; }
          .badge { display: inline-block; padding: 2px 8px; background: #0066cc; color: white; border-radius: 4px; font-size: 12px; margin-left: 8px; }
          .enabled { color: #2a7; }
          footer { margin-top: 24px; padding-top: 16px; border-top: 1px solid #eee; }
          .role { color: #666; font-size: 14px; }
          ::-webkit-scrollbar { width: 24px; height: 24px; background: white; }
          ::-webkit-scrollbar-track { background: white; }
          ::-webkit-scrollbar-thumb { background-color: #8f8f8f; border: 8px solid white; border-radius: 12px; }
          ::-webkit-scrollbar-thumb:hover { background-color: #717171; }
        </style>
      </head>
      <body>${html}</body>
      </html>
    `;
    previewFrame.srcdoc = doc;
  }
  if (sourceEditor) sourceEditor.setValue(html);
}

function getRenderedHtml() {
  return sourceEditor ? sourceEditor.getValue() : '';
}

async function fetchRenderedHtml(jsonValue, template, options, signal) {
  const requestBody = {
    json: encodeURIComponent(jsonValue),
    template: encodeURIComponent(template),
  };
  if (Object.keys(options).length > 0) requestBody.options = options;
  const response = await fetch(SIMULATOR_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
    signal,
  });
  if (!response.ok) {
    let errorMessage = `Server error: ${response.status}`;
    try {
      const errorData = await response.json();
      if (errorData.error && errorData.message) errorMessage = errorData.message;
    } catch {
      const errorText = await response.text();
      if (errorText) errorMessage = errorText;
    }
    throw new Error(errorMessage);
  }
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) return response.json();
  const html = await response.text();
  return { html };
}

/**
 * Translates a raw Mustache error message into a human-readable form by
 * converting character offsets to line numbers and clarifying error types.
 * Pure function — no side effects.
 */
function humanizeRenderError(rawMessage, templateText) {
  const msg = rawMessage;
  const atPosMatch = msg.match(/\bat (\d+)$/);
  if (!atPosMatch) return msg;
  const charPos = parseInt(atPosMatch[1], 10);
  const unclosedSectionMatch = msg.match(/Unclosed section "([^"]+)"/);
  const unclosedTagMatch = /^Unclosed tag/.test(msg);

  if (unclosedSectionMatch) {
    const sectionName = unclosedSectionMatch[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (charPos >= templateText.length) {
      const openPos = findUnclosedSectionOpening(templateText, sectionName);
      const suffix = openPos !== -1
        ? `opened at line ${positionToLineCol(templateText, openPos).line}` : '';
      return msg.replace(/\bat \d+$/, suffix);
    }
    const wrongTagMatch = templateText.substring(charPos).match(/^\{\{\/\s*([^}\s]+)\s*\}\}/);
    if (wrongTagMatch && wrongTagMatch[1] !== unclosedSectionMatch[1]) {
      const wrongLine = positionToLineCol(templateText, charPos).line;
      const wrongEscaped = wrongTagMatch[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const wrongOpenPos = findUnclosedSectionOpening(templateText, wrongEscaped, charPos);
      if (wrongOpenPos === -1) {
        const openSectionName = unclosedSectionMatch[1];
        const openSectionEsc = openSectionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const openSectionPos = findUnclosedSectionOpening(templateText, openSectionEsc, charPos);
        const openSectionLine = openSectionPos !== -1
          ? positionToLineCol(templateText, openSectionPos).line : null;
        const openSectionSigil = openSectionPos !== -1
          ? sectionSigilAt(templateText, openSectionPos) : '#';
        const replacement = openSectionLine
          ? `Unexpected {{/${wrongTagMatch[1]}}} at line ${wrongLine}`
            + ` — '{{${openSectionSigil}${openSectionName}}}' at line ${openSectionLine} is still open`
          : `Unexpected {{/${wrongTagMatch[1]}}} at line ${wrongLine}`
            + ` — no opening {{#${wrongTagMatch[1]}}} found`;
        return msg.replace(/Unclosed section "[^"]+" at \d+$/, replacement);
      }
      const openPos = findUnclosedSectionOpening(templateText, sectionName, charPos);
      if (openPos !== -1) {
        const openLine = positionToLineCol(templateText, openPos).line;
        return msg.replace(/\bat \d+$/, `opened at line ${openLine} — unexpected {{/${wrongTagMatch[1]}}} at line ${wrongLine}`);
      }
      return msg.replace(/\bat \d+$/, `— unexpected {{/${wrongTagMatch[1]}}} at line ${wrongLine}`);
    }
    return msg.replace(/\bat \d+$/, `at line ${positionToLineCol(templateText, charPos).line}`);
  }

  if (unclosedTagMatch) {
    let unmatched = -1;
    let pos = 0;
    while (pos < templateText.length) {
      const openIdx = templateText.indexOf('{{', pos);
      if (openIdx === -1) break;
      const closeIdx = templateText.indexOf('}}', openIdx + 2);
      if (closeIdx === -1) { unmatched = openIdx; break; }
      pos = openIdx + 2;
    }
    if (unmatched !== -1) {
      return msg.replace(/\bat \d+$/, `at line ${positionToLineCol(templateText, unmatched).line}`);
    }
    return msg.replace(/\bat \d+$/, '');
  }

  const { line } = positionToLineCol(templateText, charPos);
  const unopenedMatch = msg.match(/^Unopened section "([^"]+)"/);
  if (unopenedMatch) {
    const tagName = unopenedMatch[1];
    return `Unexpected {{/${tagName}}} at line ${line} — no opening {{#${tagName}}} found`;
  }
  return msg.replace(/\bat \d+$/, `at line ${line}`);
}

/**
 * Renders the template with JSON data via the /simulator endpoint and
 * updates the iframe + source views and validation overlays.
 */
async function render() {
  if (!jsonEditor || !templateEditor) return;
  const jsonValue = jsonEditor.getValue().trim();
  const template = templateEditor.getValue();

  const jsonData = validateJson();
  if (!jsonData) {
    updatePreview('');
    hideHtmlValidation();
    return;
  }

  const options = getSimulatorOptions();
  const validationError = validateOptionsTemplateCompatibility(jsonData, options, template);
  if (validationError) {
    displayValidationError(validationError);
    hideHtmlValidation();
    return;
  }
  hideValidationError();

  if (abortController) abortController.abort();
  abortController = new AbortController();
  setLoadingState(true);

  try {
    const result = await fetchRenderedHtml(jsonValue, template, options, abortController.signal);
    updatePreview(result.html);
    updateStatus(templateStatus, 'ok', 'Rendered successfully');
    templateEditor.setDiagnostics([]);
    displayHtmlValidation(result.validation);
  } catch (e) {
    if (e.name === 'AbortError') return;
    hideHtmlValidation();
    if (e.message === 'Failed to fetch') {
      updatePreview('');
      updateStatus(templateStatus, 'error', 'Connection failed');
      templateEditor.setDiagnostics([]);
    } else {
      const errorMessage = humanizeRenderError(e.message, templateEditor.getValue());
      updatePreview('');
      updateStatus(templateStatus, 'error', `Render error: ${errorMessage}`);
      const lineMatch = errorMessage.match(/\bline (\d+)/);
      const errorLine = lineMatch ? parseInt(lineMatch[1], 10) : 0;
      templateEditor.setDiagnostics(
        errorLine ? [{ line: errorLine, severity: 'error', message: errorMessage }] : [],
      );
    }
  } finally {
    setLoadingState(false);
  }
}

async function loadExample(exampleType) {
  const example = examples[exampleType];
  if (!example) return;
  if (jsonEditor) jsonEditor.setValue(JSON.stringify(example.json, null, 2));
  if (templateEditor) templateEditor.setValue(example.template);

  if (example.options) {
    if (optionArrayKey) optionArrayKey.value = example.options.arrayKey || '';
    if (optionPathKey) optionPathKey.value = example.options.pathKey || '';
    if (optionTestPath) optionTestPath.value = example.options.testPath || '';
    if (optionRelativeURLPrefix) {
      optionRelativeURLPrefix.value = example.options.relativeURLPrefix || '';
    }
    if (optionGenericFallback) {
      optionGenericFallback.checked = example.options.genericFallback || false;
    }
    if (optionsPanel && optionsPanel.hidden) {
      optionsPanel.hidden = false;
      optionsToggleBtn?.classList.add('active');
    }
  } else {
    if (optionArrayKey) optionArrayKey.value = '';
    if (optionPathKey) optionPathKey.value = '';
    if (optionTestPath) optionTestPath.value = '';
    if (optionRelativeURLPrefix) optionRelativeURLPrefix.value = '';
    if (optionGenericFallback) optionGenericFallback.checked = false;
  }

  validateJson();
  await render();
}

function setupPreviewTabs() {
  previewTabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const viewType = tab.dataset.view;
      previewTabs.forEach((t) => {
        t.classList.remove('active');
        t.setAttribute('aria-selected', 'false');
      });
      tab.classList.add('active');
      tab.setAttribute('aria-selected', 'true');
      previewViews.forEach((view) => {
        if (view.dataset.view === viewType) {
          view.classList.add('active');
          view.removeAttribute('hidden');
        } else {
          view.classList.remove('active');
          view.setAttribute('hidden', '');
        }
      });
    });
  });
}

function setupModals() {
  examplesBtn?.addEventListener('click', () => examplesModal?.showModal());
  helpBtn?.addEventListener('click', () => helpModal?.showModal());
  document.querySelectorAll('.modal-close').forEach((btn) => {
    btn.addEventListener('click', () => btn.closest('dialog')?.close());
  });
  [examplesModal, helpModal].forEach((modal) => {
    modal?.addEventListener('click', (e) => {
      if (e.target === modal) modal.close();
    });
  });
  document.querySelectorAll('.example-card').forEach((card) => {
    card.addEventListener('click', () => {
      const exampleType = card.dataset.example;
      loadExample(exampleType);
      examplesModal?.close();
    });
  });
}

function setupResizer() {
  const verticalResizer = document.getElementById('resizer-vertical');
  const jsonPanel = document.querySelector('.json-panel');
  const editorsRow = document.querySelector('.editors-row');
  const horizontalResizer = document.getElementById('resizer-horizontal');
  const workspace = document.querySelector('.workspace');

  let activeResizer = null;
  let startPos = 0;
  let startSize = 0;

  if (verticalResizer && jsonPanel && editorsRow) {
    verticalResizer.addEventListener('mousedown', (e) => {
      activeResizer = 'vertical';
      startPos = e.clientX;
      startSize = jsonPanel.offsetWidth;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    });
  }
  if (horizontalResizer && editorsRow && workspace) {
    horizontalResizer.addEventListener('mousedown', (e) => {
      activeResizer = 'horizontal';
      startPos = e.clientY;
      startSize = editorsRow.offsetHeight;
      document.body.style.cursor = 'row-resize';
      document.body.style.userSelect = 'none';
    });
  }
  document.addEventListener('mousemove', (e) => {
    if (!activeResizer) return;
    if (activeResizer === 'vertical' && jsonPanel && editorsRow) {
      const diff = e.clientX - startPos;
      const newWidth = startSize + diff;
      const containerWidth = editorsRow.offsetWidth;
      const minWidth = containerWidth * 0.2;
      const maxWidth = containerWidth * 0.8;
      if (newWidth >= minWidth && newWidth <= maxWidth) {
        jsonPanel.style.flex = 'none';
        jsonPanel.style.width = `${newWidth}px`;
      }
    }
    if (activeResizer === 'horizontal' && editorsRow && workspace) {
      const diff = e.clientY - startPos;
      const newHeight = startSize + diff;
      const containerHeight = workspace.offsetHeight;
      const minHeight = containerHeight * 0.2;
      const maxHeight = containerHeight * 0.8;
      if (newHeight >= minHeight && newHeight <= maxHeight) {
        editorsRow.style.flex = 'none';
        editorsRow.style.height = `${newHeight}px`;
      }
    }
  });
  document.addEventListener('mouseup', () => {
    if (activeResizer) {
      activeResizer = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
  });
}

function setupOptionsPanel() {
  optionsToggleBtn?.addEventListener('click', () => {
    const isHidden = optionsPanel?.hidden;
    if (optionsPanel) optionsPanel.hidden = !isHidden;
    if (optionsToggleBtn) optionsToggleBtn.classList.toggle('active', isHidden);
  });
  const handleOptionChange = () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(render, DEBOUNCE_DELAY);
  };
  optionArrayKey?.addEventListener('input', handleOptionChange);
  optionPathKey?.addEventListener('input', handleOptionChange);
  optionTestPath?.addEventListener('input', handleOptionChange);
  optionRelativeURLPrefix?.addEventListener('input', handleOptionChange);
  optionGenericFallback?.addEventListener('change', handleOptionChange);
}

function setupButtons() {
  const copyBtn = document.getElementById('copy-html');
  copyBtn?.addEventListener('click', async () => {
    const html = getRenderedHtml();
    if (html) {
      await navigator.clipboard.writeText(html);
      showToast('HTML copied to clipboard!');
    }
  });
  const fullscreenBtn = document.getElementById('fullscreen-btn');
  fullscreenBtn?.addEventListener('click', () => {
    const mainElement = document.querySelector('main');
    if (document.fullscreenElement) document.exitFullscreen();
    else mainElement?.requestFullscreen();
  });
  const formatJsonBtn = document.getElementById('format-json');
  formatJsonBtn?.addEventListener('click', formatJson);
  const validationCloseBtn = document.getElementById('validation-close');
  validationCloseBtn?.addEventListener('click', hideValidationError);

  previewStatus?.addEventListener('click', () => {
    if (!previewStatus.classList.contains('has-details')) return;
    const isExpanded = previewStatus.classList.toggle('expanded');
    previewStatus.setAttribute('aria-expanded', String(isExpanded));
    if (validationDetails) validationDetails.hidden = !isExpanded;
  });
  previewStatus?.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    ev.preventDefault();
    previewStatus.click();
  });
}

function setupKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      clearTimeout(debounceTimer);
      render();
      const statusText = previewStatus?.querySelector('.status-text');
      if (statusText) {
        const originalText = statusText.textContent;
        statusText.textContent = '⚡ Rendered instantly';
        setTimeout(() => { statusText.textContent = originalText; }, 2000);
      }
    }
  });
}

/**
 * Create the validation message element dynamically inside <main>. Done in JS
 * to avoid AEM auto-blocking, side-nav detection, and to work in fullscreen.
 */
function createValidationMessage() {
  const main = document.querySelector('main');
  if (!main || document.getElementById('validation-message')) return;
  const container = document.createElement('aside');
  container.className = 'validation-message-container';
  container.id = 'validation-message';
  container.hidden = true;
  container.setAttribute('aria-live', 'polite');
  container.innerHTML = `
    <div class="validation-message">
      <span class="validation-icon" aria-hidden="true">⚠️</span>
      <div class="validation-content">
        <strong class="validation-title" id="validation-title"></strong>
        <p class="validation-text" id="validation-text"></p>
        <div class="validation-suggestion" id="validation-suggestion"></div>
      </div>
      <button type="button" class="validation-close" id="validation-close"
        aria-label="Dismiss validation message">×</button>
    </div>
  `;
  main.appendChild(container);
}

async function init() {
  createValidationMessage();
  setupPreviewTabs();
  setupModals();
  setupResizer();
  setupButtons();
  setupOptionsPanel();
  setupKeyboardShortcuts();

  const { default: createEditor } = await import('../../vendor/codemirror/codemirror.js');

  let renderTimer = null;
  const scheduleRender = () => {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(render, DEBOUNCE_DELAY);
  };

  jsonEditor = createEditor({
    parent: jsonEditorEl,
    doc: DEFAULT_JSON,
    language: 'json',
    labelledBy: 'json-label',
    onChange: () => {
      validateJson();
      scheduleRender();
    },
  });

  templateEditor = createEditor({
    parent: templateEditorEl,
    doc: DEFAULT_TEMPLATE,
    language: 'html',
    labelledBy: 'template-label',
    onChange: scheduleRender,
  });

  sourceEditor = createEditor({
    parent: sourceEditorEl,
    doc: '',
    language: 'html',
    readOnly: true,
    labelledBy: 'preview-label',
  });

  validateJson();
  await render();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
