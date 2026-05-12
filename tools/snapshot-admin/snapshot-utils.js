import getAdminClient from '../../scripts/admin-compat.js';

export async function addToSnapshot(owner, repo, snapshot, paths) {
  const admin = await getAdminClient();
  return admin.snapshot({ org: owner, site: repo }).update(
    `${snapshot}/*`,
    JSON.stringify({ paths }),
  );
}

export async function deleteFromSnapshot(owner, repo, snapshot, path) {
  const admin = await getAdminClient();
  return admin.snapshot({ org: owner, site: repo }).remove(`${snapshot}${path}`);
}

export async function fetchSnapshotManifest(owner, repo, snapshot) {
  const admin = await getAdminClient();
  const result = await admin.snapshot({ org: owner, site: repo }).get(snapshot);
  if (!result.ok) return null;
  const { manifest } = await result.json();
  return manifest;
}

export async function fetchStatus(owner, repo, snapshot, path) {
  const admin = await getAdminClient();
  const statusAdmin = admin.status({ org: owner, site: repo });
  const status = {};
  const snapshotResult = await statusAdmin.get(`.snapshots/${snapshot}${path}`);
  if (snapshotResult.ok) status.snapshot = await snapshotResult.json();
  const pageResult = await statusAdmin.get(path);
  if (pageResult.ok) status.preview = await pageResult.json();
  return status;
}

export async function updateReviewStatus(owner, repo, snapshot, status) {
  const admin = await getAdminClient();
  return admin.snapshot({ org: owner, site: repo })
    .update(snapshot, null, { params: { review: status } });
}

export async function updateScheduledPublish(org, site, snapshotId) {
  const adminURL = 'https://helix-snapshot-scheduler-prod.adobeaem.workers.dev/schedule';
  const body = { org, site, snapshotId };
  const resp = await fetch(adminURL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = resp.headers.get('X-Error');
  return { status: resp.status, text };
}

export async function isRegisteredForSnapshotScheduler(org, site) {
  try {
    const adminURL = `https://helix-snapshot-scheduler-prod.adobeaem.workers.dev/register/${org}/${site}`;
    const resp = await fetch(adminURL);
    return resp.status === 200;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Error checking if registered for snapshot scheduler', error);
    return false;
  }
}
