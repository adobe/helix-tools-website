/**
 * JSON2HTML Simulator - Interactive tool for experimenting with Mustache templates
 * Uses server-side rendering via /simulator endpoint
 */

import { highlight, loadPrismLibrary } from '../../utils/prism/prism.js';
import { examples } from './example-data.js';

// Simulator endpoints
const ENDPOINTS = {
  production: 'https://json2html.adobeaem.workers.dev/simulator',
  ci: 'https://json2html-ci.adobeaem.workers.dev/simulator',
  local: 'http://localhost:8787/simulator',
};

// Select endpoint based on ?endpoint= query param (default: production)
// Usage: ?endpoint=ci or ?endpoint=local
function getSimulatorEndpoint() {
  const params = new URLSearchParams(window.location.search);
  const endpoint = params.get('endpoint');
  return ENDPOINTS[endpoint] || ENDPOINTS.production;
}

const SIMULATOR_ENDPOINT = getSimulatorEndpoint();

// Languages needed for syntax highlighting
// Note: handlebars depends on markup-templating which depends on markup
const PRISM_LANGUAGES = ['json', 'markup', 'markup-templating', 'handlebars'];

// DOM Elements
const jsonInput = document.getElementById('json-input');
const templateInput = document.getElementById('template-input');
const jsonHighlight = document.getElementById('json-highlight');
const templateHighlight = document.getElementById('template-highlight');
const jsonLineNumbers = document.getElementById('json-line-numbers');
const templateLineNumbers = document.getElementById('template-line-numbers');
const jsonErrorHighlight = document.getElementById('json-error-highlight');
const templateErrorHighlight = document.getElementById('template-error-highlight');
const previewFrame = document.getElementById('preview-frame');
const sourceOutput = document.getElementById('source-output');
const jsonStatus = document.getElementById('json-status');
const templateStatus = document.getElementById('template-status');
const previewStatus = document.getElementById('preview-status');
const sourceErrorHighlights = document.getElementById('source-error-highlights');
const sourceLineNumbers = document.getElementById('source-line-numbers');
const validationDetails = document.getElementById('validation-details');

// Preview tabs (Rendered vs Source toggle)
const previewTabs = document.querySelectorAll('.preview-tab');
const previewViews = document.querySelectorAll('.preview-view');

// Modal elements
const examplesModal = document.getElementById('examples-modal');
const helpModal = document.getElementById('help-modal');
const examplesBtn = document.getElementById('examples-btn');
const helpBtn = document.getElementById('help-btn');

// Options panel elements
const optionsPanel = document.getElementById('options-panel');
const optionsToggleBtn = document.getElementById('options-toggle-btn');
const optionArrayKey = document.getElementById('option-arrayKey');
const optionPathKey = document.getElementById('option-pathKey');
const optionTestPath = document.getElementById('option-testPath');
const optionRelativeURLPrefix = document.getElementById('option-relativeURLPrefix');
const optionGenericFallback = document.getElementById('option-genericFallback');

// State
let debounceTimer = null;
let validationDelayTimer = null;
let abortController = null;
const DEBOUNCE_DELAY = 300;
const VALIDATION_DELAY = 200; // Delay before showing validation errors (less jarring UX)

// Prism loading promise - ensures single load and allows awaiting
let prismLoadPromise = null;

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Convert a character offset in a string to a line:col position (1-based)
 * @param {string} text - Full text content
 * @param {number} pos - Character offset
 * @returns {{ line: number, col: number }}
 */
function positionToLineCol(text, pos) {
  const before = text.substring(0, pos);
  const lines = before.split('\n');
  return { line: lines.length, col: lines[lines.length - 1].length + 1 };
}

/**
 * Find the last unclosed {{#section}} opening using a stack.
 * Handles nested sections of the same name correctly.
 * @param {string} text - Template text
 * @param {string} escapedName - Regex-escaped section name
 * @param {number} [limit] - Only scan up to this character index (exclusive)
 * @returns {number} Character index of unclosed opening, or -1
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

/**
 * Return the sigil character ('#' or '^') of a Mustache opening tag at charIndex.
 * Falls back to '#' if the position doesn't look like a tag opener.
 * @param {string} text
 * @param {number} charIndex
 * @returns {string}
 */
function sectionSigilAt(text, charIndex) {
  const after = text.slice(charIndex + 2).trimStart();
  return after.startsWith('^') ? '^' : '#';
}

/**
 * Update line number gutter for an editor
 * @param {HTMLTextAreaElement} textarea - Source textarea
 * @param {HTMLElement} lineNumbersEl - Line numbers element
 */
