import { getMetadata } from '../../scripts/aem.js';
import { swapIcons } from '../../scripts/scripts.js';
import { loadFragment } from '../fragment/fragment.js';

/**
 * loads and decorates the footer
 * @param {Element} block The footer block element
 */
export default async function decorate(block) {
  // load footer as fragment
  const footerMeta = getMetadata('footer');
  const footerPath = footerMeta ? new URL(footerMeta, window.location).pathname : '/footer';
  const fragment = await loadFragment(footerPath);

  // decorate footer DOM
  block.textContent = '';
  const footer = document.createElement('section');
  footer.id = 'footer';
  while (fragment.firstElementChild) footer.append(fragment.firstElementChild);

  const classes = ['copyright', 'legal'];
  classes.forEach((c, i) => {
    const section = footer.children[i];
    if (section) {
      section.id = `footer-${c}`;
      section.classList.add(`footer-${c}`);
    }
  });

  block.append(footer);
  swapIcons(block);
}
