import { ensureLogin } from '../../blocks/profile/profile.js';

const CONFIG = {
  API_URL: 'https://admin.hlx.page/log',
  DEFAULT_LIMIT: 1000,
};

export async function fetchAuditLog(org, site, since, nextToken = null) {
  await ensureLogin(org, site);

  const params = new URLSearchParams({
    since,
    limit: CONFIG.DEFAULT_LIMIT,
  });

  if (nextToken) {
    params.set('nextToken', nextToken);
  }

  const url = `${CONFIG.API_URL}/${org}/${site}/main?${params}`;

  const response = await fetch(url);

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

export async function fetchAllAuditLog(org, site, since, onPageLoaded = null) {
  let allEntries = [];
  let nextToken = null;
  let pageCount = 0;

  do {
    pageCount++;

    const result = await fetchAuditLog(org, site, since, nextToken);

    if (!result.entries || result.entries.length === 0) {
      break;
    }

    const entriesCount = result.entries.length;
    allEntries = allEntries.concat(result.entries);
    nextToken = result.nextToken;

    if (onPageLoaded) {
      onPageLoaded(allEntries, !!nextToken);
    }

    if (entriesCount < CONFIG.DEFAULT_LIMIT) {
      break;
    }
  } while (nextToken);

  return allEntries;
}

function isPdfSvgOrFragment(path) {
  return /\.(pdf|svg)$/i.test(path) || (path.includes('/fragments/') && !path.includes('.'));
}

export function processAuditLog(entries, org, site) {
  if (!entries || entries.length === 0) return [];

  return entries
    .filter((entry) => entry.route === 'preview')
    .filter((entry) => isPdfSvgOrFragment(entry.path))
    .map((entry) => {
      const cleanPath = entry.path.split('?')[0].split('#')[0];
      const ext = cleanPath.split('.').pop()?.toLowerCase() || '';

      return {
        operation: 'ingest',
        path: `https://main--${site}--${org}.aem.page${entry.path}`,
        timestamp: entry.timestamp,
        user: entry.user || 'Unknown',
        resourcePath: null,
        originalFilename: cleanPath,
        contentType: ext === 'pdf' ? 'application/pdf' : ext === 'svg' ? 'image/svg+xml' : null,
        mediaHash: null,
        width: null,
        height: null,
        source: 'auditlog',
      };
    });
}
