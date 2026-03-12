import { registerToolReady } from '../../scripts/scripts.js';
import { ensureLogin } from '../../blocks/profile/profile.js';
import { initConfigField, updateConfig } from '../../utils/config/config.js';

const ADMIN_BASE = 'https://admin.hlx.page';
const REF = 'main';
const BATCH_SIZE = 10;
const CONCURRENCY = 5;
const POLL_INTERVAL = 2000;
const JOB_COUNTER_LOG_INTERVAL = 10000;
const ADMIN_API_RATE = 10;
const LOG_WINDOW_SIZE = 1000;
const TERMINAL_JOB_STATE = 'stopped';
const LARGE_SITE_PATH_THRESHOLD = 20000;
const TARGET_PARTITION_RESOURCE_COUNT = 20000;
const MAX_PARTITION_PATHS = 250;
const PARTITION_LABEL_PATH_LIMIT = 3;

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
};

function initDOM() {
  const form = document.getElementById('backfill-form');
  DOM.form = form;
  DOM.org = form.querySelector('#org');
  DOM.site = form.querySelector('#site');
  DOM.dryRun = form.querySelector('#dry-run');
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
  } else if (progressState.currentProgress >= 1 && elapsed >= 5000) {
    const estimatedTotal = (elapsed * 100) / progressState.currentProgress;
    const remaining = Math.max(0, estimatedTotal - elapsed);
    etaLabel = `~${formatDuration(remaining)}`;
  }

  DOM.progressMeta.textContent = `Elapsed: ${formatDuration(elapsed)} | ETA: ${etaLabel}`;
}

function resetProgressTracking() {
  if (progressState.timerId) {
    window.clearInterval(progressState.timerId);
  }
  progressState.startedAt = 0;
  progressState.currentProgress = 0;
  progressState.timerId = 0;
  progressState.status = 'idle';
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
    ? `Show recent (${LOG_WINDOW_SIZE})`
    : `Show all (${total})`;
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
    reset() {
      queue = Promise.resolve();
    },
  };
}

const adminLimiter = createRateLimiter(ADMIN_API_RATE, () => abortController?.signal);

