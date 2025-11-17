// Removed config.js import since we're not using datalist functionality

let currentConfig = {};
// eslint-disable-next-line no-unused-vars
let originalConfig = {}; // Used to track original state for comparison
let aggregateConfig = {}; // Used to show inherited values
let configPath = '';
const pendingChanges = new Map(); // Track all pending changes
let showInherited = false; // Track whether inherited properties are visible

// CDN provider field configurations
const CDN_FIELDS = {
  fastly: [
    {
      name: 'route', type: 'text', required: false, label: 'Routes (comma-separated)',
    },
    {
      name: 'serviceId', type: 'text', required: true, label: 'Service ID',
    },
    {
      name: 'authToken', type: 'password', required: true, label: 'Auth Token',
    },
  ],
  cloudflare: [
    {
      name: 'route', type: 'text', required: false, label: 'Routes (comma-separated)',
    },
    {
      name: 'plan', type: 'text', required: true, label: 'Plan',
    },
    {
      name: 'zoneId', type: 'text', required: true, label: 'Zone ID',
    },
    {
      name: 'apiToken', type: 'password', required: true, label: 'API Token',
    },
  ],
  akamai: [
    {
      name: 'route', type: 'text', required: false, label: 'Routes (comma-separated)',
    },
    {
      name: 'endpoint', type: 'text', required: true, label: 'Endpoint',
    },
    {
      name: 'clientSecret', type: 'password', required: true, label: 'Client Secret',
    },
    {
      name: 'clientToken', type: 'password', required: true, label: 'Client Token',
    },
    {
      name: 'accessToken', type: 'password', required: true, label: 'Access Token',
    },
  ],
  managed: [
    {
      name: 'route', type: 'text', required: false, label: 'Routes (comma-separated)',
    },
  ],
  cloudfront: [
    {
      name: 'route', type: 'text', required: false, label: 'Routes (comma-separated)',
    },
    {
      name: 'distributionId', type: 'text', required: true, label: 'Distribution ID',
    },
    {
      name: 'accessKeyId', type: 'text', required: true, label: 'Access Key ID',
    },
    {
      name: 'secretAccessKey', type: 'password', required: true, label: 'Secret Access Key',
    },
  ],
};

const org = document.getElementById('org');
const site = document.getElementById('site');
const configEditor = document.getElementById('config-editor');
const configTbody = document.getElementById('config-tbody');
const logTbody = document.getElementById('log-tbody');

// Utility functions

/**
 * Escapes HTML to prevent XSS attacks
 * @param {string} text - Text to escape
 * @returns {string} - Escaped HTML
 */
function escapeHtml(text) {
  if (typeof text !== 'string') {
    return String(text);
  }
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Sanitizes user input by removing potentially dangerous characters
 * @param {string} input - Input to sanitize
 * @returns {string} - Sanitized input
 */
function sanitizeInput(input) {
  if (typeof input !== 'string') {
    return String(input);
  }
  // Remove script tags and event handlers
  return input
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/on\w+\s*=/gi, '')
    .replace(/javascript:/gi, '')
    .replace(/vbscript:/gi, '')
    .replace(/data:/gi, '')
    .trim();
}

/**
 * Validates property key format to prevent injection
 * @param {string} key - Property key to validate
 * @returns {boolean} - Whether key is valid
 */
function isValidPropertyKey(key) {
  if (typeof key !== 'string' || key.length === 0) {
    return false;
  }
  // Only allow alphanumeric characters, dots, underscores, and hyphens
  const validKeyPattern = /^[a-zA-Z0-9._-]+$/;
  return validKeyPattern.test(key);
}

/**
 * Logs a message to the console table
 * @param {string} status - Status type (success, error, info, warning)
 * @param {string} action - Action performed
 * @param {string} message - Log message
 */
function logMessage(status, action, message) {
  const row = document.createElement('tr');
  const time = new Date().toLocaleTimeString();

  // Escape all user input to prevent XSS
  const escapedStatus = escapeHtml(status);
  const escapedAction = escapeHtml(action);
  const escapedMessage = escapeHtml(message);

  row.innerHTML = `
    <td>${escapeHtml(time)}</td>
    <td class="log-status ${escapedStatus}">${escapedStatus.toUpperCase()}</td>
    <td>${escapedAction}</td>
    <td>${escapedMessage}</td>
  `;

  logTbody.prepend(row);

  // Keep only last 50 log entries
  while (logTbody.children.length > 50) {
    logTbody.removeChild(logTbody.lastChild);
  }
}

