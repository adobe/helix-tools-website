import admin from '../../../scripts/helix-admin.js';
import { executeAdminRequest, AuthMode } from '../../../utils/admin-request.js';
import { MediaLibraryError, ErrorCodes, logMediaLibraryError } from '../core/errors.js';
import t from '../core/messages.js';

const DEFAULT_LIMIT = 1000;
const authedAdmin = admin.withRequestInit({ credentials: 'include' });

async function checkError(result) {
  if (result.ok) return;
  const { url } = result.request;
  if (result.status === 401) {
    logMediaLibraryError(ErrorCodes.EDS_AUTH_EXPIRED, { status: 401, endpoint: url });
    throw new MediaLibraryError(ErrorCodes.EDS_AUTH_EXPIRED, t('EDS_AUTH_EXPIRED'), { status: 401 });
  }
  if (result.status === 403) {
    logMediaLibraryError(ErrorCodes.EDS_LOG_DENIED, { status: 403, endpoint: url });
    throw new MediaLibraryError(ErrorCodes.EDS_LOG_DENIED, t('EDS_LOG_DENIED'), { status: 403 });
  }
  if (result.status === 404) throw new Error('Audit log not found for this site.');
  const errorText = await result.text();
  throw new Error(`Failed to fetch audit log: ${result.status} - ${errorText}`);
}

/**
 * Fetch all audit log entries with pagination.
 * @param {string} org
 * @param {string} site
 * @param {object} timeParams - { from, to } for incremental; empty for full
 * @param {Function} [onChunk] - Callback (entries) per page; enables progressive emit
 */
export async function fetchAllAuditLog(org, site, timeParams, onChunk = null, options = {}) {
  const { policy: authPolicy } = options;
  const handle = authedAdmin.log({ org, site });
  const allEntries = [];
  let nextToken = null;
  let done = false;
  let first = true;

  while (!done) {
    const params = { limit: DEFAULT_LIMIT };
    if (timeParams.from && timeParams.to) {
      params.from = timeParams.from;
      params.to = timeParams.to;
    }
    if (nextToken) params.nextToken = nextToken;

    const policy = authPolicy ?? (first ? AuthMode.PREFLIGHT_AND_RETRY : AuthMode.RETRY_ON_401);
    first = false;

    // eslint-disable-next-line no-await-in-loop -- pagination must be sequential
    const result = await executeAdminRequest(() => handle.get('', { params }), { org, site, policy });
    if (!result) return allEntries; // login cancelled

    // eslint-disable-next-line no-await-in-loop
    await checkError(result);

    // eslint-disable-next-line no-await-in-loop
    const data = await result.json();
    const { entries = [], links } = data;
    if (!entries.length) break;

    allEntries.push(...entries);
    if (onChunk) onChunk(entries);
    const token = data.nextToken || (links?.next ? new URL(links.next).searchParams.get('nextToken') : null);
    nextToken = token;
    done = entries.length < DEFAULT_LIMIT || !token;
  }

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
