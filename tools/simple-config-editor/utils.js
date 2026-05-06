/**
 * Set a nested value on `obj` at `path.key`, creating intermediate objects.
 * Mutates `obj`.
 * @param {Object} obj
 * @param {string} path  dot-separated path, '' for top level
 * @param {string} key
 * @param {*} value
 */
export function setNestedValue(obj, path, key, value) {
  if (!path) {
    obj[key] = value;
    return;
  }
  let current = obj;
  path.split('.').forEach((part) => {
    if (!current[part] || typeof current[part] !== 'object') current[part] = {};
    current = current[part];
  });
  current[key] = value;
}

/**
 * Delete a nested value on `obj` at `path.key`. No-op if the path doesn't
 * resolve. Mutates `obj`.
 * @param {Object} obj
 * @param {string} path  dot-separated path, '' for top level
 * @param {string} key
 */
export function removeNestedValue(obj, path, key) {
  if (!path) {
    delete obj[key];
    return;
  }
  let current = obj;
  const parts = path.split('.');
  for (let i = 0; i < parts.length; i += 1) {
    if (!current || typeof current !== 'object') return;
    current = current[parts[i]];
  }
  if (current && typeof current === 'object') delete current[key];
}

/**
 * Apply a Map of pending changes to a config object. Mutates `config`.
 * Each change has `{key, path, action, newValue}` — `action` is 'add', 'edit',
 * or 'remove'. Returns the same config for convenience.
 * @param {Object} config
 * @param {Map<string, {key: string, path: string, action: string, newValue: *}>} pendingChanges
 * @returns {Object} the mutated config
 */
export function applyPendingChanges(config, pendingChanges) {
  pendingChanges.forEach(({
    key, path, action, newValue,
  }) => {
    if (action === 'remove') removeNestedValue(config, path, key);
    else setNestedValue(config, path, key, newValue);
  });
  return config;
}

/**
 * Extract the hostname from a URL-like string. Bare hostnames pass through
 * unchanged. Returns `{value}` on success and `{value, error}` on parse
 * failure (with `value` being the original input, so the caller can fall
 * back gracefully).
 * @param {string} value
 * @returns {{value: string, error?: string}}
 */
export function extractHostname(value) {
  if (!value || typeof value !== 'string') return { value };
  if (!value.includes('://') && !value.startsWith('//')) return { value };
  try {
    const urlString = value.startsWith('//') ? `https:${value}` : value;
    return { value: new URL(urlString).hostname };
  } catch {
    return { value, error: `Failed to parse URL: ${value}` };
  }
}

const SIDEKICK_HOST_PROPS = ['host', 'liveHost', 'previewHost', 'reviewHost'];
const CDN_ENVS = ['prod', 'live', 'preview', 'review'];

/**
 * Clean fully-qualified URLs in known host properties (`sidekick.host` and
 * friends; `cdn.<env>.host`) down to bare hostnames. Mutates `config`.
 * Surfaces what changed and any parse failures so the caller can log them.
 * @param {Object} config
 * @returns {{
 *   config: Object,
 *   changes: Array<{path: string, from: string, to: string}>,
 *   errors: Array<{path: string, message: string}>,
 * }}
 */
export function cleanSidekickHostProperties(config) {
  const changes = [];
  const errors = [];
  if (!config) return { config, changes, errors };

  const clean = (parent, prop, path) => {
    if (!parent[prop]) return;
    const original = parent[prop];
    const result = extractHostname(original);
    if (result.error) errors.push({ path, message: result.error });
    if (result.value !== original) {
      parent[prop] = result.value;
      changes.push({ path, from: original, to: result.value });
    }
  };

  if (config.sidekick && typeof config.sidekick === 'object') {
    SIDEKICK_HOST_PROPS.forEach((prop) => clean(config.sidekick, prop, `sidekick.${prop}`));
  }
  if (config.cdn && typeof config.cdn === 'object') {
    CDN_ENVS.forEach((env) => {
      const node = config.cdn[env];
      if (node && typeof node === 'object') clean(node, 'host', `cdn.${env}.host`);
    });
  }
  return { config, changes, errors };
}