/**
 * Updates the save button visibility and state
 */
function updateSaveButton() {
  const saveButton = document.getElementById('save-all-changes');
  if (!saveButton) return;

  if (pendingChanges.size > 0) {
    saveButton.style.display = 'inline-block';
    saveButton.textContent = `Save All Changes (${pendingChanges.size})`;
    saveButton.disabled = false;
  } else {
    saveButton.style.display = 'none';
  }
}

/**
 * Adds a change to the pending changes map
 * @param {string} key - The property key
 * @param {string} path - The property path
 * @param {string} action - The action type (edit, add, remove)
 * @param {*} newValue - The new value (for edit/add)
 * @param {*} oldValue - The old value (for edit/remove)
 */
function addPendingChange(key, path, action, newValue = null, oldValue = null) {
  const fullKey = path ? `${path}.${key}` : key;
  pendingChanges.set(fullKey, {
    key,
    path,
    action,
    newValue,
    oldValue,
    timestamp: Date.now(),
  });
  updateSaveButton();
}

/**
 * Checks if a property has pending changes
 * @param {string} key - The property key
 * @param {string} path - The property path
 * @returns {boolean} - Whether the property has pending changes
 */
function hasPendingChanges(key, path) {
  const fullKey = path ? `${path}.${key}` : key;
  return pendingChanges.has(fullKey);
}

/**
 * Gets the pending change for a property
 * @param {string} key - The property key
 * @param {string} path - The property path
 * @returns {Object|null} - The pending change object or null
 */
function getPendingChange(key, path) {
  const fullKey = path ? `${path}.${key}` : key;
  return pendingChanges.get(fullKey) || null;
}

/**
 * Gets a nested value from an object using a path
 * @param {Object} obj - The object to get the value from
 * @param {string} path - The path to the property
 * @param {string} key - The final key
 * @returns {*} - The value
 */
function getNestedValue(obj, path, key) {
  if (!path) return obj[key];

  const pathParts = path.split('.');
  let current = obj;

  pathParts.forEach((part) => {
    if (current && typeof current === 'object') {
      current = current[part];
    } else {
      current = undefined;
    }
  });

  if (current && typeof current === 'object') {
    return current[key];
  }
  return undefined;
}

/**
 * Checks if a property name contains sensitive keywords
 * @param {string} key - The property key
 * @param {string} path - The property path
 * @returns {boolean} - Whether the property is sensitive
 */
function isSensitiveProperty(key, path) {
  const fullKey = path ? `${path}.${key}` : key;
  const lowerKey = fullKey.toLowerCase();
  return lowerKey.includes('key') || lowerKey.includes('token') || lowerKey.includes('secret') || lowerKey.includes('password');
}

/**
 * Gets the CDN type from current or aggregate config
 * @returns {string|null} - The CDN type or null if not set
 */
function getCdnType() {
  // Check current config first, then aggregate config
  const currentType = getNestedValue(currentConfig, 'cdn.prod', 'type');
  if (currentType) return currentType;

  const aggregateType = getNestedValue(aggregateConfig, 'cdn.prod', 'type');
  return aggregateType || null;
}

/**
 * Gets required fields for a CDN type
 * @param {string} cdnType - The CDN type
 * @returns {Array} - Array of required field objects
 */
function getRequiredCdnFields(cdnType) {
  if (!cdnType || !CDN_FIELDS[cdnType]) return [];
  return CDN_FIELDS[cdnType].filter((field) => field.required);
}

/**
 * Sets a nested value in an object using a path
 * @param {Object} obj - The object to set the value in
 * @param {string} path - The path to the property
 * @param {string} key - The final key
 * @param {*} value - The value to set
 */
function setNestedValue(obj, path, key, value) {
  if (!path) {
    obj[key] = value;
    return;
  }

  const pathParts = path.split('.');
  let current = obj;

  pathParts.forEach((part) => {
    if (!current[part]) {
      current[part] = {};
    }
    current = current[part];
  });

  current[key] = value;
}

