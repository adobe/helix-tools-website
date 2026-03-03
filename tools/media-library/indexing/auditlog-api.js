import { ensureLogin } from '../../../blocks/profile/profile.js';

const CONFIG = {
  API_URL: 'https://admin.hlx.page/log',
  DEFAULT_LIMIT: 1000,
};

/**
 * Fetch audit log from Admin API.
 * Caller must ensure auth (e.g. fetchAllAuditLog calls ensureLogin once before pagination).
 * @param {string} org - Organization
 * @param {string} site - Site
 * @param {object} timeParams - { since } for full or { from, to } for incremental (ISO)
 * @param {string} [nextToken] - Pagination token
 */
export async function fetchAuditLog(org, site, timeParams, nextToken = null) {
  const params = new URLSearchParams();
  if (timeParams.from && timeParams.to) {
    params.set('from', timeParams.from);
    params.set('to', timeParams.to);
  } else {
    params.set('since', timeParams.since || '730d');
  }
  params.set('limit', CONFIG.DEFAULT_LIMIT);

  if (nextToken) {
    params.set('nextToken', nextToken);
  }

  const url = `${CONFIG.API_URL}/${org}/${site}/main?${params}`;

  const response = await fetch(url, { credentials: 'include' });

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('Authentication required. Please sign in to the project in Sidekick.');
    }
    if (response.status === 404) {
      throw new Error('Audit log not found for this site.');
    }
    const errorText = await response.text();
    throw new Error(`Failed to fetch audit log: ${response.status} - ${errorText}`);
  }

  const data = await response.json();

  return {
    entries: data.entries || [],
    nextToken: data.links?.next ? new URL(data.links.next).searchParams.get('nextToken') : null,
  };
}

/**
 * Fetch all audit log entries with pagination.
 * @param {string} org - Organization
 * @param {string} site - Site
 * @param {object} timeParams - { since } for full or { from, to } for incremental
 * @param {Function} [onChunk] - Callback (entries) per page; enables progressive emit
 */
export async function fetchAllAuditLog(org, site, timeParams, onChunk = null) {
  await ensureLogin(org, site);

  let allEntries = [];
  let nextToken = null;

  const fetchPage = async () => {
    const result = await fetchAuditLog(org, site, timeParams, nextToken);

    if (!result.entries || result.entries.length === 0) {
      return;
    }

    const entriesCount = result.entries.length;
    allEntries = allEntries.concat(result.entries);
    nextToken = result.nextToken;

    if (entriesCount > 0 && onChunk) {
      onChunk(result.entries);
    }

    if (entriesCount < CONFIG.DEFAULT_LIMIT || !nextToken) {
      return;
    }
    await fetchPage();
  };

  await fetchPage();
  return allEntries;
}

function isPdfSvgOrFragment(path) {
  if (!path) return false;
  const cleanPath = path.split('?')[0].split('#')[0];
  return /\.(pdf|svg)$/i.test(cleanPath) || (cleanPath.includes('/fragments/') && !cleanPath.includes('.'));
}

function getContentType(ext) {
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'svg') return 'image/svg+xml';
  return null;
}

export function processAuditLog(entries, org, site) {
  if (!entries || entries.length === 0) return [];

  return entries
    .filter((entry) => entry.route === 'preview')
    .filter((entry) => isPdfSvgOrFragment(entry.path))
    .map((entry) => {
      const cleanPath = entry.path.split('?')[0].split('#')[0];
      const ext = cleanPath.split('.').pop()?.toLowerCase() || '';

      const url = `https://main--${site}--${org}.aem.page${entry.path}`;
      return {
        hash: url,
        url,
        path: url,
        name: cleanPath.split('/').pop() || cleanPath,
        timestamp: entry.timestamp,
        user: entry.user || 'Unknown',
        operation: 'ingest',
        doc: '',
        resourcePath: null,
        contentType: getContentType(ext),
        mediaHash: null,
        width: null,
        height: null,
      };
    });
}
