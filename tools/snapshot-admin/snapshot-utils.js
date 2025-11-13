export async function addToSnapshot(owner, repo, snapshot, paths) {
  const adminURL = `https://admin.hlx.page/snapshot/${owner}/${repo}/main/${snapshot}`;
  const url = `${adminURL}/*`;
  const resp = await fetch(url, {
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
  const adminURL = `https://admin.hlx.page/snapshot/${owner}/${repo}/main/${snapshot}`;
  const url = `${adminURL}${path}`;
  const resp = await fetch(url, { method: 'DELETE' });
  return resp;
}

export async function fetchSnapshotManifest(owner, repo, snapshot) {
  const adminURL = `https://admin.hlx.page/snapshot/${owner}/${repo}/main/${snapshot}`;
  const resp = await fetch(adminURL);
  if (resp.status === 200) {
    const { manifest } = await resp.json();
    return manifest;
  }
  return null;
}

export async function fetchStatus(owner, repo, snapshot, path) {
  const status = {};
  const adminSnapshotURL = `https://admin.hlx.page/status/${owner}/${repo}/main/.snapshots/${snapshot}${path}`;
  const respSnapshot = await fetch(adminSnapshotURL);
  if (respSnapshot.status === 200) {
    status.snapshot = await respSnapshot.json();
  }
  const adminPageURL = `https://admin.hlx.page/status/${owner}/${repo}/main${path}`;
  const resp = await fetch(adminPageURL);
  if (resp.status === 200) {
    status.preview = await resp.json();
  }
  return status;
}

export async function updateReviewStatus(owner, repo, snapshot, status) {
  const adminURL = `https://admin.hlx.page/snapshot/${owner}/${repo}/main/${snapshot}`;
  const resp = await fetch(`${adminURL}?review=${status}`, {
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
    console.error('Error checking if registered for snapshot scheduler', error);
    return false;
  }
}