/**
 * Removes a nested value from an object using a path
 * @param {Object} obj - The object to remove the value from
 * @param {string} path - The path to the property
 * @param {string} key - The final key
 */
function removeNestedValue(obj, path, key) {
  if (!path) {
    delete obj[key];
    return;
  }

  const pathParts = path.split('.');
  let current = obj;

  pathParts.forEach((part) => {
    current = current[part];
  });

  delete current[key];
}

/**
 * Creates nested object structure if it doesn't exist
 * @param {Object} obj - The object to create structure in
 * @param {string} path - The path to create (e.g., "cdn.provider")
 */
function createNestedStructure(obj, path) {
  if (!path) return;

  const pathParts = path.split('.');
  let current = obj;

  pathParts.forEach((part) => {
    if (!current[part] || typeof current[part] !== 'object') {
      current[part] = {};
    }
    current = current[part];
  });
}

/**
 * Determines the type of a value for display purposes
 * @param {*} value - The value to check
 * @returns {string} - The type string
 */
function getValueType(value) {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'object') return 'object';
  return typeof value;
}

/**
 * Formats a value for display in the table
 * @param {*} value - The value to format
 * @returns {string} - Formatted value string
 */
function formatValueForDisplay(value) {
  if (value === null) return 'null';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value);
}

/**
 * Creates an input element for editing a value
 * @param {*} value - The current value
 * @param {string} key - The property key
 * @param {string} path - The property path
 * @returns {HTMLElement} - The input element
 */
function createValueInput(value, key = '', path = '') {
  const valueType = getValueType(value);
  const isSensitive = isSensitiveProperty(key, path);

  // Handle undefined values (placeholders) as empty strings
  if (value === undefined) {
    const input = document.createElement('input');
    input.type = isSensitive ? 'password' : 'text';
    input.className = 'config-value-input';
    input.value = '';
    return input;
  }

  if (valueType === 'array') {
    const arrayValue = Array.isArray(value) ? value.join(', ') : '';
    if (arrayValue.length > 50) {
      const textarea = document.createElement('textarea');
      textarea.className = 'config-value-textarea';
      textarea.value = arrayValue;
      textarea.placeholder = 'Enter comma-separated values...';
      if (isSensitive) {
        textarea.type = 'password';
      }
      return textarea;
    }
    const input = document.createElement('input');
    input.type = isSensitive ? 'password' : 'text';
    input.className = 'config-value-input';
    input.value = arrayValue;
    input.placeholder = 'Enter comma-separated values...';
    return input;
  }
  if (valueType === 'object') {
    const textarea = document.createElement('textarea');
    textarea.className = 'config-value-textarea';
    textarea.value = JSON.stringify(value, null, 2);
    textarea.placeholder = 'Enter JSON...';
    return textarea;
  }
  const stringValue = value === null ? '' : String(value);
  if (stringValue.length > 50) {
    const textarea = document.createElement('textarea');
    textarea.className = 'config-value-textarea';
    textarea.value = stringValue;
    return textarea;
  }
  const input = document.createElement('input');
  input.type = isSensitive ? 'password' : 'text';
  input.className = 'config-value-input';
  input.value = stringValue;
  return input;
}

/**
 * Parses a value from the input element
 * @param {HTMLElement} input - The input element
 * @param {string} originalType - The original value type
 * @returns {*} - The parsed value
 */
function parseValueFromInput(input, originalType) {
  const value = sanitizeInput(input.value.trim());

  if (originalType === 'array') {
    if (value === '') return [];
    return value.split(',').map((item) => item.trim()).filter((item) => item !== '');
  }
  if (originalType === 'object') {
    try {
      return JSON.parse(value);
    } catch (e) {
      throw new Error(`Invalid JSON: ${e.message}`);
    }
  }
  if (originalType === 'number') {
    const num = Number(value);
    if (Number.isNaN(num)) throw new Error('Invalid number');
    return num;
  }
  if (originalType === 'boolean') {
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;
    throw new Error('Invalid boolean (use true or false)');
  }
  if (originalType === 'null') {
    if (value === '' || value.toLowerCase() === 'null') return null;
    throw new Error('Invalid null value');
  }
  if (originalType === 'undefined') {
    if (value === '') return undefined;
    throw new Error('Invalid undefined value');
  }

  return value;
}

