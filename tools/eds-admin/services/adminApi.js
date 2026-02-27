const ADMIN_BASE = 'https://admin.hlx.page';

const IN_FLIGHT = new Map();

export async function adminFetch(path, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  const url = `${ADMIN_BASE}${path}`;

  if (method === 'GET') {
    const existing = IN_FLIGHT.get(url);
    if (existing) return existing;
  }

  const promise = (async () => {
    try {
      const resp = await fetch(url, {
        ...options,
        headers: {
          ...options.headers,
          ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        },
      });

      const error = resp.headers.get('x-error') || null;
      let data = null;

      if (resp.ok) {
        const contentType = resp.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          data = await resp.json();
        } else {
          data = await resp.text();
        }
      }

      return { data, status: resp.status, error };
    } catch (err) {
      return { data: null, status: 0, error: err.message };
    } finally {
      IN_FLIGHT.delete(url);
    }
  })();

  if (method === 'GET') {
    IN_FLIGHT.set(url, promise);
  }

  return promise;
}

export async function adminFetchRaw(path, options = {}) {
  const url = `${ADMIN_BASE}${path}`;
  try {
    const resp = await fetch(url, { ...options });
    const error = resp.headers.get('x-error') || null;
    const data = resp.ok ? await resp.text() : null;
    return { data, status: resp.status, error };
  } catch (err) {
    return { data: null, status: 0, error: err.message };
  }
}

export async function fetchOrgConfig(org) {
  return adminFetch(`/config/${org}.json`);
}

export async function fetchOrgSites(org) {
  return adminFetch(`/config/${org}/sites.json`);
}

export async function fetchOrgVersions(org) {
  return adminFetch(`/config/${org}/versions.json`);
}

export async function fetchOrgVersion(org, id) {
  return adminFetch(`/config/${org}/versions/${id}.json`);
}

export async function restoreOrgVersion(org, versionId) {
  return adminFetchRaw(`/config/${org}.json?restoreVersion=${versionId}`, {
    method: 'POST',
  });
}

export async function fetchOrgSecrets(org) {
  const { data, status, error } = await adminFetch(`/config/${org}/secrets.json`);
  if (status === 404) return { data: [], status: 200, error: null };
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    return { data: Object.values(data), status, error };
  }
  return { data: data || [], status, error };
}

export async function createOrgSecret(org) {
  return adminFetch(`/config/${org}/secrets.json`, { method: 'POST' });
}

export async function deleteOrgSecret(org, secretId) {
  return adminFetch(`/config/${org}/secrets/${encodeURIComponent(secretId)}.json`, {
    method: 'DELETE',
  });
}

export async function fetchOrgApiKeys(org) {
  const { data, status, error } = await adminFetch(`/config/${org}/apiKeys.json`);
  if (status === 404) return { data: [], status: 200, error: null };
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    return {
      data: Object.entries(data).map(([id, val]) => ({ id, ...val })),
      status,
      error,
    };
  }
  return { data: data || [], status, error };
}

export async function createOrgApiKey(org, body = {}) {
  return adminFetch(`/config/${org}/apiKeys.json`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function deleteOrgApiKey(org, keyId) {
  return adminFetch(`/config/${org}/apiKeys/${encodeURIComponent(keyId)}.json`, {
    method: 'DELETE',
  });
}

export async function fetchSiteVersion(org, site, id) {
  return adminFetch(`/config/${org}/sites/${site}/versions/${id}.json`);
}

export async function fetchSiteConfig(org, site) {
  return adminFetch(`/config/${org}/sites/${site}.json`);
}

export async function fetchAggregatedConfig(org, site) {
  return adminFetch(`/config/${org}/aggregated/${site}.json`);
}

export async function saveSiteConfig(org, site, config) {
  return adminFetch(`/config/${org}/sites/${site}.json`, {
    method: 'POST',
    body: JSON.stringify(config),
  });
}

export async function savePublicConfig(org, site, publicConfig) {
  return adminFetch(`/config/${org}/sites/${site}/public.json`, {
    method: 'POST',
    body: JSON.stringify(publicConfig),
  });
}

export async function deleteSiteConfig(org, site) {
  return adminFetch(`/config/${org}/sites/${site}.json`, {
    method: 'DELETE',
  });
}

export async function saveCdnConfig(org, site, cdnConfig) {
  return adminFetch(`/config/${org}/sites/${site}/cdn/prod.json`, {
    method: 'POST',
    body: JSON.stringify(cdnConfig),
  });
}

export async function fetchSiteAccess(org, site) {
  return adminFetch(`/config/${org}/sites/${site}/access.json`);
}

export async function updateSiteAccess(org, site, access) {
  return adminFetch(`/config/${org}/sites/${site}/access.json`, {
    method: 'POST',
    body: JSON.stringify(access),
  });
}

export async function fetchSecrets(org, site) {
  const { data, status, error } = await adminFetch(`/config/${org}/sites/${site}/secrets.json`);
  if (status === 404) return { data: [], status: 200, error: null };
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    return { data: Object.values(data), status, error };
  }
  return { data: data || [], status, error };
}

export async function createSecret(org, site) {
  return adminFetch(`/config/${org}/sites/${site}/secrets.json`, { method: 'POST' });
}

export async function deleteSecret(org, site, secretId) {
  return adminFetch(`/config/${org}/sites/${site}/secrets/${encodeURIComponent(secretId)}.json`, {
    method: 'DELETE',
  });
}

export async function fetchApiKeys(org, site) {
  const { data, status, error } = await adminFetch(`/config/${org}/sites/${site}/apiKeys.json`);
  if (status === 404) return { data: [], status: 200, error: null };
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    return {
      data: Object.entries(data).map(([id, val]) => ({ id, ...val })),
      status,
      error,
    };
  }
  return { data: data || [], status, error };
}