function updateLineNumbers(textarea, lineNumbersEl) {
  if (!lineNumbersEl) return;
  const lineCount = (textarea.value.match(/\n/g) || []).length + 1;
  lineNumbersEl.textContent = Array.from({ length: lineCount }, (_, i) => i + 1).join('\n');
}

/**
 * Reposition the error line highlight to account for the textarea's current scroll offset.
 * Called on initial placement and whenever the textarea scrolls.
 * @param {HTMLTextAreaElement} textarea
 * @param {HTMLElement} highlightEl
 */
function syncErrorHighlight(textarea, highlightEl) {
  const line = parseInt(highlightEl.dataset.errorLine, 10);
  if (!line) return;
  const style = getComputedStyle(textarea);
  const paddingTop = parseFloat(style.paddingTop);
  const lineHeight = parseFloat(style.lineHeight);
  highlightEl.style.top = `${paddingTop + (line - 1) * lineHeight - textarea.scrollTop}px`;
}

/**
 * Show or hide the error line highlight band in an editor.
 * Pass line=0 (or omit) to clear the highlight.
 * @param {HTMLTextAreaElement} textarea - The editor textarea (used to measure line height)
 * @param {HTMLElement} highlightEl - The .error-line-highlight div
 * @param {number} [line] - 1-based line number to highlight
 */
function setErrorHighlight(textarea, highlightEl, line) {
  if (!highlightEl) return;
  if (!line || line < 1) {
    highlightEl.style.display = 'none';
    highlightEl.dataset.errorLine = '';
    return;
  }
  const style = getComputedStyle(textarea);
  const paddingTop = parseFloat(style.paddingTop);
  const lineHeight = parseFloat(style.lineHeight);
  highlightEl.dataset.errorLine = line;
  highlightEl.style.height = `${lineHeight}px`;
  highlightEl.style.display = 'block';
  // Only scroll if the error line is not already visible in the viewport
  const lineTop = paddingTop + (line - 1) * lineHeight;
  const lineBottom = lineTop + lineHeight;
  const { scrollTop, clientHeight } = textarea;
  const isVisible = lineTop >= scrollTop && lineBottom <= scrollTop + clientHeight;
  if (!isVisible) {
    const visibleCenter = (clientHeight - lineHeight) / 2;
    textarea.scrollTop = Math.max(0, lineTop - visibleCenter);
  }
  syncErrorHighlight(textarea, highlightEl);
}

/**
 * Show a toast notification
 * Appends to <main> so it works in fullscreen mode
 * @param {string} message - Toast message
 */
function showToast(message) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  // Append to main so it's visible in fullscreen mode
  const main = document.querySelector('main');
  (main || document.body).appendChild(toast);
  setTimeout(() => toast.remove(), 2000);
}

/**
 * Get status icon based on type
 * @param {string} type - 'ok', 'error', or 'warning'
 * @returns {string} Icon character
 */
function getStatusIcon(type) {
  if (type === 'ok') return '✓';
  if (type === 'error') return '✗';
  return '⚠';
}

/**
 * Update status indicator
 * @param {HTMLElement} statusEl - Status element
 * @param {string} type - 'ok', 'error', or 'warning'
 * @param {string} message - Status message
 */
function updateStatus(statusEl, type, message) {
  if (!statusEl) return;

  const icon = statusEl.querySelector('.status-icon');
  const text = statusEl.querySelector('.status-text');

  if (icon) {
    icon.className = `status-icon status-${type}`;
    icon.textContent = getStatusIcon(type);
  }

  if (text) {
    text.textContent = message;
  }
}

/**
 * Update preview status bar (icon + text).
 * @param {string} type - 'ok', 'error', or 'warning'
 * @param {string} message - Status message
 */
function updatePreviewStatus(type, message) {
  updateStatus(previewStatus, type, message);
}

/**
 * Update preview iframe and source view
 * @param {string} html - HTML content
 */
