/**
 * JSON2HTML Playground - Interactive tool for experimenting with Mustache templates
 * Uses client-side rendering with Mustache.js
 */

// DOM Elements
const jsonInput = document.getElementById('json-input');
const templateInput = document.getElementById('template-input');
const previewFrame = document.getElementById('preview-frame');
const sourceOutput = document.getElementById('source-output');
const autoRenderCheckbox = document.getElementById('auto-render');
const renderBtn = document.getElementById('render-btn');
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
const shareBtn = document.getElementById('share-btn');

// State
let debounceTimer = null;
const DEBOUNCE_DELAY = 300;

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Escape HTML special characters
 * @param {string} str - String to escape
 * @returns {string} Escaped string
 */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * Show a toast notification
 * @param {string} message - Toast message
 */
function showToast(message) {
  // Simple toast implementation
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  toast.style.cssText = `
    position: fixed;
    bottom: 20px;
    left: 50%;
    transform: translateX(-50%);
    padding: 12px 24px;
    background: #333;
    color: white;
    border-radius: 8px;
    font-size: 14px;
    z-index: 10000;
    animation: fadeInOut 2s ease;
  `;

  // Add animation
  const style = document.createElement('style');
  style.textContent = `
    @keyframes fadeInOut {
      0% { opacity: 0; transform: translate(-50%, 10px); }
      15% { opacity: 1; transform: translate(-50%, 0); }
      85% { opacity: 1; transform: translate(-50%, 0); }
      100% { opacity: 0; transform: translate(-50%, -10px); }
    }
  `;
  document.head.appendChild(style);

  document.body.appendChild(toast);
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
        </style>
      </head>
      <body>${html}</body>
      </html>
    `;
    previewFrame.srcdoc = doc;
  }

  // Update source view
  if (sourceOutput) {
    const codeEl = sourceOutput.querySelector('code');
    if (codeEl) {
      codeEl.textContent = html;
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
    return parsed;
  } catch (e) {
    const match = e.message.match(/position (\d+)/);
    const position = match ? ` at position ${match[1]}` : '';
    updateStatus(jsonStatus, 'error', `Invalid JSON${position}`);
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
    updateStatus(jsonStatus, 'ok', 'Formatted');
  }
}

/**
 * Get value from nested object using dot notation path
 * @param {Object} obj - Object to traverse
 * @param {string} path - Dot-separated path
 * @returns {*} Value at path
 */
function getNestedValue(obj, path) {
  const keys = path.trim().split('.');
  let value = obj;
  keys.forEach((k) => {
    value = value?.[k];
  });
  return value;
}

/**
 * Simple Mustache-like renderer (placeholder until we load the real library)
 * @param {string} template - Mustache template
 * @param {Object} data - JSON data
 * @returns {string} Rendered HTML
 */
function renderMustache(template, data) {
  // Check if Mustache is loaded
  if (typeof window.Mustache !== 'undefined') {
    return window.Mustache.render(template, data);
  }

  // Simple placeholder implementation
  let result = template;

  // Simple variable replacement: {{variable}}
  result = result.replace(/\{\{([^#^/{}]+)\}\}/g, (match, key) => {
    const value = getNestedValue(data, key);
    return value !== undefined ? escapeHtml(String(value)) : '';
  });

  // Note: This is a simplified version. Full Mustache features require the library.
  return result;
}

// ============================================================================
// RENDER FUNCTION
// ============================================================================

/**
 * Render the template with JSON data
 */
function render() {
  const jsonData = validateJson();
  const template = templateInput?.value || '';

  if (!jsonData) {
    updatePreview('<p style="color: #999; text-align: center; padding: 20px;">Invalid JSON - fix errors to see preview</p>');
    return;
  }

  try {
    // Client-side rendering with Mustache
    const html = renderMustache(template, jsonData);
    updatePreview(html);
    updateStatus(templateStatus, 'ok', 'Rendered successfully');
    updatePreviewStatus('Last rendered: just now');
  } catch (e) {
    updatePreview(`<pre style="color: #c00; padding: 20px;">Error: ${escapeHtml(e.message)}</pre>`);
    updateStatus(templateStatus, 'error', `Render error: ${e.message}`);
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
  },
  array: {
    json: {
      title: 'Shopping List',
      items: [
        { name: 'Apples', quantity: 5 },
        { name: 'Bread', quantity: 2 },
        { name: 'Milk', quantity: 1 },
      ],
    },
    template: `<div class="list">
  <h1>{{title}}</h1>
  <ul>
    {{#items}}
    <li>{{name}} (x{{quantity}})</li>
    {{/items}}
  </ul>
</div>`,
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
      company: {
        name: 'Acme Corp',
        address: {
          street: '123 Main St',
          city: 'Springfield',
          country: 'USA',
        },
      },
      employees: [
        { name: 'Alice', department: 'Engineering' },
        { name: 'Bob', department: 'Sales' },
      ],
    },
    template: `<div class="company-info">
  <h1>{{company.name}}</h1>
  <address>
    {{company.address.street}}<br>
    {{company.address.city}}, {{company.address.country}}
  </address>
  
  <h2>Team</h2>
  <ul>
    {{#employees}}
    <li><strong>{{name}}</strong> - {{department}}</li>
    {{/employees}}
  </ul>
</div>`,
  },
  product: {
    json: {
      name: 'Wireless Headphones',
      price: 149.99,
      currency: 'USD',
      inStock: true,
      rating: 4.5,
      features: ['Noise Canceling', 'Bluetooth 5.0', '30hr Battery', 'Foldable'],
      image: '/media/headphones.jpg',
    },
    template: `<article class="product-card">
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
</article>`,
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
};

/**
 * Load an example template
 * @param {string} exampleType - Type of example to load
 */
function loadExample(exampleType) {
  const example = examples[exampleType];
  if (example) {
    if (jsonInput) {
      jsonInput.value = JSON.stringify(example.json, null, 2);
    }
    if (templateInput) {
      templateInput.value = example.template;
    }
    validateJson();
    render();
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
    tab.addEventListener('click', () => {
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
    if (autoRenderCheckbox?.checked) {
      // Debounce render
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(render, DEBOUNCE_DELAY);
    }
  };

  jsonInput?.addEventListener('input', () => {
    validateJson();
    handleInput();
  });

  templateInput?.addEventListener('input', handleInput);

  // Manual render button
  renderBtn?.addEventListener('click', render);
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

  // Share button
  shareBtn?.addEventListener('click', () => {
    // TODO: Implement sharing with LZString compression
    showToast('Share feature coming soon!');
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

  // Validate JSON button
  const validateJsonBtn = document.getElementById('validate-json');
  validateJsonBtn?.addEventListener('click', validateJson);
}

// ============================================================================
// INITIALIZATION
// ============================================================================

/**
 * Initialize the playground
 */
function init() {
  setupPreviewTabs();
  setupModals();
  setupEditorListeners();
  setupResizer();
  setupButtons();

  // Initial render
  render();
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
