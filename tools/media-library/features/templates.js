import { getFileName } from '../core/files.js';

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

export function getMediaName(media) {
  const fromName = media?.name;
  if (fromName) return fromName;
  const fromUrl = media?.url ? getFileName(media.url) : '';
  if (fromUrl) return fromUrl;
  const fromPath = media?.url?.split('/').pop();
  if (fromPath) return fromPath;
  return 'Unknown';
}

export function createMediaEventHandlers(callbacks) {
  return {
    handleMediaClick: (media) => callbacks?.onMediaClick?.(media),
    handleMediaCopy: (media) => callbacks?.onMediaCopy?.(media),
  };
}

export function createUnknownPlaceholder(media) {
  const div = document.createElement('div');
  div.className = 'unknown-placeholder';
  const rawLabel = media ? getMediaName(media) : 'Unknown';
  const label = escapeHtml(rawLabel);
  div.innerHTML = `
    <svg class="unknown-icon" viewBox="0 0 20 20">
      <circle cx="10" cy="10" r="8" stroke="currentColor" stroke-width="2" fill="none"/>
    </svg>
    <span class="placeholder-label">${label}</span>
  `;
  return div;
}
