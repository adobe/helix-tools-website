/* eslint-disable no-undef */
import { loadScript, loadCSS } from '../../scripts/aem.js';

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
  loadScript('https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/prism.min.js').then(() => {
    loadCSS('../../utils/prism/prism.css');
    if (e.target) highlight(e.target);
  });
}
