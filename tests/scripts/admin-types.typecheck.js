// @ts-check
import getAdminClient, { getAdminClientForSite, getAdminClientForOrg } from '../../scripts/admin-compat.js';
import { AuthMode, executeAdminRequest } from '../../utils/admin-request.js';
import { updateConfig } from '../../utils/config/config.js';

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
  client.aggregated().read();
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
  // @ts-expect-error Aggregated config is read-only.
  client.aggregated().update('{}');
  // @ts-expect-error Aggregated config cannot descend into another path.
  client.aggregated().select('cdn.json');
}

/**
 * @param {import('../../scripts/admin-types.js').OrgBoundAdminClient} client
 */
export function checkOrgBoundClient(client) {
  client.config().select('users.json').update('{}');
  client.withRequestInit({ credentials: 'include' }).pinVersion('v1').config().read();

  // @ts-expect-error Org clients expose only the operations org-level tools use.
  client.status();
  // @ts-expect-error Org coordinates have no site.
  client.coords.site.toString();
  // @ts-expect-error Org coordinates are read-only.
  client.coords.org = 'another';
  // @ts-expect-error Bound config cannot be retargeted.
  client.config({ org: 'another' });
  // @ts-expect-error Derived org clients stay org-scoped.
  client.pinVersion('v1').status();
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
  updateConfig();
  updateConfig(bound.coords);
  checkBoundClient(bound);
  await checkAdminRequestContracts(bound);
  const org = await getAdminClientForOrg({ org: 'adobe' });
  updateConfig(org.coords);
  checkOrgBoundClient(org);
  // @ts-expect-error A persistence target must include its org.
  updateConfig({ site: 'docs' });
  // @ts-expect-error A persistence target's site must be a string.
  updateConfig({ org: 'adobe', site: 123 });
  await executeAdminRequest(async () => ({ status: 200 }), org, {
    policy: AuthMode.PREFLIGHT_AND_RETRY,
  });
  // @ts-expect-error Org clients are org-only; a site needs getAdminClientForSite.
  getAdminClientForOrg({ org: 'adobe', site: 'docs' });
  const unbound = await getAdminClient();
  if (unbound) checkUnboundClient(unbound);
}
