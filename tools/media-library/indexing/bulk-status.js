import {
  createBulkStatusJob,
  pollStatusJob,
  getStatusJobDetails,
  getStatusJobDetailsRaw,
  extractJobPaths,
  extractJobIsComplete,
  parseResourcesFromDetailsRaw,
} from './status-api.js';
import { IndexConfig } from '../core/constants.js';

const REQ_PER_SEC = 10;
const THROTTLE_MS = 1000 / REQ_PER_SEC;

const LARGE_SITE_PATH_THRESHOLD = IndexConfig.DISCOVERY_SMALL_SITE_THRESHOLD ?? 20_000;
const TARGET_PARTITION_RESOURCE_COUNT = IndexConfig.DISCOVERY_TARGET_PATHS_PER_JOB ?? 20_000;
const MAX_PARTITION_PATHS = IndexConfig.DISCOVERY_MAX_PATHS_PER_JOB ?? 250;

function normalizePath(p) {
  if (!p || typeof p !== 'string') return '';
  return p.startsWith('/') ? p : `/${p}`;
}

function createSlotQueue(intervalMs = THROTTLE_MS) {
  const queue = [];
  const interval = setInterval(() => {
    const item = queue.shift();
    if (item) {
      Promise.resolve(item.fn()).then(item.resolve).catch(item.reject);
    }
  }, intervalMs);
  return {
    run(fn) {
      return new Promise((resolve, reject) => {
        queue.push({ fn, resolve, reject });
      });
    },
    stop() { clearInterval(interval); },
  };
}

