import { getHelix6, isUnavailablePath, requestSignal } from '../../utils/helix6-download.js';
import { planZip } from '../../utils/zip-download.js';
import { codeURL, parseListing, liveURL } from './utils.js';

export async function getCodeJSON(url, root, signal) {
  const response = await getHelix6(codeURL(url, root), 'Code', {
    403: 'You do not have permission to read this codebus repository.',
    404: 'No code was found at this path. Check the organization, site, and branch.',
  }, signal);
  return response.json();
}

export async function listCodeFolder(url, root, onPage, onIncomplete) {
  const allEntries = new Map();
  const seenCursors = new Set();
  let cursor = null;
  do {
    const requestURL = codeURL(url, root);
    requestURL.searchParams.set('limit', '1000');
    if (cursor) requestURL.searchParams.set('cursor', cursor);
    let response;
    try {
      // eslint-disable-next-line no-await-in-loop
      response = await getCodeJSON(requestURL.href, root);
    } catch (error) {
      if (!cursor || !onIncomplete || !isUnavailablePath(error)) throw error;
      onIncomplete(error);
      break;
    }
    const data = parseListing(response, url, root);
    data.entries.forEach((entry) => allEntries.set(entry.url, entry));
    cursor = data.cursor;
    if (cursor) {
      if (seenCursors.has(cursor)) {
        throw new Error('The code API returned a repeated pagination cursor.');
      }
      seenCursors.add(cursor);
    }
    onPage?.(allEntries.size);
  } while (cursor);
  return [...allEntries.values()];
}

export function planCodeZip(root, branch, progress, { bestEffort = false } = {}) {
  const branchURL = codeURL(branch, root);
  const { pathname } = new URL(root);
  const [, org, , site] = pathname.split('/');
  const ref = decodeURIComponent(branchURL.pathname.slice(pathname.length, -1));
  if (!branchURL.pathname.endsWith('/') || !ref || ref.includes('/')) {
    throw new Error('Select a single CodeBus branch.');
  }
  const name = `${org}-${site}-${ref}`;
  return planZip({
    url: branchURL.href,
    name,
    list: (url, onIncomplete) => listCodeFolder(url, root, undefined, onIncomplete),
    async read(url, signal) {
      const fileURL = liveURL(await getCodeJSON(url, root, signal));
      try {
        const response = await fetch(fileURL, {
          credentials: 'omit',
          redirect: 'error',
          signal: requestSignal(signal),
        });
        if (!response.ok) throw new Error(`Live URL returned HTTP ${response.status}.`);
        return new Uint8Array(await response.arrayBuffer());
      } catch (error) {
        const hint = error instanceof TypeError
          ? ' This may be a CORS issue or a network failure. If the browser console reports CORS blocking, install a trusted CORS-unblocking extension (CORS blocker), enable it only for this download, then disable it afterward.'
          : '';
        throw new Error(`${fileURL}: ${error.message}${hint}`);
      }
    },
    progress,
    bestEffort,
    concurrency: 40,
    emptyMessage: 'This branch has no non-hidden files to download.',
  });
}

export async function zipCodeBranch(root, branch, progress) {
  const plan = await planCodeZip(root, branch, progress);
  return { blob: await plan.download(progress), filename: plan.filename };
}