/**
 * Creates a table row for a config property
 * @param {string} key - The property key
 * @param {*} value - The property value
 * @param {string} path - The full path to the property
 * @param {boolean} isInherited - Whether this value is inherited from aggregate config
 * @returns {HTMLElement} - The table row element
 */
function createConfigRow(key, value, path = '', isInherited = false) {
  const row = document.createElement('tr');
  const valueType = getValueType(value);
  const fullPath = path ? `${path}.${key}` : key;
  const hasChanges = hasPendingChanges(key, path);
  const pendingChange = getPendingChange(key, path);

  // Escape all user input to prevent XSS
  const escapedKey = escapeHtml(key);
  const escapedPath = escapeHtml(path);
  const escapedFullPath = escapeHtml(fullPath);

  // Use pending change value if available, otherwise use current value
  const displayValue = pendingChange ? pendingChange.newValue : value;

  // Check if this is a sensitive property
  const isSensitive = isSensitiveProperty(key, path);

  // Check if this is cdn.prod.host and it's not set, show placeholder
  const isCdnProdHost = fullPath === 'cdn.prod.host';
  const isCdnProdType = fullPath === 'cdn.prod.type';
  const isEmptyValue = displayValue === undefined || displayValue === null || displayValue === '';

  // Check if this is a CDN-specific field that needs a placeholder
  const cdnType = getCdnType();
  const isCdnField = fullPath.startsWith('cdn.prod.') && fullPath !== 'cdn.prod.type' && fullPath !== 'cdn.prod.host';
  const fieldName = isCdnField ? fullPath.replace('cdn.prod.', '') : null;
  const requiredFields = getRequiredCdnFields(cdnType);
  const isRequiredCdnField = isCdnField && requiredFields.some((field) => field.name === fieldName);

  let escapedValue;
  let placeholderClass = '';
  let sensitiveClass = '';

  if (isCdnProdHost && isEmptyValue) {
    escapedValue = escapeHtml('Enter production host URL (e.g., www.example.com)');
    placeholderClass = ' placeholder-text';
  } else if (isCdnProdType && isEmptyValue) {
    escapedValue = escapeHtml('Select CDN provider (fastly, cloudflare, akamai, managed, cloudfront)');
    placeholderClass = ' placeholder-text';
  } else if (isRequiredCdnField && isEmptyValue) {
    // Show placeholder for required CDN fields
    const fieldConfig = requiredFields.find((field) => field.name === fieldName);
    const placeholderText = fieldConfig ? `Enter ${fieldConfig.label.toLowerCase()}` : `Enter ${fieldName}`;
    escapedValue = escapeHtml(placeholderText);
    placeholderClass = ' placeholder-text';
  } else if (isSensitive && !isEmptyValue) {
    // Mask sensitive values for display
    escapedValue = escapeHtml('••••••••••');
    sensitiveClass = ' sensitive-value';
  } else {
    escapedValue = escapeHtml(formatValueForDisplay(displayValue));
  }

  // Add highlighting class if there are pending changes
  const highlightClass = hasChanges ? ' changed-value' : '';
  const inheritedClass = isInherited ? ' inherited-value' : '';
  const disabledAttr = isInherited ? ' disabled' : '';

  row.innerHTML = `
    <td class="config-key-cell${highlightClass}${inheritedClass}">
      ${escapedFullPath}
    </td>
    <td class="config-value-cell${highlightClass}${inheritedClass}">
      <div class="config-value-display ${escapeHtml(valueType)}${placeholderClass}${sensitiveClass}">${escapedValue}</div>
    </td>
    <td class="config-actions-cell">
      <button class="button outline edit-property" data-key="${escapedKey}" data-path="${escapedPath}"${disabledAttr}>Edit</button>
      <button class="button outline remove-property" data-key="${escapedKey}" data-path="${escapedPath}"${disabledAttr}>Remove</button>
    </td>
  `;

  return row;
}

/**
 * Flattens a nested object into key-value pairs with paths, filtering for specific prefixes
 * @param {Object} obj - The object to flatten
 * @param {string} prefix - The current path prefix
 * @returns {Array} - Array of {key, value, path, isInherited} objects
 */
