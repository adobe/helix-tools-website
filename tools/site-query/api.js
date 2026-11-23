// @ts-check
import { getAdminClientForSite } from '../../scripts/admin-compat.js';
import { executeAdminRequest, AuthMode } from '../../utils/admin-request.js';

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {import('../../scripts/admin-types.js').AdminResponse} response
 * @returns {Promise<Record<string, unknown>>}
 */
async function readJson(response) {
  if (!response.ok) {
    throw Object.assign(new Error(response.error || `Admin request failed: HTTP ${response.status}`), {
      status: response.status,
    });
  }
  const json = await response.json();
  if (!isObject(json)) throw new Error('Admin returned an invalid JSON object');
  return json;
}

/**
 * Capture the submitted site and API version for both searching and later Edit clicks.
 *
 * @param {import('../../scripts/admin-types.js').SiteCoordinates} coords
 * @param {string|null} [version]
 */
export default async function createSiteQueryApi(coords, version) {
  let siteClient = await getAdminClientForSite(coords);
  if (version) siteClient = siteClient.pinVersion(version);
  const { org, site } = siteClient.coords;

  return {
    async getLiveHost() {
      // A concrete resource works on H5 and is required by the H6 status contract.
      const response = await executeAdminRequest(
        () => siteClient.status().get('/index.html'),
        siteClient,
        { policy: AuthMode.PREFLIGHT_AND_RETRY },
      );
      if (!response) return null;
      const status = await readJson(response);
      if (!isObject(status.live) || typeof status.live.url !== 'string' || !status.live.url) {
        throw new Error('Admin did not return a live URL');
      }
      return new URL(status.live.url).host;
    },

    /** @param {string} pathname */
    async getEditUrl(pathname) {
      const response = await executeAdminRequest(
        () => siteClient.status().get(pathname, { params: { editUrl: 'auto' } }),
        siteClient,
      );
      if (!response) return null;
      const status = await readJson(response);
      if (isObject(status.edit) && typeof status.edit.url === 'string' && status.edit.url) {
        return status.edit.url;
      }
      const configResponse = await executeAdminRequest(
        () => siteClient.sidekick().read(),
        siteClient,
      );
      if (!configResponse) return null;
      const config = await readJson(configResponse);
      if (typeof config.editUrl !== 'string' || !config.editUrl) {
        throw new Error('Admin did not return an edit URL');
      }
      const editUrl = config.editUrl
        .replaceAll('{{pathname}}', () => pathname)
        .replaceAll('{{org}}', () => org)
        .replaceAll('{{site}}', () => site);
      if (/\{\{[^}]*\}\}/.test(editUrl)) {
        throw new Error('Admin returned an edit URL with unresolved placeholders');
      }
      return editUrl;
    },
  };
}
