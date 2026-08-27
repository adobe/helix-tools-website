/**
 * Pure helpers for the Web Asset Container (WAC) manager tool.
 * Kept free of DOM/fetch access so they can be unit tested directly —
 * see tests/tools/wac/utils.test.js.
 */

/**
 * localStorage key under which the shared WAC worker secret is stored,
 * scoped to an org/site combo (matches the `${org}/${site}` convention
 * used by tools/media-library/core/storage.js).
 * @param {string} org
 * @param {string} site
 * @returns {string}
 */
export function secretStorageKey(org, site) {
  return `wac-secret:${org}/${site}`;
}

/**
 * All WAC containers live under this folder within an org/site — it's
 * the effective root of this tool's browsing UI. Backend paths always
 * include it (e.g. "wac/drafts/david/demo"); UI-facing paths (URL `path`
 * params, breadcrumbs, name fields, confirmation text) never do — see
 * toUiPath()/toApiPath() below.
 */
export const WAC_ROOT = 'wac';

/**
 * Convert a real backend container path (as returned by the worker's
 * index.json, e.g. "wac/drafts/david/demo") to the UI-facing path used
 * everywhere else in this tool (e.g. "drafts/david/demo").
 * @param {string} apiPath
 * @returns {string}
 */
export function toUiPath(apiPath) {
  if (apiPath === WAC_ROOT) return '';
  const prefix = `${WAC_ROOT}/`;
  return apiPath.startsWith(prefix) ? apiPath.slice(prefix.length) : apiPath;
}

/**
 * Convert a UI-facing path back to the real backend path, for worker API
 * calls (upload/delete) and delivery URLs.
 * @param {string} uiPath
 * @returns {string}
 */
export function toApiPath(uiPath) {
  return uiPath ? `${WAC_ROOT}/${uiPath}` : WAC_ROOT;
}

/**
 * Format a UI-facing path for display: always a single leading slash,
 * never an org/site or "wac" root prefix.
 * @param {string} uiPath
 * @returns {string}
 */
export function displayPath(uiPath) {
  return `/${uiPath}`;
}

/**
 * Scope a raw index.json listing down to containers that live under the
 * WAC root, converting each to its UI-facing path. Anything outside
 * `wac/` isn't part of this tool's browsing experience.
 * @param {{ path: string }[]} wacs
 * @returns {object[]}
 */
export function scopeToWacRoot(wacs) {
  return (wacs || [])
    .filter((w) => w.path === WAC_ROOT || w.path.startsWith(`${WAC_ROOT}/`))
    .map((w) => ({ ...w, path: toUiPath(w.path) }));
}

/**
 * Build the delivery URL for a WAC container file. Delivery now happens
 * directly against the site's aem.network host rather than the worker's
 * org/site-prefixed path — org/site are encoded in the host, so `path`
 * carries no org/site segment.
 * @param {string} org
 * @param {string} site
 * @param {string} containerPath - path of the WAC container, e.g. "drafts/david/demo"
 * @param {string|null} [filePath] - file within the container, e.g. "index.html"
 * @returns {string}
 */
export function deliveryUrl(org, site, containerPath, filePath) {
  const base = `https://main--${site}--${org}.aem.network`;
  const segments = [containerPath, filePath]
    .filter(Boolean)
    .join('/')
    .split('/')
    .filter(Boolean)
    .map(encodeURIComponent);
  return segments.length ? `${base}/${segments.join('/')}` : `${base}/`;
}

/**
 * Origin of the WAC worker (no protocol) — used both for the actual
 * upload/list/delete requests (see session.js's WAC_WORKER_ENDPOINT) and
 * to verify a site's mixerConfig points at it (see isMixerConfigured()).
 */
export const WAC_WORKER_ORIGIN = 'wac.david8603.workers.dev';

/**
 * The exact "public.mixerConfig" block a site's config.json needs so that
 * `/wac/**` requests get proxied to the WAC worker for this org/site. Used
 * both to validate an existing config (isMixerConfigured()) and to
 * generate the snippet shown in the "not set up" instructions.
 * @param {string} org
 * @param {string} site
 * @returns {object}
 */
export function mixerConfigSnippet(org, site) {
  return {
    public: {
      mixerConfig: {
        patterns: { '/wac/**': 'wac' },
        backends: {
          wac: {
            origin: WAC_WORKER_ORIGIN,
            pathPrefix: `/${org}/${site}/`,
            headers: { 'x-forwarded-host': `main--${site}--${org}.aem.network` },
          },
        },
      },
    },
  };
}

/**
 * Check whether a site's config.json already has the mixerConfig block
 * that routes `/wac/**` to the WAC worker for this exact org/site.
 * @param {object|null|undefined} config - parsed config.json
 * @param {string} org
 * @param {string} site
 * @returns {boolean}
 */