function flattenObject(obj, prefix = '') {
  const result = [];
  const allowedPrefixes = ['cdn', 'access', 'metadata'];

  Object.entries(obj).forEach(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    const fullKey = prefix ? `${prefix}.${key}` : key;

    // Check if this key or any parent key starts with allowed prefixes
    const keyParts = fullKey.split('.');
    const hasAllowedPrefix = keyParts.some((part) => allowedPrefixes.some(
      (allowedPrefix) => part.startsWith(allowedPrefix),
    ));

    if (!hasAllowedPrefix) {
      return; // Skip this key if it doesn't match our criteria
    }

    if (value && typeof value === 'object' && !Array.isArray(value)) {
      // Recursively flatten nested objects
      result.push(...flattenObject(value, path));
    } else {
      result.push({ key, value, path: prefix });
    }
  });

  return result;
}

/**
 * Combines current and aggregate configs to show all properties with inheritance info
 * @returns {Array} - Array of {key, value, path, isInherited} objects
 */
function getCombinedConfig() {
  const currentFlattened = flattenObject(currentConfig);
  const aggregateFlattened = flattenObject(aggregateConfig);
  const result = [];
  const seenKeys = new Set();

  // First, add all current config properties
  currentFlattened.forEach((item) => {
    const fullKey = item.path ? `${item.path}.${item.key}` : item.key;
    result.push({
      key: item.key,
      value: item.value,
      path: item.path,
      isInherited: false,
    });
    seenKeys.add(fullKey);
  });

  // Then, add inherited properties from aggregate config
  aggregateFlattened.forEach((item) => {
    const fullKey = item.path ? `${item.path}.${item.key}` : item.key;
    if (!seenKeys.has(fullKey)) {
      result.push({
        key: item.key,
        value: item.value,
        path: item.path,
        isInherited: true,
      });
    }
  });

  return result;
}

/**
 * Populates the config table with the current configuration
 */
