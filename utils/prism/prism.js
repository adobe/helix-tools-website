/* eslint-disable no-undef */
import { loadCSS } from '../../scripts/aem.js';

let prismPromise;

function getPrism() {
  if (!prismPromise) {
    prismPromise = import('../../vendor/prismjs/prismjs.js').then(({ default: Prism }) => {
      window.Prism = Prism;
      loadCSS('/utils/prism/prism.css');
      return Prism;
    });
  }
  return prismPromise;
}

/**
 * Highlights <pre><code> element with Prism.js.
 * @param {HTMLElement} el - Element to search for <pre><code>.
 */
export function highlight(el) {
  const code = el.nodeName === 'CODE' ? el : el.querySelector('pre > code[class^="language"]');
  if (code && window.Prism) window.Prism.highlightElement(code);
}

/**
 * Loads Prism.js and highlights event target if available.
 * @param {Event} e - Event object whose target to highlight after load.
 */
export async function loadPrism(e) {
  await getPrism();
  if (e && e.target) highlight(e.target);
}

export async function loadPrismLibrary() {
  await getPrism();
}
