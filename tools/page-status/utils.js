import admin from '../../scripts/helix-admin.js';
import { executeAdminRequest } from '../../utils/admin-request.js';

/**
 * Fetches live/preview host config for the given org/site.
 * Returns null if the user cancels login; throws on invalid config.
 * @param {string} org
 * @param {string} site
 * @returns {Promise<{live: string, preview: string}|null>}
 */
export async function fetchHosts(org, site) {
  const res = await executeAdminRequest(
    () => admin.status({ org, site }).get(),
    { org, site },
  );
  if (!res) return null;
  if (!res.ok) throw new Error(`Invalid project configuration for ${org}/${site}`);
  const json = await res.json();
  if (!json.live?.url || !json.preview?.url) {
    throw new Error(`Invalid project configuration for ${org}/${site}`);
  }
  return {
    live: new URL(json.live.url).host,
    preview: new URL(json.preview.url).host,
  };
}

/**
 * Validates and normalizes a path string for status API queries.
 * Strips protocol if present, extracts the path segment, ensures a
 * trailing slash, and appends * for wildcard matching.
 * @param {string} path
 * @returns {string}
 */
export function validatePath(path) {
  if (!path) return '/*';
  let str = path;
  if (str.includes('://')) {
    [str] = path.split('://');
  }
  if (str.includes('/')) {
    str = str.substring(str.indexOf('/'));
  } else {
    str = '/';
  }
  str = str.startsWith('/') ? str : `/${str}`;
  if (!str.endsWith('/')) {
    str += '/';
  }
  return `${str}*`;
}

/**
 * Classifies three last-modified dates into a human-readable label and a
 * CSS modifier ('positive' or 'negative') for the status-light indicator.
 * @param {string} edit
 * @param {string} preview
 * @param {string} publish
 * @returns {{label: string, modifier: 'positive'|'negative'}}
 */
export function classifySequenceStatus(edit, preview, publish) {
  const valid = (d) => !Number.isNaN(d.getTime());
  const editDate = new Date(edit);
  const previewDate = new Date(preview);
  const publishDate = new Date(publish);

  if (!valid(editDate)) {
    return { label: 'No source', modifier: 'negative' };
  }
  if (!valid(previewDate) && !valid(publishDate)) {
    return { label: 'Not previewed', modifier: 'positive' };
  }
  if (valid(previewDate) && !valid(publishDate) && editDate <= previewDate) {
    return { label: 'Not published', modifier: 'positive' };
  }
  const inSequence = editDate <= previewDate && previewDate <= publishDate;
  return { label: inSequence ? 'Current' : 'Pending changes', modifier: 'positive' };
}
