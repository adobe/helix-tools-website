// @ts-check
import { executeAdminRequest, AuthMode } from '../../utils/admin-request.js';

/**
 * @typedef {import('../../scripts/admin-types.js').BoundAdminClient} AdminClient
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
 * Reads site config and aggregated config together so a single 401 retries both.
 *
 * @param {AdminClient} client
 * @param {LogFn} log
 * @returns {Promise<{cfg: AdminResponse, aggregate: AdminResponse} | null>}
 */
export async function readConfigWithAggregate(client, log) {
  const result = await executeAdminRequest(async () => {
    const [cfg, aggregate] = await Promise.all([
      client.config().read(),
      client.aggregated().read(),
    ]);
    log(cfg);
    log(aggregate);
    // Bubble 401 if either part 401s so the wrapper retries the whole pair.
    const status = cfg.status === 401 || aggregate.status === 401 ? 401 : cfg.status;
    return {
      status,
      ok: cfg.ok && aggregate.ok,
      parts: { cfg, aggregate },
    };
  }, client, { policy: AuthMode.PREFLIGHT_AND_RETRY });
  return result ? result.parts : null;
}

/**
 * @param {AdminClient} client
 * @param {LogFn} log
 * @returns {Promise<AdminResponse | null>}
 */
export function readConfig(client, log) {
  return run(client, log, () => client.config().read());
}

/**
 * @param {AdminClient} client
 * @param {LogFn} log
 * @returns {Promise<AdminResponse | null>}
 */
export function readMigrationPreview(client, log) {
  return run(client, log, () => client.config().read({ params: { migrate: 'true' } }));
}

/**
 * @param {AdminClient} client
 * @param {LogFn} log
 * @param {object} config
 * @returns {Promise<AdminResponse | null>}
 */
export function createConfig(client, log, config) {
  return run(client, log, () => client.config().create(JSON.stringify(config)));
}

/**
 * @param {AdminClient} client
 * @param {LogFn} log
 * @param {object} config
 * @returns {Promise<AdminResponse | null>}
 */
export function writeConfig(client, log, config) {
  return run(client, log, () => client.config().update(JSON.stringify(config)));
}
