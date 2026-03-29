import { registerToolReady } from '../../scripts/scripts.js';
import { ensureLogin } from '../../blocks/profile/profile.js';
import { initConfigField, updateConfig } from '../../utils/config/config.js';
import {
  dedupeMediaUrls,
  deriveOriginalFilename,
  extractMediaHash,
  getMediaIdentity,
} from './media-identity.js';
import {
  getSiteAemPageOrigin,
  normalizeMediaUrlToCurrentSiteAemPage,
  resolveHtmlMediaBaseUrl,
} from './media-origin.js';

const ADMIN_BASE = 'https://admin.hlx.page';
const DA_ETC_ORIGIN = 'https://da-etc.adobeaem.workers.dev';
const AEM_PAGE_SUFFIX = '.aem.page';
const REF = 'main';
const MEDIALOG_IMPORT_BUNDLE_VERSION = 1;
const PAGE_CRAWL_CONCURRENCY = 25;
const POLL_INTERVAL = 2000;
const JOB_COUNTER_LOG_INTERVAL = 10000;
const ADMIN_API_RATE = 10;
const AEM_PAGE_RATE = 190;
const LOG_WINDOW_SIZE = 1000;
const TERMINAL_JOB_STATE = 'stopped';
const LARGE_SITE_PATH_THRESHOLD = 20000;
const TARGET_PARTITION_RESOURCE_COUNT = 10000;
const MAX_PARTITION_PATHS = 250;
const PARTITION_LABEL_PATH_LIMIT = 3;
const MIN_ETA_SAMPLE_MS = 10000;
const MIN_PROCESSING_ETA_SAMPLE_COUNT = 50;
const DEFAULT_INGEST_BATCH_DURATION_MS = 150;
const PROCESSING_PROGRESS_PAGE_INTERVAL = 25;
const PROCESSING_PROGRESS_MIN_INTERVAL_MS = 500;

const VIDEO_EXTENSIONS = /\.(mp4|mov|webm|avi|m4v|mkv)$/i;

const MEDIA_EXTENSIONS = /\.(png|jpe?g|gif|webp|avif|svg|mp4|mov|webm|avi|m4v|mkv)$/i;

const CONTENT_TYPE_MAP = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  svg: 'image/svg+xml',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  avi: 'video/x-msvideo',
  m4v: 'video/x-m4v',
  mkv: 'video/x-matroska',
};

// DOM references
const DOM = {};

let abortController = null;
// Initialized after createRateLimiter so the shared abort-signal closure is available.
// eslint-disable-next-line prefer-const
let adminLimiter;
const stats = {
  pages: 0, media: 0, sent: 0, errors: 0, dupes: 0,
};
const consoleState = {
  entries: [],
  showAll: false,
};
const progressState = {
  startedAt: 0,
  currentProgress: 0,
  timerId: 0,
  status: 'idle',
  phase: 'idle',
  phaseStartedAt: 0,
  discoveryTotalJobs: 0,
  discoveryCompletedJobs: 0,
  totalPages: 0,
  processedPages: 0,
  standaloneMediaCount: 0,
  totalEntries: 0,
  totalBatches: 0,
  processedBatches: 0,
};

function initDOM() {
  const form = document.getElementById('backfill-form');
  DOM.form = form;
  DOM.org = form.querySelector('#org');
  DOM.site = form.querySelector('#site');
  DOM.fallbackUser = form.querySelector('#fallback-user');
  DOM.runBtn = form.querySelector('#run-btn');
  DOM.cancelBtn = form.querySelector('#cancel-btn');
  DOM.progressSection = document.getElementById('progress-section');
  DOM.phaseLabel = document.getElementById('phase-label');
  DOM.progressBar = document.getElementById('progress-bar');
  DOM.progressMeta = document.getElementById('progress-meta');
  DOM.statPages = document.getElementById('stat-pages');
  DOM.statMedia = document.getElementById('stat-media');
  DOM.statSent = document.getElementById('stat-sent');
  DOM.statErrors = document.getElementById('stat-errors');
  DOM.statDupes = document.getElementById('stat-dupes');
  DOM.consoleControls = document.getElementById('console-controls');
  DOM.consoleMeta = document.getElementById('console-meta');
  DOM.showAllLogs = document.getElementById('show-all-logs');
  DOM.console = document.getElementById('console-output');
}

function updateStatsDisplay() {
  DOM.statPages.textContent = stats.pages;
  DOM.statMedia.textContent = stats.media;
  DOM.statSent.textContent = stats.sent;
  DOM.statErrors.textContent = stats.errors;
  DOM.statDupes.textContent = stats.dupes;
}

function resetStats() {
  stats.pages = 0;
  stats.media = 0;
  stats.sent = 0;
  stats.errors = 0;
  stats.dupes = 0;
  updateStatsDisplay();
}

function formatDuration(ms) {
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  if (mins < 60) return `${mins}m ${remSecs}s`;
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `${hrs}h ${remMins}m ${remSecs}s`;
}

function estimateIngestBatchDurationMs() {
  return Math.max(DEFAULT_INGEST_BATCH_DURATION_MS, adminLimiter.getInterval());
}

function estimateRemainingMs() {
  if (!progressState.phaseStartedAt) {
    return null;
  }

  const phaseElapsed = Math.max(0, Date.now() - progressState.phaseStartedAt);

  switch (progressState.phase) {
    case 'discovery': {
      if (progressState.discoveryTotalJobs > 0 && progressState.discoveryCompletedJobs > 0) {
        const remainingJobs = Math.max(
          0,
          progressState.discoveryTotalJobs - progressState.discoveryCompletedJobs,
        );
        return (phaseElapsed / progressState.discoveryCompletedJobs) * remainingJobs;
      }
      return null;
    }
    case 'processing': {
      if (
        progressState.totalPages <= 0
        || progressState.processedPages < MIN_PROCESSING_ETA_SAMPLE_COUNT
        || phaseElapsed < MIN_ETA_SAMPLE_MS
      ) {
        return null;
      }

      const remainingPages = Math.max(0, progressState.totalPages - progressState.processedPages);
      const msPerPage = phaseElapsed / progressState.processedPages;
      return remainingPages * msPerPage;
    }
    case 'export': {
      if (progressState.processedBatches > 0) {
        return 0;
      }
      return Math.max(500, estimateIngestBatchDurationMs());
    }
    default:
      return null;
  }
}

function updateProgressMeta() {
  if (!DOM.progressMeta) return;
  if (!progressState.startedAt) {
    DOM.progressMeta.textContent = 'Elapsed: 0s | ETA: estimating...';
    return;
  }

  const elapsed = Math.max(0, Date.now() - progressState.startedAt);
  let etaLabel = 'estimating...';

  if (progressState.status === 'complete') {
    etaLabel = 'done';
  } else if (progressState.status === 'cancelled') {
    etaLabel = 'cancelled';
  } else if (progressState.status === 'error') {
    etaLabel = 'unavailable';
  } else {
    const remaining = estimateRemainingMs();
    if (Number.isFinite(remaining)) {
      etaLabel = `~${formatDuration(remaining)}`;
    }
  }

  DOM.progressMeta.textContent = `Elapsed: ${formatDuration(elapsed)} | ETA: ${etaLabel}`;
}

function beginProgressPhase(phase, metrics = {}) {
  progressState.phase = phase;
  progressState.phaseStartedAt = Date.now();
  Object.assign(progressState, metrics);
  updateProgressMeta();
}

function updateProgressMetrics(metrics = {}) {
  Object.assign(progressState, metrics);
  updateProgressMeta();
}

function resetProgressTracking() {
  if (progressState.timerId) {
    window.clearInterval(progressState.timerId);
  }
  progressState.startedAt = 0;
  progressState.currentProgress = 0;
  progressState.timerId = 0;
  progressState.status = 'idle';
  progressState.phase = 'idle';
  progressState.phaseStartedAt = 0;
  progressState.discoveryTotalJobs = 0;
  progressState.discoveryCompletedJobs = 0;
  progressState.totalPages = 0;
  progressState.processedPages = 0;
  progressState.standaloneMediaCount = 0;
  progressState.totalEntries = 0;
  progressState.totalBatches = 0;
  progressState.processedBatches = 0;
  updateProgressMeta();
}

function startProgressTracking() {
  resetProgressTracking();
  progressState.startedAt = Date.now();
  progressState.status = 'running';
  updateProgressMeta();
  progressState.timerId = window.setInterval(updateProgressMeta, 1000);
}

function stopProgressTracking() {
  if (progressState.timerId) {
    window.clearInterval(progressState.timerId);
    progressState.timerId = 0;
  }
  updateProgressMeta();
}

