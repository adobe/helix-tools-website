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
 * Preflights the login: Fetch is the tool's entry point, its session covers later saves.
 * @param {AdminClient} client
 * @param {LogFn} log
 * @returns {Promise<object|null>} parsed headers.json, an empty one on 404, null when unavailable
 */
export async function readHeaders(client, log) {
  const res = await run(client, log, () => client.config().select('headers.json').read(), {
    policy: AuthMode.PREFLIGHT_AND_RETRY,
  });
  if (!res) return null;
  if (res.status === 404) return {};
  if (!res.ok) return null;
  const body = await res.json();
  return body !== null && typeof body === 'object' ? body : null;
}

/**
 * @param {AdminClient} client
 * @param {LogFn} log
 * @param {object} headers
 * @returns {Promise<boolean>}
 */
export async function writeHeaders(client, log, headers) {
  const res = await run(
    client,
    log,
    () => client.config().select('headers.json').update(JSON.stringify(headers)),
  );
  return res?.ok ?? false;
}

/**
 * @param {AdminClient} client
 * @param {LogFn} log
 * @returns {Promise<boolean>}
 */
export async function removeHeaders(client, log) {
  const res = await run(client, log, () => client.config().select('headers.json').remove());
  return res?.ok ?? false;
}