export async function createApiKey(org, site, body = {}) {
  return adminFetch(`/config/${org}/sites/${site}/apiKeys.json`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function deleteApiKey(org, site, keyId) {
  return adminFetch(`/config/${org}/sites/${site}/apiKeys/${encodeURIComponent(keyId)}.json`, {
    method: 'DELETE',
  });
}

export async function addOrgUser(org, user) {
  return adminFetch(`/config/${org}/users.json`, {
    method: 'POST',
    body: JSON.stringify(user),
  });
}

export async function updateOrgUser(org, userId, user) {
  return adminFetch(`/config/${org}/users/${userId}.json`, {
    method: 'POST',
    body: JSON.stringify(user),
  });
}

export async function deleteOrgUser(org, userId) {
  return adminFetch(`/config/${org}/users/${userId}.json`, {
    method: 'DELETE',
  });
}

export async function fetchRobots(org, site) {
  return adminFetchRaw(`/config/${org}/sites/${site}/robots.txt`);
}

export async function saveRobots(org, site, content) {
  const url = `${ADMIN_BASE}/config/${org}/sites/${site}/robots.txt`;
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: content,
    });
    return { data: null, status: resp.status, error: resp.headers.get('x-error') || null };
  } catch (err) {
    return { data: null, status: 0, error: err.message };
  }
}

export async function fetchHeaders(org, site) {
  return adminFetch(`/config/${org}/sites/${site}/headers.json`);
}

export async function saveHeaders(org, site, headers) {
  return adminFetch(`/config/${org}/sites/${site}/headers.json`, {
    method: 'POST',
    body: JSON.stringify(headers),
  });
}

async function saveYamlConfig(path, yaml, { create = false } = {}) {
  const url = `${ADMIN_BASE}${path}`;
  try {
    const resp = await fetch(url, {
      method: create ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'text/yaml' },
      body: yaml,
    });
    return { data: null, status: resp.status, error: resp.headers.get('x-error') || null };
  } catch (err) {
    return { data: null, status: 0, error: err.message };
  }
}

export async function fetchIndexConfig(org, site) {
  return adminFetchRaw(`/config/${org}/sites/${site}/content/query.yaml`);
}

export async function saveIndexConfig(org, site, yaml, opts) {
  return saveYamlConfig(`/config/${org}/sites/${site}/content/query.yaml`, yaml, opts);
}

export async function fetchSitemapConfig(org, site) {
  return adminFetchRaw(`/config/${org}/sites/${site}/content/sitemap.yaml`);
}

export async function saveSitemapConfig(org, site, yaml, opts) {
  return saveYamlConfig(`/config/${org}/sites/${site}/content/sitemap.yaml`, yaml, opts);
}

export async function fetchSnapshots(org, site) {
  return adminFetch(`/snapshot/${org}/${site}/main`);
}

export async function fetchSnapshot(org, site, snapshotId) {
  return adminFetch(`/snapshot/${org}/${site}/main/${encodeURIComponent(snapshotId)}`);
}

export async function saveSnapshotManifest(org, site, snapshotId, manifest) {
  return adminFetch(`/snapshot/${org}/${site}/main/${encodeURIComponent(snapshotId)}`, {
    method: 'POST',
    body: JSON.stringify(manifest),
  });
}

