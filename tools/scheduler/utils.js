const WORKER = 'https://helix-snapshot-scheduler-ci.adobeaem.workers.dev';
const ADMIN = 'https://admin.hlx.page';

async function readError(resp, fallback) {
  const xError = resp.headers.get('x-error') || resp.headers.get('X-Error');
  if (xError) return xError;
  try {
    const text = await resp.text();
    if (text) return text;
  } catch {
    // ignore
  }
  return fallback;
}

export async function checkRegistration(org, site) {
  const resp = await fetch(`${WORKER}/register/${org}/${site}`);
  if (resp.status === 200) return { registered: true, resp };
  if (resp.status === 404) return { registered: false, resp };
  return { error: await readError(resp, 'Could not check scheduler registration.'), resp };
}

export function normalizeEntries(payload, org, site) {
  const key = `${org}--${site}`;
  const items = payload?.[key] || {};
  return Object.entries(items)
    .map(([id, item]) => ({
      id,
      type: item?.type || 'unknown',
      scheduledPublish: item?.scheduledPublish,
      approved: item?.approved,
      userId: item?.userId,
    }))
    .sort((a, b) => new Date(a.scheduledPublish) - new Date(b.scheduledPublish));
}

export async function fetchSchedule(org, site, nonce) {
  const url = `${WORKER}/schedule/${org}/${site}?nonce=${encodeURIComponent(nonce)}`;
  const resp = await fetch(url);
  if (!resp.ok) {
    return { error: await readError(resp, 'Could not load scheduled items.'), resp };
  }
  let json;
  try {
    json = await resp.json();
  } catch {
    return { error: 'Could not parse scheduler response.', resp };
  }
  return { entries: normalizeEntries(json, org, site), resp };
}

export async function deletePageSchedule(org, site, path, nonce) {
  const idPath = path.startsWith('/') ? path : `/${path}`;
  const url = `${WORKER}/schedule/page/${org}/${site}${idPath}?nonce=${encodeURIComponent(nonce)}`;
  const resp = await fetch(url, { method: 'DELETE' });
  if (resp.ok) return { ok: true, resp };
  return { ok: false, error: await readError(resp, 'Failed to delete scheduled page.'), resp };
}

export async function deleteSnapshotSchedule(org, site, snapshotId, nonce) {
  const idPath = snapshotId.startsWith('/') ? snapshotId : `/${snapshotId}`;
  const url = `${WORKER}/schedule/snapshot/${org}/${site}${idPath}?nonce=${encodeURIComponent(nonce)}`;
  const resp = await fetch(url, { method: 'DELETE' });
  if (resp.ok) return { ok: true, resp };
  return { ok: false, error: await readError(resp, 'Failed to delete scheduled snapshot.'), resp };
}

export async function clearSnapshotScheduledPublish(org, site, snapshotId) {
  const name = snapshotId.startsWith('/') ? snapshotId.slice(1) : snapshotId;
  const url = `${ADMIN}/snapshot/${org}/${site}/main/${name}`;
  const getResp = await fetch(url);
  if (!getResp.ok) {
    return { ok: false, error: await readError(getResp, 'Could not fetch snapshot manifest.'), resp: getResp };
  }
  let manifest;
  try {
    ({ manifest } = await getResp.json());
  } catch {
    return { ok: false, error: 'Could not parse snapshot manifest.', resp: getResp };
  }
  if (manifest?.metadata) delete manifest.metadata.scheduledPublish;
  const postResp = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(manifest),
  });
  if (postResp.ok) return { ok: true, resp: postResp };
  return { ok: false, error: await readError(postResp, 'Could not update snapshot metadata.'), resp: postResp };
}

export async function schedulePage({
  org, site, path, scheduledPublish, nonce,
}) {
  const resp = await fetch(`${WORKER}/schedule/page/${org}/${site}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path, scheduledPublish, nonce }),
  });
  if (resp.ok) return { ok: true, resp };
  return { ok: false, error: await readError(resp, 'Failed to schedule publish.'), resp };
}

export async function ensurePreview(org, site, path) {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  const resp = await fetch(`${ADMIN}/preview/${org}/${site}/main${cleanPath}`, { method: 'POST' });
  if (resp.ok) return { ok: true, resp };
  return { ok: false, error: await readError(resp, 'Could not preview page before scheduling.'), resp };
}

export function formatDate(iso) {
  if (!iso) return 'No schedule date';
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}

export function formatDuration(iso) {
  if (!iso) return '';
  const target = new Date(iso);
  if (Number.isNaN(target.getTime())) return '';
  const diff = target.getTime() - Date.now();
  if (diff <= 0) return 'due now';

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    const remH = hours % 24;
    return remH > 0 ? `in ${days}d ${remH}h` : `in ${days}d`;
  }
  if (hours > 0) {
    const remM = minutes % 60;
    return remM > 0 ? `in ${hours}h ${remM}m` : `in ${hours}h`;
  }
  if (minutes > 0) return `in ${minutes}m`;
  return `in ${seconds}s`;
}

export function buildPageUrl(org, site, path) {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `https://main--${site}--${org}.aem.page${cleanPath}`;
}

export function buildSnapshotUrl(org, site, snapshotId) {
  const name = snapshotId.startsWith('/') ? snapshotId.slice(1) : snapshotId;
  const manifest = `https://main--${site}--${org}.aem.page/.snapshots/${name}/.manifest.json`;
  return `/tools/snapshot-admin/snapshot-details.html?snapshot=${encodeURIComponent(manifest)}`;
}

export function isAtLeastFiveMinAhead(localDatetimeValue) {
  if (!localDatetimeValue) return false;
  const selected = new Date(localDatetimeValue);
  if (Number.isNaN(selected.getTime())) return false;
  return selected.getTime() - Date.now() >= 5 * 60 * 1000;
}

export function parseSidekickParams(searchString) {
  const params = new URLSearchParams(searchString);
  const org = params.get('owner') || '';
  const site = params.get('repo') || '';
  const referrer = params.get('referrer') || '';
  let path = '';
  if (referrer) {
    try {
      path = new URL(referrer).pathname;
    } catch {
      path = '';
    }
  }
  return {
    org, site, path, referrer,
  };
}

export function generateNonce() {
  return crypto.randomUUID();
}

export async function writeScheduleIntent(org, site, entry) {
  const url = `${ADMIN}/log/${org}/${site}/main`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ entries: [entry] }),
  });
  if (resp.ok) return { ok: true, resp };
  return { ok: false, error: await readError(resp, 'Failed to record schedule intent.'), resp };
}

const VIEW_NONCE_TTL_MS = 25 * 60 * 1000;
let viewNonceCache = null; // { key: 'org/site', nonce, writtenAt }

// eslint-disable-next-line no-underscore-dangle
export function __resetViewNonceForTests() {
  viewNonceCache = null;
}

export async function ensureViewNonce(org, site) {
  const key = `${org}/${site}`;
  if (
    viewNonceCache
    && viewNonceCache.key === key
    && Date.now() - viewNonceCache.writtenAt < VIEW_NONCE_TTL_MS
  ) {
    return viewNonceCache.nonce;
  }
  const nonce = generateNonce();
  const result = await writeScheduleIntent(org, site, { route: 'view-schedule-intent', nonce });
  if (!result.ok) {
    viewNonceCache = null;
    throw new Error(result.error || 'Could not record view intent.');
  }
  viewNonceCache = { key, nonce, writtenAt: Date.now() };
  return nonce;
}

export function invalidateViewNonceCache() {
  viewNonceCache = null;
}
