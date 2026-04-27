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

// DOM Elements — assigned in initDOMRefs() after buildUI() injects the HTML
let jsonInput;
let templateInput;
let jsonHighlight;
let templateHighlight;
let jsonLineNumbers;
let templateLineNumbers;
let jsonErrorHighlight;
let templateErrorHighlight;
let previewFrame;
let sourceOutput;
let jsonStatus;
let templateStatus;
let previewStatus;
let sourceErrorHighlights;
let sourceLineNumbers;
let validationDetails;
let previewTabs;
let previewViews;
let examplesModal;
let helpModal;
let examplesBtn;
let helpBtn;
let optionsPanel;
let optionsToggleBtn;
let optionArrayKey;
let optionPathKey;
let optionTestPath;
let optionRelativeURLPrefix;
let optionGenericFallback;

// Container reference — set in init(container)
let rootContainer = null;

// State
let debounceTimer = null;
let validationDelayTimer = null;
let abortController = null;
const DEBOUNCE_DELAY = 300;
const VALIDATION_DELAY = 200; // Delay before showing validation errors (less jarring UX)

// Prism loading promise - ensures single load and allows awaiting
let prismLoadPromise = null;

// ============================================================================
// BUILD UI + DOM REFS
// ============================================================================

/**
 * Inject simulator HTML into container (skipped on standalone page where HTML already exists).
 * @param {Element} container
 */
