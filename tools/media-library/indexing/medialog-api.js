import admin from '../../../scripts/helix-admin.js';
import { executeAdminRequest, AuthMode } from '../../../utils/admin-request.js';
import { MediaLibraryError, ErrorCodes, logMediaLibraryError } from '../core/errors.js';
import t from '../core/messages.js';

export {
  detectMediaType,
  getMediaItemsFromMap,
  mergeEntriesIntoMediaMap,
  transformToMediaData,
} from './transforms.js';

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
  if (result.status === 404) throw new Error('Media log not found for this site.');
  const errorText = await result.text();
  throw new Error(`Failed to fetch medialog: ${result.status} - ${errorText}`);
}

/**
 * Fetch all medialog entries (with pagination).
 * @param {string} org
 * @param {string} site
 * @param {object} timeParams - { from, to } for incremental; empty for full
 * @param {Function} [onChunk] - Callback (entries) for each page; enables progressive display
 */
export async function fetchAllMediaLog(org, site, timeParams, onChunk = null, options = {}) {
  const { policy: authPolicy } = options;
  const handle = authedAdmin.medialog({ org, site });
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
    const { entries = [] } = data;
    const token = data.nextToken || (data.links?.next
      ? new URL(data.links.next).searchParams.get('nextToken')
      : null);

    if (!entries.length) break;
    allEntries.push(...entries);
    if (onChunk) onChunk(entries);
    nextToken = token;
    done = entries.length < DEFAULT_LIMIT || !token;
  }

  return allEntries;
}
