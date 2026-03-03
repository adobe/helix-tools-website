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
  CORS_PROXY_URL,
} from '../core/constants.js';
import { getDedupeKey } from '../core/urls.js';

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

/**
 * Fetch page markdown from preview URL.
 */
export async function fetchPageMarkdown(pagePath, org, repo, ref = 'main') {
  try {
    const path = pagePath.startsWith('/') ? pagePath : `/${pagePath}`;

    // Use CORS proxy to fetch page markdown
    // Proxy URL is a Cloudflare Worker that forwards requests with CORS headers
    const pageUrl = `https://${ref}--${repo}--${org}.aem.page${path}`;
    const url = `${CORS_PROXY_URL}?url=${encodeURIComponent(pageUrl)}`;

    const resp = await fetch(url);
    if (!resp.ok) return null;
    return resp.text();
  } catch {
    return null;
  }
}

/**
 * Build usage map by fetching pages and parsing markdown for PDF/SVG/fragment/external links.
 */
export async function buildUsageMap(pageEntries, org, repo, ref = 'main', onProgress = null) {
  const usageMap = {
    fragments: new Map(),
    pdfs: new Map(),
    svgs: new Map(),
    externalMedia: new Map(),
  };

  const pagesByPath = new Map();
  pageEntries.forEach((e) => {
    const p = normalizePath(e.path);
    if (!pagesByPath.has(p)) pagesByPath.set(p, []);
    pagesByPath.get(p).push(e);
  });
  pagesByPath.forEach((events) => {
    events.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  });

  const getLatestPageTimestamp = (path) => {
    const events = pagesByPath.get(path);
    return events?.[0]?.timestamp ?? 0;
  };

  const uniquePages = [...pagesByPath.keys()].filter((p) => !isHiddenPath(p));

  const results = await processConcurrently(
    uniquePages,
    async (normalizedPath, i) => {
      onProgress?.({ message: `Parsing page ${i + 1}/${uniquePages.length}: ${normalizedPath}` });
      const md = await fetchPageMarkdown(normalizedPath, org, repo, ref);
      return { normalizedPath, md };
    },
    IndexConfig.MAX_CONCURRENT_FETCHES,
  );

  results.forEach(({ normalizedPath, md }) => {
    if (!md) return;

    const addToMap = (map, path) => {
      if (!map.has(path)) map.set(path, []);
      if (!map.get(path).includes(normalizedPath)) {
        map.get(path).push(normalizedPath);
      }
    };

    const addToExternalMedia = (url) => {
      const pageTs = getLatestPageTimestamp(normalizedPath);
      const existing = usageMap.externalMedia.get(url);
      if (!existing) {
        usageMap.externalMedia.set(url, { pages: [normalizedPath], latestTimestamp: pageTs });
      } else if (!existing.pages.includes(normalizedPath)) {
        existing.pages.push(normalizedPath);
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
  });

  return usageMap;
}