function setPhase(label, progress) {
  DOM.phaseLabel.textContent = label;
  if (label === 'Complete') {
    progressState.status = 'complete';
    progressState.currentProgress = 100;
  } else if (label === 'Cancelled') {
    progressState.status = 'cancelled';
  } else if (label === 'Error') {
    progressState.status = 'error';
  } else if (progressState.startedAt) {
    progressState.status = 'running';
  }
  if (progress !== undefined) {
    DOM.progressBar.value = progress;
    progressState.currentProgress = progress;
  }
  updateProgressMeta();
}

function buildLogLine({ text, level }) {
  const line = document.createElement('p');
  line.className = `log-line ${level}`;
  line.textContent = text;
  return line;
}

function updateConsoleControls() {
  const total = consoleState.entries.length;
  const hasOverflow = total > LOG_WINDOW_SIZE;
  DOM.consoleControls.setAttribute('aria-hidden', String(total === 0));
  if (!hasOverflow) {
    DOM.consoleMeta.textContent = `${total} log entries`;
    DOM.showAllLogs.hidden = true;
    return;
  }

  const visible = consoleState.showAll ? total : LOG_WINDOW_SIZE;
  DOM.consoleMeta.textContent = consoleState.showAll
    ? `Showing all ${visible} log entries`
    : `Showing latest ${visible} of ${total} log entries`;
  DOM.showAllLogs.hidden = false;
  DOM.showAllLogs.textContent = consoleState.showAll
    ? 'Show Recent Logs'
    : 'Show All Logs';
  DOM.showAllLogs.setAttribute('aria-pressed', String(consoleState.showAll));
}

function renderConsole() {
  const total = consoleState.entries.length;
  const start = consoleState.showAll ? 0 : Math.max(0, total - LOG_WINDOW_SIZE);
  const fragment = document.createDocumentFragment();
  for (let i = start; i < total; i += 1) {
    fragment.appendChild(buildLogLine(consoleState.entries[i]));
  }
  DOM.console.replaceChildren(fragment);
  updateConsoleControls();
  DOM.console.scrollTop = DOM.console.scrollHeight;
}

function resetConsole() {
  consoleState.entries = [];
  consoleState.showAll = false;
  DOM.console.replaceChildren();
  updateConsoleControls();
}

function log(message, level = 'info') {
  const ts = new Date().toLocaleTimeString();
  const entry = {
    level,
    text: `[${ts}] ${message}`,
  };
  const keepBottom = (DOM.console.scrollTop + DOM.console.clientHeight)
    >= (DOM.console.scrollHeight - 8);
  consoleState.entries.push(entry);

  if (consoleState.showAll || consoleState.entries.length <= LOG_WINDOW_SIZE) {
    DOM.console.appendChild(buildLogLine(entry));
  } else {
    if (DOM.console.firstChild) {
      DOM.console.removeChild(DOM.console.firstChild);
    }
    DOM.console.appendChild(buildLogLine(entry));
  }
  updateConsoleControls();
  if (keepBottom || consoleState.showAll) {
    DOM.console.scrollTop = DOM.console.scrollHeight;
  }
}

function showLoadingButton(button) {
  button.disabled = true;
  const { width, height } = button.getBoundingClientRect();
  button.style.minWidth = `${width}px`;
  button.style.minHeight = `${height}px`;
  button.dataset.label = button.textContent || 'Run Backfill';
  button.innerHTML = '<i class="symbol symbol-loading"></i>';
}

function resetLoadingButton(button) {
  button.textContent = button.dataset.label;
  button.removeAttribute('style');
  button.disabled = false;
}

function disableForm() {
  showLoadingButton(DOM.runBtn);
  [...DOM.form.elements].forEach((el) => { el.disabled = true; });
  DOM.cancelBtn.hidden = false;
  DOM.cancelBtn.disabled = false;
}

function enableForm() {
  resetLoadingButton(DOM.runBtn);
  [...DOM.form.elements].forEach((el) => { el.disabled = false; });
  DOM.cancelBtn.hidden = true;
  // site field should reflect org state
  DOM.site.disabled = !DOM.org.value;
}

function isAborted() {
  return abortController && abortController.signal.aborted;
}

