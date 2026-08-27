// eslint-disable-next-line import/no-unresolved -- ESM import from a CDN, not a local module
import { unzipSync } from 'https://cdn.jsdelivr.net/npm/fflate@0.8.2/esm/browser.js';
import { commonRoot } from './utils.js';

/**
 * Unzip a File client-side and describe its contents so the upload UI can
 * validate it (has an index.html?) and show a file listing before it's
 * sent to the worker.
 * @param {File} file
 * @returns {Promise<{
 *   files: string[], hasIndex: boolean, bytes: Uint8Array, extractedBytes: number
 * }>}
 */
export default async function inspectZip(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  const entries = unzipSync(buf, {
    filter(fileInfo) {
      return !fileInfo.name.endsWith('/')
        && !fileInfo.name.startsWith('__MACOSX/')
        && fileInfo.name.split('/').pop() !== '.DS_Store';
    },
  });

  const rootPrefix = commonRoot(Object.keys(entries).map((n) => n.replace(/^\/+/, '')));
  const files = [];
  let extractedBytes = 0;

  Object.keys(entries).forEach((name) => {
    let relative = name.replace(/^\/+/, '');
    if (rootPrefix && relative.startsWith(rootPrefix)) {
      relative = relative.slice(rootPrefix.length);
    }
    if (!relative || relative.split('/').includes('.wac')) return;
    if (relative.split('/').some((p) => p === '' || p === '.' || p === '..')) return;
    files.push(relative);
    extractedBytes += entries[name]?.byteLength || 0;
  });

  files.sort((a, b) => a.localeCompare(b));
  if (!files.length) throw new Error('Zip has no usable files');

  const hasIndex = files.some((f) => {
    const lower = f.toLowerCase();
    return lower === 'index.html' || lower === 'index.htm';
  });
  return {
    files, hasIndex, bytes: buf, extractedBytes,
  };
}
