// @ts-check
import { executeAdminRequest, AuthMode } from '../../utils/admin-request.js';

/**
 * @typedef {import('../../utils/admin-request.js').BoundAdminClient} AdminClient
 * @typedef {import('../../scripts/admin-types.js').AdminResponse} AdminResponse
 * @typedef {(res: AdminResponse) => void} LogFn
 */

/**
 * @param {AdminClient} client
 * @param {LogFn} log
 * @param {() => Promise<AdminResponse>} call
 * @param {import('../../utils/admin-request.js').AuthOptions} [options]
 */
function run(client, log, call, options) {
  return executeAdminRequest(async () => {
    const res = await call();
    log(res);
    return res;
  }, client, options);
}

/**
 * @param {AdminClient} client
 * @param {LogFn} log
 * @returns {Promise<unknown>} parsed org config, or null when unavailable
 */
export async function readOrgConfig(client, log) {
  const res = await run(client, log, () => client.config().read(), {
    policy: AuthMode.PREFLIGHT_AND_RETRY,
  });
  return res?.ok ? res.json() : null;
}

/**
 * @param {AdminClient} client
 * @param {LogFn} log
 * @returns {Promise<unknown>} parsed access.json, an empty one on 404, null when unavailable
 */
export async function readSiteAccess(client, log) {
  const res = await run(client, log, () => client.config().select('access.json').read(), {
    policy: AuthMode.PREFLIGHT_AND_RETRY,
  });
  if (!res) return null;
  if (res.status === 404) return { admin: { role: {} } };
  return res.ok ? res.json() : null;
}

/**
 * @param {AdminClient} client
 * @param {LogFn} log
 * @param {object} access
 * @returns {Promise<boolean>}
 */
export async function writeSiteAccess(client, log, access) {
  const res = await run(
    client,
    log,
    () => client.config().select('access.json').update(JSON.stringify(access)),
  );
  return res?.ok ?? false;
}

/**
 * @param {AdminClient} client
 * @param {LogFn} log
 * @param {{id: string}} user
 * @returns {Promise<boolean>}
 */
export async function updateOrgUser(client, log, user) {
  const res = await run(
    client,
    log,
    () => client.config().select(`users/${user.id}.json`).update(JSON.stringify(user)),
  );
  return res?.ok ?? false;
}

/**
 * @param {AdminClient} client
 * @param {LogFn} log
 * @param {{id: string}} user
 * @returns {Promise<boolean>}
 */
export async function removeOrgUser(client, log, user) {
  const res = await run(
    client,
    log,
    () => client.config().select(`users/${user.id}.json`).remove(),
  );
  return res?.ok ?? false;
}

/**
 * @param {AdminClient} client
 * @param {LogFn} log
 * @param {object} user
 * @returns {Promise<boolean>}
 */
export async function addOrgUser(client, log, user) {
  const res = await run(
    client,
    log,
    () => client.config().select('users.json').update(JSON.stringify(user)),
  );
  return res?.ok ?? false;
}