function waitForDelay(ms, signal) {
  const duration = Math.max(0, ms);
  if (!signal) {
    return new Promise((resolve) => { setTimeout(resolve, duration); });
  }

  if (signal.aborted) return Promise.resolve();

  return new Promise((resolve) => {
    let timeoutId = 0;
    const onAbort = () => {
      clearTimeout(timeoutId);
      signal.removeEventListener('abort', onAbort);
      resolve();
    };

    timeoutId = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, duration);

    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function createRateLimiter(initialRate, getSignal = () => null) {
  let interval = Math.ceil(1000 / initialRate);
  let queue = Promise.resolve();

  return {
    acquire() {
      const gate = queue;
      queue = queue.then(
        () => waitForDelay(interval, getSignal()),
      );
      return gate;
    },
    handleResponse(res) {
      const rate = parseFloat(res.headers.get('x-ratelimit-rate'));
      if (rate > 0) {
        interval = Math.ceil(1000 / rate);
      }
    },
    backoff(seconds) {
      queue = queue.then(
        () => waitForDelay(seconds * 1000, getSignal()),
      );
    },
    getInterval() {
      return interval;
    },
    reset() {
      queue = Promise.resolve();
      interval = Math.ceil(1000 / initialRate);
    },
  };
}

adminLimiter = createRateLimiter(ADMIN_API_RATE, () => abortController?.signal);
const aemPageLimiter = createRateLimiter(AEM_PAGE_RATE, () => abortController?.signal);

function etcFetch(href, api, options) {
  const url = `${DA_ETC_ORIGIN}/${api}?url=${encodeURIComponent(href)}`;
  const opts = options || {};
  return fetch(url, opts);
}

function getRateLimitedTarget(url) {
  if (url.startsWith(ADMIN_BASE)) {
    return {
      limiter: adminLimiter,
      label: 'admin API',
      queue503Backoff: false,
      fetch: (targetUrl, fetchOptions) => fetch(targetUrl, fetchOptions),
    };
  }

  try {
    if (new URL(url).hostname.endsWith(AEM_PAGE_SUFFIX)) {
      return {
        limiter: aemPageLimiter,
        label: 'aem.page',
        queue503Backoff: true,
        fetch: (targetUrl, fetchOptions) => etcFetch(targetUrl, 'cors', fetchOptions),
      };
    }
  } catch {
    return null;
  }

  return null;
}

async function fetchWithRetry(url, options = {}, maxRetries = 3) {
  const signal = abortController ? abortController.signal : undefined;
  const fetchOptions = { ...options, signal };
  const rateLimitedTarget = getRateLimitedTarget(url);

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    if (isAborted()) throw new DOMException('Aborted', 'AbortError');
    try {
      if (rateLimitedTarget) {
        // eslint-disable-next-line no-await-in-loop
        await rateLimitedTarget.limiter.acquire();
        if (isAborted()) throw new DOMException('Aborted', 'AbortError');
      }
      // eslint-disable-next-line no-await-in-loop
      const res = await (rateLimitedTarget?.fetch
        ? rateLimitedTarget.fetch(url, fetchOptions)
        : fetch(url, fetchOptions));
      if (rateLimitedTarget) {
        rateLimitedTarget.limiter.handleResponse(res);
      }
      if (res.status === 429 && attempt < maxRetries) {
        const retryAfter = parseInt(
          res.headers.get('x-retry-after') || res.headers.get('retry-after'),
          10,
        ) || (2 ** attempt);
        log(`${rateLimitedTarget?.label || 'Request'} rate limited (429), pausing ${retryAfter}s before retry (${attempt + 1}/${maxRetries})...`, 'warn');
        if (rateLimitedTarget) {
          rateLimitedTarget.limiter.backoff(retryAfter);
        } else {
          // eslint-disable-next-line no-await-in-loop
          await waitForDelay(retryAfter * 1000, signal);
        }
        // eslint-disable-next-line no-continue
        continue;
      }
      if (res.status === 503 && attempt < maxRetries) {
        const delay = (2 ** attempt) * 1000;
        log(`${rateLimitedTarget?.label || 'Service'} unavailable (503), retrying in ${delay / 1000}s...`, 'warn');
        if (rateLimitedTarget?.queue503Backoff) {
          rateLimitedTarget.limiter.backoff(delay / 1000);
        } else {
          // eslint-disable-next-line no-await-in-loop
          await waitForDelay(delay, signal);
        }
        // eslint-disable-next-line no-continue
        continue;
      }
      return res;
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      if (attempt < maxRetries) {
        // eslint-disable-next-line no-await-in-loop
        await waitForDelay((2 ** attempt) * 1000, signal);
      } else {
        throw err;
      }
    }
  }
  throw new Error(`Failed to fetch ${url} after ${maxRetries + 1} attempts`);
}

async function runWithConcurrency(items, fn, limit) {
  const results = [];
  let index = 0;

  async function worker() {
    while (index < items.length) {
      if (isAborted()) return;
      const i = index;
      index += 1;
      // eslint-disable-next-line no-await-in-loop
      results[i] = await fn(items[i], i);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

function toCounterValue(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function asObject(value) {
  return value && typeof value === 'object' ? value : {};
}

function getJobStateData(rawJobData) {
  const jobData = asObject(rawJobData);
  const nestedJobData = asObject(jobData.job);
  return Object.keys(nestedJobData).length ? nestedJobData : jobData;
}

function extractJobCounters(rawJobData) {
  const jobData = getJobStateData(rawJobData);
  const progress = asObject(jobData.progress);
  const readCounter = (key) => toCounterValue(progress[key]);

  return {
    total: readCounter('total'),
    processed: readCounter('processed'),
    failed: readCounter('failed'),
  };
}

function extractJobState(rawJobData) {
  const jobData = getJobStateData(rawJobData);
  if (typeof jobData.state === 'string' && jobData.state) {
    return jobData.state;
  }
  return '';
}

function mergeJobCounters(base, incoming) {
  const merged = { ...base };
  ['total', 'processed', 'failed'].forEach((key) => {
    if (Number.isFinite(incoming[key])) {
      merged[key] = incoming[key];
    }
  });
  return merged;
}

function extractJobResources(rawJobData) {
  const jobData = getJobStateData(rawJobData);
  const jobDataRoot = asObject(jobData.data);
  if (Array.isArray(jobDataRoot.resources)) {
    return jobDataRoot.resources;
  }
  return [];
}

function extractJobPhase(rawJobData) {
  const jobData = getJobStateData(rawJobData);
  const jobDataRoot = asObject(jobData.data);
  if (typeof jobDataRoot.phase === 'string' && jobDataRoot.phase) {
    return jobDataRoot.phase;
  }
  return '';
}

function extractJobPaths(rawJobData) {
  const jobData = getJobStateData(rawJobData);
  const resources = asObject(asObject(jobData.data).resources);
  const paths = new Set();

  Object.values(resources).forEach((partitionPaths) => {
    if (!Array.isArray(partitionPaths)) return;
    partitionPaths.forEach((path) => {
      if (typeof path === 'string' && path.startsWith('/')) {
        paths.add(path);
      }
    });
  });

  return Array.from(paths);
}

function toJobProgressPercent(counters) {
  if (!Number.isFinite(counters.total) || counters.total <= 0) {
    return 0;
  }
  if (!Number.isFinite(counters.processed)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round((counters.processed / counters.total) * 100)));
}

function mergeResourceRecords(existing, incoming) {
  return {
    ...existing,
    ...incoming,
    previewLastModified: existing.previewLastModified || incoming.previewLastModified || '',
    previewLastModifiedBy: existing.previewLastModifiedBy || incoming.previewLastModifiedBy || '',
  };
}

function mergeResourcesByPath(...resourceLists) {
  const byPath = new Map();
  resourceLists.forEach((resources) => {
    resources.forEach((resource) => {
      if (!resource?.path) return;
      const existing = byPath.get(resource.path);
      if (!existing) {
        byPath.set(resource.path, resource);
      } else {
        byPath.set(resource.path, mergeResourceRecords(existing, resource));
      }
    });
  });
  return Array.from(byPath.values());
}

function packPathBuckets(buckets) {
  const partitions = [];
  const sortedBuckets = [...buckets].sort((a, b) => (
    b.estimatedCount - a.estimatedCount
    || a.paths[0].localeCompare(b.paths[0])
  ));

  sortedBuckets.forEach((bucket) => {
    const targetPartition = partitions.find((partition) => (
      partition.estimatedCount + bucket.estimatedCount <= TARGET_PARTITION_RESOURCE_COUNT
      && partition.paths.length + bucket.paths.length <= MAX_PARTITION_PATHS
    ));

    if (targetPartition) {
      targetPartition.paths.push(...bucket.paths);
      targetPartition.estimatedCount += bucket.estimatedCount;
      return;
    }

    partitions.push({
      paths: [...bucket.paths],
      estimatedCount: bucket.estimatedCount,
    });
  });

  return partitions.map((partition) => ({
    ...partition,
    paths: partition.paths.slice().sort((a, b) => a.localeCompare(b)),
  }));
}

function buildPathPartitions(paths) {
  const topLevelBuckets = new Map();
  const rootPaths = new Set();

  paths.forEach((path) => {
    if (typeof path !== 'string' || !path.startsWith('/')) return;
    const segments = path.split('/').filter(Boolean);

    if (!segments.length) {
      rootPaths.add(path);
      return;
    }

    const exactPath = `/${segments[0]}`;
    const bucket = topLevelBuckets.get(exactPath) || {
      exactPath,
      wildcardPath: `${exactPath}/*`,
      hasExactRoot: false,
      hasWildcardContent: false,
      estimatedCount: 0,
    };

    if (segments.length === 1) {
      if (path.endsWith('/')) {
        bucket.hasWildcardContent = true;
        bucket.estimatedCount += 1;
      } else {
        bucket.hasExactRoot = true;
      }
    } else {
      bucket.hasWildcardContent = true;
      bucket.estimatedCount += 1;
    }

    topLevelBuckets.set(exactPath, bucket);
  });

  const folderBuckets = [];
  topLevelBuckets.forEach((bucket) => {
    if (bucket.hasWildcardContent) {
      folderBuckets.push({
        paths: bucket.hasExactRoot
          ? [bucket.exactPath, bucket.wildcardPath]
          : [bucket.wildcardPath],
        estimatedCount: bucket.estimatedCount + (bucket.hasExactRoot ? 1 : 0),
      });
      return;
    }

    if (bucket.hasExactRoot) {
      rootPaths.add(bucket.exactPath);
    }
  });

  const rootBuckets = Array.from(rootPaths)
    .sort((a, b) => a.localeCompare(b))
    .map((path) => ({
      paths: [path],
      estimatedCount: 1,
    }));
  const partitions = packPathBuckets([...folderBuckets, ...rootBuckets]).sort((a, b) => (
    b.estimatedCount - a.estimatedCount
    || a.paths[0].localeCompare(b.paths[0])
  ));

  return {
    folderBucketCount: folderBuckets.length,
    rootPathCount: rootBuckets.length,
    partitions,
  };
}

function describePartitionPaths(paths) {
  if (paths.length <= PARTITION_LABEL_PATH_LIMIT) {
    return paths.join(', ');
  }
  return `${paths.slice(0, PARTITION_LABEL_PATH_LIMIT).join(', ')}, +${paths.length - PARTITION_LABEL_PATH_LIMIT} more`;
}

function describePartitionPlan(partitionPlan) {
  return `${partitionPlan.partitions.length} packed partition(s) from ${partitionPlan.folderBucketCount} top-level bucket(s) and ${partitionPlan.rootPathCount} root path(s), targeting about ${TARGET_PARTITION_RESOURCE_COUNT} preview path(s)/job`;
}

function formatPartitionLabel(partition, index, total) {
  const estimateInfo = Number.isFinite(partition.estimatedCount)
    ? `; ~${partition.estimatedCount} path(s)`
    : '';
  return `Detailed status job ${index + 1}/${total} (${describePartitionPaths(partition.paths)}${estimateInfo})`;
}

function normalizePartitionPaths(partition) {
  if (Array.isArray(partition)) {
    return partition;
  }
  return Array.isArray(partition?.paths) ? partition.paths : [];
}

function sumJobCounters(counterList) {
  const keys = ['total', 'processed', 'failed'];
  const totals = {};

  keys.forEach((key) => {
    let sum = 0;
    let found = false;
    counterList.forEach((counter) => {
      if (Number.isFinite(counter?.[key])) {
        sum += counter[key];
        found = true;
      }
    });
    totals[key] = found ? sum : null;
  });

  return totals;
}

async function runStatusJob(org, site, paths, {
  jobLabel,
  onPoll,
  pathsOnly = false,
} = {}) {
  const normalizedPaths = Array.isArray(paths) ? paths : [paths];
  const label = jobLabel || `status job (${normalizedPaths.join(', ')})`;
  const statusUrl = `${ADMIN_BASE}/status/${org}/${site}/${REF}/*`;

  const createRes = await fetchWithRetry(statusUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      paths: normalizedPaths,
      pathsOnly,
      select: ['preview'],
    }),
  });

  if (!createRes.ok) {
    throw new Error(`Failed to create ${label}: ${createRes.status}`);
  }

  const job = await createRes.json();
  const selfUrl = job.links?.self;
  if (!selfUrl) throw new Error(`No job URL returned for ${label}`);

  log(`${label} created: ${selfUrl}`);

  let state = extractJobState(job);
  let counters = extractJobCounters(job);
  let phase = extractJobPhase(job);
  const isInlineResult = createRes.status === 200 && state === TERMINAL_JOB_STATE;
  let lastStatusLogAt = 0;
  let lastLoggedState = '';
  let lastLoggedPhase = '';

  const maybeLogJobStatus = (force = false) => {
    const now = Date.now();
    const statusChanged = state !== lastLoggedState || phase !== lastLoggedPhase;
    if (
      !force
      && !statusChanged
      && (now - lastStatusLogAt) < JOB_COUNTER_LOG_INTERVAL
      && state !== TERMINAL_JOB_STATE
    ) {
      return;
    }
    if (!force && !statusChanged && (now - lastStatusLogAt) < JOB_COUNTER_LOG_INTERVAL) {
      return;
    }

    const phaseInfo = phase ? `, phase=${phase}` : '';
    log(`${label}: state=${state || 'unknown'}${phaseInfo}`);
    lastStatusLogAt = now;
    lastLoggedState = state;
    lastLoggedPhase = phase;
  };

  if (!isInlineResult) {
    maybeLogJobStatus(true);
  }

  while (!isInlineResult && state !== TERMINAL_JOB_STATE) {
    if (isAborted()) throw new DOMException('Aborted', 'AbortError');
    // eslint-disable-next-line no-await-in-loop
    await waitForDelay(POLL_INTERVAL, abortController?.signal);
    // eslint-disable-next-line no-await-in-loop
    const pollRes = await fetchWithRetry(selfUrl);
    if (!pollRes.ok) {
      throw new Error(`Failed to poll ${label}: ${pollRes.status}`);
    }
    // eslint-disable-next-line no-await-in-loop
    const pollData = await pollRes.json();
    state = extractJobState(pollData) || state;
    counters = mergeJobCounters(counters, extractJobCounters(pollData));
    phase = extractJobPhase(pollData) || phase;
    const progress = toJobProgressPercent(counters);
    if (onPoll) {
      onPoll({ state, progress, counters });
    }
    maybeLogJobStatus(false);
  }

  if (isInlineResult) {
    const resources = pathsOnly ? [] : extractJobResources(job);
    const discoveredPaths = pathsOnly ? extractJobPaths(job) : [];
    const detailMetric = pathsOnly ? `paths=${discoveredPaths.length}` : `resources=${resources.length}`;
    log(`${label} completed inline: phase=${phase || 'unknown'} (${detailMetric})`);

    return {
      state,
      phase,
      isComplete: phase === 'completed',
      counters,
      paths: discoveredPaths,
      resources,
    };
  }

  const detailsUrl = `${selfUrl}/details`;
  const detailsRes = await fetchWithRetry(detailsUrl);
  if (!detailsRes.ok) throw new Error(`Failed to fetch job details for ${label}: ${detailsRes.status}`);

  const details = await detailsRes.json();
  counters = mergeJobCounters(counters, extractJobCounters(details));
  phase = extractJobPhase(details) || phase;
  const resources = pathsOnly ? [] : extractJobResources(details);
  const discoveredPaths = pathsOnly ? extractJobPaths(details) : [];
  const detailMetric = pathsOnly ? `paths=${discoveredPaths.length}` : `resources=${resources.length}`;
  log(`${label} details: phase=${phase || 'unknown'} (${detailMetric})`);

  const isComplete = state === TERMINAL_JOB_STATE && phase === 'completed';

  return {
    state,
    phase,
    isComplete,
    counters,
    paths: discoveredPaths,
    resources,
  };
}

async function runPartitionedStatusJobs(org, site, partitions, {
  showProgress = true,
} = {}) {
  if (!partitions.length) {
    return {
      resources: [],
      counters: { total: null, processed: null, failed: null },
      incompleteCount: 0,
    };
  }

  const partitionCounters = [];
  let incompleteCount = 0;
  let resources = [];
  if (showProgress) {
    updateProgressMetrics({
      discoveryTotalJobs: partitions.length,
      discoveryCompletedJobs: 0,
    });
  }
  log(`Running ${partitions.length} packed detailed status job(s) targeting about ${TARGET_PARTITION_RESOURCE_COUNT} preview path(s) each`);

  for (let i = 0; i < partitions.length; i += 1) {
    if (isAborted()) throw new DOMException('Aborted', 'AbortError');
    const partition = partitions[i];
    const partitionPaths = normalizePartitionPaths(partition);
    const partitionLabel = formatPartitionLabel(partition, i, partitions.length);

    // eslint-disable-next-line no-await-in-loop
    const partitionJob = await runStatusJob(org, site, partitionPaths, {
      jobLabel: partitionLabel,
      onPoll: ({ state, progress }) => {
        if (showProgress) {
          const baseProgress = 10 + Math.floor((i / partitions.length) * 10);
          const progressSpan = Math.max(1, Math.ceil(10 / partitions.length));
          const phaseProgress = Math.min(
            20,
            baseProgress + Math.round((progress / 100) * progressSpan),
          );
          setPhase(
            `Phase 1: Discovering pages... (partition ${i + 1}/${partitions.length}, ${state} ${progress}%)`,
            phaseProgress,
          );
        }
      },
    });

    partitionCounters.push(partitionJob.counters);
    if (!partitionJob.isComplete) {
      incompleteCount += 1;
      log(`${partitionLabel} stopped before completion (phase=${partitionJob.phase || 'unknown'}, resources=${partitionJob.resources.length})`, 'warn');
    }
    resources = mergeResourcesByPath(resources, partitionJob.resources);
    if (showProgress) {
      updateProgressMetrics({ discoveryCompletedJobs: i + 1 });
    }
  }

  const counters = sumJobCounters(partitionCounters);
  log(`Detailed partition summary: resources=${resources.length}`);
  if (incompleteCount > 0) {
    log(`${incompleteCount} detailed status partition job(s) stopped before completion. Results may still be incomplete.`, 'warn');
  }

  return {
    resources,
    counters,
    incompleteCount,
  };
}

function classifyDiscoveredPaths(discoveredPaths) {
  const pages = [];
  const standaloneMedia = [];

  discoveredPaths.forEach((path) => {
    if (MEDIA_EXTENSIONS.test(path)) {
      standaloneMedia.push({ path });
    } else if (!path.match(/\.\w+$/)) {
      pages.push({ path });
    }
  });

  return { pages, standaloneMedia };
}

function buildStatusMetadata(resources) {
  const pageMetadataByPath = new Map();
  const standaloneMediaMetadataByPath = new Map();

  resources.forEach((resource) => {
    if (!resource.previewLastModified) return;

    const metadata = {
      path: resource.path,
      lastModified: resource.previewLastModified,
      user: resource.previewLastModifiedBy || '',
    };

    if (MEDIA_EXTENSIONS.test(resource.path)) {
      standaloneMediaMetadataByPath.set(resource.path, metadata);
    } else if (!resource.path.match(/\.\w+$/)) {
      pageMetadataByPath.set(resource.path, metadata);
    }
  });

  return {
    pageMetadataByPath,
    standaloneMediaMetadataByPath,
  };
}

function applyStatusMetadata(items, metadataByPath) {
  let withMetadata = 0;
  let withoutMetadata = 0;

  items.forEach((item) => {
    const metadata = metadataByPath.get(item.path);
    if (!metadata) {
      withoutMetadata += 1;
      return;
    }

    item.lastModified = metadata.lastModified;
    item.user = metadata.user;
    withMetadata += 1;
  });

  return {
    withMetadata,
    withoutMetadata,
  };
}

// Phase 1: Discover all page/media paths via lightweight bulk status job
async function discoverPaths(org, site) {
  beginProgressPhase('discovery', {
    discoveryTotalJobs: 0,
    discoveryCompletedJobs: 0,
    totalPages: 0,
    processedPages: 0,
    standaloneMediaCount: 0,
    totalEntries: 0,
    totalBatches: 0,
    processedBatches: 0,
  });
  setPhase('Phase 1: Planning page discovery...', 0);
  log('Starting lightweight path discovery via bulk status job...');
  const pathDiscoveryJob = await runStatusJob(org, site, ['/*'], {
    jobLabel: 'Path discovery job',
    pathsOnly: true,
    onPoll: ({ state, progress }) => {
      setPhase(`Phase 1: Planning page discovery... (${state} ${progress}%)`, Math.min(progress * 0.1, 10));
    },
  });

  const discoveredPaths = pathDiscoveryJob.paths;
  const pathCount = discoveredPaths.length;
  const partitionPlan = pathCount > 0 ? buildPathPartitions(discoveredPaths) : null;

  if (pathDiscoveryJob.isComplete) {
    log(`Path discovery completed with ${pathCount} preview path(s).`);
  } else if (pathCount > 0) {
    log(`Path discovery stopped before completion (phase=${pathDiscoveryJob.phase || 'unknown'}). Using ${pathCount} returned path(s) as a best-effort partition plan.`, 'warn');
  } else {
    log(`Path discovery stopped before completion (phase=${pathDiscoveryJob.phase || 'unknown'}), and returned no paths.`, 'warn');
  }

  const { pages, standaloneMedia } = classifyDiscoveredPaths(discoveredPaths);

  stats.pages = pages.length;
  updateProgressMetrics({
    totalPages: pages.length,
    standaloneMediaCount: standaloneMedia.length,
  });
  updateStatsDisplay();
  log(`Discovered ${pages.length} page path(s) and ${standaloneMedia.length} standalone media path(s)`);

  return {
    pages,
    standaloneMedia,
    pathDiscoveryJob,
    partitionPlan,
  };
}

async function loadDetailedStatusMetadata(org, site, {
  pathDiscoveryJob,
  partitionPlan,
}) {
  const pathCount = pathDiscoveryJob.paths.length;
  let resources = [];

  if (pathCount === 0 && pathDiscoveryJob.isComplete) {
    log('No preview paths found for this site.');
    return buildStatusMetadata(resources);
  }

  if (!pathDiscoveryJob.isComplete && partitionPlan) {
    log(`Running detailed status with ${describePartitionPlan(partitionPlan)} from partial path discovery. Coverage may still be incomplete.`, 'warn');
    ({ resources } = await runPartitionedStatusJobs(org, site, partitionPlan.partitions, {
      showProgress: false,
    }));
  } else if (pathDiscoveryJob.isComplete && pathCount > LARGE_SITE_PATH_THRESHOLD) {
    log(`Path discovery found ${pathCount} preview path(s), above threshold ${LARGE_SITE_PATH_THRESHOLD}. Running detailed status with ${describePartitionPlan(partitionPlan)}.`);
    ({ resources } = await runPartitionedStatusJobs(org, site, partitionPlan.partitions, {
      showProgress: false,
    }));
  } else {
    log('Starting detailed status job for full site in parallel with markdown crawling...');
    const primaryStatusJob = await runStatusJob(org, site, ['/*'], {
      jobLabel: 'Primary detailed status job',
    });

    resources = primaryStatusJob.resources;
    if (primaryStatusJob.isComplete) {
      log(`Primary detailed status job completed with phase=${primaryStatusJob.phase}.`);
    } else if (partitionPlan) {
      log(
        `Primary detailed status job stopped before completion (phase=${primaryStatusJob.phase || 'unknown'}). Retrying with ${describePartitionPlan(partitionPlan)} from path discovery.`,
        'warn',
      );
      const partitionedDiscovery = await runPartitionedStatusJobs(
        org,
        site,
        partitionPlan.partitions,
        {
          showProgress: false,
        },
      );
      resources = mergeResourcesByPath(resources, partitionedDiscovery.resources);
    } else {
      log(
        `Primary detailed status job stopped before completion (phase=${primaryStatusJob.phase || 'unknown'}). Proceeding with partial results.`,
        'warn',
      );
    }
  }

  const metadata = buildStatusMetadata(mergeResourcesByPath(resources));
  log(`Detailed status resolved metadata for ${metadata.pageMetadataByPath.size} page(s) and ${metadata.standaloneMediaMetadataByPath.size} standalone media path(s)`);
  return metadata;
}

function getContentType(url) {
  const ext = url.split('.').pop().split(/[?#]/)[0].toLowerCase();
  return CONTENT_TYPE_MAP[ext] || 'application/octet-stream';
}

function extractDimensions(url) {
  const match = url.match(/media_[\da-f]+\.[\w]+[?#]width=(\d+)&height=(\d+)/);
  if (match) return { width: parseInt(match[1], 10), height: parseInt(match[2], 10) };
  return {};
}

function normalizeMediaUrl(rawUrl, pageBaseUrl, siteAemOrigin, pageSourceUrl = '') {
  return normalizeMediaUrlToCurrentSiteAemPage(rawUrl, {
    pageBaseUrl,
    siteAemOrigin,
    pageSourceUrl,
  });
}

function toMarkdownPath(pagePath) {
  if (!pagePath || pagePath === '/') {
    return '/index.md';
  }
  if (pagePath.endsWith('/')) {
    return `${pagePath}index.md`;
  }
  return `${pagePath}.md`;
}

function normalizeTimestampMs(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : NaN;
  }
  if (typeof value === 'string' && value) {
    const ts = Date.parse(value);
    return Number.isNaN(ts) ? NaN : ts;
  }
  return NaN;
}

/**
 * When the CORS proxy (da-etc.adobeaem.workers.dev) passes through a 301 with a relative
 * Location header, the browser resolves that path against the proxy origin instead of the
 * original aem.page origin. This produces a bogus URL on the proxy host that returns no
 * last-modified. This helper detects that case and re-fetches the correctly constructed URL.
 */
async function resolveProxyRedirectLastModified(originalUrl, response) {
  if (!response.redirected) return '';
  try {
    const etcHostname = new URL(DA_ETC_ORIGIN).hostname;
    const responseUrlObj = new URL(response.url);
    if (responseUrlObj.hostname !== etcHostname) return '';
    const correctUrl = new URL(originalUrl).origin
      + responseUrlObj.pathname
      + responseUrlObj.search;
    if (correctUrl === originalUrl) return '';
    const redirectResponse = await fetchWithRetry(correctUrl, { method: 'HEAD' }, 1);
    if (redirectResponse.ok) {
      return (redirectResponse.headers.get('last-modified') || '').trim();
    }
  } catch {
    // malformed URL or network error — ignore
  }
  return '';
}

async function fetchLastModified(url) {
  const response = await fetchWithRetry(url, { method: 'HEAD' }, 1);
  if (response.ok) {
    const lm = (response.headers.get('last-modified') || '').trim();
    if (lm) return lm;
  }
  return resolveProxyRedirectLastModified(url, response);
}

async function fetchContentSourceType(org, site) {
  const configUrl = `${ADMIN_BASE}/config/${encodeURIComponent(org)}/sites/${encodeURIComponent(site)}.json`;

  try {
    const response = await fetchWithRetry(configUrl, {}, 1);
    if (!response.ok) {
      log(`Site config lookup returned ${response.status}; defaulting contentSourceType to markup.`, 'warn');
      return 'markup';
    }

    const config = await response.json();
    return config?.content?.source?.type || 'markup';
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    log(`Failed to load site config for contentSourceType: ${err.message}. Defaulting to markup.`, 'warn');
    return 'markup';
  }
}

function isHtmlResponse(contentType, body) {
  if (contentType?.includes('text/html') || contentType?.includes('application/xhtml+xml')) {
    return true;
  }

  const trimmed = body?.trimStart().toLowerCase() || '';
  return trimmed.startsWith('<!doctype html')
    || trimmed.startsWith('<html')
    || trimmed.startsWith('<head')
    || trimmed.startsWith('<body');
}

function getHtmlBaseUrl(doc, fallbackBaseUrl) {
  return resolveHtmlMediaBaseUrl(
    doc.querySelector('base[href]')?.getAttribute('href') || '',
    fallbackBaseUrl,
  );
}

function parseSrcsetUrls(srcset) {
  if (!srcset) return [];

  return srcset
    .split(',')
    .map((entry) => entry.trim().split(/\s+/)[0])
    .filter(Boolean);
}

function normalizeCollectedMediaUrls(mediaUrls, baseUrl, siteAemOrigin, pageSourceUrl = '') {
  return dedupeMediaUrls(mediaUrls
    .map((url) => normalizeMediaUrl(url, baseUrl, siteAemOrigin, pageSourceUrl))
    .filter(Boolean));
}

function parseMediaFromMarkdown(markdown, pageBaseUrl, siteAemOrigin) {
  const mediaUrls = [];

  // Inline images: ![alt](url) or ![alt](url "title")
  const inlineImageRegex = /!\[[^\]]*]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  let match = inlineImageRegex.exec(markdown);
  while (match) {
    mediaUrls.push(match[1]);
    match = inlineImageRegex.exec(markdown);
  }

  // Reference-style images: ![alt][ref] paired with [ref]: url
  const refDefs = {};
  const refDefRegex = /^\[([^\]]+)]:\s*(.+)$/gm;
  match = refDefRegex.exec(markdown);
  while (match) {
    const [refUrl] = match[2].trim().split(/\s+/);
    refDefs[match[1].toLowerCase()] = refUrl;
    match = refDefRegex.exec(markdown);
  }
  const refImageRegex = /!\[[^\]]*]\[([^\]]+)]/g;
  match = refImageRegex.exec(markdown);
  while (match) {
    const def = refDefs[match[1].toLowerCase()];
    if (def) mediaUrls.push(def);
    match = refImageRegex.exec(markdown);
  }

  // Video links: [text](url) where url ends with video extension
  const linkRegex = /\[[^\]]*]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  match = linkRegex.exec(markdown);
  while (match) {
    if (VIDEO_EXTENSIONS.test(match[1])) {
      mediaUrls.push(match[1]);
    }
    match = linkRegex.exec(markdown);
  }

  return dedupeMediaUrls(mediaUrls
    .map((url) => normalizeMediaUrl(url, pageBaseUrl, siteAemOrigin))
    .filter(Boolean));
}