function buildUI(container) {
  if (container.querySelector('#json-input')) return;

  container.innerHTML = `
    <div class="simulator-header">
      <span class="header-content">
        <h1>JSON2HTML Simulator</h1>
        <p>Build and test Mustache templates for your JSON endpoints. <a href="https://www.aem.live/developer/json2html" target="_blank" rel="noopener noreferrer">View full documentation →</a></p>
      </span>
      <span class="header-actions">
        <button type="button" class="button outline" id="examples-btn">
          <span class="icon icon-code"></span> Examples
        </button>
        <button type="button" class="button outline" id="help-btn">
          <span class="icon icon-question"></span> Syntax Help
        </button>
      </span>
    </div>
    <div class="control-bar">
      <span class="control-options">
        <button type="button" class="button small outline" id="options-toggle-btn" title="Toggle Options">
          ⚙ Options
        </button>
        <button type="button" class="button small outline" id="fullscreen-btn" title="Toggle Fullscreen">
          ⛶
        </button>
      </span>
    </div>
    <div class="options-panel" id="options-panel" hidden>
      <span class="options-header">
        <span class="options-label">Simulator Options</span>
        <span class="options-hint">Configure data filtering and URL rewriting. <a href="https://www.aem.live/developer/json2html#configuration-parameters" target="_blank" rel="noopener noreferrer">Learn more →</a></span>
      </span>
      <span class="options-grid">
        <div class="option-group">
          <label for="option-arrayKey">
            <span class="option-name">arrayKey</span>
            <span class="option-desc"><strong>When to use:</strong> Your JSON has nested data and you want to access an inner array (e.g., "data" or "items.products")</span>
          </label>
          <input type="text" id="option-arrayKey" placeholder="e.g., data">
          <div class="option-hint" id="arrayKey-hint">
            💡 When arrayKey points to an array, wrap your template in <code>{{#.}}...{{/.}}</code> to iterate over items
          </div>
        </div>
        <div class="option-group">
          <label for="option-pathKey">
            <span class="option-name">pathKey</span>
            <span class="option-desc"><strong>When to use:</strong> You want to filter an array to find one specific item by a property name (e.g., "URL" or "path")</span>
          </label>
          <input type="text" id="option-pathKey" placeholder="e.g., URL">
          <div class="option-hint">
            💡 Use with arrayKey + testPath to filter arrays and extract a single matching item
          </div>
        </div>
        <div class="option-group">
          <label for="option-testPath">
            <span class="option-name">testPath</span>
            <span class="option-desc"><strong>When to use:</strong> The value to match against pathKey to find the right item (e.g., "/products/my-item")</span>
          </label>
          <input type="text" id="option-testPath" placeholder="e.g., /page1">
        </div>
        <div class="option-group">
          <label for="option-relativeURLPrefix">
            <span class="option-name">relativeURLPrefix</span>
            <span class="option-desc"><strong>When to use:</strong> Your JSON has relative image URLs like "/media/image.jpg" and you want to prefix them with a CDN domain</span>
          </label>
          <input type="text" id="option-relativeURLPrefix" placeholder="e.g., https://cdn.example.com">
        </div>
        <div class="option-group option-checkbox">
          <label for="option-genericFallback">
            <input type="checkbox" id="option-genericFallback">
            <span class="option-info">
              <span class="option-name">genericFallback</span>
              <span class="option-desc"><strong>When to use:</strong> You want auto-generated HTML from your JSON without writing a template</span>
            </span>
          </label>
        </div>
      </span>
    </div>
    <div class="workspace">
      <section class="editors-row">
        <div class="editor-panel json-panel">
          <div class="editor-header">
            <span class="editor-label">JSON Data</span>
            <div class="editor-actions">
              <button type="button" class="button small outline" id="format-json">Format</button>
            </div>
          </div>
          <div class="editor-wrapper">
            <div class="line-numbers" id="json-line-numbers" aria-hidden="true"></div>
            <textarea id="json-input" class="code-editor" spellcheck="false" placeholder="Enter your JSON data here...">{
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
}</textarea>
            <pre class="code-highlight" id="json-highlight" aria-hidden="true"><code class="language-json"></code></pre>
            <div class="error-line-highlight" id="json-error-highlight" aria-hidden="true"></div>
          </div>
          <div class="editor-status" id="json-status">
            <span class="status-icon status-ok">✓</span>
            <span class="status-text">Valid JSON</span>
          </div>
        </div>
        <span class="resizer resizer-vertical" id="resizer-vertical" title="Drag to resize">
          <span class="resizer-handle"></span>
        </span>
        <div class="editor-panel template-panel">
          <div class="editor-header">
            <span class="editor-label">Mustache Template</span>
          </div>
          <div class="editor-wrapper">
            <div class="line-numbers" id="template-line-numbers" aria-hidden="true"></div>
            <textarea id="template-input" class="code-editor" spellcheck="false" placeholder="Enter your Mustache template here..."><!DOCTYPE html>
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
</html></textarea>
            <pre class="code-highlight" id="template-highlight" aria-hidden="true"><code class="language-html"></code></pre>
            <div class="error-line-highlight" id="template-error-highlight" aria-hidden="true"></div>
          </div>
          <div class="editor-status" id="template-status">
            <span class="status-icon status-ok">✓</span>
            <span class="status-text">Template ready</span>
          </div>
        </div>
      </section>
      <span class="resizer resizer-horizontal" id="resizer-horizontal" title="Drag to resize">
        <span class="resizer-handle"></span>
      </span>
      <section class="preview-panel">
        <div class="preview-header">
          <span class="preview-label">HTML Preview</span>
          <div class="preview-tabs" role="tablist">
            <button type="button" class="preview-tab" role="tab" data-view="rendered" aria-selected="false">
              Rendered
            </button>
            <button type="button" class="preview-tab active" role="tab" data-view="source" aria-selected="true">
              Source
            </button>
          </div>
          <div class="preview-actions">
            <button type="button" class="button small outline" id="copy-html" title="Copy HTML">
              <span class="icon icon-copy"></span>
            </button>
          </div>
        </div>
        <div class="preview-content">
          <div class="preview-view" data-view="rendered" hidden>
            <iframe id="preview-frame" sandbox="allow-scripts" title="HTML Preview"></iframe>
          </div>
          <div class="preview-view active" data-view="source">
            <div class="line-numbers" id="source-line-numbers" aria-hidden="true"></div>
            <div id="source-error-highlights" class="source-error-highlights" aria-hidden="true"></div>
            <pre id="source-output" class="source-code"><code class="language-html"></code></pre>
          </div>
          <div class="validation-details" id="validation-details" aria-live="polite" hidden></div>
        </div>
        <div class="preview-status" id="preview-status">
          <span class="status-icon status-ok">✓</span>
          <span class="status-text">HTML</span>
          <span class="status-hint" id="keyboard-hint">💡 Press <kbd>Cmd+Enter</kbd> to render instantly</span>
        </div>
      </section>
    </div>
    <dialog id="examples-modal" class="modal examples-modal">
      <div class="modal-content">
        <div class="modal-header">
          <h2>Example Templates</h2>
          <button type="button" class="modal-close" aria-label="Close">×</button>
        </div>
        <div class="modal-body">
          <div class="examples-grid">
            <button type="button" class="example-card" data-example="basic">
              <h3>Basic Object</h3>
              <p>Simple key-value pair rendering</p>
            </button>
            <button type="button" class="example-card" data-example="array">
              <h3>Array Loop</h3>
              <p>Iterate over arrays with {{#items}}</p>
            </button>
            <button type="button" class="example-card" data-example="conditional">
              <h3>Conditionals</h3>
              <p>Show/hide based on boolean values</p>
            </button>
            <button type="button" class="example-card" data-example="nested">
              <h3>Nested Data</h3>
              <p>Access nested object properties</p>
            </button>
            <button type="button" class="example-card" data-example="product">
              <h3>Product Card</h3>
              <p>E-commerce product example</p>
            </button>
            <button type="button" class="example-card" data-example="event">
              <h3>Event Page</h3>
              <p>Content fragment example</p>
            </button>
            <button type="button" class="example-card" data-example="contentIndex">
              <h3>Content Index</h3>
              <p>Blog/article listing with pagination</p>
            </button>
            <button type="button" class="example-card" data-example="storeLocator">
              <h3>Store Locator</h3>
              <p>Location data with nested address</p>
            </button>
            <button type="button" class="example-card" data-example="productCatalog">
              <h3>Product Catalog</h3>
              <p>Multiple products with filtering</p>
            </button>
            <button type="button" class="example-card" data-example="eventCalendar">
              <h3>Event Calendar</h3>
              <p>Events with date and capacity</p>
            </button>
          </div>
        </div>
      </div>
    </dialog>
    <dialog id="help-modal" class="modal help-modal">
      <div class="modal-content">
        <div class="modal-header">
          <h2>Mustache Syntax Reference</h2>
          <button type="button" class="modal-close" aria-label="Close">×</button>
        </div>
        <div class="modal-body">
          <div class="syntax-reference">
            <div class="syntax-item">
              <h3>Variables</h3>
              <code>{{variable}}</code>
              <p>Renders the value of <em>variable</em> (HTML escaped)</p>
            </div>
            <div class="syntax-item">
              <h3>Unescaped HTML</h3>
              <code>{{{rawHtml}}}</code>
              <p>Renders raw HTML without escaping</p>
            </div>
            <div class="syntax-item">
              <h3>Sections (Loops &amp; Conditionals)</h3>
              <code>{{#items}}...{{/items}}</code>
              <p>Loops over arrays or shows content if truthy</p>
            </div>
            <div class="syntax-item">
              <h3>Inverted Sections</h3>
              <code>{{^items}}...{{/items}}</code>
              <p>Shows content only if value is falsy or empty</p>
            </div>
            <div class="syntax-item">
              <h3>Nested Properties</h3>
              <code>{{author.name}}</code>
              <p>Access nested object properties with dot notation</p>
            </div>
            <div class="syntax-item">
              <h3>Comments</h3>
              <code>{{! This is a comment }}</code>
              <p>Comments are not rendered in output</p>
            </div>
          </div>
          <div class="help-links">
            <p>
              <a href="https://mustache.github.io/mustache.5.html" target="_blank" rel="noopener noreferrer">
                Full Mustache Documentation ↗
              </a>
            </p>
            <p>
              <a href="https://www.aem.live/developer/json2html" target="_blank" rel="noopener noreferrer">
                AEM JSON2HTML Documentation ↗
              </a>
            </p>
          </div>
        </div>
      </div>
    </dialog>
  `;
}

