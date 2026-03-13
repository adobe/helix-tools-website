/**
 * Parse utilities for linked content
 */
import {
  IndexConfig,
  ExternalMedia,
  MediaType,
  Paths,
  ICON_DOC_EXCLUDE,
  Domains,
} from '../core/constants.js';
import { getDedupeKey } from '../core/urls.js';
import { fetchAdminWithRateLimit } from '../core/admin-rate-limit.js';
import { isPerfEnabled } from '../core/params.js';

export { getDedupeKey };

const MD_LINK_RE = /\[[^\]]*\]\(([^)]+)\)/gi;
const MD_AUTOLINK_RE = /<(https?:\/\/[^>]+|\/[^>\s]*)>/g;
const ICON_RE = /:([a-zA-Z0-9-]+):/g;

export function normalizePath(path) {
  if (!path) return '';
  const cleanPath = path.split('?')[0].split('#')[0];
  if (!cleanPath.includes('.') && !cleanPath.startsWith(Paths.MEDIA)) {
    return cleanPath === '/' || cleanPath === '' ? '/index.md' : `${cleanPath}.md`;
  }
  return cleanPath;
}

export function isPage(path) {
  if (!path || typeof path !== 'string') return false;
  return (path.endsWith('.md')
          || path.endsWith('.html')
          || (!path.includes('.') && !path.startsWith(Paths.MEDIA)))
         && !path.includes(Paths.FRAGMENTS);
}

export function isHiddenPath(path) {
  if (!path || typeof path !== 'string') return false;
  return path.includes('/.');
}

function pathWithoutQueryHash(path) {
  if (!path) return '';
  return path.split('?')[0].split('#')[0];
}

export function isPdf(path) {
  const p = pathWithoutQueryHash(path);
  return p && p.toLowerCase().endsWith('.pdf');
}

export function isSvg(path) {
  const p = pathWithoutQueryHash(path);
  return p && p.toLowerCase().endsWith('.svg');
}

export function isFragmentDoc(path) {
  return path && path.includes(Paths.FRAGMENTS);
}

export function isPdfOrSvg(path) {
  return isPdf(path) || isSvg(path);
}

export function toAbsoluteFilePath(path) {
  if (!path) return '';
  const p = path.split('?')[0].split('#')[0].trim();
  return p.startsWith('/') ? p : `/${p}`;
}

export function getLinkedContentType(path) {
  if (isPdf(path)) return MediaType.DOCUMENT;
  if (isSvg(path)) return MediaType.IMAGE;
  if (isFragmentDoc(path)) return MediaType.FRAGMENT;
  return 'unknown';
}

function toPath(href) {
  if (!href) return '';
  try {
    if (href.startsWith('http')) {
      return new URL(href).pathname;
    }
    return href.startsWith('/') ? href : `/${href}`;
  } catch {
    return href;
  }
}

function extractUrlsFromMarkdown(md) {
  if (!md || typeof md !== 'string') return [];
  const fromLinks = [...md.matchAll(MD_LINK_RE)].map((m) => m[1].trim());
  const fromAutolinks = [...md.matchAll(MD_AUTOLINK_RE)].map((m) => m[1].trim());
  return [...fromLinks, ...fromAutolinks];
}

function isExternalUrl(url) {
  if (!url || !url.startsWith('http')) return false;
  return !Domains.SAME_ORIGIN.some((d) => url.includes(d));
}