async function fetchWithRetry(url, options = {}, maxRetries = 3) {
  const signal = abortController ? abortController.signal : undefined;
  const fetchOptions = { ...options, signal };
  const isAdminApi = url.startsWith(ADMIN_BASE);

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    if (isAborted()) throw new DOMException('Aborted', 'AbortError');
    try {
      if (isAdminApi) {
        // eslint-disable-next-line no-await-in-loop
        await adminLimiter.acquire();
        if (isAborted()) throw new DOMException('Aborted', 'AbortError');
      }
      // eslint-disable-next-line no-await-in-loop
      const res = await fetch(url, fetchOptions);
      if (isAdminApi) {
        adminLimiter.handleResponse(res);
      }
      if (res.status === 429 && attempt < maxRetries) {
        const retryAfter = parseInt(
          res.headers.get('x-retry-after') || res.headers.get('retry-after'),
          10,
        ) || (2 ** attempt);
        log(`Rate limited (429), pausing ${retryAfter}s before retry (${attempt + 1}/${maxRetries})...`, 'warn');
        if (isAdminApi) {
          adminLimiter.backoff(retryAfter);
        } else {
          // eslint-disable-next-line no-await-in-loop
          await waitForDelay(retryAfter * 1000, signal);
        }
        // eslint-disable-next-line no-continue
        continue;
      }
      if (res.status === 503 && attempt < maxRetries) {
        const delay = (2 ** attempt) * 1000;
        log(`Service unavailable (503), retrying in ${delay / 1000}s...`, 'warn');
        // eslint-disable-next-line no-await-in-loop
        await waitForDelay(delay, signal);
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
  phaseOffset = 10,
  phaseSpan = 10,
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
  log(`Running ${partitions.length} packed detailed status job(s) targeting about ${TARGET_PARTITION_RESOURCE_COUNT} preview path(s) each`);

  for (let i = 0; i < partitions.length; i += 1) {
    if (isAborted()) throw new DOMException('Aborted', 'AbortError');
    const partition = partitions[i];
    const partitionPaths = normalizePartitionPaths(partition);
    const partitionLabel = formatPartitionLabel(partition, i, partitions.length);
    const baseProgress = phaseOffset + Math.floor((i / partitions.length) * phaseSpan);
    const progressSpan = Math.max(1, Math.ceil(phaseSpan / partitions.length));

    // eslint-disable-next-line no-await-in-loop
    const partitionJob = await runStatusJob(org, site, partitionPaths, {
      jobLabel: partitionLabel,
      onPoll: ({ state, progress }) => {
        const phaseProgress = Math.min(
          phaseOffset + phaseSpan,
          baseProgress + Math.round((progress / 100) * progressSpan),
        );
        setPhase(
          `Phase 1: Discovering pages... (partition ${i + 1}/${partitions.length}, ${state} ${progress}%)`,
          phaseProgress,
        );
      },
    });

    partitionCounters.push(partitionJob.counters);
    if (!partitionJob.isComplete) {
      incompleteCount += 1;
      log(`${partitionLabel} stopped before completion (phase=${partitionJob.phase || 'unknown'}, resources=${partitionJob.resources.length})`, 'warn');
    }
    resources = mergeResourcesByPath(resources, partitionJob.resources);
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

// Phase 1: Discover all pages via bulk status job
async function discoverPages(org, site) {
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

  let resources = [];
  if (pathCount === 0 && pathDiscoveryJob.isComplete) {
    log('No preview paths found for this site.');
  } else if (!pathDiscoveryJob.isComplete && partitionPlan) {
    log(`Running detailed status with ${describePartitionPlan(partitionPlan)} from partial path discovery. Coverage may still be incomplete.`, 'warn');
    ({ resources } = await runPartitionedStatusJobs(org, site, partitionPlan.partitions));
  } else if (pathDiscoveryJob.isComplete && pathCount > LARGE_SITE_PATH_THRESHOLD) {
    log(`Path discovery found ${pathCount} preview path(s), above threshold ${LARGE_SITE_PATH_THRESHOLD}. Running detailed status with ${describePartitionPlan(partitionPlan)}.`);
    ({ resources } = await runPartitionedStatusJobs(org, site, partitionPlan.partitions));
  } else {
    log('Starting detailed status job for full site...');
    const primaryStatusJob = await runStatusJob(org, site, ['/*'], {
      jobLabel: 'Primary detailed status job',
      onPoll: ({ state, progress }) => {
        setPhase(
          `Phase 1: Discovering pages... (${state} ${progress}%)`,
          10 + Math.min(progress * 0.1, 10),
        );
      },
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
      );
      resources = mergeResourcesByPath(resources, partitionedDiscovery.resources);
    } else {
      log(
        `Primary detailed status job stopped before completion (phase=${primaryStatusJob.phase || 'unknown'}). Proceeding with partial results.`,
        'warn',
      );
    }
  }

  resources = mergeResourcesByPath(resources);

  const pages = [];
  const standaloneMedia = [];

  resources.forEach((r) => {
    if (!r.previewLastModified) return;
    if (MEDIA_EXTENSIONS.test(r.path)) {
      standaloneMedia.push({
        path: r.path,
        lastModified: r.previewLastModified,
        user: r.previewLastModifiedBy || '',
      });
    } else if (!r.path.match(/\.\w+$/)) {
      pages.push({
        path: r.path,
        lastModified: r.previewLastModified,
        user: r.previewLastModifiedBy || '',
      });
    }
  });

  stats.pages = pages.length;
  updateStatsDisplay();
  log(`Discovered ${pages.length} pages and ${standaloneMedia.length} standalone media files`);
  return { pages, standaloneMedia };
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

function normalizeMediaUrl(rawUrl, pageBaseUrl) {
  if (!rawUrl) return null;
  try {
    const normalizedInput = rawUrl.startsWith('//') ? `https:${rawUrl}` : rawUrl;
    const url = new URL(normalizedInput, pageBaseUrl);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    if (url.hostname.includes('.hlx.page')) {
      url.hostname = url.hostname.replace('.hlx.page', '.aem.page');
    }
    if (url.hostname.includes('.hlx.live')) {
      url.hostname = url.hostname.replace('.hlx.live', '.aem.live');
    }
    return url.toString();
  } catch (err) {
    return null;
  }
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

function parseMediaFromMarkdown(markdown, pageBaseUrl) {
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

  return mediaUrls
    .map((url) => normalizeMediaUrl(url, pageBaseUrl))
    .filter(Boolean);
}

function toComparableTimestamp(lastModified) {
  const ts = Date.parse(lastModified);
  return Number.isNaN(ts) ? Number.MAX_SAFE_INTEGER : ts;
}

function createDeterministicEntries(mediaCandidates) {
  const sorted = [...mediaCandidates].sort((a, b) => {
    const tsDiff = toComparableTimestamp(a.page.lastModified)
      - toComparableTimestamp(b.page.lastModified);
    if (tsDiff !== 0) return tsDiff;
    const pathDiff = a.page.path.localeCompare(b.page.path);
    if (pathDiff !== 0) return pathDiff;
    const urlDiff = a.url.localeCompare(b.url);
    if (urlDiff !== 0) return urlDiff;
    return a.order - b.order;
  });

  const seenMedia = new Set();
  let dupes = 0;
  const entries = sorted.map(({ page, url }) => {
    const operation = seenMedia.has(url) ? 'reuse' : 'ingest';
    if (operation === 'reuse') {
      dupes += 1;
    }
    seenMedia.add(url);
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

// Phase 2: Fetch and parse markdown for each page
async function processPages(org, site, pages) {
  setPhase('Phase 2: Processing page content...', 25);
  log(`Processing ${pages.length} pages for media references...`);

  const mediaCandidates = [];
  let candidateOrder = 0;
  let processed = 0;
  let useAdminApi = false;

  async function fetchMarkdown(page) {
    const markdownPath = toMarkdownPath(page.path);
    if (!useAdminApi) {
      try {
        const cdnUrl = `https://${REF}--${site}--${org}.aem.page${markdownPath}`;
        const res = await fetchWithRetry(cdnUrl, {}, 1);
        if (res.ok) return res.text();
      } catch (err) {
        if (err.name === 'AbortError') throw err;
      }
      if (!useAdminApi) {
        useAdminApi = true;
        log('CDN not accessible, switching to admin API...', 'warn');
      }
    }

    const adminUrl = `${ADMIN_BASE}/preview/${org}/${site}/${REF}${markdownPath}`;
    const adminRes = await fetchWithRetry(adminUrl, {}, 1);
    if (adminRes.ok) return adminRes.text();
    return null;
  }

  await runWithConcurrency(pages, async (page) => {
    if (isAborted()) return;

    let markdown;
    try {
      markdown = await fetchMarkdown(page);
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      log(`Failed to fetch ${page.path}: ${err.message}`, 'error');
      stats.errors += 1;
    }

    if (markdown) {
      const pageBaseUrl = `https://${REF}--${site}--${org}.aem.page${page.path}`;
      const urls = parseMediaFromMarkdown(markdown, pageBaseUrl);
      urls.forEach((url) => {
        mediaCandidates.push({
          order: candidateOrder,
          url,
          page,
        });
        candidateOrder += 1;
      });
    }

    processed += 1;
    const pct = 25 + Math.round((processed / pages.length) * 45);
    setPhase(`Phase 2: Processing pages... (${processed}/${pages.length})`, pct);
    stats.media = mediaCandidates.length;
    updateStatsDisplay();
  }, CONCURRENCY);

  const { entries, dupes } = createDeterministicEntries(mediaCandidates);
  stats.media = entries.length;
  stats.dupes = dupes;
  updateStatsDisplay();

  log(`Found ${entries.length} media entries across ${pages.length} pages (${dupes} duplicates)`);
  return entries;
}

// Phase 3: Post entries to medialog
async function ingestEntries(org, site, entries, fallbackUser, dryRun) {
  setPhase('Phase 3: Ingesting entries...', 70);

  const enrichedEntries = entries.map(({ entry, page }) => {
    const user = page.user || fallbackUser || '';
    return {
      ...entry,
      user,
      timestamp: page.lastModified,
    };
  });

  if (dryRun) {
    log('DRY RUN — entries that would be sent:', 'warn');
    enrichedEntries.forEach((e) => {
      log(`  ${e.operation} ${e.contentType} ${e.path} (from ${e.resourcePath}, user: ${e.user || 'unknown'})`);
    });
    stats.sent = enrichedEntries.length;
    updateStatsDisplay();
    return;
  }

  log(`Posting ${enrichedEntries.length} entries in batches of ${BATCH_SIZE}...`);

  for (let i = 0; i < enrichedEntries.length; i += BATCH_SIZE) {
    if (isAborted()) throw new DOMException('Aborted', 'AbortError');
    const batch = enrichedEntries.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(enrichedEntries.length / BATCH_SIZE);

    try {
      const url = `${ADMIN_BASE}/medialog/${org}/${site}/${REF}/`;
      // eslint-disable-next-line no-await-in-loop
      const res = await fetchWithRetry(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries: batch }),
      });

      if (res.ok) {
        stats.sent += batch.length;
        log(`Batch ${batchNum}/${totalBatches}: sent ${batch.length} entries`);
      } else {
        stats.errors += batch.length;
        log(`Batch ${batchNum}/${totalBatches}: failed (${res.status})`, 'error');
      }
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      stats.errors += batch.length;
      log(`Batch ${batchNum}/${totalBatches}: error — ${err.message}`, 'error');
    }

    updateStatsDisplay();
    const pct = 70 + Math.round(((i + batch.length) / enrichedEntries.length) * 25);
    setPhase(`Phase 3: Ingesting... (${batchNum}/${totalBatches})`, pct);
  }
}

function showReport(dryRun, startTime) {
  const duration = formatDuration(Date.now() - startTime);
  setPhase('Complete', 100);
  log('--- Backfill Summary ---', 'success');
  log(`  Duration: ${duration}`);
  log(`  Pages crawled: ${stats.pages}`);
  log(`  Media entries: ${stats.media}`);
  log(`  Unique (ingest): ${stats.media - stats.dupes}`);
  log(`  Duplicates (reuse): ${stats.dupes}`);
  if (dryRun) {
    log('  Mode: DRY RUN (no entries were posted)', 'warn');
  } else {
    log(`  Entries sent: ${stats.sent}`);
    log(`  Errors: ${stats.errors}`);
  }
  log('Done.', 'success');
}

async function runBackfill() {
  const org = DOM.org.value.trim();
  const site = DOM.site.value.trim();
  const dryRun = DOM.dryRun.checked;
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
  disableForm();
  resetStats();
  resetConsole();
  startProgressTracking();
  DOM.console.setAttribute('aria-hidden', 'false');
  DOM.progressSection.setAttribute('aria-hidden', 'false');

  const startTime = Date.now();
  try {
    log(`Starting backfill for ${org}/${site}${dryRun ? ' (dry run)' : ''}...`);

    const { pages, standaloneMedia } = await discoverPages(org, site);
    if (isAborted()) return;

    const entries = await processPages(org, site, pages);
    if (isAborted()) return;

    const existingMediaPaths = new Set(entries.map(({ entry }) => entry.path));
    standaloneMedia.forEach((media) => {
      const mediaUrl = `https://${REF}--${site}--${org}.aem.page${media.path}`;
      stats.media += 1;
      if (existingMediaPaths.has(mediaUrl)) {
        stats.dupes += 1;
        return;
      }
      existingMediaPaths.add(mediaUrl);
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
    updateStatsDisplay();

    await ingestEntries(org, site, entries, fallbackUser, dryRun);
    if (isAborted()) return;

    showReport(dryRun, startTime);
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
