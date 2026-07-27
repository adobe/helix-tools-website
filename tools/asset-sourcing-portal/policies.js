const JCR_ILLEGAL_CHARS = /[[\]{}&:\\?#|*%<>"+]+/g;

export const DEFAULT_UPLOAD_LIMITS = {
  maxFileBytes: 500 * 1024 * 1024,
  maxBatch: 1000,
};

export function assertValidRelativePath(path) {
  if (typeof path !== 'string' || !path.trim()) throw new Error('Path is required');
  const normalized = path.replace(/\\/g, '/');
  if (!normalized.startsWith('/')) throw new Error('Path must start with /');
  normalized.split('/').forEach((segment) => {
    if (segment === '.' || segment === '..') throw new Error('Path must not contain . or ..');
  });
}

export function stripValidRelativePath(path) {
  assertValidRelativePath(path);
  return path.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
}

function sanitizeJcrPath(path) {
  return path.split('/').map((segment) => (
    segment ? segment.replace(JCR_ILLEGAL_CHARS, '_') : segment
  )).join('/');
}

function joinPathSegments(...segments) {
  const joined = segments.flatMap((segment) => (
    segment ? segment.split('/').filter(Boolean) : []
  )).join('/');
  if (!joined) throw new Error('Invalid file path');
  return joined;
}

export function vendorUploadPathEnabled(policy) {
  return (policy?.mode || 'preserve') === 'preserve' && policy?.vendorPath?.enabled === true;
}

export function resolveUploadRelativePath(policy, clientRelativePath, vendorPathPrefix) {
  const mode = policy?.mode || 'preserve';
  let relative = stripValidRelativePath(clientRelativePath);

  if (mode === 'preserve' && policy?.vendorPath?.enabled && vendorPathPrefix?.trim()) {
    const prefix = stripValidRelativePath(vendorPathPrefix);
    relative = prefix ? joinPathSegments(prefix, relative) : relative;
  } else if (mode === 'flatten') {
    const basename = relative.split('/').pop();
    if (!basename) throw new Error('Invalid file path');
    relative = basename;
  } else if (mode === 'fixed') {
    relative = policy?.subPath ? joinPathSegments(policy.subPath, relative) : relative;
  } else if (mode !== 'preserve') {
    throw new Error('Unsupported upload path policy.');
  }
  return sanitizeJcrPath(relative);
}

export function flattenPathCollisions(policy, clientPaths, vendorPathPrefix) {
  if ((policy?.mode || 'preserve') !== 'flatten') return undefined;
  const seen = new Map();
  let collision;
  clientPaths.some((clientPath) => {
    const resolved = resolveUploadRelativePath(policy, clientPath, vendorPathPrefix);
    const prior = seen.get(resolved);
    if (prior) {
      collision = `Multiple files would upload as "${resolved}" (${prior} and ${clientPath}). Rename one or use preserve mode.`;
      return true;
    }
    seen.set(resolved, clientPath);
    return false;
  });
  return collision;
}

function normalizedExtensions(extensions) {
  if (!Array.isArray(extensions)) return [];
  return [...new Set(extensions.map((entry) => (
    typeof entry === 'string' ? entry.trim().toLowerCase().replace(/^\./, '') : ''
  )).filter(Boolean))];
}

export function checkFileExtension(policy, filePath) {
  if (!policy) return undefined;
  const basename = filePath.split('/').pop() || filePath;
  const dot = basename.lastIndexOf('.');
  const extension = dot > 0 && dot < basename.length - 1
    ? basename.slice(dot + 1).toLowerCase() : null;
  const allow = normalizedExtensions(policy.allow);
  const deny = normalizedExtensions(policy.deny);

  if (allow.length && (!extension || !allow.includes(extension))) {
    const allowed = allow.map((entry) => `.${entry}`).join(', ');
    return extension
      ? `File type .${extension} is not allowed. Allowed types: ${allowed}.`
      : `Files must have an allowed extension: ${allowed}.`;
  }
  if (deny.length && extension && deny.includes(extension)) {
    return `File type .${extension} is not allowed.`;
  }
  return undefined;
}

export function uploadPathPolicyHint(policy) {
  const mode = policy?.mode || 'preserve';
  if (mode === 'flatten') {
    return 'Files land directly in the destination folder (folder names from your computer are not kept)';
  }
  if (mode === 'fixed' && policy?.subPath) {
    return `All files go under a fixed sub-folder (${policy.subPath}/)`;
  }
  if (mode === 'preserve' && policy?.vendorPath?.enabled) {
    const label = policy.vendorPath.label || 'Upload path';
    return `Your folder structure is kept under the destination folder — set ${label} for this batch`;
  }
  return mode === 'preserve'
    ? 'Your folder structure is kept under the destination folder'
    : undefined;
}

export function validateImageDimensions(policy, mimeType, width, height) {
  if (!policy || !String(mimeType || '').toLowerCase().startsWith('image/')) return;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    throw new Error('Invalid image dimensions');
  }
  if (policy.minDimensionPx !== undefined && Math.min(width, height) < policy.minDimensionPx) {
    throw new Error(`Image must be at least ${policy.minDimensionPx}px on the shortest side (got ${width}×${height})`);
  }
  if (policy.minWidthPx !== undefined && width < policy.minWidthPx) {
    throw new Error(`Image width must be at least ${policy.minWidthPx}px (got ${width})`);
  }
  if (policy.minHeightPx !== undefined && height < policy.minHeightPx) {
    throw new Error(`Image height must be at least ${policy.minHeightPx}px (got ${height})`);
  }
}

export function validateUploadPath(path, policy) {
  if (!vendorUploadPathEnabled(policy)) return undefined;
  const label = policy?.vendorPath?.label || 'Upload path';
  const value = path.trim() || '/';
  try {
    assertValidRelativePath(value);
  } catch (error) {
    return error instanceof Error ? error.message : 'Invalid upload path';
  }
  if (policy?.vendorPath?.required && !stripValidRelativePath(value)) {
    return `${label} is required before uploading.`;
  }
  return undefined;
}
