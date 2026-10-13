/**
 * Pure helper functions for the bulk cache purge ops page. Live and preview
 * hosts of the same site are always treated as a single site identified by
 * its `ref--site--org` combination.
 */

const HOST_PATTERN = '^([a-z0-9-]+?)--([a-z0-9-]+?)--([a-z0-9-]+)\\.'
  + '(?:aem|hlx)(?:-fastly|-cloudflare)?\\.(?:live|page)$';
const HOST_RE = new RegExp(HOST_PATTERN);

/**
 * Parses a block of pasted text into a list of unique, resolved AEM sites.
 * Tokens are split on whitespace/commas, normalized to a bare hostname, and
 * matched against the `ref--site--org.(aem|hlx)[-fastly|-cloudflare].(live|page)`
 * pattern. The `.aem.page` and `.aem.live` hosts of the same site resolve to
 * the same `liveHost` and are deduplicated (first occurrence wins).
 * @param {string} text raw pasted text containing hostnames and/or URLs
 * @returns {{
 *   sites: Array<{
 *     input: string, host: string, ref: string, site: string, org: string, liveHost: string
 *   }>,
 *   rejected: Array<{input: string, reason: string}>,
 *   duplicates: Array<{input: string, liveHost: string}>,
 * }} parsed sites, rejected tokens with reasons, and duplicate tokens
 */
export function parseHostList(text) {
  const tokens = (text || '').split(/[\s,]+/).filter((t) => t.length);
  const sites = [];
  const rejected = [];
  const duplicates = [];
  const seen = new Set();

  tokens.forEach((token) => {
    let host;
    if (token.includes('://')) {
      try {
        host = new URL(token).hostname;
      } catch {
        rejected.push({ input: token, reason: 'only *.aem.live / *.aem.page hosts are supported' });
        return;
      }
    } else {
      const slashIndex = token.indexOf('/');
      host = slashIndex === -1 ? token : token.slice(0, slashIndex);
    }
    host = host.toLowerCase();

    const match = host.match(HOST_RE);
    if (!match) {
      rejected.push({ input: token, reason: 'only *.aem.live / *.aem.page hosts are supported' });
      return;
    }

    const [, ref, site, org] = match;
    const liveHost = `${ref}--${site}--${org}.aem.live`;

    if (seen.has(liveHost)) {
      duplicates.push({ input: token, liveHost });
      return;
    }
    seen.add(liveHost);
    sites.push({
      input: token, host, ref, site, org, liveHost,
    });
  });

  return { sites, rejected, duplicates };
}

/**
 * Surrogate key presets available for bulk purging. Keys are templates
 * resolved via {@link expandTemplate}. When `preview` is true, both the live
 * form `{key}` and preview form `p_{key}` are purged; media keys have no
 * preview form.
 * @type {ReadonlyArray<{id: string, label: string, template: string, preview: boolean}>}
 */
export const KEY_PRESETS = Object.freeze([
  {
    id: 'metadata', label: 'Metadata', template: '{cbid}_metadata', preview: true,
  },
  {
    id: 'content', label: 'All content', template: '{cbid}', preview: true,
  },
  {
    id: 'media', label: 'All media', template: '{cbid}_media', preview: false,
  },
  {
    id: 'head', label: 'Head', template: '{ref}--{site}--{org}_head', preview: false,
  },
  {
    id: '404', label: '404 pages', template: '{ref}--{site}--{org}_404', preview: false,
  },
  {
    id: 'code', label: 'Code', template: '{ref}--{site}--{org}_code', preview: false,
  },
  {
    id: 'site', label: 'Whole site', template: '{ref}--{site}--{org}', preview: false,
  },
]);

/**
 * Preset ids selected by default when the bulk purge page loads.
 * @type {ReadonlyArray<string>}
 */
export const DEFAULT_PRESET_IDS = ['metadata'];

/**
 * Expands a key template's `{cbid}`, `{ref}`, `{site}`, `{org}` placeholders
 * using the given site info.
 * @param {string} template key template containing placeholders
 * @param {{ref?: string, site?: string, org?: string, contentBusId?: string}} siteInfo
 *   values to substitute
 * @returns {string} the expanded key
 * @throws {Error} if `{cbid}` is used without a contentBusId, or an unknown
 *   placeholder remains after substitution
 */
export function expandTemplate(template, {
  ref, site, org, contentBusId,
} = {}) {
  if (template.includes('{cbid}') && !contentBusId) {
    throw new Error(`Cannot expand template "${template}": contentBusId is required but missing`);
  }
  const result = template
    .replaceAll('{cbid}', contentBusId ?? '')
    .replaceAll('{ref}', ref ?? '')
    .replaceAll('{site}', site ?? '')
    .replaceAll('{org}', org ?? '');

  const remaining = result.match(/\{[^}]*\}/);
  if (remaining) {
    throw new Error(`Cannot expand template "${template}": unknown placeholder ${remaining[0]}`);
  }

  return result;
}

/**
 * Builds the unique list of surrogate keys to purge for a site, combining
 * selected presets (with automatic `p_` preview variants where applicable)
 * and custom key templates (added as-is, no automatic preview variant).
 * @param {{presetIds?: string[], customKeys?: string[]}} selection presets and custom key templates
 * @param {{ref?: string, site?: string, org?: string, contentBusId?: string}} siteInfo
 *   values to substitute into templates
 * @returns {string[]} unique, expanded surrogate keys
 * @throws {Error} if an unknown preset id is given, or a template fails to expand
 */
export function buildKeys({ presetIds = [], customKeys = [] }, siteInfo) {
  const keys = [];

  presetIds.forEach((id) => {
    const preset = KEY_PRESETS.find((p) => p.id === id);
    if (!preset) {
      throw new Error(`Unknown preset id: ${id}`);
    }
    const expanded = expandTemplate(preset.template, siteInfo);
    keys.push(expanded);
    if (preset.preview) {
      keys.push(`p_${expanded}`);
    }
  });

  customKeys.forEach((template) => {
    keys.push(expandTemplate(template, siteInfo));
  });

  return [...new Set(keys)];
}

/**
 * Splits pasted text into a list of unique, non-empty tokens on commas
 * and/or whitespace
 * @param {string} text raw pasted text
 * @returns {string[]} unique non-empty tokens
 */
export function parseList(text) {
  return [...new Set((text || '')
    .split(/[,\s]+/)
    .filter((t) => t.length))];
}

/**
 * Parses pasted text into valid and invalid paths. A valid path must start
 * with `/`.
 * @param {string} text raw pasted text containing paths
 * @returns {{paths: string[], invalid: string[]}} valid and invalid paths
 */
export function parsePaths(text) {
  const tokens = parseList(text);
  const paths = [];
  const invalid = [];
  tokens.forEach((t) => {
    if (t.startsWith('/')) {
      paths.push(t);
    } else {
      invalid.push(t);
    }
  });
  return { paths, invalid };
}

/**
 * Summarizes a purge worker log, counting error and warning lines. The
 * worker's purge log uses `ERROR:` / `WARN:` line prefixes and the request
 * always returns HTTP 200 even when some CDN purges fail, so the log must be
 * inspected to detect partial failures.
 * @param {string} text the purge log text
 * @returns {{errors: number, warnings: number}} counts of error/warning lines
 */
export function summarizePurgeLog(text) {
  const lines = (text || '').split('\n');
  let errors = 0;
  let warnings = 0;
  lines.forEach((line) => {
    if (line.startsWith('ERROR:')) {
      errors += 1;
    } else if (line.startsWith('WARN:')) {
      warnings += 1;
    }
  });
  return { errors, warnings };
}
