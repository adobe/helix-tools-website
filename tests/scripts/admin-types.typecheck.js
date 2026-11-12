// @ts-check
import getAdminClient, { getAdminClientForSite } from '../../scripts/admin-compat.js';
import { AuthMode, executeAdminRequest } from '../../utils/admin-request.js';

/**
 * Compile-only contract checks; these functions are never executed.
 *
 * @param {import('../../scripts/admin-types.js').UnboundAdminClient} client
 */
export function checkUnboundClient(client) {
  const coords = { org: 'adobe', site: 'docs', ref: 'branch' };
  client.status(coords).get('/guide');
  client.config({ org: 'adobe', profile: 'production' }).read();
  client.withRequestInit({ credentials: 'include' }).pinVersion('v1').preview(coords).bulk({
    paths: ['/guide'],
  });
  client.pinVersion().status({ ...coords, ref: null }).get();

  // @ts-expect-error Unbound resources still require coordinates.
  client.status();
  // @ts-expect-error Site and profile configuration scopes are mutually exclusive.
  client.config({ ...coords, profile: 'production' });
  // @ts-expect-error Status resources do not support deletion.
  client.status(coords).remove('/guide');
}

/**
 * @param {import('../../scripts/admin-types.js').BoundAdminClient} client
 */
export function checkBoundClient(client) {
  client.status().get('/guide');
  client.config().select('cdn.json').read();
  client.withRequestInit({ credentials: 'include' }).pinVersion('v1').preview().bulk({
    paths: ['/guide'],
  });
  client.raw('GET', 'https://api.aem.live/adobe/sites/docs/jobs/123');

  // @ts-expect-error Bound resources cannot be retargeted per call.
  client.status({ org: 'another', site: 'site' });
  // @ts-expect-error Bound config cannot select another configuration scope.
  client.config({ org: 'another' });
  // @ts-expect-error Bound coordinates are read-only.
  client.coords.site = 'another';
  // @ts-expect-error The exposed coordinate object cannot be replaced.
  client.coords = { org: 'another', site: 'site', ref: 'main' };
  // @ts-expect-error Deriving request defaults must retain binding.
  client.withRequestInit({ cache: 'no-store' }).status({ org: 'another', site: 'site' });
  // @ts-expect-error Pinning a version must retain binding.
  client.pinVersion('v1').status({ org: 'another', site: 'site' });
  // @ts-expect-error Read-only resources do not acquire update capabilities.
  client.sidekick().update('/config.json');
}

/**
 * @param {import('../../scripts/admin-types.js').BoundAdminClient} client
 */
export async function checkAdminRequestContracts(client) {
  const requestFn = async () => ({ status: 200, ok: true, value: 'result' });
  const boundResult = await executeAdminRequest(requestFn, client);
  const legacyResult = await executeAdminRequest(requestFn, { org: 'adobe', site: 'docs' });
  boundResult?.value.toUpperCase();
  legacyResult?.value.toUpperCase();
  executeAdminRequest(requestFn, client, { policy: AuthMode.PREFLIGHT_AND_RETRY });
  executeAdminRequest(requestFn, { org: 'adobe', policy: AuthMode.NONE });

  // @ts-expect-error The response keeps its inferred properties rather than becoming any.
  boundResult?.missing();
  // @ts-expect-error Auth context requires an org or a bound client.
  executeAdminRequest(requestFn, { site: 'docs' });
  // @ts-expect-error A coordinate container alone is not a bound client.
  executeAdminRequest(requestFn, { coords: { org: 'adobe', site: 'docs', ref: 'main' } });
  // @ts-expect-error Bound auth options cannot retarget the client.
  executeAdminRequest(requestFn, client, { org: 'another' });
  // @ts-expect-error The legacy form keeps policy in its second argument.
  executeAdminRequest(requestFn, { org: 'adobe', site: 'docs' }, { policy: AuthMode.NONE });
  // @ts-expect-error Bound callers must choose a supported auth policy.
  executeAdminRequest(requestFn, client, { policy: 'invalid' });
  // @ts-expect-error Legacy callers must choose a supported auth policy.
  executeAdminRequest(requestFn, { org: 'adobe', policy: 'invalid' });

  const unbound = await getAdminClient();
  if (unbound) {
    // @ts-expect-error Unbound clients do not supply auth coordinates.
    executeAdminRequest(requestFn, unbound);
  }
}

export async function checkFactoryContracts() {
  const bound = await getAdminClientForSite({ org: 'adobe', site: 'docs' });
  checkBoundClient(bound);
  await checkAdminRequestContracts(bound);
  const unbound = await getAdminClient();
  if (unbound) checkUnboundClient(unbound);
}