export function isMixerConfigured(config, org, site) {
  const backend = config?.public?.mixerConfig?.backends?.wac;
  const expected = mixerConfigSnippet(org, site).public.mixerConfig;
  return !!(
    config?.public?.mixerConfig?.patterns?.['/wac/**'] === 'wac'
    && backend
    && backend.origin === expected.backends.wac.origin
    && backend.pathPrefix === expected.backends.wac.pathPrefix
    && backend.headers?.['x-forwarded-host'] === expected.backends.wac.headers['x-forwarded-host']
  );
}

/**
 * The parent folder of a container path, e.g. "drafts/david/demo" ->
 * "drafts/david". A root-level container (no "/") has "" as its parent.
 * @param {string} path
 * @returns {string}
 */
export function parentFolder(path) {
  const parts = String(path || '').split('/').filter(Boolean);
  parts.pop();
  return parts.join('/');
}

/**
 * Build a link to the WAC editor page for a single container.
 * @param {string} origin - window.location.origin
 * @param {string} org
 * @param {string} site
 * @param {string} path - container path
 * @returns {string}
 */
export function editorPageUrl(origin, org, site, path) {
  const url = new URL('/tools/wac/wac-editor.html', origin);
  url.searchParams.set('org', org);
  url.searchParams.set('site', site);
  url.searchParams.set('path', path);
  return url.href;
}

/**
 * Build a link to the WAC browse page, optionally scoped to a folder.
 * @param {string} origin - window.location.origin
 * @param {string} org
 * @param {string} site
 * @param {string} [folder]
 * @returns {string}
 */
export function browsePageUrl(origin, org, site, folder = '') {
  const url = new URL('/tools/wac/index.html', origin);
  if (org) url.searchParams.set('org', org);
  if (site) url.searchParams.set('site', site);
  if (folder) url.searchParams.set('path', folder);
  return url.href;
}

/**
 * Format a byte count as a short human-readable string.
 * @param {number} n
 * @returns {string}
 */
