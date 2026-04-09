import { ensureLogin } from '../../../blocks/profile/profile.js';
import { IndexConfig } from '../core/constants.js';
import { fetchAdminWithRateLimit } from '../core/admin-rate-limit.js';

const STATUS_BASE = 'https://admin.hlx.page/status';

function fetchWithAuth(url, options = {}) {
  return fetchAdminWithRateLimit(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
}

export async function createBulkStatusJob(org, repo, ref = 'main', contentPath = null, options = {}) {
  await ensureLogin(org, repo);

  let paths;
  if (options.paths && options.paths.length > 0) {
    paths = options.paths;
  } else {
    const normalized = contentPath && typeof contentPath === 'string' && contentPath.trim()
      ? contentPath.trim().replace(/\/+$/, '').replace(/^(?!\/)/, '/')
      : null;
    paths = normalized ? [normalized, `${normalized}/*`] : ['/*'];
  }

  const payload = { paths, select: ['preview'] };
  if (options.pathsOnly) {
    payload.pathsOnly = true;
  }

  const url = `${STATUS_BASE}/${org}/${repo}/${ref}/*`;
  const resp = await fetchWithAuth(url, {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Failed to create bulk status job: ${resp.status} - ${text}`);
  }

  const data = await resp.json();
  if (!data.job || data.job.state !== 'created') {
    throw new Error('Bulk status job creation failed or returned unexpected state');
  }

  const jobUrl = data.links?.self;
  if (!jobUrl || typeof jobUrl !== 'string') {
    throw new Error('Bulk status job response missing links.self URL');
  }

  return {
    jobId: data.job.name,
    jobUrl,
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

export async function getStatusJobDetailsRaw(jobUrl) {
  const detailsUrl = `${jobUrl}/details`;
  const resp = await fetchWithAuth(detailsUrl);
  if (!resp.ok) {
    throw new Error(`Failed to fetch job details: ${resp.status}`);
  }
  return resp.json();
}

function asJobData(raw) {
  const obj = raw && typeof raw === 'object' ? raw : {};
  const nested = obj.job && typeof obj.job === 'object' ? obj.job : null;
  const fromData = obj.data?.job && typeof obj.data.job === 'object' ? obj.data.job : null;
  const job = nested && Object.keys(nested).length > 0 ? nested : fromData || obj;
  return job;
}

function asObject(value) {
  return value && typeof value === 'object' ? value : {};
}

export function parseResourcesFromDetailsRaw(raw) {
  const jobData = asJobData(raw);
  const dataRoot = jobData?.data != null ? asObject(jobData.data) : {};
  const { resources } = dataRoot;
  if (Array.isArray(resources)) return resources;
  if (resources && typeof resources === 'object') {
    const list = [];
    Object.values(resources).forEach((part) => {
      if (Array.isArray(part)) list.push(...part);
    });
    return list;
  }
  return [];
}

export function extractJobPhase(rawJobData) {
  const jobData = asJobData(rawJobData);
  const dataRoot = asObject(jobData?.data);
  return typeof dataRoot.phase === 'string' ? dataRoot.phase : '';
}

export function extractJobState(rawJobData) {
  if (typeof rawJobData?.state === 'string' && rawJobData.state) return rawJobData.state;
  const jobData = asJobData(rawJobData);
  return typeof jobData?.state === 'string' ? jobData.state : '';
}

export function extractJobIsComplete(rawJobData, pathsOnly) {
  const state = extractJobState(rawJobData);
  const phase = extractJobPhase(rawJobData);
  const jobData = asJobData(rawJobData);
  const error = jobData?.error;
  const cancelled = jobData?.cancelled === true;

  if (state !== 'stopped' || error || cancelled) return false;
  if (phase === 'completed') return true;
  if (!pathsOnly) {
    const resources = parseResourcesFromDetailsRaw(rawJobData);
    return resources.length > 0;
  }
  return false;
}

export function extractJobPaths(rawJobData) {
  const jobData = asJobData(rawJobData);
  const dataRoot = asObject(jobData?.data);
  const resources = asObject(dataRoot.resources);
  const paths = new Set();
  Object.values(resources).forEach((partitionPaths) => {
    if (!Array.isArray(partitionPaths)) return;
    partitionPaths.forEach((p) => {
      if (typeof p === 'string' && p.startsWith('/')) paths.add(p);
    });
  });
  return Array.from(paths);
}

export async function getStatusJobDetails(jobUrl) {
  const raw = await getStatusJobDetailsRaw(jobUrl);
  return parseResourcesFromDetailsRaw(raw);
}
