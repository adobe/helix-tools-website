import getAdminClient from '../../scripts/admin-compat.js';
import { executeAdminRequest } from '../../utils/admin-request.js';

/**
 * Fetches live/preview host config for the given org/site.
 * Returns null if the user cancels login; throws on invalid config.
 * @param {string} org
 * @param {string} site
 * @param {Object} [client] - Admin client; defaults to the global one.
 * @returns {Promise<{live: string, preview: string}|null>}
 */
export async function fetchHosts(org, site, client) {
  const admin = client || await getAdminClient();
  const res = await executeAdminRequest(
    () => admin.status({ org, site }).get('/index'),
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
    [, str] = path.split('://');
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
 * Fetches the site's content source type from its sidekick config.
 * @param {Object} admin - Admin client for the site.
 * @param {string} org
 * @param {string} site
 * @param {boolean} h6 - Site runs on the Helix 6 API.
 * @returns {Promise<string|undefined>}
 */
export async function fetchContentSourceType(admin, org, site, h6) {
  try {
    const res = await admin.sidekick({ org, site }).get(h6 ? '' : 'config.json');
    if (!res.ok) return undefined;
    const { contentSourceType } = await res.json();
    return contentSourceType;
  } catch {
    return undefined;
  }
}

/**
 * Whether the admin API reports source last-modified dates for a bulk status
 * listing of the given content source type. Without a listing, a missing
 * source date does not mean the document was deleted from the source.
 * @param {string} [contentSourceType]
 * @param {boolean} h6 - Site runs on the Helix 6 API.
 * @returns {boolean}
 */
export function hasSourceListing(contentSourceType, h6) {
  if (!contentSourceType) return true;
  if (h6) return contentSourceType === 'sourcebus';
  return ['google', 'onedrive'].includes(contentSourceType);
}

/**
 * Classifies three last-modified dates into a human-readable label and a
 * CSS modifier ('positive', 'notice' or 'negative') for the status-light indicator.
 * @param {string} edit
 * @param {string} preview
 * @param {string} publish
 * @param {{sourceExpected?: boolean, publishKnown?: boolean}} [opts] - `sourceExpected: false`
 * when the content source has no listing, so a missing edit date is not flagged.
 * `publishKnown: false` when live state could not be read.
 * @returns {{label: string, modifier: 'positive'|'notice'|'negative'}}
 */
export function classifySequenceStatus(edit, preview, publish, {
  sourceExpected = true,
  publishKnown = true,
} = {}) {
  const valid = (d) => !Number.isNaN(d.getTime());
  const editDate = new Date(edit ?? NaN);
  const previewDate = new Date(preview ?? NaN);
  const publishDate = new Date(publish ?? NaN);
  const publishUnknown = { label: 'Publish unknown', modifier: 'notice' };

  if (!valid(editDate)) {
    if (sourceExpected || (!valid(previewDate) && !valid(publishDate))) {
      return { label: 'No source', modifier: 'negative' };
    }
    if (!publishKnown) return publishUnknown;
    if (!valid(publishDate)) {
      return { label: 'Not published', modifier: 'positive' };
    }
    if (!valid(previewDate) || previewDate <= publishDate) {
      return { label: 'Current', modifier: 'positive' };
    }
    return { label: 'Pending changes', modifier: 'positive' };
  }
  if (!valid(previewDate) && !valid(publishDate)) {
    return { label: 'Not previewed', modifier: 'positive' };
  }
  if (!publishKnown) {
    if (editDate <= previewDate) return publishUnknown;
    return { label: 'Pending changes', modifier: 'positive' };
  }
  if (valid(previewDate) && !valid(publishDate) && editDate <= previewDate) {
    return { label: 'Not published', modifier: 'positive' };
  }
  const inSequence = editDate <= previewDate && previewDate <= publishDate;
  return { label: inSequence ? 'Current' : 'Pending changes', modifier: 'positive' };
}