export function getExternalMediaType(url) {
  if (!url || !url.startsWith('http') || !isExternalUrl(url)) return null;
  try {
    const parsed = new URL(url);
    const pathPart = parsed.pathname.split('?')[0].split('#')[0];
    const pathLower = pathPart.toLowerCase();
    const extMatch = pathLower.match(ExternalMedia.EXTENSION_REGEX);
    if (extMatch) {
      const ext = extMatch[1].toLowerCase();
      let type = MediaType.LINK;
      if (ExternalMedia.EXTENSIONS.pdf.includes(ext)) type = MediaType.DOCUMENT;
      else if (ExternalMedia.EXTENSIONS.svg.includes(ext)) type = MediaType.IMAGE;
      else if (ExternalMedia.EXTENSIONS.image.includes(ext)) type = MediaType.IMAGE;
      else if (ExternalMedia.EXTENSIONS.video.includes(ext)) type = MediaType.VIDEO;
      const name = pathPart.split('/').pop() || parsed.hostname;
      return { type, name };
    }
    const host = parsed.hostname;
    const matched = ExternalMedia.HOST_PATTERNS.find(
      (p) => p.host.test(host) && (!p.pathContains || parsed.pathname.includes(p.pathContains)),
    );
    if (matched) {
      const { type: patternType } = matched;
      if (matched.typeFromPath) {
        const lastSegment = pathPart.split('/').pop() || '';
        const segExt = lastSegment.split('.').pop()?.toLowerCase();
        const imageExts = [...ExternalMedia.EXTENSIONS.image, ...ExternalMedia.EXTENSIONS.svg];
        if (segExt && ExternalMedia.EXTENSIONS.video.includes(segExt)) {
          return { type: MediaType.VIDEO, name: lastSegment };
        }
        if (segExt && ExternalMedia.EXTENSIONS.pdf.includes(segExt)) {
          return { type: MediaType.DOCUMENT, name: lastSegment };
        }
        if (segExt && imageExts.includes(segExt)) {
          return { type: MediaType.IMAGE, name: lastSegment };
        }
      }
      if (patternType === ExternalMedia.CATEGORY_IMG) {
        return { type: MediaType.IMAGE, name: pathPart.split('/').pop() || host };
      }
      if (patternType === MediaType.VIDEO) {
        return { type: MediaType.VIDEO, name: host };
      }
      return { type: MediaType.LINK, name: host };
    }
  } catch {
    /* parse error */
  }
  return null;
}

export function extractExternalMediaUrls(md) {
  if (!md || typeof md !== 'string') return [];
  const urls = extractUrlsFromMarkdown(md);
  return [...new Set(urls.filter((u) => getExternalMediaType(u) !== null))];
}

export function extractIconReferences(md) {
  if (!md || typeof md !== 'string') return [];
  const matches = [...md.matchAll(ICON_RE)];
  return [...new Set(
    matches
      .filter((m) => !ICON_DOC_EXCLUDE.has(m[1].toLowerCase()))
      .map((m) => `/icons/${m[1]}.svg`),
  )];
}

export function extractFragmentReferences(md) {
  const urls = extractUrlsFromMarkdown(md);
  return [...new Set(urls.filter((u) => u.includes(Paths.FRAGMENTS)).map((u) => toPath(u)))];
}

export function extractLinks(md, pattern) {
  const urls = extractUrlsFromMarkdown(md);
  const pathPart = (u) => u.split('?')[0].split('#')[0];
  return [...new Set(
    urls
      .filter((u) => pattern.test(pathPart(u)) && !isExternalUrl(u))
      .map((u) => toPath(u)),
  )];
}

function processConcurrently(items, fn, concurrency) {
  const results = new Array(items.length);
  let nextIndex = 0;

  const runOne = () => {
    if (nextIndex >= items.length) return Promise.resolve();
    const i = nextIndex;
    nextIndex += 1;
    return Promise.resolve()
      .then(() => fn(items[i], i))
      .then((value) => {
        results[i] = value;
        return runOne();
      });
  };

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => runOne(),
  );
  return Promise.all(workers).then(() => results);
}

const ADMIN_PREVIEW_BASE = 'https://admin.hlx.page/preview';

/**
 * Fetch page markdown via admin.hlx.page (same as page-status diff).
 * Uses shared admin rate limiter (10 req/s) and 429 retry with backoff.
 * Returns structured result: { markdown, status, reason }
 */
export async function fetchPageMarkdown(pagePath, org, repo, ref = 'main') {
  try {
    const path = pagePath.startsWith('/') ? pagePath : `/${pagePath}`;
    let fetchPath;
    if (path.endsWith('/')) fetchPath = `${path}index.md`;
    else if (path.endsWith('.md')) fetchPath = path;
    else fetchPath = `${path}.md`;
    const url = `${ADMIN_PREVIEW_BASE}/${org}/${repo}/${ref}${fetchPath}`;

    const resp = await fetchAdminWithRateLimit(url, {}, { maxRetries: 3 });
    if (!resp.ok) {
      return { markdown: null, status: resp.status, reason: `HTTP ${resp.status}` };
    }
    const markdown = await resp.text();
    return { markdown, status: 200, reason: null };
  } catch (error) {
    return { markdown: null, status: null, reason: error.message || 'Network error' };
  }
}