function updatePreview(html) {
  // Update iframe
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
          .badge {
            display: inline-block;
            padding: 2px 8px;
            background: #0066cc;
            color: white;
            border-radius: 4px;
            font-size: 12px;
            margin-left: 8px;
          }
          .enabled { color: #2a7; }
          footer { margin-top: 24px; padding-top: 16px; border-top: 1px solid #eee; }
          .role { color: #666; font-size: 14px; }
          
          /* Scrollbar styling to match design system */
          ::-webkit-scrollbar {
            width: 24px;
            height: 24px;
            background: white;
          }
          ::-webkit-scrollbar-track {
            background: white;
          }
          ::-webkit-scrollbar-thumb {
            background-color: #8f8f8f;
            border: 8px solid white;
            border-radius: 12px;
          }
          ::-webkit-scrollbar-thumb:hover {
            background-color: #717171;
          }
        </style>
      </head>
      <body>${html}</body>
      </html>
    `;
    previewFrame.srcdoc = doc;
  }

  // Update source view with syntax highlighting
  if (sourceOutput) {
    const codeEl = sourceOutput.querySelector('code');
    if (codeEl) {
      codeEl.textContent = html;
      codeEl.className = 'language-html';
      highlight(codeEl);
    }
  }

  // Update source line numbers
  if (sourceLineNumbers) {
    const lineCount = html ? (html.match(/\n/g) || []).length + 1 : 0;
    sourceLineNumbers.textContent = Array.from(
      { length: lineCount },
      (_, i) => i + 1,
    ).join('\n');
  }
}

/**
 * Get rendered HTML
 * @returns {string} Current HTML output
 */
function getRenderedHtml() {
  const codeEl = sourceOutput?.querySelector('code');
  return codeEl?.textContent || '';
}

/**
 * Sync scroll position from textarea to highlight overlay
 * @param {HTMLElement} textarea - Source textarea
 * @param {HTMLElement} highlightEl - Target highlight element
 */
function syncScroll(textarea, highlightEl) {
  if (highlightEl) {
    highlightEl.scrollTop = textarea.scrollTop;
    highlightEl.scrollLeft = textarea.scrollLeft;
  }
}

/**
 * Ensure Prism library is loaded (returns cached promise for deduplication)
 * @returns {Promise<void>}
 */
function ensurePrismReady() {
  if (!prismLoadPromise) {
    prismLoadPromise = loadPrismLibrary(PRISM_LANGUAGES);
  }
  return prismLoadPromise;
}

/**
 * Update highlight overlay with syntax-highlighted content
 * @param {HTMLElement} textarea - Source textarea
 * @param {HTMLElement} highlightEl - Target highlight element
 * @param {string} language - Prism language class (e.g., 'json', 'html')
 */
function updateEditorHighlight(textarea, highlightEl, language) {
  if (!highlightEl) return;

  const codeEl = highlightEl.querySelector('code');
  if (!codeEl) return;

  let text = textarea.value;

  // Handle trailing newline to avoid rendering issues
  if (text[text.length - 1] === '\n') {
    text += ' ';
  }

  // Update content and apply highlighting
  // (Prism is guaranteed loaded before listeners are set up)
  codeEl.textContent = text;
  codeEl.className = `language-${language}`;
  highlight(codeEl);
}

/**
 * Highlight source code with Prism.js
 */
async function highlightSource() {
  const codeEl = sourceOutput?.querySelector('code');
  if (!codeEl) return;

  // Ensure the language class is set for HTML
  codeEl.className = 'language-html';

  // Ensure Prism is loaded before highlighting
  await ensurePrismReady();

  // Use the shared highlight utility
  highlight(codeEl);
}

/**
 * Update all editor highlights
 */
async function updateAllEditorHighlights() {
  // Ensure Prism is loaded first
  await ensurePrismReady();

  // Now apply highlighting synchronously
  updateEditorHighlight(jsonInput, jsonHighlight, 'json');
  updateEditorHighlight(templateInput, templateHighlight, 'handlebars');
}

/**
 * Validate JSON input
 * @returns {Object|null} Parsed JSON or null if invalid
 */
function validateJson() {
  const value = jsonInput?.value ?? '';
  if (!value.trim()) {
    updateStatus(jsonStatus, 'warning', 'Empty JSON');
    setErrorHighlight(jsonInput, jsonErrorHighlight);
    return null;
  }

  try {
    const parsed = JSON.parse(value);
    updateStatus(jsonStatus, 'ok', 'Valid JSON');
    setErrorHighlight(jsonInput, jsonErrorHighlight);
    return parsed;
  } catch (e) {
    const match = e.message.match(/position (\d+)/);
    if (match) {
      const { line } = positionToLineCol(value, parseInt(match[1], 10));
      updateStatus(jsonStatus, 'error', `Invalid JSON at line ${line}`);
      setErrorHighlight(jsonInput, jsonErrorHighlight, line);
    } else {
      updateStatus(jsonStatus, 'error', 'Invalid JSON');
      setErrorHighlight(jsonInput, jsonErrorHighlight);
    }
    return null;
  }
}

/**
 * Format JSON input
 */
function formatJson() {
  const parsed = validateJson();
  if (parsed && jsonInput) {
    jsonInput.value = JSON.stringify(parsed, null, 2);
    updateEditorHighlight(jsonInput, jsonHighlight, 'json');
    updateLineNumbers(jsonInput, jsonLineNumbers);
    updateStatus(jsonStatus, 'ok', 'Formatted');
  }
}

/**
 * Escape HTML special characters so strings can be safely injected via innerHTML.
 * @param {string} str - Raw string
 * @returns {string} Escaped string
 */
function escapeHtml(str) {
  const el = document.createElement('span');
  el.textContent = str;
  return el.innerHTML;
}

/**
 * Get nested value from object using dot notation path
 * @param {Object} obj - Object to traverse
 * @param {string} path - Dot notation path (e.g., "data.items")
 * @returns {*} Value at path or undefined
 */
function getNestedValue(obj, path) {
  if (!path || !obj) return obj;

  return path.split('.').reduce((current, key) => (current != null ? current[key] : undefined), obj);
}

/**
 * Get current simulator options from the options panel
 * @returns {Object} Options object (only includes non-empty values)
 */
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

/**
 * Validate that options and template are compatible
 * @param {Object} jsonData - Parsed JSON data
 * @param {Object} options - Simulator options
 * @param {string} template - Mustache template
 * @returns {Object|null} Error object or null if valid
 */
function validateOptionsTemplateCompatibility(jsonData, options, template) {
  if (!jsonData || !options || !template?.trim()) {
    return null;
  }

  // Check arrayKey + template mismatch
  if (options.arrayKey) {
    const arrayData = getNestedValue(jsonData, options.arrayKey);

    // Check if arrayKey path exists
    if (arrayData === undefined) {
      return {
        type: 'invalid_path',
        title: 'Invalid arrayKey Path',
        message: `The path "${options.arrayKey}" doesn't exist in your JSON data.`,
        suggestion: 'Check your JSON structure and verify the arrayKey path is correct.',
      };
    }

    // Check if arrayKey points to an array
    if (Array.isArray(arrayData)) {
      // If pathKey + testPath are set, the array is filtered to a single item
      // In this case, the template doesn't need {{#.}}...{{/.}} syntax
      const isFilteringToSingleItem = options.pathKey && options.testPath;

      if (!isFilteringToSingleItem) {
        // Check if template uses array iteration syntax
        // Matches: {{#.}}, {{#.  }}, {{# .}}, etc.
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

  // Check pathKey/testPath without arrayKey
  if ((options.pathKey || options.testPath) && !options.arrayKey) {
    return {
      type: 'missing_arrayKey',
      title: 'Missing arrayKey Option',
      message: 'You\'re using pathKey or testPath without arrayKey.',
      suggestion: 'The pathKey and testPath options work together with arrayKey to filter arrays. Add an arrayKey option to specify which array to filter.',
    };
  }

  return null; // Valid
}

// ============================================================================
// RENDER FUNCTION
// ============================================================================

/**
 * Show/hide loading indicator
 * @param {boolean} show - Whether to show loading state
 */
function setLoadingState(show) {
  const renderButton = document.getElementById('render-btn');
  if (renderButton) {
    renderButton.disabled = show;
    renderButton.textContent = show ? '⏳ Rendering...' : '▶ Render';
  }
  if (show) {
    updatePreviewStatus('ok', 'Rendering…');
  }
}

/**
 * Display a validation error in the dedicated validation message area.
 * Uses a small delay to avoid jarring UX when user is still typing.
 * @param {Object} error - Error object with type, title, message, suggestion
 */
function displayValidationError(error) {
  // Clear any pending validation display
  if (validationDelayTimer) {
    clearTimeout(validationDelayTimer);
  }

  // Delay showing validation to avoid jarring UX while typing
  validationDelayTimer = setTimeout(() => {
    const validationContainer = document.getElementById('validation-message');
    const validationTitle = document.getElementById('validation-title');
    const validationText = document.getElementById('validation-text');
    const validationSuggestion = document.getElementById('validation-suggestion');

    if (!validationContainer || !validationTitle || !validationText || !validationSuggestion) {
      return;
    }

    // Set content
    validationTitle.textContent = error.title;
    validationText.textContent = error.message;
    validationSuggestion.innerHTML = `<strong>💡 How to fix:</strong>${error.suggestion}`;

    // Show the validation message
    validationContainer.hidden = false;

    // Update status bar
    updateStatus(templateStatus, 'warning', `Validation: ${error.title}`);
  }, VALIDATION_DELAY);
}

/**
 * Hide the validation error message
 */
function hideValidationError() {
  // Clear any pending validation display
  if (validationDelayTimer) {
    clearTimeout(validationDelayTimer);
    validationDelayTimer = null;
  }

  const validationContainer = document.getElementById('validation-message');
  if (validationContainer) {
    validationContainer.hidden = true;
  }
}

/**
 * Hide the validation details panel and reset the status bar toggle state.
 */
function collapseValidationDetails() {
  if (validationDetails) {
    validationDetails.hidden = true;
    validationDetails.innerHTML = '';
  }
  if (previewStatus) {
    previewStatus.classList.remove('has-details', 'expanded');
  }
}

/**
 * Hide HTML validation status and source error highlights.
 * Shows a neutral message when no preview is available.
 */
function hideHtmlValidation() {
  updatePreviewStatus('error', 'No preview — fix errors above');
  collapseValidationDetails();
  if (sourceErrorHighlights) {
    sourceErrorHighlights.innerHTML = '';
  }
}

/**
 * Render error/warning line highlights in the source view.
 * Measures actual line height from the source `<pre>` and positions
 * translucent bands over each flagged line, matching the
 * textarea-based error-line-highlight pattern used by the editors.
 * @param {Array} results - Validation result items with line and severity
 */
function renderSourceHighlights(results) {
  if (!sourceErrorHighlights || !sourceOutput) return;

  const linesWithIssues = results.filter((r) => r.line);
  if (linesWithIssues.length === 0) {
    sourceErrorHighlights.innerHTML = '';
    return;
  }

  const style = getComputedStyle(sourceOutput);
  const paddingTop = parseFloat(style.paddingTop);
  const lineHeight = parseFloat(style.lineHeight);

  const seen = new Set();
  sourceErrorHighlights.innerHTML = linesWithIssues.map((r) => {
    if (seen.has(r.line)) return '';
    seen.add(r.line);
    const top = paddingTop + (r.line - 1) * lineHeight;
    const cls = r.severity === 'error'
      ? 'source-highlight-error' : 'source-highlight-warning';
    return `<div class="source-highlight ${cls}" `
      + `style="top:${top}px;height:${lineHeight}px" `
      + `title="${escapeHtml(r.message)}"></div>`;
  }).join('');
}

/**
 * Keep source line numbers and error highlights in sync when the `<pre>` scrolls.
 */
function syncSourceOverlays() {
  if (!sourceOutput) return;
  const { scrollTop } = sourceOutput;
  if (sourceLineNumbers) sourceLineNumbers.scrollTop = scrollTop;
  if (sourceErrorHighlights) {
    sourceErrorHighlights.style.transform = `translateY(-${scrollTop}px)`;
  }
}

/**
 * Build a human-readable status message from validation results.
 * Shows the first (most severe) message with line info, plus a
 * "+N more" suffix when additional issues exist.
 * @param {Array} results - Validation result items
 * @returns {{ type: string, message: string }}
 */
function formatValidationStatus(results) {
  if (results.length === 0) {
    return { type: 'ok', message: 'Valid EDS HTML' };
  }

  const errors = results.filter((r) => r.severity === 'error');
  const worst = errors.length > 0 ? errors[0] : results[0];
  const type = errors.length > 0 ? 'error' : 'warning';

  let msg = worst.message;
  if (worst.line) msg += ` (line ${worst.line})`;

  const remaining = results.length - 1;
  if (remaining > 0) {
    msg += ` (+${remaining} more)`;
  }

  return { type, message: msg };
}

/**
 * Scroll the source `<pre>` to bring a specific line into view.
 * @param {number} line - 1-based line number
 */
function scrollSourceToLine(line) {
  if (!sourceOutput || !line) return;
  const style = getComputedStyle(sourceOutput);
  const paddingTop = parseFloat(style.paddingTop);
  const lineHeight = parseFloat(style.lineHeight);
  const lineTop = paddingTop + (line - 1) * lineHeight;
  const center = (sourceOutput.clientHeight - lineHeight) / 2;
  sourceOutput.scrollTop = Math.max(0, lineTop - center);
}

/**
 * Populate the expandable validation detail list.
 * Each row shows severity icon, message, and line number.
 * Clicking a row scrolls the source to that line.
 * @param {Array} results - Validation result items
 */
function buildValidationDetails(results) {
  if (!validationDetails || results.length < 2) {
    collapseValidationDetails();
    return;
  }

  validationDetails.innerHTML = results.map((r) => {
    const icon = r.severity === 'error' ? '✗' : '⚠';
    const lineAttr = r.line ? ` data-line="${r.line}"` : '';
    const lineLabel = r.line ? `<span class="detail-line">line ${r.line}</span>` : '';
    return `<div class="validation-detail-row"${lineAttr}>`
      + `<span class="detail-severity">${icon}</span>`
      + `<span class="detail-msg">${escapeHtml(r.message)}</span>`
      + `${lineLabel}</div>`;
  }).join('');

  validationDetails.hidden = true;
  validationDetails.querySelectorAll('.validation-detail-row').forEach((row) => {
    row.addEventListener('click', () => {
      const line = parseInt(row.dataset.line, 10);
      if (line) scrollSourceToLine(line);
    });
  });

  previewStatus?.classList.add('has-details');
}

/**
 * Display HTML validation results from the server.
 * Updates the preview status bar and highlights error lines in the source.
 * @param {object} validation - Validation result from /simulator
 */
function displayHtmlValidation(validation) {
  if (!validation) {
    hideHtmlValidation();
    return;
  }

  const { results } = validation;
  const { type, message } = formatValidationStatus(results);
  updatePreviewStatus(type, message);
  renderSourceHighlights(results);
  buildValidationDetails(results);
}

/**
 * POST to the simulator endpoint and return the rendered HTML.
 * Throws with a human-readable message on HTTP or server errors.
 * @param {string} jsonValue - Raw JSON string
 * @param {string} template - Mustache template string
 * @param {Object} options - Simulator options
 * @param {AbortSignal} signal - Abort signal for cancellation
 * @returns {Promise<{html: string, validation: object}>} Rendered HTML with validation
 */
async function fetchRenderedHtml(jsonValue, template, options, signal) {
  const requestBody = {
    json: encodeURIComponent(jsonValue),
    template: encodeURIComponent(template),
  };
  if (Object.keys(options).length > 0) {
    requestBody.options = options;
  }

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

  return response.json();
}

/**
 * Translate a raw Mustache error message into a human-readable form
 * by converting character offsets to line numbers and clarifying error types.
 * Pure function — no side effects.
 * @param {string} rawMessage - Error message from the simulator
 * @param {string} templateText - Current template content
 * @returns {string} Human-readable error message
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
      // EOF case: position is end-of-template — find where the section actually opened.
      const openPos = findUnclosedSectionOpening(templateText, sectionName);
      const suffix = openPos !== -1
        ? `opened at line ${positionToLineCol(templateText, openPos).line}` : '';
      return msg.replace(/\bat \d+$/, suffix);
    }

    // Mismatch case: a {{/wrongTag}} was encountered while this section was open.
    const wrongTagMatch = templateText.substring(charPos).match(/^\{\{\/\s*([^}\s]+)\s*\}\}/);
    if (wrongTagMatch && wrongTagMatch[1] !== unclosedSectionMatch[1]) {
      const wrongLine = positionToLineCol(templateText, charPos).line;
      const wrongEscaped = wrongTagMatch[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const wrongOpenPos = findUnclosedSectionOpening(templateText, wrongEscaped, charPos);

      if (wrongOpenPos === -1) {
        // Orphan close tag: the wrong tag has no opener before it.
        // The Mustache stack tells us exactly which section IS open — no guessing.
        const openSectionName = unclosedSectionMatch[1];
        // Limit scan to charPos so a later {{/name}} doesn't pop the stack.
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

      // Out-of-order: the named section is genuinely unclosed.
      // Limit to charPos so a later {{/sectionName}} doesn't pop the stack.
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
    // "Unclosed tag" reports end-of-template — find the last unmatched {{.
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

  // "Unopened section" and all other errors report an accurate position.
  const { line } = positionToLineCol(templateText, charPos);
  const unopenedMatch = msg.match(/^Unopened section "([^"]+)"/);
  if (unopenedMatch) {
    const tagName = unopenedMatch[1];
    return `Unexpected {{/${tagName}}} at line ${line} — no opening {{#${tagName}}} found`;
  }
  return msg.replace(/\bat \d+$/, `at line ${line}`);
}

/**
 * Render the template with JSON data via /simulator endpoint
 */
async function render() {
  const jsonValue = jsonInput?.value?.trim();
  const template = templateInput?.value || '';

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
    setErrorHighlight(templateInput, templateErrorHighlight);
    displayHtmlValidation(result.validation);
  } catch (e) {
    if (e.name === 'AbortError') return;

    hideHtmlValidation();
    if (e.message === 'Failed to fetch') {
      updatePreview('');
      updateStatus(templateStatus, 'error', 'Connection failed');
      setErrorHighlight(templateInput, templateErrorHighlight);
    } else {
      const errorMessage = humanizeRenderError(e.message, templateInput?.value ?? '');
      updatePreview('');
      updateStatus(templateStatus, 'error', `Render error: ${errorMessage}`);
      const lineMatch = errorMessage.match(/\bline (\d+)/);
      const errorLine = lineMatch ? parseInt(lineMatch[1], 10) : 0;
      setErrorHighlight(templateInput, templateErrorHighlight, errorLine);
    }
  } finally {
    setLoadingState(false);
  }
}

/**
 * Load an example template
 * @param {string} exampleType - Type of example to load
 */
async function loadExample(exampleType) {
  const example = examples[exampleType];
  if (example) {
    // Load JSON and template
    if (jsonInput) {
      jsonInput.value = JSON.stringify(example.json, null, 2);
    }
    if (templateInput) {
      templateInput.value = example.template;
    }

    // Load options if present (clear if not)
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

      // Show options panel if options are set
      if (optionsPanel && optionsPanel.hidden) {
        optionsPanel.hidden = false;
        optionsToggleBtn?.classList.add('active');
      }
    } else {
      // Clear all options
      if (optionArrayKey) optionArrayKey.value = '';
      if (optionPathKey) optionPathKey.value = '';
      if (optionTestPath) optionTestPath.value = '';
      if (optionRelativeURLPrefix) optionRelativeURLPrefix.value = '';
      if (optionGenericFallback) optionGenericFallback.checked = false;
    }

    validateJson();
    updateLineNumbers(jsonInput, jsonLineNumbers);
    updateLineNumbers(templateInput, templateLineNumbers);
    await updateAllEditorHighlights();
    await render();
  }
}

// ============================================================================
// SETUP FUNCTIONS
// ============================================================================

/**
 * Setup preview tab switching (Rendered vs Source)
 */
function setupPreviewTabs() {
  previewTabs.forEach((tab) => {
    tab.addEventListener('click', async () => {
      const viewType = tab.dataset.view;

      // Update tab states
      previewTabs.forEach((t) => {
        t.classList.remove('active');
        t.setAttribute('aria-selected', 'false');
      });
      tab.classList.add('active');
      tab.setAttribute('aria-selected', 'true');

      // Update view visibility
      previewViews.forEach((view) => {
        if (view.dataset.view === viewType) {
          view.classList.add('active');
          view.removeAttribute('hidden');
        } else {
          view.classList.remove('active');
          view.setAttribute('hidden', '');
        }
      });

      // Highlight source code when switching to Source view
      if (viewType === 'source') {
        await highlightSource();
      }
    });
  });
}

/**
 * Setup modal dialogs
 */
function setupModals() {
  // Examples modal
  examplesBtn?.addEventListener('click', () => {
    examplesModal?.showModal();
  });

  // Help modal
  helpBtn?.addEventListener('click', () => {
    helpModal?.showModal();
  });

  // Close buttons
  document.querySelectorAll('.modal-close').forEach((btn) => {
    btn.addEventListener('click', () => {
      btn.closest('dialog')?.close();
    });
  });

  // Click outside to close
  [examplesModal, helpModal].forEach((modal) => {
    modal?.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.close();
      }
    });
  });

  // Example card clicks
  document.querySelectorAll('.example-card').forEach((card) => {
    card.addEventListener('click', () => {
      const exampleType = card.dataset.example;
      loadExample(exampleType);
      examplesModal?.close();
    });
  });
}

