import { createLimiter } from './browse.js';

const CONCURRENCY = 4;

function statusError(status) {
  const error = new Error(`Source lookup failed: ${status}`);
  error.status = status;
  return error;
}

/**
 * Looks up the source of one page via the Helix 6 status API.
 * @param {Object} admin - H6 admin client.
 * @param {string} org
 * @param {string} site
 * @param {string} path - Web path.
 * @returns {Promise<{lastModified: string}|{missing: true}>}
 */
export async function lookupSource(admin, org, site, path) {
  const res = await admin.raw('GET', `/${org}/sites/${site}/status${path}`, null, {
    params: { editUrl: 'auto' },
  });
  if (!res.ok) throw statusError(res.status);
  const { edit = {} } = await res.json();
  if (edit.status === 404) return { missing: true };
  if (edit.lastModified) return { lastModified: edit.lastModified };
  throw statusError(edit.status || 500);
}

/**
 * Looks up the sources of many pages with bounded concurrency.
 * @param {Object} admin - H6 admin client.
 * @param {string} org
 * @param {string} site
 * @param {string[]} paths - Web paths.
 * @param {Object} opts
 * @param {(path: string, result?: Object, error?: Error) => void} opts.onResult
 * @param {{aborted: boolean}} [opts.signal] - Stops starting new lookups once aborted.
 * @returns {Promise<void>}
 */
export async function lookupAll(admin, org, site, paths, { onResult, signal }) {
  const limit = createLimiter(CONCURRENCY);
  await Promise.all(paths.map((path) => limit(async () => {
    if (signal?.aborted) return;
    try {
      onResult(path, await lookupSource(admin, org, site, path));
    } catch (error) {
      onResult(path, undefined, error);
    }
  })));
}
