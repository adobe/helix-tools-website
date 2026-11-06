const PAGE_LIMIT = 1000;
const CONCURRENCY = 8;
const EXCLUDED = ['/.helix/', '/.snapshots/', '/.trash/', '/.da/'];

/**
 * Converts a content bus resource path to its web path.
 * @param {string} path
 * @returns {string}
 */
export function contentToWebPath(path) {
  if (path.endsWith('/index.md')) return path.slice(0, -'index.md'.length);
  if (path.endsWith('.md')) return path.slice(0, -'.md'.length);
  return path;
}

/**
 * Converts a source bus path to its web path.
 * @param {string} path
 * @returns {string}
 */
export function sourceToWebPath(path) {
  if (path.endsWith('/index.html')) return path.slice(0, -'index.html'.length);
  if (path.endsWith('.html')) return path.slice(0, -'.html'.length);
  return path;
}

function statusError(res) {
  const error = new Error(`Listing failed: ${res.status}`);
  error.status = res.status;
  return error;
}

export function createLimiter(max) {
  let active = 0;
  const waiting = [];
  return async (fn) => {
    if (active < max) active += 1;
    else await new Promise((resolve) => { waiting.push(resolve); });
    try {
      return await fn();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active -= 1;
    }
  };
}

/**
 * Walks a folder tree with bounded concurrency.
 * @param {string} root - Root folder path (ending with `/`).
 * @param {(folder: string) => Promise<{folders: string[], files: Object[]}>} listFolder
 * @returns {Promise<Object[]>} All files found.
 */
export async function walkTree(root, listFolder) {
  const files = [];
  const limit = createLimiter(CONCURRENCY);
  const visit = async (folder) => {
    const result = await limit(() => listFolder(folder));
    files.push(...result.files);
    await Promise.all(result.folders
      .filter((f) => !EXCLUDED.some((e) => f.startsWith(e)))
      .map(visit));
  };
  await visit(root);
  return files;
}

/**
 * Lists one folder of a content bus partition via the browse API, following
 * pagination cursors.
 * @param {Object} admin - H6 admin client.
 * @param {string} org
 * @param {string} site
 * @param {'preview'|'live'} partition
 * @param {string} folder
 * @returns {Promise<{folders: string[], files: {path: string, lastModified: string}[]}>}
 */
export async function listPartitionFolder(admin, org, site, partition, folder) {
  const prefix = `/${org}/sites/${site}/${partition}`;
  const folders = [];
  const files = [];
  let cursor;
  do {
    const params = { limit: PAGE_LIMIT };
    if (cursor) params.cursor = cursor;
    // eslint-disable-next-line no-await-in-loop
    const res = await admin.raw('GET', `${prefix}${folder}`, null, { params });
    if (res.status === 404) break;
    if (!res.ok) throw statusError(res);
    // eslint-disable-next-line no-await-in-loop
    const json = await res.json();
    (json.children || []).forEach((child) => {
      const path = child.path.startsWith(prefix) ? child.path.slice(prefix.length) : child.path;
      if (child.type === 'folder') folders.push(path);
      else files.push({ path, lastModified: child.lastModified });
    });
    ({ cursor } = json);
  } while (cursor);
  return { folders, files };
}

/**
 * Lists one folder of the source bus.
 * @param {Object} admin - H6 admin client.
 * @param {string} org
 * @param {string} site
 * @param {string} folder
 * @returns {Promise<{folders: string[], files: {path: string, lastModified: string}[]}>}
 */
export async function listSourceFolder(admin, org, site, folder) {
  const res = await admin.raw('GET', `/${org}/sites/${site}/source${folder}`);
  if (res.status === 404) return { folders: [], files: [] };
  if (!res.ok) throw statusError(res);
  const items = await res.json();
  const folders = [];
  const files = [];
  items.forEach(({ name, 'last-modified': lastModified }) => {
    if (name.endsWith('/')) folders.push(`${folder}${name}`);
    else files.push({ path: `${folder}${name}`, lastModified });
  });
  return { folders, files };
}

/**
 * Collects page status resources for a folder on a Helix 6 site, in the same
 * shape as the H5 bulk status job resources.
 * @param {Object} admin - H6 admin client.
 * @param {Object} opts
 * @param {string} opts.org
 * @param {string} opts.site
 * @param {string} opts.folder - Root folder (ending with `/`).
 * @param {boolean} opts.source - Whether to list the source bus.
 * @returns {Promise<{resources: Object[], liveForbidden: boolean}>} Resources sorted by
 * path; `liveForbidden` when live could not be listed (missing `live:list` permission).
 */
export async function collectResources(admin, {
  org, site, folder, source,
}) {
  let liveForbidden = false;
  const [sourceFiles, previewFiles, liveFiles] = await Promise.all([
    source
      ? walkTree(folder, (f) => listSourceFolder(admin, org, site, f))
      : [],
    walkTree(folder, (f) => listPartitionFolder(admin, org, site, 'preview', f)),
    walkTree(folder, (f) => listPartitionFolder(admin, org, site, 'live', f))
      .catch((error) => {
        if (error.status !== 403) throw error;
        liveForbidden = true;
        return [];
      }),
  ]);

  const resources = new Map();
  const getOrCreate = (path) => {
    if (!resources.has(path)) resources.set(path, { path });
    return resources.get(path);
  };
  previewFiles.forEach(({ path, lastModified }) => {
    getOrCreate(contentToWebPath(path)).previewLastModified = lastModified;
  });
  liveFiles.forEach(({ path, lastModified }) => {
    getOrCreate(contentToWebPath(path)).publishLastModified = lastModified;
  });
  sourceFiles.forEach(({ path, lastModified }) => {
    const webPath = sourceToWebPath(path);
    const isPage = path.endsWith('.html') || path.endsWith('.json');
    if (isPage || resources.has(webPath)) getOrCreate(webPath).sourceLastModified = lastModified;
  });

  return {
    resources: [...resources.values()].sort((a, b) => a.path.localeCompare(b.path)),
    liveForbidden,
  };
}