async function runWithConcurrency(items, limit, fn) {
  const results = [];
  let next = 0;
  async function runOne() {
    const i = next;
    next += 1;
    if (i >= items.length) return;
    results[i] = await fn(items[i], i);
    if (next < items.length) await runOne();
  }
  const workers = Array(Math.min(limit, items.length))
    .fill(null)
    .map(() => runOne());
  await Promise.all(workers);
  return results;
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

function buildPathPartitions(paths, base = null) {
  const topLevelBuckets = new Map();
  const rootPaths = new Set();

  paths.forEach((path) => {
    if (typeof path !== 'string' || !path.startsWith('/')) return;
    if (base && path !== base && !path.startsWith(`${base}/`)) return;
    const pathNorm = path.replace(/\/$/, '');
    let relPath;
    if (!base) {
      relPath = pathNorm;
    } else if (pathNorm === base) {
      relPath = '';
    } else {
      relPath = pathNorm.slice(base.length + 1);
    }
    const segments = relPath.split('/').filter(Boolean);

    if (!segments.length) {
      rootPaths.add(base || path);
      return;
    }

    const exactPath = base ? `${base}/${segments[0]}` : `/${segments[0]}`;
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

async function runPartitionedStatusJobs(org, repo, ref, partitions, opts) {
  const {
    onProgress, slotQueue, pollConcurrency, pollInterval, maxDurationMs, perf,
  } = opts;
  if (!partitions.length) return [];

  let resources = [];
  const interval = partitions.length > 5 ? Math.min(pollInterval * 2, 3000) : pollInterval;
  const jobDurationsMs = [];

  const jobCreateStart = Date.now();
  const jobs = await partitions.reduce(async (accPromise, partition) => {
    const acc = await accPromise;
    const paths = Array.isArray(partition) ? partition : (partition?.paths || []);
    const { jobUrl } = await createBulkStatusJob(org, repo, ref, null, { paths });
    acc.push({ jobUrl, paths });
    return acc;
  }, Promise.resolve([]));
  const jobCreationMs = Date.now() - jobCreateStart;

  await runWithConcurrency(jobs, pollConcurrency, async ({ jobUrl }, i) => {
    const jobStart = Date.now();
    await pollStatusJob(jobUrl, interval, (progress) => {
      if (onProgress && progress) {
        const pct = progress.processed && progress.total
          ? Math.round((progress.processed / progress.total) * 100)
          : 0;
        onProgress({
          stage: 'fetching',
          message: `Status job ${i + 1}/${jobs.length}: ${pct}%`,
          percent: 15,
        });
      }
    }, maxDurationMs);
    jobDurationsMs[i] = Date.now() - jobStart;
  });

  if (perf) {
    perf.partitionJobMs = jobDurationsMs;
    perf.partitionJobMaxMs = Math.max(...jobDurationsMs, 0);
    perf.partitionCount = partitions.length;
    perf.jobCount = partitions.length;
    perf.jobCreationMs = jobCreationMs;
    perf.pollingMs = Math.max(...jobDurationsMs, 0);
  }

  const detailsStart = Date.now();
  await jobs.reduce(async (prev, { jobUrl }) => {
    await prev;
    const partResources = await slotQueue.run(() => getStatusJobDetails(jobUrl));
    resources = mergeResourcesByPath(resources, partResources);
  }, Promise.resolve());
  if (perf) {
    perf.partitionDetailsMs = Date.now() - detailsStart;
  }

  return resources;
}

async function runStatusJob(org, repo, ref, paths, opts = {}) {
  const {
    pathsOnly = false,
    onProgress,
    slotQueue,
    pollInterval = IndexConfig.STATUS_POLL_INTERVAL_MS,
    maxDurationMs = IndexConfig.STATUS_POLL_MAX_DURATION_MS,
  } = opts;
  const normalizedPaths = Array.isArray(paths) ? paths : [paths];
  const { jobUrl } = await createBulkStatusJob(org, repo, ref, null, {
    paths: normalizedPaths,
    pathsOnly,
  });

  await pollStatusJob(jobUrl, pollInterval, (progress) => {
    if (onProgress && progress) {
      const pct = progress.processed && progress.total
        ? Math.round((progress.processed / progress.total) * 100)
        : 0;
      onProgress({ progress: pct });
    }
  }, maxDurationMs);

  const detailsRaw = await slotQueue.run(() => getStatusJobDetailsRaw(jobUrl));
  const resources = pathsOnly ? [] : parseResourcesFromDetailsRaw(detailsRaw);
  const isComplete = extractJobIsComplete(detailsRaw, pathsOnly);
  const discoveredPaths = pathsOnly ? extractJobPaths(detailsRaw) : [];

  return {
    isComplete,
    resources,
    paths: discoveredPaths,
  };
}

export default async function runBulkStatus(org, repo, ref, contentPath, options = {}) {
  const {
    onProgress,
    pollInterval = IndexConfig.STATUS_POLL_INTERVAL_MS,
    maxDurationMs = IndexConfig.STATUS_POLL_MAX_DURATION_MS,
    pollConcurrency = IndexConfig.STATUS_POLL_CONCURRENCY ?? 3,
  } = options;

  const effectiveRef = ref || 'main';
  const perf = {
    jobCount: 0,
    jobCreationMs: 0,
    pollingMs: 0,
    totalDurationMs: 0,
  };
  const startTime = Date.now();
  const base = contentPath ? normalizePath(contentPath).replace(/\/$/, '') : null;

  const discoveryPaths = base ? [base, `${base}/*`] : ['/*'];
  const slotQueue = createSlotQueue();

  try {
    const discoveryCreateStart = Date.now();
    const pathDiscoveryJob = await runStatusJob(org, repo, effectiveRef, discoveryPaths, {
      pathsOnly: true,
      onProgress: (p) => {
        if (onProgress) {
          onProgress({
            stage: 'discovery',
            message: `Discovery: ${p.progress ?? 0}%`,
            percent: 5,
          });
        }
      },
      slotQueue,
      pollInterval,
      maxDurationMs,
    });
    perf.discoveryMs = Date.now() - discoveryCreateStart;

    const discoveredPaths = pathDiscoveryJob.paths;
    const pathCount = discoveredPaths.length;
    const partitionPlan = pathCount > 0 ? buildPathPartitions(discoveredPaths, base) : null;

    if (pathDiscoveryJob.isComplete && pathCount === 0) {
      perf.totalDurationMs = Date.now() - startTime;
      return { resources: [], perf };
    }

    let resources = [];
    perf.decision = 'single';

    if (!pathDiscoveryJob.isComplete && partitionPlan) {
      perf.decision = 'partitioned';
      resources = await runPartitionedStatusJobs(
        org,
        repo,
        effectiveRef,
        partitionPlan.partitions,
        {
          onProgress, slotQueue, pollConcurrency, pollInterval, maxDurationMs, perf,
        },
      );
    } else if (pathDiscoveryJob.isComplete && pathCount > LARGE_SITE_PATH_THRESHOLD) {
      perf.decision = 'partitioned';
      resources = await runPartitionedStatusJobs(
        org,
        repo,
        effectiveRef,
        partitionPlan.partitions,
        {
          onProgress, slotQueue, pollConcurrency, pollInterval, maxDurationMs, perf,
        },
      );
    } else {
      perf.decision = 'single';
      const fullCreateStart = Date.now();
      const primaryStatusJob = await runStatusJob(org, repo, effectiveRef, discoveryPaths, {
        onProgress: (p) => {
          if (onProgress) {
            onProgress({
              stage: 'fetching',
              message: `Status job: ${p.progress ?? 0}%`,
              percent: 15,
            });
          }
        },
        slotQueue,
        pollInterval,
        maxDurationMs,
      });
      perf.jobCreationMs = Date.now() - fullCreateStart;
      perf.jobCount = 1;
      resources = primaryStatusJob.resources;

      if (!primaryStatusJob.isComplete && partitionPlan) {
        perf.decision = 'partitioned-retry';
        const partitioned = await runPartitionedStatusJobs(
          org,
          repo,
          effectiveRef,
          partitionPlan.partitions,
          {
            onProgress, slotQueue, pollConcurrency, pollInterval, maxDurationMs, perf,
          },
        );
        resources = mergeResourcesByPath(resources, partitioned);
      }
    }

    if (base) {
      const prefix = base.endsWith('/') ? base : `${base}/`;
      resources = resources.filter(
        (r) => r.path === base || (r.path && r.path.startsWith(prefix)),
      );
    }

    perf.totalDurationMs = Date.now() - startTime;

    return { resources, perf };
  } finally {
    slotQueue.stop();
  }
}
