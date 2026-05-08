import admin from '../../scripts/helix-admin.js';
import { executeAdminRequest, AuthMode } from '../../utils/admin-request.js';

function formatResources(org, site, name, resources) {
  return resources.map((res) => ({
    path: res.path,
    aemPreview: `https://main--${site}--${org}.aem.page${res.path}`,
    url: `https://${name}--main--${site}--${org}.aem.reviews${res.path}`,
  }));
}

function filterPaths(hrefs) {
  return hrefs.reduce((acc, href) => {
    try {
      const { pathname } = new URL(href);
      acc.push(pathname.endsWith('.html') ? pathname.replace('.html', '') : pathname);
    } catch {
      // do nothing
    }
    return acc;
  }, []);
}

function comparePaths(first, second) {
  return {
    added: second.filter((item) => !first.includes(item)),
    removed: first.filter((item) => !second.includes(item)),
  };
}

export async function fetchSnapshots(org, site) {
  const result = await executeAdminRequest(
    () => admin.snapshot({ org, site }).get(),
    { org, site, policy: AuthMode.PREFLIGHT_AND_RETRY },
  );
  if (!result) return null;
  if (!result.ok) return { error: result.error || `Error: ${result.status}`, status: result.status };
  const json = await result.json();
  return { snapshots: json.snapshots.map((name) => ({ org, site, name })), status: result.status };
}

export async function fetchManifest(org, site, name) {
  const result = await executeAdminRequest(
    () => admin.snapshot({ org, site }).get(name),
    { org, site, policy: AuthMode.PREFLIGHT_AND_RETRY },
  );
  if (!result) return null;
  if (!result.ok) return { error: result.error || `Error: ${result.status}`, status: result.status };
  const { manifest } = await result.json();
  manifest.resources = formatResources(org, site, name, manifest.resources);
  return { manifest, status: result.status };
}

export async function saveManifest(org, site, name, manifestToSave) {
  const body = manifestToSave !== undefined && manifestToSave !== null
    ? JSON.stringify(manifestToSave)
    : null;
  const result = await executeAdminRequest(
    () => admin.snapshot({ org, site }).update(name, body),
    { org, site },
  );
  if (!result) return null;
  if (!result.ok) return { error: result.error || `Error: ${result.status}`, status: result.status };
  return { status: result.status };
}

export async function reviewSnapshot(org, site, name, state) {
  const message = `Snapshot ${name} request ${state}`;
  const result = await executeAdminRequest(
    () => admin.snapshot({ org, site }).update(
      name,
      JSON.stringify({ review: state, message }),
      { params: { review: state } },
    ),
    { org, site },
  );
  if (!result) return null;
  if (!result.ok) return { error: result.error || `Error: ${result.status}`, status: result.status };
  return { success: true, status: result.status };
}

export async function deleteSnapshotUrls(org, site, name, paths = ['/*']) {
  const results = await Promise.all(paths.map(async (path) => {
    const result = await executeAdminRequest(
      () => admin.snapshot({ org, site }).remove(`${name}${path}`),
      { org, site },
    );
    if (!result) return null;
    if (!result.ok) return { error: result.error || `Error: ${result.status}`, status: result.status };
    return { success: result.status };
  }));
  if (results.some((r) => r === null)) return null;
  const firstError = results.find((r) => r.error);
  if (firstError) return firstError;
  return results[0];
}

export async function deleteSnapshot(org, site, name) {
  const result = await executeAdminRequest(
    () => admin.snapshot({ org, site }).remove(name),
    { org, site },
  );
  if (!result) return null;
  if (!result.ok) return { error: result.error || `Error: ${result.status}`, status: result.status };
  return { status: result.status };
}

export async function updatePaths(org, site, name, currPaths, editedHrefs) {
  const paths = filterPaths(editedHrefs);
  const { removed, added } = comparePaths(currPaths, paths);

  if (removed.length > 0) {
    const deleteResult = await deleteSnapshotUrls(org, site, name, removed);
    if (!deleteResult || deleteResult.error) return deleteResult;
  }

  if (added.length > 0) {
    const result = await executeAdminRequest(
      () => admin.snapshot({ org, site }).update(`${name}/*`, JSON.stringify({ paths: added })),
      { org, site },
    );
    if (!result) return null;
    if (!result.ok) return { error: result.error || `Error: ${result.status}`, status: result.status };
  }

  return formatResources(org, site, name, paths.map((path) => ({ path })));
}

/** Add event listeners to password fields for show/hide functionality */
export function addPasswordFieldListeners() {
  const passwordFields = document.querySelectorAll('.password-field');
  passwordFields.forEach((field) => {
    field.addEventListener('focus', () => { field.type = 'text'; });
    field.addEventListener('blur', () => { field.type = 'password'; });
  });
}