/**
 * Setup editor input listeners for auto-render
 */
function setupEditorListeners() {
  const handleInput = () => {
    // Always auto-render with debounce
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(render, DEBOUNCE_DELAY);
  };

  // JSON input listeners
  jsonInput?.addEventListener('input', () => {
    validateJson();
    updateEditorHighlight(jsonInput, jsonHighlight, 'json');
    updateLineNumbers(jsonInput, jsonLineNumbers);
    handleInput();
  });

  jsonInput?.addEventListener('scroll', () => {
    syncScroll(jsonInput, jsonHighlight);
    if (jsonLineNumbers) jsonLineNumbers.scrollTop = jsonInput.scrollTop;
    syncErrorHighlight(jsonInput, jsonErrorHighlight);
  });

  // Template input listeners
  templateInput?.addEventListener('input', () => {
    updateEditorHighlight(templateInput, templateHighlight, 'handlebars');
    updateLineNumbers(templateInput, templateLineNumbers);
    handleInput();
  });

  templateInput?.addEventListener('scroll', () => {
    syncScroll(templateInput, templateHighlight);
    if (templateLineNumbers) templateLineNumbers.scrollTop = templateInput.scrollTop;
    syncErrorHighlight(templateInput, templateErrorHighlight);
  });

  sourceOutput?.addEventListener('scroll', syncSourceOverlays);
}

