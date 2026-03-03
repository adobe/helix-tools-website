import { ensureLogin } from '../../../blocks/profile/profile.js';
import { IndexConfig } from '../core/constants.js';

const STATUS_BASE = 'https://admin.hlx.page/status';

function fetchWithAuth(url, options = {}) {
  return fetch(url, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
}

export async function createBulkStatusJob(org, repo, ref = 'main') {
  await ensureLogin(org, repo);

  const url = `${STATUS_BASE}/${org}/${repo}/${ref}/*`;
  const resp = await fetchWithAuth(url, {
    method: 'POST',
    body: JSON.stringify({
      paths: ['/*'],
      select: ['preview'],
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Failed to create bulk status job: ${resp.status} - ${text}`);
  }

  const data = await resp.json();
  if (!data.job || data.job.state !== 'created') {
    throw new Error('Bulk status job creation failed or returned unexpected state');
  }

  return {
    jobId: data.job.name,
    jobUrl: data.links?.self,
  };
}

const BULK_JOB_TERMINAL_SUCCESS = ['completed', 'stopped'];
const BULK_JOB_TERMINAL_FAILURE = ['failed', 'error', 'cancelled'];

export async function pollStatusJob(
  jobUrl,
  pollIntervalMs = IndexConfig.STATUS_POLL_INTERVAL_MS,
  onProgress = null,
  maxDurationMs = IndexConfig.STATUS_POLL_MAX_DURATION_MS,
  startTime = null,
) {
  const startedAt = startTime ?? Date.now();

  const resp = await fetchWithAuth(jobUrl);
  if (!resp.ok) {
    throw new Error(`Failed to fetch job status: ${resp.status}`);
  }

  const {
    state, progress, error, cancelled,
  } = await resp.json();
  if (onProgress && progress) {
    onProgress(progress);
  }

  if (BULK_JOB_TERMINAL_SUCCESS.includes(state)) {
    if (state === 'stopped' && (error || cancelled)) {
      throw new Error(error || 'Bulk status job was cancelled');
    }
    return state;
  }

  if (BULK_JOB_TERMINAL_FAILURE.includes(state)) {
    throw new Error(`Bulk status job ended with state: ${state}`);
  }

  if (maxDurationMs > 0 && Date.now() - startedAt >= maxDurationMs) {
    throw new Error(`Bulk status job polling timed out after ${Math.round(maxDurationMs / 60000)} minutes`);
  }

  await new Promise((resolve) => {
    setTimeout(resolve, pollIntervalMs);
  });
  return pollStatusJob(jobUrl, pollIntervalMs, onProgress, maxDurationMs, startedAt);
}

export async function getStatusJobDetails(jobUrl) {
  const detailsUrl = `${jobUrl}/details`;
  const resp = await fetchWithAuth(detailsUrl);

  if (!resp.ok) {
    throw new Error(`Failed to fetch job details: ${resp.status}`);
  }

  const { data } = await resp.json();
  return data?.resources || [];
}
