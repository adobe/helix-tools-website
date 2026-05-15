import admin from '../../../scripts/helix-admin.js';
import { executeAdminRequest, AuthMode } from '../../../utils/admin-request.js';
import { IndexConfig } from '../core/constants.js';

const authedAdmin = admin.withRequestInit({ credentials: 'include' });

/**
 * @typedef {object} JobDescriptor
 * @property {object} handle
 * @property {string} topic
 * @property {string} name
 * @property {string} org
 * @property {string} site
 */

export async function createBulkStatusJob(org, repo, ref = 'main') {
  const result = await executeAdminRequest(
    () => authedAdmin.status({ org, site: repo, ref }).update('*', JSON.stringify({
      paths: ['/*'],
      select: ['preview'],
    })),
    { org, site: repo, policy: AuthMode.RETRY_ON_401 },
  );

  if (!result) throw new Error('Bulk status job creation cancelled: login required');
  if (!result.ok) {
    const text = await result.text();
    throw new Error(`Failed to create bulk status job: ${result.status} - ${text}`);
  }

  const data = await result.json();
  if (!data.job || data.job.state !== 'created') {
    throw new Error('Bulk status job creation failed or returned unexpected state');
  }

  const { topic, name } = data.job;
  if (!topic || !name) {
    throw new Error('Bulk status job response missing job topic or name');
  }

  return {
    handle: authedAdmin.job({ org, site: repo, ref }),
    topic,
    name,
    org,
    site: repo,
  };
}

const BULK_JOB_TERMINAL_SUCCESS = ['completed', 'stopped'];
const BULK_JOB_TERMINAL_FAILURE = ['failed', 'error', 'cancelled'];

/**
 * @param {JobDescriptor} job
 */
export async function pollStatusJob(
  job,
  pollIntervalMs = IndexConfig.STATUS_POLL_INTERVAL_MS,
  onProgress = null,
  maxDurationMs = IndexConfig.STATUS_POLL_MAX_DURATION_MS,
  startTime = null,
) {
  const startedAt = startTime ?? Date.now();

  const result = await executeAdminRequest(
    () => job.handle.get(`${job.topic}/${job.name}`),
    { org: job.org, site: job.site, policy: AuthMode.RETRY_ON_401 },
  );
  if (!result) throw new Error('Job status poll cancelled: login required');
  if (!result.ok) throw new Error(`Failed to fetch job status: ${result.status}`);

  const {
    state, progress, error, cancelled,
  } = await result.json();
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
  return pollStatusJob(job, pollIntervalMs, onProgress, maxDurationMs, startedAt);
}

/**
 * @param {JobDescriptor} job
 */
export async function getStatusJobDetails(job) {
  const result = await executeAdminRequest(
    () => job.handle.get(`${job.topic}/${job.name}/details`),
    { org: job.org, site: job.site, policy: AuthMode.RETRY_ON_401 },
  );
  if (!result) throw new Error('Job details cancelled: login required');
  if (!result.ok) throw new Error(`Failed to fetch job details: ${result.status}`);

  const { data } = await result.json();
  return data?.resources || [];
}