export async function deleteSnapshot(org, site, snapshotId) {
  return adminFetch(`/snapshot/${org}/${site}/main/${encodeURIComponent(snapshotId)}`, {
    method: 'DELETE',
  });
}

export async function addSnapshotPaths(org, site, snapshotId, paths) {
  return adminFetch(`/snapshot/${org}/${site}/main/${encodeURIComponent(snapshotId)}/*`, {
    method: 'POST',
    body: JSON.stringify({ paths }),
  });
}

export async function removeSnapshotPath(org, site, snapshotId, path) {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return adminFetch(`/snapshot/${org}/${site}/main/${encodeURIComponent(snapshotId)}${cleanPath}`, {
    method: 'DELETE',
  });
}

export async function removeAllSnapshotPaths(org, site, snapshotId) {
  return adminFetch(`/snapshot/${org}/${site}/main/${encodeURIComponent(snapshotId)}/*`, {
    method: 'DELETE',
  });
}

export async function reviewSnapshot(org, site, snapshotId, reviewStatus, message) {
  return adminFetch(`/snapshot/${org}/${site}/main/${encodeURIComponent(snapshotId)}?review=${encodeURIComponent(reviewStatus)}`, {
    method: 'POST',
    body: message ? JSON.stringify({ message }) : undefined,
  });
}

export async function fetchLogs(org, site, options = {}) {
  const params = new URLSearchParams();
  if (options.since) params.set('since', options.since);
  if (options.from) params.set('from', options.from);
  if (options.to) params.set('to', options.to);
  const qs = params.toString();
  let nextUrl = `${ADMIN_BASE}/log/${org}/${site}/main${qs ? `?${qs}` : ''}`;
  const allEntries = [];

  try {
    while (nextUrl) {
      // eslint-disable-next-line no-await-in-loop
      const resp = await fetch(nextUrl);
      if (!resp.ok) {
        const error = resp.headers.get('x-error') || `HTTP ${resp.status}`;
        return { data: allEntries, status: resp.status, error };
      }
      let json;
      try {
        // eslint-disable-next-line no-await-in-loop
        json = await resp.json();
      } catch (parseErr) {
        return { data: allEntries, status: resp.status, error: parseErr.message || 'Invalid JSON response' };
      }
      if (Array.isArray(json.entries)) {
        allEntries.push(...json.entries);
      } else if (Array.isArray(json)) {
        allEntries.push(...json);
      }
      nextUrl = json.links?.next || null;
    }
    return { data: allEntries, status: 200, error: null };
  } catch (err) {
    return { data: allEntries, status: 0, error: err.message };
  }
}

export async function fetchPageStatus(org, site, path) {
  const cleanPath = path.startsWith('/') ? path.slice(1) : path;
  return adminFetch(`/status/${org}/${site}/main/${cleanPath}`);
}

export async function previewPage(org, site, path) {
  const cleanPath = path.startsWith('/') ? path.slice(1) : path;
  return adminFetch(`/preview/${org}/${site}/main/${cleanPath}`, { method: 'POST' });
}

export async function publishPage(org, site, path) {
  const cleanPath = path.startsWith('/') ? path.slice(1) : path;
  return adminFetch(`/live/${org}/${site}/main/${cleanPath}`, { method: 'POST' });
}

export async function unpublishPage(org, site, path) {
  const cleanPath = path.startsWith('/') ? path.slice(1) : path;
  return adminFetch(`/live/${org}/${site}/main/${cleanPath}`, { method: 'DELETE' });
}

export async function unpreviewPage(org, site, path) {
  const cleanPath = path.startsWith('/') ? path.slice(1) : path;
  return adminFetch(`/preview/${org}/${site}/main/${cleanPath}`, { method: 'DELETE' });
}