/**
 * Assign all module-level DOM element references.
 * Must be called after buildUI() so elements exist in the document.
 */
function initDOMRefs() {
  jsonInput = document.getElementById('json-input');
  templateInput = document.getElementById('template-input');
  jsonHighlight = document.getElementById('json-highlight');
  templateHighlight = document.getElementById('template-highlight');
  jsonLineNumbers = document.getElementById('json-line-numbers');
  templateLineNumbers = document.getElementById('template-line-numbers');
  jsonErrorHighlight = document.getElementById('json-error-highlight');
  templateErrorHighlight = document.getElementById('template-error-highlight');
  previewFrame = document.getElementById('preview-frame');
  sourceOutput = document.getElementById('source-output');
  jsonStatus = document.getElementById('json-status');
  templateStatus = document.getElementById('template-status');
  previewStatus = document.getElementById('preview-status');
  sourceErrorHighlights = document.getElementById('source-error-highlights');
  sourceLineNumbers = document.getElementById('source-line-numbers');
  validationDetails = document.getElementById('validation-details');
  previewTabs = document.querySelectorAll('.preview-tab');
  previewViews = document.querySelectorAll('.preview-view');
  examplesModal = document.getElementById('examples-modal');
  helpModal = document.getElementById('help-modal');
  examplesBtn = document.getElementById('examples-btn');
  helpBtn = document.getElementById('help-btn');
  optionsPanel = document.getElementById('options-panel');
  optionsToggleBtn = document.getElementById('options-toggle-btn');
  optionArrayKey = document.getElementById('option-arrayKey');
  optionPathKey = document.getElementById('option-pathKey');
  optionTestPath = document.getElementById('option-testPath');
  optionRelativeURLPrefix = document.getElementById('option-relativeURLPrefix');
  optionGenericFallback = document.getElementById('option-genericFallback');
}

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
 * Build a newline-delimited string of line numbers "1\n2\n…\nN".
 * @param {number} count - Total number of lines
 * @returns {string}
 */
