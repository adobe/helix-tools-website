import { adminFetch } from '../../utils/admin-fetch.js';

export async function addToSnapshot(owner, repo, snapshot, paths) {
  const resp = await adminFetch(`/snapshot/${owner}/${repo}/main/${snapshot}/*`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      paths,
    }),
  });
  return resp;
}

export async function deleteFromSnapshot(owner, repo, snapshot, path) {
  const resp = await adminFetch(`/snapshot/${owner}/${repo}/main/${snapshot}${path}`, { method: 'DELETE' });
  return resp;
}

export async function fetchSnapshotManifest(owner, repo, snapshot) {
  const resp = await adminFetch(`/snapshot/${owner}/${repo}/main/${snapshot}`);
  if (resp.status === 200) {
    const { manifest } = await resp.json();
    return manifest;
  }
  return null;
}

export async function fetchStatus(owner, repo, snapshot, path) {
  const status = {};
  const respSnapshot = await adminFetch(`/status/${owner}/${repo}/main/.snapshots/${snapshot}${path}`);
  if (respSnapshot.status === 200) {
    status.snapshot = await respSnapshot.json();
  }
  const resp = await adminFetch(`/status/${owner}/${repo}/main${path}`);
  if (resp.status === 200) {
    status.preview = await resp.json();
  }
  return status;
}

export async function updateReviewStatus(owner, repo, snapshot, status) {
  const resp = await adminFetch(`/snapshot/${owner}/${repo}/main/${snapshot}?review=${status}`, {
    method: 'POST',
  });
  return resp;
}

export async function updateScheduledPublish(org, site, snapshotId) {
  const adminURL = 'https://helix-snapshot-scheduler-prod.adobeaem.workers.dev/schedule';
  const body = {
    org,
    site,
    snapshotId,
  };

  const headers = {
    'content-type': 'application/json',
  };

  const resp = await fetch(`${adminURL}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const result = resp.headers.get('X-Error');
  return { status: resp.status, text: result };
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