export async function bulkPreview(org, site, paths, { forceUpdate = false } = {}) {
  const body = { paths };
  if (forceUpdate) body.forceUpdate = true;
  return adminFetch(`/preview/${org}/${site}/main/*`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function bulkPublish(org, site, paths, { forceUpdate = false } = {}) {
  const body = { paths };
  if (forceUpdate) body.forceUpdate = true;
  return adminFetch(`/live/${org}/${site}/main/*`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function bulkUnpreview(org, site, paths) {
  return adminFetch(`/preview/${org}/${site}/main/*`, {
    method: 'POST',
    body: JSON.stringify({ paths, delete: true }),
  });
}

export async function bulkUnpublish(org, site, paths) {
  return adminFetch(`/live/${org}/${site}/main/*`, {
    method: 'POST',
    body: JSON.stringify({ paths, delete: true }),
  });
}

export async function bulkStatus(org, site, paths, { select } = {}) {
  const body = { paths };
  if (select) body.select = select;
  return adminFetch(`/status/${org}/${site}/main/*`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function indexPage(org, site, path) {
  const cleanPath = path.startsWith('/') ? path.slice(1) : path;
  return adminFetch(`/index/${org}/${site}/main/${cleanPath}`, { method: 'POST' });
}

export async function fetchJobDetails(org, site, topic, jobName) {
  return adminFetch(`/job/${org}/${site}/main/${topic}/${jobName}/details`);
}

export async function fetchProfile(org, site) {
  return adminFetch(`/profile/${org}/${site}/main`);
}

export async function fetchPsi(org, site, url) {
  const encodedUrl = encodeURIComponent(url);
  return adminFetch(`/psi/${org}/${site}/main?url=${encodedUrl}`);
}

export async function fetchSiteVersions(org, site) {
  if (site) {
    return adminFetch(`/config/${org}/sites/${site}/versions.json`);
  }
  return adminFetch(`/config/${org}/versions.json`);
}

export async function restoreVersion(org, site, versionId) {
  if (site) {
    return adminFetchRaw(`/config/${org}/sites/${site}.json?restoreVersion=${versionId}`, {
      method: 'POST',
    });
  }
  return adminFetchRaw(`/config/${org}.json?restoreVersion=${versionId}`, {
    method: 'POST',
  });
}

export async function renameVersion(org, site, versionId, name) {
  const base = site
    ? `/config/${org}/sites/${site}/versions/${versionId}.json`
    : `/config/${org}/versions/${versionId}.json`;
  return adminFetch(`${base}?name=${encodeURIComponent(name)}`, {
    method: 'POST',
  });
}

export async function deleteVersion(org, site, versionId) {
  const base = site
    ? `/config/${org}/sites/${site}/versions/${versionId}.json`
    : `/config/${org}/versions/${versionId}.json`;
  return adminFetch(base, { method: 'DELETE' });
}

export async function deleteHeaders(org, site) {
  return adminFetch(`/config/${org}/sites/${site}/headers.json`, { method: 'DELETE' });
}

export async function syncCode(owner, repo) {
  return adminFetch(`/code/${owner}/${repo}/main/*`, { method: 'POST' });
}

export async function publishSnapshot(org, site, snapshotId) {
  return adminFetch(`/snapshot/${org}/${site}/main/${encodeURIComponent(snapshotId)}?publish=true`, {
    method: 'POST',
  });
}

export async function publishSnapshotResource(org, site, snapshotId, path) {
  const cleanPath = path.startsWith('/') ? path.slice(1) : path;
  return adminFetch(`/snapshot/${org}/${site}/main/${encodeURIComponent(snapshotId)}/${cleanPath}?publish=true`, {
    method: 'POST',
  });
}

export async function bulkIndex(org, site, paths) {
  return adminFetch(`/index/${org}/${site}/main/*`, {
    method: 'POST',
    body: JSON.stringify({ paths }),
  });
}

export async function deleteFromIndex(org, site, path) {
  const cleanPath = path.startsWith('/') ? path.slice(1) : path;
  return adminFetch(`/index/${org}/${site}/main/${cleanPath}`, { method: 'DELETE' });
}

export async function saveSidekickConfig(org, site, sidekickConfig) {
  return adminFetch(`/config/${org}/sites/${site}.json`, {
    method: 'POST',
    body: JSON.stringify({ sidekick: sidekickConfig }),
  });
}

export async function createSiteConfig(org, site, config) {
  return adminFetch(`/config/${org}/sites/${site}.json`, {
    method: 'PUT',
    body: JSON.stringify(config),
  });
}

const RUM_BUNDLES_BASE = 'https://bundles.aem.page';

export async function fetchRumDay(domain, domainkey, dateStr) {
  const datePath = dateStr.split('-').join('/');
  const url = `${RUM_BUNDLES_BASE}/bundles/${domain}/${datePath}?domainkey=${encodeURIComponent(domainkey)}`;
  try {
    const resp = await fetch(url);
    if (!resp.ok) return { data: [], status: resp.status, error: `HTTP ${resp.status}` };
    const json = await resp.json();
    return { data: json.rumBundles || [], status: 200, error: null };
  } catch (err) {
    return { data: [], status: 0, error: err.message };
  }
}
