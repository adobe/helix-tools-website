import { getHelix6, projectRoot } from '../../utils/helix6-download.js';
import { isPathSegment, planZip } from '../../utils/zip-download.js';

function isSourceSegment(name) {
  return isPathSegment(name) && !name.startsWith('.versions');
}

function getSource(url, signal) {
  return getHelix6(url, 'Source', {
    403: 'You do not have permission to read source content for this site.',
    404: 'Source content was not found. Check the organization, site, and source path.',
  }, signal);
}

async function listSourceFolder(url) {
  const response = await getSource(url);
  const listing = await response.json();
  if (!Array.isArray(listing)) throw new Error('The Source API did not return a folder listing.');
  return listing.map((entry) => {
    const folder = entry?.['content-type'] === 'application/folder';
    const raw = entry?.name;
    if (typeof raw !== 'string' || raw.endsWith('/') !== folder) {
      throw new Error('The Source API returned an invalid folder entry.');
    }
    const name = folder ? raw.slice(0, -1) : raw;
    if (!isSourceSegment(name)) throw new Error('The Source API returned an invalid entry name.');
    return {
      name,
      url: `${url}${encodeURIComponent(name)}${folder ? '/' : ''}`,
      type: folder ? 'folder' : 'file',
    };
  });
}

export function isSourceFolder(input) {
  const path = input.trim();
  return !path || path.endsWith('/');
}

export function planSourceDownload(org, site, input, progress) {
  const project = projectRoot(org, site, 'sites');
  const path = input.trim().replace(/^\//, '');
  const folder = isSourceFolder(input);
  const parts = path ? (folder ? path.slice(0, -1) : path).split('/') : [];
  if (!parts.every(isSourceSegment)) {
    throw new Error('Enter a source file or folder path, without dot segments or version paths.');
  }
  const name = parts.at(-1);
  const url = `${project}source/${parts.map(encodeURIComponent).join('/')}${parts.length && folder ? '/' : ''}`;
  if (!folder) {
    return {
      filename: name,
      async download(onProgress) {
        onProgress(`Downloading ${name}...`);
        const response = await getSource(url);
        return response.blob();
      },
    };
  }

  return planZip({
    url,
    name: `${org}-${site}-${name || 'source'}`,
    list: listSourceFolder,
    bestEffort: true,
    async read(file, signal) {
      const response = await getSource(file, signal);
      return new Uint8Array(await response.arrayBuffer());
    },
    progress,
  });
}