export function formatBytes(n) {
  if (!Number.isFinite(n) || n < 0) return '0 B';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

/**
 * Format an ISO timestamp as a short, locale-aware date/time string for
 * display in the container list (e.g. "Aug 26, 2026, 3:45 PM").
 * @param {string|null|undefined} iso
 * @returns {string} '' if `iso` is missing or unparseable
 */
export function formatModified(iso) {
  if (!iso) return '';
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

/**
 * Build the "modified …" meta text shown next to a container in the
 * browse list, from the `lastModified`/`author` fields the worker's
 * index.json may return per container. Falls back to the zip size when
 * neither is present, so older worker deployments still show something.
 * @param {{ lastModified?: string|null, author?: string|null, zipSize?: number|null }} wac
 * @returns {string}
 */
export function containerMetaText(wac) {
  const modified = formatModified(wac.lastModified);
  const parts = [modified, wac.author].filter(Boolean);
  if (parts.length) return parts.join(' · ');
  return Number.isFinite(wac.zipSize) ? formatBytes(wac.zipSize) : '';
}

/**
 * Loosely check whether a dropped/picked File looks like a zip archive.
 * @param {File|null|undefined} file
 * @returns {boolean}
 */
export function isZipFile(file) {
  if (!file) return false;
  const name = (file.name || '').toLowerCase();
  return name.endsWith('.zip') || file.type === 'application/zip' || file.type === 'application/x-zip-compressed';
}

/**
 * Slugify a zip filename into a kebab-case container name.
 * @param {string} filename
 * @returns {string}
 */
export function kebabFromZipName(filename) {
  const base = String(filename || '')
    .replace(/\.zip$/i, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || 'container';
}

/**
 * Find the common leading directory shared by every file, if any
 * (used to strip a single wrapping folder out of an uploaded zip).
 * @param {string[]} files
 * @returns {string} the common prefix (with trailing slash), or '' if none
 */
export function commonRoot(files) {
  if (!files.length) return '';
  const first = files[0].split('/')[0];
  if (!first) return '';
  const prefix = `${first}/`;
  return files.every((f) => f.startsWith(prefix)) ? prefix : '';
}

/**
 * Rank a WAC's listed files down to just the previewable HTML files,
 * with index.html/index.htm first, the container's declared default
 * next, then everything else alphabetically.
 * @param {{ files?: string[]|null, default?: string|null }} wac
 * @returns {string[]}
 */
export function htmlFilesForWac(wac) {
  const listed = Array.isArray(wac.files) ? wac.files : [];
  return listed.filter((f) => /\.html?$/i.test(f)).sort((a, b) => {
    const rank = (p) => {
      const lower = p.toLowerCase();
      if (lower === 'index.html' || lower === 'index.htm') return 0;
      if (wac.default && p === wac.default) return 1;
      return 2;
    };
    const d = rank(a) - rank(b);
    return d !== 0 ? d : a.localeCompare(b);
  });
}

/**
 * Pick which HTML file should be previewed by default for a WAC.
 * @param {{ default?: string|null }} wac
 * @param {string[]} htmlFiles - as returned by {@link htmlFilesForWac}
 * @returns {string|null}
 */
export function pickDefaultHtmlFile(wac, htmlFiles) {
  if (!htmlFiles.length) return null;
  const index = htmlFiles.find((f) => {
    const lower = f.toLowerCase();
    return lower === 'index.html' || lower === 'index.htm';
  });
  if (index) return index;
  if (wac.default && htmlFiles.includes(wac.default)) return wac.default;
  return htmlFiles[0];
}

/**
 * Build a folder/file tree out of a flat list of WAC containers, keyed
 * by their path. Each leaf carries the original WAC record.
 * @param {{ path: string }[]} items
 * @returns {{ name: string, children: Map<string, object>, wac: object|null }}
 */
export function buildTree(items) {
  const root = { name: '', children: new Map(), wac: null };
  items.forEach((wac) => {
    const parts = wac.path.split('/');
    let node = root;
    parts.forEach((part, i) => {
      if (!node.children.has(part)) {
        node.children.set(part, { name: part, children: new Map(), wac: null });
      }
      node = node.children.get(part);
      if (i === parts.length - 1) node.wac = wac;
    });
  });
  return root;
}

/**
 * Walk a tree built by {@link buildTree} down to the node for a given
 * folder path, e.g. "drafts/david".
 * @param {{ children: Map<string, object> }} root
 * @param {string} folderPath
 * @returns {object|null} the node, or null if the path doesn't exist
 */
export function getTreeNode(root, folderPath) {
  if (!folderPath) return root;
  return folderPath.split('/').filter(Boolean).reduce(
    (node, part) => (node ? node.children.get(part) || null : null),
    root,
  );
}

/**
 * List the immediate entries of a tree node for a breadcrumb-style browser:
 * one entry per subfolder (isContainer: false) and one per WAC container
 * that lives directly at this level (isContainer: true). A name can
 * legitimately produce both (a container living at a path that is also a
 * folder prefix for other containers) — callers should key rows by
 * `${name}:${isContainer}`, not `name` alone.
 * @param {{ children: Map<string, object> } | null} node
 * @returns {{ name: string, isContainer: boolean, wac: object|null }[]}
 */
export function listChildEntries(node) {
  if (!node) return [];
  const entries = [];
  node.children.forEach((child, name) => {
    if (child.wac) entries.push({ name, isContainer: true, wac: child.wac });
    if (child.children.size > 0) entries.push({ name, isContainer: false, wac: null });
  });
  return entries.sort((a, b) => {
    if (a.isContainer !== b.isContainer) return a.isContainer ? 1 : -1;
    return a.name.localeCompare(b.name);
  });
}

const MAGIC_BANNER_BLOCK = 'magic-banner';

/**
 * Escape a string for safe interpolation into HTML text content.
 * @param {string} s
 * @returns {string}
 */
export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

/**
 * Escape a string for safe interpolation into an HTML attribute value.
 * @param {string} s
 * @returns {string}
 */
export function escapeAttr(s) {
  return escapeHtml(s).replace(/`/g, '&#96;');
}

/**
 * Build the DA/Google-Docs clipboard payload for the "magic banner" block:
 * a single-column table linking back to the WAC preview URL, optionally
 * preceded by the content-overlay text.
 * @param {string} content
 * @param {string} url - delivery URL without a `?content=` override
 * @returns {{ html: string, plain: string }}
 */
export function buildMagicBannerClipboard(content, url) {
  const text = String(content || '').replace(/\s+$/g, '');
  const bodyText = text ? `${text}\n\n${url}` : url;
  const plain = `${MAGIC_BANNER_BLOCK}\n${bodyText}`;

  const linesHtml = text
    ? text.split(/\r\n|\r|\n/).map((line) => `<p>${escapeHtml(line)}</p>`).join('')
    : '';
  const link = `<p><a href="${escapeAttr(url)}">${escapeHtml(url)}</a></p>`;
  const cellHtml = `${linesHtml}${link}`;

  const html = `<table>
  <thead>
    <tr><th>${MAGIC_BANNER_BLOCK}</th></tr>
  </thead>
  <tbody>
    <tr><td>${cellHtml}</td></tr>
  </tbody>
</table>`;

  return { html, plain };
}
