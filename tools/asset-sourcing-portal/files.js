import { assertValidRelativePath } from './policies.js';

export function normalizeClientPath(path) {
  const normalized = String(path).replace(/\\/g, '/');
  const withLeading = normalized.startsWith('/') ? normalized : `/${normalized}`;
  assertValidRelativePath(withLeading);
  return withLeading;
}

export function collectFilesFromFileList(fileList) {
  return Array.from(fileList).map((file) => ({
    file,
    relativePath: normalizeClientPath(file.webkitRelativePath || file.name),
  }));
}

function readDirectoryEntries(reader) {
  return new Promise((resolve, reject) => {
    const entries = [];
    const readBatch = () => {
      reader.readEntries((batch) => {
        if (!batch.length) resolve(entries);
        else {
          entries.push(...batch);
          readBatch();
        }
      }, reject);
    };
    readBatch();
  });
}

function fileFromEntry(entry) {
  return new Promise((resolve, reject) => {
    entry.file(resolve, reject);
  });
}

async function traverseEntry(entry, basePath) {
  if (entry.isFile) {
    const file = await fileFromEntry(entry);
    const rawPath = basePath ? `${basePath}/${entry.name}` : entry.name;
    return [{ file, relativePath: normalizeClientPath(rawPath) }];
  }
  if (!entry.isDirectory) return [];
  const directoryPath = basePath ? `${basePath}/${entry.name}` : entry.name;
  const children = await readDirectoryEntries(entry.createReader());
  const nested = await Promise.all(children.map((child) => traverseEntry(child, directoryPath)));
  return nested.flat();
}

export async function collectFilesFromDataTransfer(dataTransfer) {
  if (!dataTransfer.items?.length) return collectFilesFromFileList(dataTransfer.files);
  const entries = Array.from(dataTransfer.items)
    .filter((item) => item.kind === 'file')
    .map((item) => item.webkitGetAsEntry?.())
    .filter(Boolean);
  if (!entries.length) return collectFilesFromFileList(dataTransfer.files);
  const nested = await Promise.all(entries.map((entry) => traverseEntry(entry, '')));
  return nested.flat();
}

export async function readImageDimensions(file) {
  if (!file.type.toLowerCase().startsWith('image/')) return undefined;
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(file);
    const dimensions = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return dimensions;
  }

  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    const cleanup = () => URL.revokeObjectURL(objectUrl);
    image.onload = () => {
      cleanup();
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
    };
    image.onerror = () => {
      cleanup();
      reject(new Error('Could not read image dimensions'));
    };
    image.src = objectUrl;
  });
}