/**
 * Setup resizable panels - both vertical (JSON/Template) and horizontal (editors/preview)
 */
function setupResizer() {
  // Vertical resizer (between JSON and Template panels)
  const verticalResizer = document.getElementById('resizer-vertical');
  const jsonPanel = document.querySelector('.json-panel');
  const editorsRow = document.querySelector('.editors-row');

  // Horizontal resizer (between editors row and preview panel)
  const horizontalResizer = document.getElementById('resizer-horizontal');
  const workspace = document.querySelector('.workspace');

  let activeResizer = null;
  let startPos = 0;
  let startSize = 0;

  // Vertical resizer (col-resize)
  if (verticalResizer && jsonPanel && editorsRow) {
    verticalResizer.addEventListener('mousedown', (e) => {
      activeResizer = 'vertical';
      startPos = e.clientX;
      startSize = jsonPanel.offsetWidth;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    });
  }

  // Horizontal resizer (row-resize)
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

      // Limit to 20% - 80% of container
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

      // Limit to 20% - 80% of container
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

/**
 * Setup options panel toggle and input listeners
 */
function setupOptionsPanel() {
  // Toggle options panel visibility
  optionsToggleBtn?.addEventListener('click', () => {
    const isHidden = optionsPanel?.hidden;
    if (optionsPanel) {
      optionsPanel.hidden = !isHidden;
    }
    // Update button visual state
    if (optionsToggleBtn) {
      optionsToggleBtn.classList.toggle('active', isHidden);
    }
  });

  // Always auto-render when options change
  const handleOptionChange = () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(render, DEBOUNCE_DELAY);
  };

  // Add listeners to all option inputs
  optionArrayKey?.addEventListener('input', handleOptionChange);
  optionPathKey?.addEventListener('input', handleOptionChange);
  optionTestPath?.addEventListener('input', handleOptionChange);
  optionRelativeURLPrefix?.addEventListener('input', handleOptionChange);
  optionGenericFallback?.addEventListener('change', handleOptionChange);
}

