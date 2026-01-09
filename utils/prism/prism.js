/* eslint-disable no-undef */
import { loadScript, loadCSS } from '../../scripts/aem.js';

const PRISM_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0';

/**
 * Highlights <pre><code> element with Prism.js.
 * @param {HTMLElement} el - Element to search for <pre><code>.
 */
export function highlight(el) {
  const code = el.nodeName === 'CODE' ? el : el.querySelector('pre > code[class^="language"]');
  if (code) Prism.highlightElement(code);
}

/**
 * Loads Prism.js library and associated CSS for syntax highlighting.
 * @param {Event} e - Event object containing target element to highlight, if available.
 */
export function loadPrism(e) {
  loadScript(`${PRISM_CDN}/prism.min.js`).then(() => {
    loadCSS('../../utils/prism/prism.css');
    if (e.target) highlight(e.target);
  });
}

/**
 * Loads Prism.js core library and CSS with optional language components.
 * @param {string[]} [languages=[]] - Optional language components to load (e.g., ['json'])
 * @returns {Promise<void>}
 */
export async function loadPrismLibrary(languages = []) {
  // loadScript already handles deduplication via DOM check
  await loadScript(`${PRISM_CDN}/prism.min.js`);
  loadCSS('/utils/prism/prism.css');

  // Load any requested language components in parallel
  await Promise.all(
    languages.map((lang) => loadScript(`${PRISM_CDN}/components/prism-${lang}.min.js`)),
  );
}
