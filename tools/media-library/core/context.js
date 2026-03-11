/**
 * Shared context for media-library blocks (sidebar, topbar, grid).
 * Main media-library.js populates this; blocks consume it.
 */
let context = {};

export function setMediaLibraryContext(c) {
  context = { ...context, ...c };
}

export function getMediaLibraryContext() {
  return context;
}
