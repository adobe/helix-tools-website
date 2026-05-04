/* eslint-disable no-undef */
import { loadCSS } from '../../scripts/aem.js';

export function highlight(el) {
  const code = el.nodeName === 'CODE' ? el : el.querySelector('pre > code[class^="language"]');
  if (code) Prism.highlightElement(code);
}

export async function loadPrism(e) {
  const { default: Prism } = await import('../../vendor/prismjs/prismjs.js');
  window.Prism = Prism;
  loadCSS('/utils/prism/prism.css');
  if (e?.target) highlight(e.target);
}

export async function loadPrismLibrary(languages = []) {
  const { default: Prism } = await import('../../vendor/prismjs/prismjs.js');
  window.Prism = Prism;
  loadCSS('/utils/prism/prism.css');
  await Promise.all(languages.map((lang) => import(`../../vendor/prismjs/prism-${lang}.js`)));
}