function populateConfigTable() {
  configTbody.innerHTML = '';

  if (Object.keys(currentConfig).length === 0) {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td colspan="3" style="text-align: center; padding: var(--spacing-l); color: var(--gray-500);">
        ${escapeHtml('No configuration properties found')}
      </td>
    `;
    configTbody.appendChild(row);
    return;
  }

  const combined = getCombinedConfig();

  // Ensure cdn.prod.type always appears, even if not in config
  const hasCdnProdType = combined.some((item) => (item.path ? `${item.path}.${item.key}` : item.key) === 'cdn.prod.type');

  if (!hasCdnProdType && (currentConfig.cdn || aggregateConfig.cdn)) {
    // Add cdn.prod.type as undefined if cdn exists but prod.type doesn't
    combined.push({
      key: 'type', value: undefined, path: 'cdn.prod', isInherited: false,
    });
  } else if (!hasCdnProdType) {
    // Add cdn.prod.type as undefined if cdn doesn't exist at all
    combined.push({
      key: 'type', value: undefined, path: 'cdn.prod', isInherited: false,
    });
  }

  // Ensure cdn.prod.host always appears, even if not in config
  const hasCdnProdHost = combined.some((item) => (item.path ? `${item.path}.${item.key}` : item.key) === 'cdn.prod.host');

  if (!hasCdnProdHost && (currentConfig.cdn || aggregateConfig.cdn)) {
    // Add cdn.prod.host as undefined if cdn exists but prod.host doesn't
    combined.push({
      key: 'host', value: undefined, path: 'cdn.prod', isInherited: false,
    });
  } else if (!hasCdnProdHost) {
    // Add cdn.prod.host as undefined if cdn doesn't exist at all
    combined.push({
      key: 'host', value: undefined, path: 'cdn.prod', isInherited: false,
    });
  }

  // Add required CDN fields as placeholders if CDN type is set
  const cdnType = getCdnType();
  if (cdnType) {
    const requiredFields = getRequiredCdnFields(cdnType);
    requiredFields.forEach((field) => {
      const fullKey = `cdn.prod.${field.name}`;
      const exists = combined.some((item) => (item.path ? `${item.path}.${item.key}` : item.key) === fullKey);

      if (!exists) {
        combined.push({
          key: field.name, value: undefined, path: 'cdn.prod', isInherited: false,
        });
      }
    });
  }

  // Filter out inherited properties if showInherited is false
  const filteredCombined = showInherited ? combined : combined.filter((item) => !item.isInherited);

  filteredCombined.forEach(({
    key, value, path, isInherited,
  }) => {
    const row = createConfigRow(key, value, path, isInherited);
    configTbody.appendChild(row);
  });

  // Add event listeners for edit and remove buttons
  configTbody.querySelectorAll('.edit-property').forEach((button) => {
    button.addEventListener('click', (e) => {
      if (e.target.disabled) return; // Skip if button is disabled (inherited value)
      const { key } = e.target.dataset;
      const { path } = e.target.dataset;
      // eslint-disable-next-line no-use-before-define
      editProperty(key, path);
    });
  });

  configTbody.querySelectorAll('.remove-property').forEach((button) => {
    button.addEventListener('click', (e) => {
      if (e.target.disabled) return; // Skip if button is disabled (inherited value)
      const { key } = e.target.dataset;
      const { path } = e.target.dataset;
      // eslint-disable-next-line no-use-before-define
      removeProperty(key, path);
    });
  });
}

/**
 * Edits a property value inline
 * @param {string} key - The property key
 * @param {string} path - The property path
 */
function editProperty(key, path) {
  const row = Array.from(configTbody.children).find((r) => r.querySelector(`[data-key="${key}"][data-path="${path}"]`));

  if (!row) return;

  const valueCell = row.querySelector('.config-value-cell');
  const currentValue = getNestedValue(currentConfig, path, key);
  // For undefined values (placeholders), treat them as strings for editing purposes
  const valueType = currentValue === undefined ? 'string' : getValueType(currentValue);

  const input = createValueInput(currentValue, key, path);
  const saveButton = document.createElement('button');
  saveButton.className = 'button';
  saveButton.textContent = 'Ok';

  const cancelButton = document.createElement('button');
  cancelButton.className = 'button outline';
  cancelButton.textContent = 'Cancel';

  const buttonContainer = document.createElement('div');
  buttonContainer.style.marginTop = 'var(--spacing-xs)';
  buttonContainer.appendChild(saveButton);
  buttonContainer.appendChild(cancelButton);

  valueCell.innerHTML = '';
  valueCell.appendChild(input);
  valueCell.appendChild(buttonContainer);

  input.focus();

  const saveHandler = () => {
    try {
      const newValue = parseValueFromInput(input, valueType);
      const fullKey = path ? `${path}.${key}` : key;

      // Check if this is a new property or an edit
      const isNewProperty = currentValue === '';
      const action = isNewProperty ? 'add' : 'edit';

      // Add to pending changes
      addPendingChange(key, path, action, newValue, currentValue);

      // Update local config for display purposes
      setNestedValue(currentConfig, path, key, newValue);

      // Refresh the table to show the change
      populateConfigTable();

      const actionText = isNewProperty ? 'Added' : 'Updated';
      logMessage('info', actionText.toUpperCase(), `${actionText} property: ${fullKey} (pending save)`);
    } catch (error) {
      logMessage('error', 'EDIT', `Failed to update property: ${error.message}`);
    }
  };

  const cancelHandler = () => {
    // If this was a new property being added (empty value), remove it from local config
    if (currentValue === '') {
      removeNestedValue(currentConfig, path, key);
      logMessage('info', 'CANCEL', `Cancelled adding property: ${path ? `${path}.${key}` : key}`);
    } else {
      logMessage('info', 'CANCEL', `Cancelled editing property: ${path ? `${path}.${key}` : key}`);
    }
    populateConfigTable();
  };

  saveButton.addEventListener('click', saveHandler);
  cancelButton.addEventListener('click', cancelHandler);

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      saveHandler();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelHandler();
    }
  });
}

/**
 * Removes a property from the configuration
 * @param {string} key - The property key
 * @param {string} path - The property path
 */
function removeProperty(key, path) {
  // eslint-disable-next-line no-alert
  if (!window.confirm(`Are you sure you want to remove the property "${path ? `${path}.${key}` : key}"?`)) {
    return;
  }

  const fullKey = path ? `${path}.${key}` : key;
  const currentValue = getNestedValue(currentConfig, path, key);

  // Add to pending changes
  addPendingChange(key, path, 'remove', null, currentValue);

  // Update local config for display purposes
  removeNestedValue(currentConfig, path, key);

  // Refresh the table to show the change
  populateConfigTable();

  logMessage('info', 'REMOVE', `Removed property: ${fullKey} (pending save)`);
}

/**
 * Adds a new property to the configuration
 */
function addProperty() {
  const allowedPrefixes = ['cdn', 'access', 'metadata'];
  // eslint-disable-next-line no-alert
  const key = prompt(`Enter property key (must start with: ${allowedPrefixes.join(', ')}):`);
  if (!key) return;

  // Sanitize the input
  const sanitizedKey = sanitizeInput(key);

  // Validate the key format
  if (!isValidPropertyKey(sanitizedKey)) {
    logMessage('error', 'ADD', 'Property key contains invalid characters. Only alphanumeric characters, dots, underscores, and hyphens are allowed.');
    return;
  }

  // Check if the key starts with an allowed prefix
  const hasAllowedPrefix = allowedPrefixes.some((prefix) => sanitizedKey.startsWith(prefix));
  if (!hasAllowedPrefix) {
    logMessage('error', 'ADD', `Property key must start with one of: ${allowedPrefixes.join(', ')}`);
    return;
  }

  // Handle nested object creation if key contains dots
  if (sanitizedKey.includes('.')) {
    const keyParts = sanitizedKey.split('.');
    const finalKey = keyParts.pop();
    const path = keyParts.join('.');

    // Create nested structure if it doesn't exist
    createNestedStructure(currentConfig, path);

    // Add the property to the nested location
    setNestedValue(currentConfig, path, finalKey, '');

    // Refresh the table to show the new property
    populateConfigTable();

    // Immediately enter edit mode for the new property
    setTimeout(() => {
      editProperty(finalKey, path);
    }, 100);

    logMessage('info', 'ADD', `Added nested property to table: ${sanitizedKey}`);
  } else {
    // Add the property to local config with empty value
    currentConfig[sanitizedKey] = '';

    // Refresh the table to show the new property
    populateConfigTable();

    // Immediately enter edit mode for the new property
    setTimeout(() => {
      editProperty(sanitizedKey, '');
    }, 100);

    logMessage('info', 'ADD', `Added property to table: ${sanitizedKey}`);
  }
}

/**
 * Loads the configuration for the selected org/site
 */
async function loadConfig() {
  if (!org.value || !site.value) {
    logMessage('error', 'LOAD', 'Please select both organization and site');
    return;
  }

  try {
    configPath = `/config/${org.value}/sites/${site.value}.json`;
    const adminURL = `https://admin.hlx.page${configPath}`;
    const aggregateURL = `https://admin.hlx.page/config/${org.value}/aggregated/${site.value}.json`;

    logMessage('info', 'LOAD', `Loading config from: ${configPath}`);

    // Fetch both current config and aggregate config
    const [configResponse, aggregateResponse] = await Promise.all([
      fetch(adminURL),
      fetch(aggregateURL),
    ]);

    if (!configResponse.ok) {
      throw new Error(`HTTP ${configResponse.status}: ${configResponse.statusText}`);
    }

    if (!aggregateResponse.ok) {
      throw new Error(`Failed to load aggregate config: HTTP ${aggregateResponse.status}`);
    }

    const config = await configResponse.json();
    const aggregate = await aggregateResponse.json();

    currentConfig = { ...config };
    originalConfig = { ...config }; // Store original config for comparison
    aggregateConfig = { ...aggregate }; // Store aggregate config for inherited values
    pendingChanges.clear(); // Clear any pending changes when loading new config

    configEditor.removeAttribute('aria-hidden');

    // Reset inherited visibility state when loading new config
    showInherited = false;
    const toggleButton = document.getElementById('toggle-inherited');
    toggleButton.textContent = 'Show Inherited';

    populateConfigTable();
    updateSaveButton(); // Hide save button initially

    logMessage('success', 'LOAD', 'Configuration loaded successfully');
  } catch (error) {
    logMessage('error', 'LOAD', `Failed to load configuration: ${error.message}`);
  }
}