function lineNumbersText(count) {
  return Array.from({ length: count }, (_, i) => i + 1).join('\n');
}

/**
 * Get the pixel offset of a 1-based line number within an element,
 * using the element's computed paddingTop and lineHeight.
 * @param {Element} element - The element whose styles determine the layout
 * @param {number} line - 1-based line number
 * @returns {{ top: number, lineHeight: number }}
 */
function getLinePosition(element, line) {
  const style = getComputedStyle(element);
  const paddingTop = parseFloat(style.paddingTop);
  const lineHeight = parseFloat(style.lineHeight);
  return { top: paddingTop + (line - 1) * lineHeight, lineHeight };
}

/**
 * Update line number gutter for an editor
 * @param {HTMLTextAreaElement} textarea - Source textarea
 * @param {HTMLElement} lineNumbersEl - Line numbers element
 */
function updateLineNumbers(textarea, lineNumbersEl) {
  if (!lineNumbersEl) return;
  const lineCount = (textarea.value.match(/\n/g) || []).length + 1;
  lineNumbersEl.textContent = lineNumbersText(lineCount);
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
  const { top } = getLinePosition(textarea, line);
  highlightEl.style.top = `${top - textarea.scrollTop}px`;
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
  const { top: lineTop, lineHeight } = getLinePosition(textarea, line);
  highlightEl.dataset.errorLine = line;
  highlightEl.style.height = `${lineHeight}px`;
  highlightEl.style.display = 'block';
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
  // Append to rootContainer so it's visible in fullscreen mode
  (rootContainer || document.body).appendChild(toast);
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

  if (sourceLineNumbers) {
    const lineCount = html ? (html.match(/\n/g) || []).length + 1 : 0;
    sourceLineNumbers.textContent = lineNumbersText(lineCount);
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
    previewStatus.removeAttribute('role');
    previewStatus.removeAttribute('tabindex');
    previewStatus.removeAttribute('aria-expanded');
    previewStatus.removeAttribute('aria-controls');
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
    sourceErrorHighlights.replaceChildren();
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

  sourceErrorHighlights.replaceChildren();

  // Deduplicate by line, keeping the first (most severe) entry per line
  const uniqueByLine = [...new Map(
    results.filter((r) => r.line).map((r) => [r.line, r]),
  ).values()];
  if (uniqueByLine.length === 0) return;

  uniqueByLine.forEach((r) => {
    const { top, lineHeight } = getLinePosition(sourceOutput, r.line);
    const cls = r.severity === 'error'
      ? 'source-highlight-error' : 'source-highlight-warning';
    const band = document.createElement('div');
    band.className = `source-highlight ${cls}`;
    band.style.top = `${top}px`;
    band.style.height = `${lineHeight}px`;
    band.title = r.message;
    sourceErrorHighlights.appendChild(band);
  });
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
  const { top: lineTop, lineHeight } = getLinePosition(sourceOutput, line);
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
      row.addEventListener('click', () => scrollSourceToLine(r.line));
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

/**
 * Display HTML validation results from the server.
 * Updates the preview status bar and highlights error lines in the source.
 * @param {object} validation - Validation result from /simulator
 */
function displayHtmlValidation(validation) {
  if (!validation || !Array.isArray(validation.results)) {
    collapseValidationDetails();
    if (sourceErrorHighlights) sourceErrorHighlights.replaceChildren();
    if (!validation) updatePreviewStatus('ok', 'HTML');
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

  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return response.json();
  }
  const html = await response.text();
  return { html };
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
    const mainElement = rootContainer;
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
    previewStatus.setAttribute('aria-expanded', String(isExpanded));
    if (validationDetails) validationDetails.hidden = !isExpanded;
  });
  previewStatus?.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    ev.preventDefault();
    previewStatus.click();
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
  const main = rootContainer;
  if (!main || main.querySelector('#validation-message')) return;

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
 * Initialize the simulator inside the given container element.
 * Injects the simulator HTML if not already present (embedded mode),
 * then wires all listeners and renders the initial preview.
 * @param {Element} container - Element to build the simulator inside
 */
export default async function init(container) {
  rootContainer = container;
  buildUI(container);
  initDOMRefs();
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

// Auto-init on the standalone simulator page only.
// When imported by the config tool, #simulator-root already exists so this is skipped;
// the config tool calls init(container) explicitly on tab activation.
if (!document.getElementById('simulator-root')) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => init(document.querySelector('main')));
  } else {
    init(document.querySelector('main'));
  }
}