function parseMediaFromHtml(html, fallbackBaseUrl, siteAemOrigin, responseSourceUrl = '') {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const pageBaseUrl = getHtmlBaseUrl(doc, fallbackBaseUrl);
  const mediaUrls = [];

  doc.querySelectorAll('img[src]').forEach((img) => {
    mediaUrls.push(img.getAttribute('src'));
  });

  doc.querySelectorAll('img[srcset]').forEach((img) => {
    mediaUrls.push(...parseSrcsetUrls(img.getAttribute('srcset')));
  });

  doc.querySelectorAll('source[src]').forEach((source) => {
    const src = source.getAttribute('src');
    if (src && MEDIA_EXTENSIONS.test(src)) {
      mediaUrls.push(src);
    }
  });

  doc.querySelectorAll('source[srcset]').forEach((source) => {
    mediaUrls.push(...parseSrcsetUrls(source.getAttribute('srcset')));
  });

  doc.querySelectorAll('video[src], video[poster]').forEach((video) => {
    if (video.getAttribute('src')) {
      mediaUrls.push(video.getAttribute('src'));
    }
    if (video.getAttribute('poster')) {
      mediaUrls.push(video.getAttribute('poster'));
    }
  });

  doc.querySelectorAll('meta[property="og:image"], meta[property="og:image:url"], meta[name="twitter:image"], meta[name="twitter:image:src"], meta[property="og:video"], meta[property="og:video:url"]').forEach((meta) => {
    const value = meta.getAttribute('content');
    if (value) {
      mediaUrls.push(value);
    }
  });

  doc.querySelectorAll('a[href]').forEach((anchor) => {
    const href = anchor.getAttribute('href');
    if (href && VIDEO_EXTENSIONS.test(href)) {
      mediaUrls.push(href);
    }
  });

  doc.querySelectorAll('[style*="background-image"]').forEach((element) => {
    const style = element.getAttribute('style') || '';
    const matches = style.match(/url\((['"]?)(.*?)\1\)/gi) || [];
    matches.forEach((match) => {
      const urlMatch = match.match(/url\((['"]?)(.*?)\1\)/i);
      if (urlMatch?.[2]) {
        mediaUrls.push(urlMatch[2]);
      }
    });
  });

  return normalizeCollectedMediaUrls(mediaUrls, pageBaseUrl, siteAemOrigin, responseSourceUrl);
}

function toComparableTimestamp(lastModified) {
  const ts = normalizeTimestampMs(lastModified);
  return Number.isNaN(ts) ? Number.MAX_SAFE_INTEGER : ts;
}

function createDeterministicEntries(mediaCandidates) {
  const sorted = [...mediaCandidates].sort((a, b) => {
    const tsDiff = toComparableTimestamp(a.page.lastModified)
      - toComparableTimestamp(b.page.lastModified);
    if (tsDiff !== 0) return tsDiff;
    const pathDiff = a.page.path.localeCompare(b.page.path);
    if (pathDiff !== 0) return pathDiff;
    const identityDiff = getMediaIdentity(a.url).localeCompare(getMediaIdentity(b.url));
    if (identityDiff !== 0) return identityDiff;
    const urlDiff = a.url.localeCompare(b.url);
    if (urlDiff !== 0) return urlDiff;
    return a.order - b.order;
  });

  const seenMedia = new Set();
  let dupes = 0;
  const entries = sorted.map(({ page, url }) => {
    const mediaIdentity = getMediaIdentity(url);
    const operation = seenMedia.has(mediaIdentity) ? 'reuse' : 'ingest';
    if (operation === 'reuse') {
      dupes += 1;
    }
    seenMedia.add(mediaIdentity);
    return {
      entry: {
        operation,
        path: url,
        resourcePath: page.path,
        contentType: getContentType(url),
        ...extractDimensions(url),
      },
      page,
    };
  });

  return { entries, dupes };
}

function compareResolvedEntries(a, b) {
  const tsDiff = a.timestamp - b.timestamp;
  if (tsDiff !== 0) return tsDiff;
  const operationDiff = (a.operation || '').localeCompare(b.operation || '');
  if (operationDiff !== 0) return operationDiff;
  const pathDiff = (a.path || '').localeCompare(b.path || '');
  if (pathDiff !== 0) return pathDiff;
  const resourcePathDiff = (a.resourcePath || '').localeCompare(b.resourcePath || '');
  if (resourcePathDiff !== 0) return resourcePathDiff;
  const contentTypeDiff = (a.contentType || '').localeCompare(b.contentType || '');
  if (contentTypeDiff !== 0) return contentTypeDiff;
  const userDiff = (a.user || '').localeCompare(b.user || '');
  if (userDiff !== 0) return userDiff;
  return (a.sourceOrder || 0) - (b.sourceOrder || 0);
}

function createResolvedEntries(entries, fallbackUser, contentSourceType = 'markup') {
  return entries
    .map(({
      entry,
      page,
      ingestLastModified,
      ingestUser,
    }, sourceOrder) => {
      const user = entry.operation === 'ingest'
        ? (ingestUser || page.user || fallbackUser || '')
        : (page.user || fallbackUser || '');
      const mediaHash = extractMediaHash(entry.path);
      const originalFilename = deriveOriginalFilename(entry.path);
      const timestamp = entry.operation === 'reuse'
        ? normalizeTimestampMs(page.lastModified)
        : (() => {
          const ingestTimestamp = normalizeTimestampMs(ingestLastModified);
          return Number.isFinite(ingestTimestamp) ? ingestTimestamp : 0;
        })();

      return {
        ...entry,
        ...(mediaHash ? { mediaHash } : {}),
        originalFilename,
        contentSourceType,
        user,
        timestamp,
        sourceOrder,
      };
    })
    .sort(compareResolvedEntries);
}

function buildExportBundle(org, site, resolvedEntries, warningMessages = []) {
  const entries = resolvedEntries.map(({ sourceOrder, ...entry }) => entry);
  const ingestCount = entries.filter((entry) => entry.operation === 'ingest').length;
  const reuseCount = entries.filter((entry) => entry.operation === 'reuse').length;

  return {
    version: MEDIALOG_IMPORT_BUNDLE_VERSION,
    generatedAt: new Date().toISOString(),
    org,
    site,
    ref: REF,
    summary: {
      pagesCrawled: stats.pages,
      mediaEntries: entries.length,
      ingestCount,
      reuseCount,
      duplicateCount: stats.dupes,
      warnings: warningMessages,
    },
    entries,
  };
}

function downloadJson(filename, payload) {
  const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
  const href = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = href;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(href);
}

async function exportBundle(
  org,
  site,
  entries,
  fallbackUser,
  contentSourceType,
  warningMessages = [],
) {
  beginProgressPhase('export', {
    totalEntries: entries.length,
    totalBatches: 1,
    processedBatches: 0,
  });
  setPhase('Phase 3: Building export bundle...', 70);

  const resolvedEntries = createResolvedEntries(entries, fallbackUser, contentSourceType);
  const validEntries = resolvedEntries.filter((entry) => Number.isFinite(entry.timestamp));
  const skippedTimestampCount = resolvedEntries.length - validEntries.length;
  if (skippedTimestampCount > 0) {
    log(
      `Skipping ${skippedTimestampCount} entry/entries that could not be normalized to a numeric timestamp.`,
      'warn',
    );
  }

  const bundle = buildExportBundle(org, site, validEntries, warningMessages);
  const timestampLabel = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `medialog-import-bundle-${org}-${site}-${timestampLabel}.json`;

  setPhase('Phase 3: Downloading export bundle...', 95);
  downloadJson(filename, bundle);

  stats.sent = validEntries.length;
  updateStatsDisplay();
  updateProgressMetrics({ processedBatches: 1, totalEntries: validEntries.length });
  log(`Downloaded medialog import bundle: ${filename}`);

  return {
    filename,
    exportedEntries: validEntries.length,
    skippedTimestampCount,
  };
}

// Phase 2: Fetch and parse markdown for each page
async function processPages(org, site, pages) {
  beginProgressPhase('processing', {
    totalPages: pages.length,
    processedPages: 0,
    totalEntries: 0,
    totalBatches: 0,
    processedBatches: 0,
  });
  setPhase('Phase 2: Processing page content...', 25);
  log(`Processing ${pages.length} pages for media references...`);

  const mediaCandidates = [];
  let candidateOrder = 0;
  let processed = 0;
  let htmlPageCount = 0;
  let redirectSkippedCount = 0;
  let lastProgressProcessed = 0;
  let lastProgressUpdateAt = Date.now();
  const siteAemOrigin = getSiteAemPageOrigin(org, site, REF);

  async function fetchPageContent(page) {
    const markdownPath = toMarkdownPath(page.path);
    const pageUrl = `https://${REF}--${site}--${org}.aem.page${markdownPath}`;
    const pageRes = await fetchWithRetry(pageUrl, { redirect: 'manual' }, 1);
    if (pageRes.status === 0 || (pageRes.status >= 300 && pageRes.status < 400)) {
      return {
        redirected: true,
        requestUrl: pageUrl,
      };
    }
    if (pageRes.ok) {
      page.fallbackLastModified = pageRes.headers.get('last-modified') || page.fallbackLastModified || '';
      return {
        body: await pageRes.text(),
        contentType: pageRes.headers.get('content-type') || '',
        requestUrl: pageUrl,
        responseSourceUrl: pageRes.headers.get('x-source-location')
          || pageRes.headers.get('x-content-source-location')
          || pageRes.headers.get('location')
          || '',
      };
    }
    return null;
  }

  function flushProcessingProgress(force = false) {
    const now = Date.now();
    const processedDelta = processed - lastProgressProcessed;
    const shouldFlush = force
      || processed === pages.length
      || processedDelta >= PROCESSING_PROGRESS_PAGE_INTERVAL
      || (
        processedDelta > 0
        && (now - lastProgressUpdateAt) >= PROCESSING_PROGRESS_MIN_INTERVAL_MS
      );

    if (!shouldFlush) {
      return;
    }

    updateProgressMetrics({ processedPages: processed });
    const pct = 25 + Math.round((processed / pages.length) * 40);
    setPhase(`Phase 2: Processing pages... (${processed}/${pages.length})`, pct);
    stats.media = mediaCandidates.length;
    updateStatsDisplay();
    lastProgressProcessed = processed;
    lastProgressUpdateAt = now;
  }

  await runWithConcurrency(pages, async (page) => {
    if (isAborted()) return;

    let pageContent;
    try {
      pageContent = await fetchPageContent(page);
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      log(`Failed to fetch ${page.path}: ${err.message}`, 'error');
      stats.errors += 1;
    }

    if (pageContent?.body) {
      const pageBaseUrl = pageContent.requestUrl;
      const isHtml = isHtmlResponse(pageContent.contentType, pageContent.body);
      if (isHtml) {
        htmlPageCount += 1;
      }
      const urls = isHtml
        ? parseMediaFromHtml(
          pageContent.body,
          pageBaseUrl,
          siteAemOrigin,
          pageContent.responseSourceUrl,
        )
        : parseMediaFromMarkdown(pageContent.body, pageBaseUrl, siteAemOrigin);
      urls.forEach((url) => {
        mediaCandidates.push({
          order: candidateOrder,
          url,
          page,
        });
        candidateOrder += 1;
      });
    } else if (pageContent?.redirected) {
      redirectSkippedCount += 1;
    }

    processed += 1;
    flushProcessingProgress();
  }, PAGE_CRAWL_CONCURRENCY);

  if (pages.length > 0) {
    flushProcessingProgress(true);
  }

  if (htmlPageCount > 0) {
    log(`Scraped media from HTML responses for ${htmlPageCount} page(s) that did not return markdown.`, 'warn');
  }
  if (redirectSkippedCount > 0) {
    log(`Skipped ${redirectSkippedCount} page(s) whose markdown path responded with a redirect instead of direct content.`, 'warn');
  }
  log(`Collected ${mediaCandidates.length} media candidate(s) across ${pages.length} crawled page(s)`);
  return mediaCandidates;
}

function applyFallbackLastModified(items) {
  let applied = 0;
  let missing = 0;

  items.forEach((item) => {
    if (item.lastModified) {
      return;
    }

    if (item.fallbackLastModified) {
      item.lastModified = item.fallbackLastModified;
      item.user = '';
      applied += 1;
      return;
    }

    missing += 1;
  });

  return { applied, missing };
}

function buildStandaloneMediaMetadataByIdentity(org, site, standaloneMedia) {
  const metadataByIdentity = new Map();

  standaloneMedia.forEach((media) => {
    const mediaUrl = `https://${REF}--${site}--${org}.aem.page${media.path}`;
    const mediaIdentity = getMediaIdentity(mediaUrl);
    if (!mediaIdentity) {
      return;
    }

    const existing = metadataByIdentity.get(mediaIdentity);
    const candidate = {
      path: media.path,
      lastModified: media.lastModified || media.fallbackLastModified || '',
      user: media.user || '',
    };

    if (!existing) {
      metadataByIdentity.set(mediaIdentity, candidate);
      return;
    }

    const candidateHasUser = Boolean(candidate.user);
    const existingHasUser = Boolean(existing.user);
    if (candidateHasUser && !existingHasUser) {
      metadataByIdentity.set(mediaIdentity, candidate);
      return;
    }

    const candidateDepth = candidate.path.split('/').filter(Boolean).length;
    const existingDepth = existing.path.split('/').filter(Boolean).length;
    if (candidateDepth > existingDepth) {
      metadataByIdentity.set(mediaIdentity, candidate);
    }
  });

  return metadataByIdentity;
}

async function populateStandaloneMediaFallbackLastModified(org, site, standaloneMedia) {
  const pending = standaloneMedia.filter(
    (media) => !media.lastModified && !media.fallbackLastModified,
  );
  if (!pending.length) {
    return { attempted: 0, found: 0 };
  }

  log(`Fetching aem.page Last-Modified fallback for ${pending.length} standalone media path(s)...`);
  let found = 0;

  await runWithConcurrency(pending, async (media) => {
    const mediaUrl = `https://${REF}--${site}--${org}.aem.page${media.path}`;

    try {
      const lastModified = await fetchLastModified(mediaUrl);
      if (lastModified) {
        media.fallbackLastModified = lastModified;
        found += 1;
      }
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      log(`Failed to fetch fallback Last-Modified for ${media.path}: ${err.message}`, 'warn');
    }
  }, PAGE_CRAWL_CONCURRENCY);

  return {
    attempted: pending.length,
    found,
  };
}

async function populateIngestLastModified(entries, standaloneMediaMetadataByIdentity = new Map()) {
  const ingestEntries = entries.filter(({ entry }) => entry.operation === 'ingest');
  if (!ingestEntries.length) {
    return {
      attempted: 0,
      found: 0,
      reusedFromStatus: 0,
      fetched: 0,
    };
  }

  let found = 0;
  let reusedFromStatus = 0;

  ingestEntries.forEach((item) => {
    const metadata = standaloneMediaMetadataByIdentity.get(getMediaIdentity(item.entry.path));
    if (!metadata?.lastModified) {
      return;
    }

    item.ingestLastModified = metadata.lastModified;
    item.ingestUser = metadata.user || '';
    found += 1;
    reusedFromStatus += 1;
  });

  const pending = ingestEntries.filter((item) => !item.ingestLastModified);
  if (!pending.length) {
    return {
      attempted: ingestEntries.length,
      found,
      reusedFromStatus,
      fetched: 0,
    };
  }

  log(`Fetching asset/media Last-Modified for ${pending.length} ingest entry URL(s)...`);
  let fetched = 0;

  await runWithConcurrency(pending, async (item) => {
    try {
      const assetUrl = new URL(item.entry.path);
      assetUrl.hostname = assetUrl.hostname
        .replace('.hlx.page', '.aem.page')
        .replace('.hlx.live', '.aem.page')
        .replace('.aem.live', '.aem.page');
      const lastModified = await fetchLastModified(assetUrl.toString());
      if (lastModified) {
        item.ingestLastModified = lastModified;
        found += 1;
        fetched += 1;
      }
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      log(`Failed to fetch asset/media Last-Modified for ${item.entry.path}: ${err.message}`, 'warn');
    }
  }, PAGE_CRAWL_CONCURRENCY);

  return {
    attempted: ingestEntries.length,
    found,
    reusedFromStatus,
    fetched,
  };
}

function showReport(startTime, exportResult) {
  const duration = formatDuration(Date.now() - startTime);
  setPhase('Complete', 100);
  log('--- Export Summary ---', 'success');
  log(`  Duration: ${duration}`);
  log(`  Pages crawled: ${stats.pages}`);
  log(`  Media entries: ${stats.media}`);
  log(`  Unique (ingest): ${stats.media - stats.dupes}`);
  log(`  Duplicates (reuse): ${stats.dupes}`);
  log(`  Bundle entries: ${stats.sent}`);
  if (exportResult?.skippedTimestampCount > 0) {
    log(`  Invalid timestamps skipped: ${exportResult.skippedTimestampCount}`, 'warn');
  }
  if (exportResult?.filename) {
    log(`  Bundle file: ${exportResult.filename}`);
  }
  log('  Next step: run the separate backfill CLI with your bucket and contentBusId.');
  log(`  Errors: ${stats.errors}`);
  log('Done.', 'success');
}

async function runBackfill() {
  const org = DOM.org.value.trim();
  const site = DOM.site.value.trim();
  const fallbackUser = DOM.fallbackUser.value.trim();

  if (!org || !site) return;

  if (!await ensureLogin(org, site)) {
    window.addEventListener('profile-update', ({ detail: loginInfo }) => {
      if (loginInfo.includes(org)) {
        DOM.runBtn.click();
      }
    }, { once: true });
    return;
  }

  abortController = new AbortController();
  adminLimiter.reset();
  aemPageLimiter.reset();
  disableForm();
  resetStats();
  resetConsole();
  startProgressTracking();
  DOM.console.setAttribute('aria-hidden', 'false');
  DOM.progressSection.setAttribute('aria-hidden', 'false');

  const startTime = Date.now();
  try {
    const bundleWarnings = [];
    const warnForBundle = (message) => {
      bundleWarnings.push(message);
      log(message, 'warn');
    };
    const contentSourceType = await fetchContentSourceType(org, site);

    log(`Starting medialog bundle export for ${org}/${site}...`);
    log(`Using contentSourceType=${contentSourceType} for exported backfill entries.`);

    const discovery = await discoverPaths(org, site);
    if (isAborted()) return;

    let statusMetadataReady = false;
    const statusMetadataPromise = loadDetailedStatusMetadata(org, site, discovery)
      .then((metadata) => {
        statusMetadataReady = true;
        return { metadata };
      })
      .catch((error) => {
        statusMetadataReady = true;
        return { error };
      });

    const mediaCandidates = await processPages(org, site, discovery.pages);
    if (isAborted()) return;

    if (!statusMetadataReady) {
      beginProgressPhase('metadata');
      setPhase('Phase 2.5: Waiting for detailed status metadata...', 65);
    }
    const statusMetadataResult = await statusMetadataPromise;
    if (statusMetadataResult.error) {
      throw statusMetadataResult.error;
    }

    const {
      pageMetadataByPath,
      standaloneMediaMetadataByPath,
    } = statusMetadataResult.metadata;

    applyStatusMetadata(discovery.pages, pageMetadataByPath);
    applyStatusMetadata(
      discovery.standaloneMedia,
      standaloneMediaMetadataByPath,
    );

    const pageFallbackStats = applyFallbackLastModified(discovery.pages);

    if (
      pageFallbackStats.missing > 0
      || discovery.standaloneMedia.some((media) => !media.lastModified)
    ) {
      setPhase('Phase 2.5: Filling fallback Last-Modified metadata...', 68);
    }

    const standaloneFallbackFetchStats = await populateStandaloneMediaFallbackLastModified(
      org,
      site,
      discovery.standaloneMedia,
    );
    const standaloneFallbackStats = applyFallbackLastModified(discovery.standaloneMedia);

    if (pageFallbackStats.applied > 0 || standaloneFallbackStats.applied > 0) {
      warnForBundle(
        `Used aem.page Last-Modified fallback for ${pageFallbackStats.applied} page(s) and ${standaloneFallbackStats.applied} standalone media path(s); user will remain empty for those entries.`,
      );
    }

    if (standaloneFallbackFetchStats.attempted > 0 && standaloneFallbackFetchStats.found === 0) {
      warnForBundle('Standalone media fallback header fetches completed without any recoverable Last-Modified values.');
    }

    if (pageFallbackStats.missing > 0 || standaloneFallbackStats.missing > 0) {
      warnForBundle(
        `No Last-Modified metadata was available for ${pageFallbackStats.missing} page(s) and ${standaloneFallbackStats.missing} standalone media path(s) even after fallback; those items will still be skipped.`,
      );
    }

    const eligibleMediaCandidates = mediaCandidates.filter(({ page }) => page.lastModified);
    const skippedCandidateCount = mediaCandidates.length - eligibleMediaCandidates.length;
    if (skippedCandidateCount > 0) {
      warnForBundle(`Skipping ${skippedCandidateCount} media candidate(s) whose source page had neither detailed status metadata nor an aem.page Last-Modified fallback.`);
    }

    const { entries, dupes } = createDeterministicEntries(eligibleMediaCandidates);
    stats.media = entries.length;
    stats.dupes = dupes;
    updateStatsDisplay();
    log(`Found ${entries.length} media entries across ${discovery.pages.length} crawled page(s) (${dupes} duplicates)`);

    const standaloneMedia = discovery.standaloneMedia.filter((media) => media.lastModified);
    const standaloneMediaMetadataByIdentity = buildStandaloneMediaMetadataByIdentity(
      org,
      site,
      standaloneMedia,
    );
    const existingMediaPaths = new Set(entries.map(({ entry }) => getMediaIdentity(entry.path)));
    standaloneMedia.forEach((media) => {
      const mediaUrl = `https://${REF}--${site}--${org}.aem.page${media.path}`;
      const mediaIdentity = getMediaIdentity(mediaUrl);
      stats.media += 1;
      if (existingMediaPaths.has(mediaIdentity)) {
        stats.dupes += 1;
        return;
      }
      existingMediaPaths.add(mediaIdentity);
      entries.push({
        entry: {
          operation: 'ingest',
          path: mediaUrl,
          resourcePath: media.path,
          contentType: getContentType(media.path),
        },
        page: media,
      });
    });
    setPhase('Phase 2.6: Resolving ingest asset timestamps...', 69);
    const ingestLastModifiedStats = await populateIngestLastModified(
      entries,
      standaloneMediaMetadataByIdentity,
    );
    if (ingestLastModifiedStats.reusedFromStatus > 0) {
      log(
        `Reused detailed status metadata for ${ingestLastModifiedStats.reusedFromStatus} `
          + 'ingest entry URL(s) before asset header fetches.',
      );
    }
    if (ingestLastModifiedStats.attempted > 0 && ingestLastModifiedStats.fetched > 0) {
      log(
        'Resolved asset/media Last-Modified from direct asset header fetches for '
          + `${ingestLastModifiedStats.fetched} of `
          + `${ingestLastModifiedStats.attempted - ingestLastModifiedStats.reusedFromStatus} `
          + 'remaining ingest entry URL(s).',
      );
    }
    if (
      ingestLastModifiedStats.attempted > 0
      && ingestLastModifiedStats.found < ingestLastModifiedStats.attempted
    ) {
      warnForBundle(
        'Some ingest entry URLs did not expose a usable asset/media Last-Modified header; '
          + 'those ingests will be exported with timestamp 0.',
      );
    }
    updateProgressMetrics({
      totalEntries: entries.length,
      totalBatches: 1,
    });
    updateStatsDisplay();

    const exportResult = await exportBundle(
      org,
      site,
      entries,
      fallbackUser,
      contentSourceType,
      bundleWarnings,
    );
    if (isAborted()) return;

    showReport(startTime, exportResult);
    updateConfig();
  } catch (err) {
    if (err.name === 'AbortError') {
      log('Backfill cancelled by user.', 'warn');
      setPhase('Cancelled');
    } else {
      log(`Fatal error: ${err.message}`, 'error');
      setPhase('Error');
      stats.errors += 1;
      updateStatsDisplay();
    }
  } finally {
    stopProgressTracking();
    enableForm();
    abortController = null;
  }
}

function registerListeners() {
  DOM.form.addEventListener('submit', (e) => {
    e.preventDefault();
    runBackfill();
  });

  DOM.cancelBtn.addEventListener('click', () => {
    if (abortController) {
      abortController.abort();
      DOM.cancelBtn.disabled = true;
    }
  });

  DOM.showAllLogs.addEventListener('click', () => {
    consoleState.showAll = !consoleState.showAll;
    renderConsole();
  });
}

async function init() {
  initDOM();
  resetProgressTracking();
  await initConfigField();
  registerListeners();
}

registerToolReady(init());