/**
 * Updates URL parameters based on org/site values
 */
function updateURLParams() {
  const url = new URL(window.location.href);

  if (org.value) {
    url.searchParams.set('org', org.value);
  } else {
    url.searchParams.delete('org');
  }

  if (site.value) {
    url.searchParams.set('site', site.value);
  } else {
    url.searchParams.delete('site');
  }

  window.history.replaceState({}, document.title, url.href);
}

/**
 * Loads org/site values from URL parameters
 */
function loadFromURLParams() {
  const urlParams = new URLSearchParams(window.location.search);

  const orgParam = urlParams.get('org');
  const siteParam = urlParams.get('site');

  if (orgParam) {
    org.value = orgParam;
    site.disabled = false;
  }

  if (siteParam) {
    site.value = siteParam;
  }
}

/**
 * Saves all pending changes to the server
 */
async function saveAllChanges() {
  if (pendingChanges.size === 0) {
    logMessage('warning', 'SAVE', 'No changes to save');
    return;
  }

  try {
    // Fetch current config from server to get latest state
    const adminURL = `https://admin.hlx.page${configPath}`;
    const response = await fetch(adminURL);

    if (!response.ok) {
      throw new Error(`Failed to fetch current config: HTTP ${response.status}`);
    }

    const serverConfig = await response.json();

    // Apply all pending changes to the server config
    pendingChanges.forEach((change) => {
      const {
        key, path, action, newValue,
      } = change;

      // Only apply changes for properties that are not inherited
      // (inherited properties can't be edited, so they won't have pending changes)
      if (action === 'remove') {
        removeNestedValue(serverConfig, path, key);
      } else {
        // For 'add' and 'edit' actions
        setNestedValue(serverConfig, path, key, newValue);
      }
    });

    // POST the updated config back
    const saveResponse = await fetch(adminURL, {
      method: 'POST',
      body: JSON.stringify(serverConfig),
      headers: {
        'content-type': 'application/json',
      },
    });

    if (!saveResponse.ok) {
      throw new Error(`Failed to save config: HTTP ${saveResponse.status}`);
    }

    // Store the count before clearing
    const changesCount = pendingChanges.size;

    // Update original config to reflect the saved state
    originalConfig = { ...serverConfig };
    currentConfig = { ...serverConfig };

    // Clear all pending changes
    pendingChanges.clear();

    // Refresh the table and hide save button
    populateConfigTable();
    updateSaveButton();

    logMessage('success', 'SAVE', `Successfully saved ${changesCount} changes`);
  } catch (error) {
    logMessage('error', 'SAVE', `Failed to save changes: ${error.message}`);
  }
}

