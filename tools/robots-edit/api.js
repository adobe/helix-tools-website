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
 * Preflights login: Fetch is the natural entry point (fetch → edit → save), so once it
 * succeeds the user has an active session for any later save.
 *
 * @param {AdminClient} client
 * @param {LogFn} log
 * @returns {Promise<string|null>} robots.txt, an empty one on 404 (no custom robots.txt),
 *   null when unavailable (including a cancelled login)
 */
export async function readRobots(client, log) {
  const res = await run(client, log, () => client.config().select('robots.txt').read(), {
    policy: AuthMode.PREFLIGHT_AND_RETRY,
  });
  if (!res) return null;
  if (res.status === 404) return '';
  return res.ok ? res.text() : null;
}

/**
 * @param {AdminClient} client
 * @param {LogFn} log
 * @param {string} text
 * @returns {Promise<boolean>}
 */
export async function writeRobots(client, log, text) {
  const res = await run(client, log, () => client.config().select('robots.txt').update(text));
  return res?.ok ?? false;
}
