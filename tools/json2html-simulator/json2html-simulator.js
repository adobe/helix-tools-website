/**
 * JSON2HTML Simulator - Interactive tool for experimenting with Mustache templates
 * Uses server-side rendering via /simulator endpoint
 */

import { highlight, loadPrismLibrary } from '../../utils/prism/prism.js';

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
// eslint-disable-next-line prefer-destructuring
const jsonLineNumbers = document.getElementById('json-line-numbers');
const templateLineNumbers = document.getElementById('template-line-numbers');
const jsonErrorHighlight = document.getElementById('json-error-highlight');
const templateErrorHighlight = document.getElementById('template-error-highlight');
const previewFrame = document.getElementById('preview-frame');
const sourceOutput = document.getElementById('source-output');
const jsonStatus = document.getElementById('json-status');
const templateStatus = document.getElementById('template-status');
const previewStatus = document.getElementById('preview-status');

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
 * Update preview status text
 * @param {string} message - Status message
 */
function updatePreviewStatus(message) {
  const statusText = previewStatus?.querySelector('.status-text');
  if (statusText) {
    statusText.textContent = message;
  }
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
  const value = jsonInput?.value?.trim();
  if (!value) {
    updateStatus(jsonStatus, 'warning', 'Empty JSON');
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
    updateStatus(jsonStatus, 'ok', 'Formatted');
  }
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
          return {
            type: 'array_iteration_missing',
            title: 'Template Missing Array Iteration',
            message: `Your arrayKey "${options.arrayKey}" points to an array with ${arrayData.length} item${arrayData.length === 1 ? '' : 's'}, but your template doesn't iterate over it.`,
            suggestion: `Wrap your template in <code>{{#.}}...{{/.}}</code> to loop over array items.<br><br>
<strong>Example:</strong><br>
<code>{{#.}}<br>
&nbsp;&nbsp;&lt;h1&gt;{{name}}&lt;/h1&gt;<br>
&nbsp;&nbsp;&lt;p&gt;{{description}}&lt;/p&gt;<br>
{{/.}}</code><br><br>
<strong>Alternative:</strong> Remove arrayKey and use <code>{{#${options.arrayKey}}}...{{/${options.arrayKey}}}</code> in your template instead.`,
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
    updatePreviewStatus('Rendering...');
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
 * POST to the simulator endpoint and return the rendered HTML.
 * Throws with a human-readable message on HTTP or server errors.
 * @param {string} jsonValue - Raw JSON string
 * @param {string} template - Mustache template string
 * @param {Object} options - Simulator options
 * @param {AbortSignal} signal - Abort signal for cancellation
 * @returns {Promise<string>} Rendered HTML
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

  return response.text();
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
    return;
  }

  const options = getSimulatorOptions();
  const validationError = validateOptionsTemplateCompatibility(jsonData, options, template);
  if (validationError) {
    displayValidationError(validationError);
    return;
  }
  hideValidationError();

  if (abortController) abortController.abort();
  abortController = new AbortController();
  setLoadingState(true);

  try {
    const html = await fetchRenderedHtml(jsonValue, template, options, abortController.signal);
    updatePreview(html);
    updateStatus(templateStatus, 'ok', 'Rendered successfully');
    setErrorHighlight(templateInput, templateErrorHighlight);
    updatePreviewStatus('Last rendered: just now');
  } catch (e) {
    if (e.name === 'AbortError') return;

    if (e.message === 'Failed to fetch') {
      updatePreview('');
      updateStatus(templateStatus, 'error', 'Connection failed');
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

// ============================================================================
// EXAMPLES DATA
// ============================================================================

const examples = {
  basic: {
    json: {
      name: 'John Doe',
      email: 'john@example.com',
      message: 'Hello, World!',
    },
    template: `<div class="greeting">
  <h1>Hello, {{name}}!</h1>
  <p>Email: {{email}}</p>
  <blockquote>{{message}}</blockquote>
</div>`,
    // No options - basic example
  },
  array: {
    json: {
      metadata: {
        title: 'Shopping List',
        lastUpdated: '2025-01-06',
      },
      data: {
        items: [
          { name: 'Apples', quantity: 5 },
          { name: 'Bread', quantity: 2 },
          { name: 'Milk', quantity: 1 },
        ],
      },
    },
    template: `<div class="list">
  <h1>Shopping List</h1>
  <ul>
    {{#.}}
    <li>{{name}} (x{{quantity}})</li>
    {{/.}}
  </ul>
</div>`,
    options: {
      arrayKey: 'data.items',
    },
    // Demonstrates: Using arrayKey to navigate to nested array
  },
  conditional: {
    json: {
      user: 'Alice',
      isPremium: true,
      notifications: 3,
      hasNotifications: true,
    },
    template: `<div class="user-status">
  <h1>Welcome, {{user}}!</h1>
  
  {{#isPremium}}
  <p class="badge">⭐ Premium Member</p>
  {{/isPremium}}
  
  {{^isPremium}}
  <p><a href="#">Upgrade to Premium</a></p>
  {{/isPremium}}
  
  {{#hasNotifications}}
  <p>You have {{notifications}} new notifications.</p>
  {{/hasNotifications}}
</div>`,
  },
  nested: {
    json: {
      pages: [
        {
          path: '/about',
          title: 'About Us',
          description: 'Learn about our company',
          author: 'Marketing Team',
        },
        {
          path: '/products',
          title: 'Our Products',
          description: 'Browse our product catalog',
          author: 'Product Team',
        },
        {
          path: '/contact',
          title: 'Contact Us',
          description: 'Get in touch',
          author: 'Support Team',
        },
      ],
    },
    template: `<article class="page">
  <h1>{{title}}</h1>
  <p class="description">{{description}}</p>
  <footer>
    <p class="meta">Created by {{author}}</p>
    <p class="path">Path: {{path}}</p>
  </footer>
</article>`,
    options: {
      arrayKey: 'pages',
      pathKey: 'path',
      testPath: '/products',
    },
    // Demonstrates: Using arrayKey + pathKey + testPath to extract single item from array
  },
  product: {
    json: {
      name: 'Wireless Headphones',
      price: 149.99,
      currency: 'USD',
      inStock: true,
      rating: 4.5,
      features: ['Noise Canceling', 'Bluetooth 5.0', '30hr Battery', 'Foldable'],
      image: '/media/products/headphones.jpg',
      thumbnail: '/media/products/headphones-thumb.jpg',
    },
    template: `<article class="product-card">
  <img src="{{image}}" alt="{{name}}" class="product-image" />
  <h1>{{name}}</h1>
  <p class="price">{{currency}} {{price}}</p>
  
  {{#inStock}}
  <p class="stock in-stock">✓ In Stock</p>
  {{/inStock}}
  {{^inStock}}
  <p class="stock out-of-stock">Out of Stock</p>
  {{/inStock}}
  
  <p class="rating">Rating: {{rating}} / 5</p>
  
  <h2>Features</h2>
  <ul class="features">
    {{#features}}
    <li>{{.}}</li>
    {{/features}}
  </ul>
  
  <img src="{{thumbnail}}" alt="{{name}} thumbnail" class="thumbnail" />
</article>`,
    options: {
      relativeURLPrefix: 'https://cdn.example.com',
    },
    // Demonstrates: Using relativeURLPrefix to rewrite /media/* URLs to full CDN URLs
  },
  event: {
    json: {
      schema: 'event',
      title: 'Tech Conference 2025',
      date: 'March 15, 2025',
      location: 'San Francisco, CA',
      description: 'Join us for the biggest tech event of the year!',
      speakers: [
        { name: 'Jane Smith', topic: 'AI & Machine Learning' },
        { name: 'John Doe', topic: 'Cloud Architecture' },
      ],
      registrationOpen: true,
    },
    template: `<article class="event-page">
  <header>
    <h1>{{title}}</h1>
    <p class="meta">📅 {{date}} | 📍 {{location}}</p>
  </header>
  
  <section class="description">
    <p>{{description}}</p>
  </section>
  
  <section class="speakers">
    <h2>Speakers</h2>
    {{#speakers}}
    <div class="speaker">
      <strong>{{name}}</strong>
      <span>{{topic}}</span>
    </div>
    {{/speakers}}
  </section>
  
  {{#registrationOpen}}
  <footer>
    <button class="register-btn">Register Now</button>
  </footer>
  {{/registrationOpen}}
</article>`,
  },
  contentIndex: {
    json: {
      total: 47,
      offset: 0,
      limit: 10,
      data: [
        {
          path: '/blog/2025/getting-started',
          title: 'Getting Started with Edge Delivery',
          description: 'Learn how to set up your first EDS project in minutes.',
          author: 'Content Team',
          date: '2025-01-05',
          image: '/media/blog/getting-started.jpg',
        },
        {
          path: '/blog/2025/blocks-deep-dive',
          title: 'Building Custom Blocks',
          description: 'A comprehensive guide to creating reusable blocks.',
          author: 'Developer Team',
          date: '2025-01-03',
          image: '/media/blog/blocks.jpg',
        },
        {
          path: '/blog/2024/performance-tips',
          title: 'Keeping Your Score at 100',
          description: 'Best practices for maintaining perfect Lighthouse scores.',
          author: 'Performance Team',
          date: '2024-12-28',
          image: '/media/blog/performance.jpg',
        },
      ],
    },
    template: `<div class="article-index">
  <header class="index-header">
    <p class="pagination-info">Showing {{limit}} of {{total}} articles</p>
  </header>
  
  <div class="article-grid">
    {{#.}}
    <article class="article-card">
      <img src="{{image}}" alt="{{title}}" class="article-image" />
      <div class="article-content">
        <h2><a href="{{path}}">{{title}}</a></h2>
        <p class="description">{{description}}</p>
        <footer class="article-meta">
          <span class="author">By {{author}}</span>
          <span class="date">{{date}}</span>
        </footer>
      </div>
    </article>
    {{/.}}
  </div>
</div>`,
    options: {
      arrayKey: 'data',
    },
    // Demonstrates: Blog/article index from query-index.json with pagination metadata
  },
  storeLocator: {
    json: {
      region: 'San Francisco Bay Area',
      stores: [
        {
          id: 'store-001',
          name: 'Downtown Flagship',
          path: '/stores/downtown',
          address: {
            street: '123 Market Street',
            city: 'San Francisco',
            state: 'CA',
            zip: '94102',
          },
          phone: '(415) 555-0123',
          hours: {
            weekday: '9:00 AM - 9:00 PM',
            weekend: '10:00 AM - 6:00 PM',
          },
          services: ['In-Store Pickup', 'Returns', 'Gift Wrapping', 'Personal Shopping'],
          isOpen: true,
        },
        {
          id: 'store-002',
          name: 'Mission District',
          path: '/stores/mission',
          address: {
            street: '456 Valencia Street',
            city: 'San Francisco',
            state: 'CA',
            zip: '94110',
          },
          phone: '(415) 555-0456',
          hours: {
            weekday: '10:00 AM - 8:00 PM',
            weekend: '11:00 AM - 7:00 PM',
          },
          services: ['In-Store Pickup', 'Returns'],
          isOpen: true,
        },
        {
          id: 'store-003',
          name: 'Palo Alto',
          path: '/stores/palo-alto',
          address: {
            street: '789 University Ave',
            city: 'Palo Alto',
            state: 'CA',
            zip: '94301',
          },
          phone: '(650) 555-0789',
          hours: {
            weekday: '9:00 AM - 9:00 PM',
            weekend: '10:00 AM - 8:00 PM',
          },
          services: ['In-Store Pickup', 'Returns', 'Repairs'],
          isOpen: false,
        },
      ],
    },
    template: `<article class="store-detail">
  <header>
    <h1>{{name}}</h1>
    {{#isOpen}}
    <span class="status open">Open Now</span>
    {{/isOpen}}
    {{^isOpen}}
    <span class="status closed">Currently Closed</span>
    {{/isOpen}}
  </header>
  
  <section class="store-info">
    <div class="address">
      <h2>Address</h2>
      <p>{{address.street}}</p>
      <p>{{address.city}}, {{address.state}} {{address.zip}}</p>
      <p class="phone">📞 {{phone}}</p>
    </div>
    
    <div class="hours">
      <h2>Hours</h2>
      <p><strong>Mon-Fri:</strong> {{hours.weekday}}</p>
      <p><strong>Sat-Sun:</strong> {{hours.weekend}}</p>
    </div>
  </section>
  
  <section class="services">
    <h2>Available Services</h2>
    <ul>
      {{#services}}
      <li>{{.}}</li>
      {{/services}}
    </ul>
  </section>
</article>`,
    options: {
      arrayKey: 'stores',
      pathKey: 'path',
      testPath: '/stores/downtown',
    },
    // Demonstrates: Store locator with nested address, filtering by path
  },
  productCatalog: {
    json: {
      metadata: {
        category: 'Electronics',
        totalProducts: 24,
        currentPage: 1,
      },
      products: [
        {
          sku: 'LAPTOP-001',
          name: 'ProBook 15 Laptop',
          path: '/products/probook-15',
          price: {
            amount: 1299.99,
            currency: 'USD',
            salePrice: 999.99,
            onSale: true,
          },
          availability: 'in-stock',
          images: ['/media/products/probook-main.jpg', '/media/products/probook-side.jpg'],
          rating: {
            score: 4.5,
            reviewCount: 127,
          },
          badges: ['Best Seller', 'Free Shipping'],
        },
        {
          sku: 'TABLET-002',
          name: 'ProTab 10 Tablet',
          path: '/products/protab-10',
          price: {
            amount: 599.99,
            currency: 'USD',
            salePrice: null,
            onSale: false,
          },
          availability: 'in-stock',
          images: ['/media/products/protab-main.jpg'],
          rating: {
            score: 4.2,
            reviewCount: 89,
          },
          badges: ['New Arrival'],
        },
        {
          sku: 'MONITOR-003',
          name: 'UltraView 27" Monitor',
          path: '/products/ultraview-27',
          price: {
            amount: 449.99,
            currency: 'USD',
            salePrice: 379.99,
            onSale: true,
          },
          availability: 'low-stock',
          images: ['/media/products/ultraview-main.jpg'],
          rating: {
            score: 4.8,
            reviewCount: 256,
          },
          badges: ['Top Rated'],
        },
      ],
    },
    template: `<article class="product-detail">
  <div class="product-gallery">
    {{#images}}
    <img src="{{.}}" alt="{{name}}" class="product-image" />
    {{/images}}
  </div>
  
  <div class="product-info">
    <div class="badges">
      {{#badges}}
      <span class="badge">{{.}}</span>
      {{/badges}}
    </div>
    
    <h1>{{name}}</h1>
    <p class="sku">SKU: {{sku}}</p>
    
    <div class="pricing">
      {{#price.onSale}}
      <span class="original-price">{{price.currency}} {{price.amount}}</span>
      <span class="sale-price">{{price.currency}} {{price.salePrice}}</span>
      {{/price.onSale}}
      {{^price.onSale}}
      <span class="price">{{price.currency}} {{price.amount}}</span>
      {{/price.onSale}}
    </div>
    
    <div class="rating">
      ⭐ {{rating.score}} / 5 ({{rating.reviewCount}} reviews)
    </div>
    
    <p class="availability availability-{{availability}}">
      {{availability}}
    </p>
  </div>
</article>`,
    options: {
      arrayKey: 'products',
      pathKey: 'path',
      testPath: '/products/probook-15',
      relativeURLPrefix: 'https://cdn.example.com',
    },
    // Demonstrates: Product catalog with filtering, CDN URLs, sale prices
  },
  eventCalendar: {
    json: {
      calendar: {
        month: 'January 2025',
        year: 2025,
      },
      events: [
        {
          id: 'evt-001',
          title: 'Developer Meetup',
          path: '/events/developer-meetup',
          date: 'January 15, 2025',
          time: '6:00 PM - 8:00 PM',
          location: 'Adobe Tower, Floor 12',
          type: 'In-Person',
          capacity: 50,
          registered: 42,
          spotsLeft: 8,
          isAlmostFull: true,
          description: 'Monthly gathering for web developers to share knowledge and network.',
        },
        {
          id: 'evt-002',
          title: 'AEM Best Practices Webinar',
          path: '/events/aem-webinar',
          date: 'January 22, 2025',
          time: '10:00 AM - 11:30 AM',
          location: 'Online (Zoom)',
          type: 'Virtual',
          capacity: 500,
          registered: 234,
          spotsLeft: 266,
          isAlmostFull: false,
          description: 'Learn best practices for Edge Delivery Services from Adobe experts.',
        },
        {
          id: 'evt-003',
          title: 'Hackathon Weekend',
          path: '/events/hackathon',
          date: 'January 27-28, 2025',
          time: 'All Day',
          location: 'Innovation Lab, Building C',
          type: 'In-Person',
          capacity: 100,
          registered: 100,
          spotsLeft: 0,
          isAlmostFull: true,
          description: 'Build something amazing in 48 hours with fellow developers.',
        },
      ],
    },
    template: `<article class="event-detail">
  <header class="event-header">
    <span class="event-type type-{{type}}">{{type}}</span>
    <h1>{{title}}</h1>
  </header>
  
  <div class="event-info">
    <p class="datetime">
      <span class="date">📅 {{date}}</span>
      <span class="time">🕐 {{time}}</span>
    </p>
    <p class="location">📍 {{location}}</p>
  </div>
  
  <section class="description">
    <p>{{description}}</p>
  </section>
  
  <section class="registration">
    <h2>Registration</h2>
    <div class="capacity-bar">
      <span class="registered">{{registered}} / {{capacity}} registered</span>
    </div>
    
    {{#spotsLeft}}
    <p class="spots-left {{#isAlmostFull}}almost-full{{/isAlmostFull}}">
      {{spotsLeft}} spots remaining
    </p>
    <button class="register-btn">Register Now</button>
    {{/spotsLeft}}
    
    {{^spotsLeft}}
    <p class="sold-out">This event is sold out</p>
    <button class="waitlist-btn">Join Waitlist</button>
    {{/spotsLeft}}
  </section>
</article>`,
    options: {
      arrayKey: 'events',
      pathKey: 'path',
      testPath: '/events/developer-meetup',
    },
    // Demonstrates: Event calendar with capacity tracking, conditional registration
  },
};

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
