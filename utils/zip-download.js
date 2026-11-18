import { isUnavailablePath } from './helix6-download.js';

export function saveDownload(blob, filename) {
  const href = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = href;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(href), 60000);
}

export function isPathSegment(value) {
  return typeof value === 'string' && value !== '' && value !== '.' && value !== '..'
    && !/[/\\:]/.test(value)
    && [...value].every((char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127);
}

async function createZip(directories, downloads, read, progress, concurrency) {
  const files = Object.create(null);
  directories.forEach((path) => { files[path] = new Uint8Array(0); });
  const controller = new AbortController();
  let next = 0;
  let count = 0;
  let failure;
  async function worker() {
    while (!controller.signal.aborted && next < downloads.length) {
      const entry = downloads[next];
      next += 1;
      try {
        // eslint-disable-next-line no-await-in-loop
        files[entry.path] = await read(entry.url, controller.signal);
        count += 1;
        progress(`Downloading... ${count} / ${downloads.length} files.`);
      } catch (error) {
        if (!failure) {
          failure = new Error(`Could not download ${entry.path}: ${error.message}`);
          controller.abort();
        }
      }
    }
  }
  progress(`Downloading... 0 / ${downloads.length} files.`);
  await Promise.all(Array.from({ length: Math.min(concurrency, downloads.length) }, worker));
  if (failure) throw failure;

  progress(`Creating ZIP with ${count} files...`);
  const { zipSync } = await import('../vendor/fflate/fflate.js');
  return new Blob([zipSync(files, { level: 0 })], { type: 'application/zip' });
}

export async function planZip({
  url, name, list, read, progress, concurrency = 8, emptyMessage, bestEffort = false,
}) {
  const folders = [{ url, path: `${name}/` }];
  const directories = [];
  const downloads = [];
  const skipped = [];
  while (folders.length) {
    const folder = folders.pop();
    const report = (error) => skipped.push(`${folder.path}: ${error.message}`);
    // eslint-disable-next-line no-await-in-loop
    const entries = await list(folder.url, bestEffort ? report : undefined).catch((error) => {
      if (!bestEffort || folder.url === url || !isUnavailablePath(error)) throw error;
      report(error);
      return null;
    });
    const names = new Set();
    entries?.forEach((entry) => {
      if (!isPathSegment(entry.name) || names.has(entry.name)) {
        throw new Error(`Invalid or duplicate archive entry in ${folder.path}`);
      }
      names.add(entry.name);
      const path = `${folder.path}${entry.name}`;
      if (entry.type === 'folder') {
        folders.push({ url: entry.url, path: `${path}/` });
      } else {
        downloads.push({ url: entry.url, path });
      }
    });
    if (entries) directories.push(folder.path);
    progress(`Finding files... ${downloads.length} found.`);
  }
  if (!downloads.length && emptyMessage && !skipped.length) throw new Error(emptyMessage);

  return {
    filename: `${name}.zip`,
    paths: [...directories, ...downloads.map((entry) => entry.path)].sort(),
    fileCount: downloads.length,
    skipped,
    download: (onProgress) => createZip(directories, downloads, read, onProgress, concurrency),
  };
}
