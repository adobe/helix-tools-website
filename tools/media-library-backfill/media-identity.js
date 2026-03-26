export function getPathnameFromMediaRef(pathOrUrl) {
  if (!pathOrUrl || typeof pathOrUrl !== 'string') return '';
  try {
    return new URL(pathOrUrl).pathname || '';
  } catch {
    return pathOrUrl.split(/[?#]/, 1)[0];
  }
}

export function extractMediaHash(pathOrUrl) {
  const pathname = getPathnameFromMediaRef(pathOrUrl);
  const match = pathname.match(/\/media_([0-9a-f]+)\.[a-z0-9]+$/i);
  return match?.[1]?.toLowerCase() || '';
}

export function canonicalizeHashedMediaUrl(pathOrUrl) {
  if (!pathOrUrl || typeof pathOrUrl !== 'string') {
    return '';
  }

  const pathname = getPathnameFromMediaRef(pathOrUrl);
  if (!pathname || !extractMediaHash(pathOrUrl)) {
    return pathOrUrl;
  }

  try {
    const url = new URL(pathOrUrl);
    return `${url.origin}${pathname}`;
  } catch {
    return pathname;
  }
}

export function getMediaIdentity(pathOrUrl) {
  const mediaHash = extractMediaHash(pathOrUrl);
  return mediaHash ? `mediaHash:${mediaHash}` : pathOrUrl;
}

export function deriveOriginalFilename(pathOrUrl) {
  const pathname = getPathnameFromMediaRef(pathOrUrl);
  return pathname || pathOrUrl;
}

export function dedupeMediaUrls(urls) {
  const seenMedia = new Set();

  return urls.filter((url) => {
    const identity = getMediaIdentity(url);
    if (!identity || seenMedia.has(identity)) {
      return false;
    }
    seenMedia.add(identity);
    return true;
  });
}
