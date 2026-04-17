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

export function deriveRedirectOriginalFilename(initialUrl, finalUrl) {
  if (!extractMediaHash(finalUrl)) {
    return '';
  }

  const initialPathname = deriveOriginalFilename(initialUrl);
  const finalPathname = deriveOriginalFilename(finalUrl);
  if (!initialPathname || initialPathname === finalPathname) {
    return '';
  }

  return initialPathname;
}

export function discardBrokenMediaEntries(entries, brokenMediaIdentities = new Set()) {
  if (!brokenMediaIdentities?.size) {
    return {
      entries,
      discardedEntryCount: 0,
      discardedMediaCount: 0,
    };
  }

  const discardedMedia = new Set();
  const filteredEntries = entries.filter(({ entry }) => {
    const mediaIdentity = getMediaIdentity(entry?.path || '');
    if (!mediaIdentity || !brokenMediaIdentities.has(mediaIdentity)) {
      return true;
    }

    discardedMedia.add(mediaIdentity);
    return false;
  });

  return {
    entries: filteredEntries,
    discardedEntryCount: entries.length - filteredEntries.length,
    discardedMediaCount: discardedMedia.size,
  };
}

export function summarizeMediaEntries(entries) {
  return {
    media: entries.length,
    dupes: entries.filter(({ entry }) => entry?.operation === 'reuse').length,
  };
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
