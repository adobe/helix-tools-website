// @ts-check
// This is the only tool that takes a raw admin URL, so it picks the backend
// from the typed host instead of going through admin-compat.
import h5Admin from '../../scripts/helix-admin.js';
import h6Admin from '../../scripts/aem-admin.js';
import { coordsFromURL, isHelix6 } from '../../scripts/admin-compat.js';

/**
 * @param {string} url
 */
export default function adminForURL(url) {
  try {
    return new URL(url).hostname === 'admin.hlx.page' ? h5Admin : h6Admin;
  } catch {
    return h6Admin;
  }
}

/**
 * Whether an H5 admin URL targets a site that has moved to H6.
 * @param {string} url
 * @returns {Promise<boolean>}
 */
export async function movedToH6(url) {
  if (adminForURL(url) !== h5Admin) return false;
  const { org, site } = coordsFromURL(url);
  if (!org || !site) return false;
  // Ignore the use-h6-api flag: forcing it would flag every H5 URL.
  return isHelix6({ org, site }, false);
}
