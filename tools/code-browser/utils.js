const API_ORIGIN = 'https://api.aem.live';

export function codeRoot(org, site) {
  const values = [org, site].map((value) => value.trim());
  if (values.some((value) => !/^[a-z0-9][a-z0-9-]*$/i.test(value))) {
    throw new Error('Organization and site must contain only letters, numbers, and hyphens.');
  }
  return `${API_ORIGIN}/${values[0]}/repos/${values[1]}/code/`;
}

// Never follow API-provided paths outside the selected repository or API origin.
export function codeURL(path, root) {
  if (typeof path !== 'string' || !path) {
    throw new Error('The code API returned an invalid path.');
  }
  const segments = path.split(/[?#]/)[0].split('/');
  if (segments.some((segment) => {
    const decoded = decodeURIComponent(segment);
    return decoded === '.' || decoded === '..' || /[/\\]/.test(decoded)
      || [...decoded].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);
  })) {
    throw new Error('The code API returned an invalid code path.');
  }
  const url = new URL(path, API_ORIGIN);
  const rootURL = new URL(root);
  if (url.origin !== API_ORIGIN || url.username || url.password
    || !url.pathname.startsWith(rootURL.pathname) || url.hash) {
    throw new Error('The code API returned a path outside the selected repository.');
  }
  return url;
}

export function parseBranches(data, root) {
  if (!Array.isArray(data?.branches)) {
    throw new Error('The code API did not return a branch listing.');
  }
  return data.branches.map((path) => {
    const url = codeURL(path, root);
    const name = url.pathname.slice(new URL(root).pathname.length).replace(/\/$/, '');
    if (!name || name.includes('/') || !url.pathname.endsWith('/')) {
      throw new Error('The code API returned an invalid branch path.');
    }
    return { name: decodeURIComponent(name), url: url.href };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

export function parseListing(data, folder, root) {
  if (!Array.isArray(data?.children)) {
    throw new Error('The code API did not return a folder listing.');
  }
  const parent = codeURL(folder, root);
  const entries = data.children.map((entry) => {
    const url = codeURL(entry.path, root);
    const isFolder = entry.type === 'folder';
    const name = url.pathname.slice(parent.pathname.length).replace(/\/$/, '');
    if (!url.pathname.startsWith(parent.pathname) || !name || name.includes('/')
      || !['file', 'folder'].includes(entry.type)
      || isFolder !== url.pathname.endsWith('/')) {
      throw new Error('The code API returned an invalid folder entry.');
    }
    return { ...entry, name: decodeURIComponent(name), url: url.href };
  });
  if (data.cursor !== undefined && data.cursor !== null && typeof data.cursor !== 'string') {
    throw new Error('The code API returned an invalid pagination cursor.');
  }
  return { entries: entries.filter((entry) => !entry.name.startsWith('.')), cursor: data.cursor || null };
}

export function filterEntries(entries, query) {
  const term = query.trim().toLowerCase();
  return entries.filter((entry) => entry.name.toLowerCase().includes(term))
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}

export function liveURL(data) {
  if (typeof data?.live?.url !== 'string' || !data.live.url) {
    throw new Error('The code API did not return a live URL for this file.');
  }
  const url = new URL(data.live.url);
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('The code API returned an invalid live URL.');
  }
  return url.href;
}

export function folderBreadcrumbs(folder, branchURL) {
  const url = new URL(folder);
  const base = new URL(branchURL);
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) {
    throw new Error('Folder is outside the selected branch.');
  }
  const crumbs = [{ name: '/', url: base.href }];
  const segments = url.pathname.slice(base.pathname.length).split('/').filter(Boolean);
  segments.forEach((segment) => {
    base.pathname += `${segment}/`;
    crumbs.push({ name: decodeURIComponent(segment), url: base.href });
  });
  return crumbs;
}