/**
 * Setup action buttons
 */
function setupButtons() {
  // Copy HTML button
  const copyBtn = document.getElementById('copy-html');
  copyBtn?.addEventListener('click', async () => {
    const html = getRenderedHtml();
    if (html) {
      await navigator.clipboard.writeText(html);
      showToast('HTML copied to clipboard!');
    }
  });

  // Fullscreen button - fullscreen the entire tool
  const fullscreenBtn = document.getElementById('fullscreen-btn');
  fullscreenBtn?.addEventListener('click', () => {
    const mainElement = document.querySelector('main');
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      mainElement?.requestFullscreen();
    }
  });

  // Format JSON button
  const formatJsonBtn = document.getElementById('format-json');
  formatJsonBtn?.addEventListener('click', formatJson);

  // Validation close button
  const validationCloseBtn = document.getElementById('validation-close');
  validationCloseBtn?.addEventListener('click', hideValidationError);

  // Toggle validation details when clicking the preview status bar
  previewStatus?.addEventListener('click', () => {
    if (!previewStatus.classList.contains('has-details')) return;
    const isExpanded = previewStatus.classList.toggle('expanded');
    if (validationDetails) validationDetails.hidden = !isExpanded;
  });
}

/**
 * Setup keyboard shortcuts
 */
function setupKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    // Cmd+Enter (Mac) or Ctrl+Enter (Windows/Linux) for immediate render
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      clearTimeout(debounceTimer); // Cancel any pending debounced render
      render(); // Render immediately without debounce

      // Brief visual feedback
      const statusText = previewStatus?.querySelector('.status-text');
      if (statusText) {
        const originalText = statusText.textContent;
        statusText.textContent = '⚡ Rendered instantly';
        setTimeout(() => {
          statusText.textContent = originalText;
        }, 2000);
      }
    }
  });
}

// ============================================================================
// INITIALIZATION
// ============================================================================

/**
 * Create validation message element dynamically inside <main>.
 * Must be done in JS after page load to:
 * 1. Avoid AEM auto-blocking (decorateBlocks targets div.section > div > div)
 * 2. Avoid scripts.js side-nav detection (looks for main > aside)
 * 3. Work in fullscreen mode (element must be inside <main>)
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

/**
 * Initialize the simulator
 */
async function init() {
  // Load Prism FIRST - must complete before input listeners are active
  await ensurePrismReady();

  // Create validation message dynamically (avoids AEM decoration and side-nav detection)
  createValidationMessage();

  // Set up UI components
  setupPreviewTabs();
  setupModals();
  setupEditorListeners();
  setupResizer();
  setupButtons();
  setupOptionsPanel();
  setupKeyboardShortcuts();

  // Initialize editor syntax highlighting (Prism is now guaranteed loaded)
  await updateAllEditorHighlights();

  // Initialize line numbers for both editors
  updateLineNumbers(jsonInput, jsonLineNumbers);
  updateLineNumbers(templateInput, templateLineNumbers);

  // Initial render
  render();
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