/**
 * Toggles the visibility of inherited properties
 */
function toggleInheritedProperties() {
  showInherited = !showInherited;
  const toggleButton = document.getElementById('toggle-inherited');

  if (showInherited) {
    toggleButton.textContent = 'Hide Inherited';
  } else {
    toggleButton.textContent = 'Show Inherited';
  }

  // Refresh the table to apply the new filtering
  populateConfigTable();
}

/**
 * Initializes the config editor
 */
function init() {
  // Load values from URL parameters first
  loadFromURLParams();

  // Enable site field when org has value
  org.addEventListener('input', () => {
    site.disabled = !org.value;
    updateURLParams();
  });

  // Update URL when site changes
  site.addEventListener('input', () => {
    updateURLParams();
  });

  // Load config when form is submitted
  document.getElementById('config-selection-form').addEventListener('submit', (e) => {
    e.preventDefault();
    loadConfig();
  });

  // Add property button
  document.getElementById('add-property').addEventListener('click', addProperty);

  // Save all changes button
  document.getElementById('save-all-changes').addEventListener('click', saveAllChanges);

  // Toggle inherited properties button
  document.getElementById('toggle-inherited').addEventListener('click', toggleInheritedProperties);

  // Auto-load config if both org and site are set from URL params
  if (org.value && site.value) {
    logMessage('info', 'AUTO-LOAD', 'Auto-loading configuration from URL parameters');
    loadConfig();
  }

  logMessage('info', 'INIT', 'Config Editor initialized');
}

init();
