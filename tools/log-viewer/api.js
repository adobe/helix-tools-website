// @ts-check
import { getAdminClientForSite } from '../../scripts/admin-compat.js';
import { executeAdminRequest, AuthMode } from '../../utils/admin-request.js';

/**
 * @typedef {import('../../scripts/admin-types.js').SiteCoordinates} SiteCoordinates
 * @typedef {import('../../scripts/admin-types.js').AdminParams} AdminParams
 * @typedef {{org?: string, site?: string, owner?: string,
 *   repo?: string, ref?: string|null}} LogCoordinates
 */

/**
 * @param {SiteCoordinates} coords
 * @param {string} [version]
 */
export default async function createLogApi(coords, version) {
  const siteClient = (await getAdminClientForSite(coords)).pinVersion(version);

  /** @param {LogCoordinates} target */
  const getEntryClient = async (target) => (await getAdminClientForSite({
    org: target.org || target.owner || siteClient.coords.org,
    site: target.site || target.repo || siteClient.coords.site,
    ref: target.ref === undefined ? siteClient.coords.ref : target.ref,
  })).pinVersion(version);

  return {
    // A concrete resource supplies the same hosts on H5; H6 has no site-level status route.
    readHosts: () => executeAdminRequest(
      () => siteClient.status().get('/index.html'),
      siteClient,
      { policy: AuthMode.PREFLIGHT_AND_RETRY },
    ),
    /**
     * @param {AdminParams} params
     * @param {boolean} firstPage
     * @param {string} [next]
     */
    readLogs: (params, firstPage, next) => executeAdminRequest(
      () => (next ? siteClient.raw('GET', next) : siteClient.log().get('', { params })),
      siteClient,
      { policy: firstPage ? AuthMode.PREFLIGHT_AND_RETRY : AuthMode.RETRY_ON_401 },
    ),
    /** @param {LogCoordinates} target */
    async readConfig(target) {
      const client = await getEntryClient(target);
      return executeAdminRequest(() => client.config().read(), client);
    },
    /**
     * @param {LogCoordinates} target
     * @param {string} path
     */
    async readJobDetails(target, path) {
      const client = await getEntryClient(target);
      const result = await executeAdminRequest(() => client.job().get(path), client);
      if (!result?.ok) return result;
      const data = await result.json();
      if (!data || typeof data !== 'object' || !('links' in data)
        || !data.links || typeof data.links !== 'object'
        || !('details' in data.links) || typeof data.links.details !== 'string'
        || !data.links.details) {
        throw new Error('API returned no job details link');
      }
      const { details } = data.links;
      return executeAdminRequest(() => client.raw('GET', details), client);
    },
    /**
     * @param {LogCoordinates} target
     * @param {string} path
     */
    async readStatus(target, path) {
      const client = await getEntryClient(target);
      return executeAdminRequest(() => client.status().get(path), client);
    },
  };
}
