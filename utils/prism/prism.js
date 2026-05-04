/* eslint-disable no-undef */
import { loadCSS } from '../../scripts/aem.js';

const LANG_LOADERS = {
  json: () => import('../../vendor/prismjs/prism-json.js'),
  markup: () => import('../../vendor/prismjs/prism-markup.js'),
  'markup-templating': () => import('../../vendor/prismjs/prism-markup-templating.js'),
  handlebars: () => import('../../vendor/prismjs/prism-handlebars.js'),
};

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

/**
 * Loads Prism.js core and the requested language components.
 * Pages that load language components must include the prismjs import map.
 * @param {string[]} languages - Language component names to load (e.g. ['json', 'markup']).
 */
export async function loadPrismLibrary(languages = []) {
  await getPrism();
  await Promise.all(languages.map((lang) => LANG_LOADERS[lang]?.()));
}