/**
 * Build usage map by fetching pages and parsing markdown for PDF/SVG/fragment/external links.
 * Enhanced with batching, failure tracking, retry logic, and progressive callbacks.
 */
export async function buildUsageMap(pageEntries, org, repo, ref = 'main', onProgress = null, onBatch = null) {
  const usageMap = {
    fragments: new Map(),
    pdfs: new Map(),
    svgs: new Map(),
    externalMedia: new Map(),
  };

  const latestTimestampByPath = new Map();
  pageEntries.forEach((e) => {
    const p = normalizePath(e.path);
    const ts = e.timestamp || 0;
    const current = latestTimestampByPath.get(p) ?? 0;
    latestTimestampByPath.set(p, Math.max(current, ts));
  });

  const getLatestPageTimestamp = (path) => latestTimestampByPath.get(path) ?? 0;

  const uniquePages = [...latestTimestampByPath.keys()].filter((p) => !isHiddenPath(p));

  const usageMapStartTime = Date.now();
  const counters = { success: 0, fail: 0, parsed: 0 };
  const fetchTimes = [];
  const batchSize = IndexConfig.USAGE_MAP_PROGRESSIVE_BATCH_SIZE ?? 1000;
  const failureReasons = new Map(); // reason -> count
  const failedPathsByReason = new Map(); // reason -> path[]

  const processResultIntoUsageMap = ({ normalizedPath, md }) => {
    if (md == null) return; // allow empty string (200 with empty body)

    const addToMap = (map, path) => {
      if (!map.has(path)) map.set(path, new Set());
      map.get(path).add(normalizedPath);
    };

    const addToExternalMedia = (url) => {
      const pageTs = getLatestPageTimestamp(normalizedPath);
      const existing = usageMap.externalMedia.get(url);
      if (!existing) {
        usageMap.externalMedia.set(url, {
          pages: new Set([normalizedPath]),
          latestTimestamp: pageTs,
        });
      } else {
        existing.pages.add(normalizedPath);
        existing.latestTimestamp = Math.max(existing.latestTimestamp, pageTs);
      }
    };

    const fragments = extractFragmentReferences(md);
    const pdfs = extractLinks(md, /\.pdf$/);
    const svgs = extractLinks(md, /\.svg$/);
    const icons = extractIconReferences(md);
    const externalUrls = extractExternalMediaUrls(md);

    fragments.forEach((f) => addToMap(usageMap.fragments, f));
    pdfs.forEach((p) => addToMap(usageMap.pdfs, p));
    svgs.forEach((s) => addToMap(usageMap.svgs, s));
    icons.forEach((s) => addToMap(usageMap.svgs, s));
    externalUrls.forEach((u) => addToExternalMedia(u));
  };

  // Process pages in batches for progressive display
  for (let batchStart = 0; batchStart < uniquePages.length; batchStart += batchSize) {
    const batch = uniquePages.slice(batchStart, batchStart + batchSize);
    const batchResults = await processConcurrently(
      batch,
      async (normalizedPath, i) => {
        const globalIndex = batchStart + i;
        onProgress?.({ message: `Parsing page ${globalIndex + 1}/${uniquePages.length}: ${normalizedPath}` });
        const fetchStart = Date.now();
        const result = await fetchPageMarkdown(normalizedPath, org, repo, ref);
        const fetchTime = Date.now() - fetchStart;
        fetchTimes.push(fetchTime);

        const isSuccess = result?.status === 200;
        const md = isSuccess ? (result.markdown ?? '') : (result?.markdown || null);
        if (isSuccess) {
          counters.success += 1;
        } else {
          counters.fail += 1;
          const reason = result?.reason || `HTTP ${result?.status ?? 'unknown'}`;
          const count = failureReasons.get(reason) || 0;
          failureReasons.set(reason, count + 1);
          if (!failedPathsByReason.has(reason)) failedPathsByReason.set(reason, []);
          failedPathsByReason.get(reason).push(normalizedPath);
        }
        counters.parsed += 1;
        return { normalizedPath, md };
      },
      IndexConfig.MAX_CONCURRENT_PAGE_FETCHES,
    );

    batchResults.forEach(processResultIntoUsageMap);

    // Call onBatch after each batch for progressive UI updates
    if (onBatch) {
      onBatch(usageMap);
    }
  }

  // Retry failed pages serially (concurrency=1 to avoid overload)
  const allFailedPaths = [];
  failedPathsByReason.forEach((paths) => allFailedPaths.push(...paths));
  if (allFailedPaths.length > 0) {
    onProgress?.({ message: `Retrying ${allFailedPaths.length} failed pages...` });
    const retryResults = await processConcurrently(
      allFailedPaths,
      async (normalizedPath) => {
        const result = await fetchPageMarkdown(normalizedPath, org, repo, ref);
        const isSuccess = result?.status === 200;
        const md = isSuccess ? (result.markdown ?? '') : (result?.markdown || null);
        return { normalizedPath, md, isSuccess };
      },
      1, /* serial retries */
    );
    retryResults.forEach(processResultIntoUsageMap);
    retryResults.forEach(({ isSuccess }) => {
      if (isSuccess) {
        counters.success += 1;
        counters.fail -= 1;
      }
    });
    // Remove recovered paths from failedPathsByReason and failureReasons
    const recovered = new Set(retryResults.filter((r) => r.isSuccess).map((r) => r.normalizedPath));
    if (recovered.size > 0) {
      failedPathsByReason.forEach((paths, reason) => {
        const remaining = paths.filter((p) => !recovered.has(p));
        if (remaining.length === 0) {
          failedPathsByReason.delete(reason);
          failureReasons.delete(reason);
        } else {
          failedPathsByReason.set(reason, remaining);
          failureReasons.set(reason, remaining.length);
        }
      });
      if (isPerfEnabled()) {
        console.log(`[buildUsageMap] Retry: ${recovered.size}/${allFailedPaths.length} recovered`);
      }
    }
  }

  // Convert Sets to arrays for consumers
  ['fragments', 'pdfs', 'svgs'].forEach((key) => {
    usageMap[key].forEach((set, path) => {
      usageMap[key].set(path, [...set]);
    });
  });
  usageMap.externalMedia.forEach((data, url) => {
    usageMap.externalMedia.set(url, { ...data, pages: [...data.pages] });
  });

  // Performance logging
  const avgFetchTime = fetchTimes.length > 0
    ? Math.round(fetchTimes.reduce((sum, t) => sum + t, 0) / fetchTimes.length)
    : 0;
  const maxFetchTime = fetchTimes.length > 0 ? Math.max(...fetchTimes) : 0;
  const minFetchTime = fetchTimes.length > 0 ? Math.min(...fetchTimes) : 0;
  const durationMs = Date.now() - usageMapStartTime;
  const fragCount = usageMap.fragments?.size ?? 0;
  const pdfCount = usageMap.pdfs?.size ?? 0;
  const svgCount = usageMap.svgs?.size ?? 0;
  const extCount = usageMap.externalMedia?.size ?? 0;
  const itemsFound = fragCount + pdfCount + svgCount + extCount;

  if (isPerfEnabled()) {
    const endIso = new Date().toISOString();
    const durationSec = Math.round(durationMs / 1000);
    const lines = [
      `[buildUsageMap] Ended at ${endIso} (duration: ${durationSec}s)`,
      `  Pages: ${counters.success} success, ${counters.fail} failed of ${uniquePages.length} total`,
      `  Fetch times: avg=${avgFetchTime}ms, min=${minFetchTime}ms, max=${maxFetchTime}ms`,
      `  Items: frag=${fragCount}, pdf=${pdfCount}, svg=${svgCount}, ext=${extCount} (${itemsFound} total)`,
    ];
    const sortedReasons = [...failureReasons.entries()].sort((a, b) => b[1] - a[1]);
    if (counters.fail > 0) {
      if (sortedReasons.length > 0) {
        lines.push('  Failure breakdown:');
        sortedReasons.forEach(([reason, count]) => {
          lines.push(`    ${reason}: ${count} (${Math.round((count / counters.fail) * 100)}%)`);
          const paths = failedPathsByReason.get(reason) || [];
          paths.slice(0, 10).forEach((p) => lines.push(`      - ${p}`));
          if (paths.length > 10) {
            lines.push(`      ... and ${paths.length - 10} more`);
          }
        });
      }
    }
    console.log(lines.join('\n'));
  }

  return {
    usageMap,
    counters,
    durationMs,
    fetchTimes: { avg: avgFetchTime, min: minFetchTime, max: maxFetchTime },
  };
}
