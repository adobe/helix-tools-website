/**
 * Adapted from the Prism.js Line Highlight Plugin
 * https://prismjs.com/plugins/line-highlight/
 *
 * Prism.js is an open-source project licensed under the MIT License.
 * https://github.com/PrismJS/prism/blob/master/LICENSE
 */

/* eslint-disable no-unused-expressions, func-names */
!(function () {
  /**
   * Returns array of all elements with given CSS selector in specified context.
   * @param {string} selector - CSS selector string
   * @param {HTMLElement|Document} - Context to search for selector (defaults to `document`)
   * @returns {HTMLElement[]} Array of matched elements
   */
  function selectElements(selector, context = document) {
    return [...context.querySelectorAll(selector)];
  }

  /**
   * Checks if an element contains specified class name.
   * @param {HTMLElement} element - Element to check
   * @param {string} className - Class name to look for
   * @returns {boolean} `true` if element has specified class, otherwise `false`
   */
  function hasClass(element, className) {
    const formattedClass = ` ${className} `;
    const elementClass = ` ${element.className} `.replace(/[\n\t]/g, ' ');
    return elementClass.includes(formattedClass);
  }

  /**
   * Highlights specific lines of code within an element by creating and positioning div elements.
   * @param {HTMLElement} element - Element containing lines to highlight
   * @param {string} lineNumbers - String of line numbers or ranges to highlight (e.g., "1,2-4")
   * @param {string} - Optional additional class to apply to each highlight element
   */
  function highlightLines(element, lineNumbers, additionalClass = '') {
    // normalize and split line numbers string ("1,2-4" becomes ["1", "2-4"])
    const linesArray = lineNumbers.replace(/\s+/g, '').split(',');

    // get data-line-offset (default to 0)
    const lineOffset = parseInt(element.dataset.lineOffset, 10) || 0;

    // calculate line height from computed style
    const lineHeight = parseFloat(getComputedStyle(element).lineHeight, 10);

    linesArray.forEach((lineRange) => {
      const [startLine, endLine] = lineRange.split('-').map((l) => parseInt(l, 10));
      const end = endLine || startLine; // if endLine is undefined, it's a single line

      // create line highlight
      const highlight = document.createElement('div');
      highlight.textContent = Array(end - startLine + 2).join(' \r\n');
      highlight.className = 'line-highlight';
      if (additionalClass) highlight.classList.add(additionalClass);

      // add data attributes
      const { error } = element.dataset;
      if (error) {
        // highlight.dataset.error = error;
        // highlight.classList.add('error-hover');
      }
      if (!hasClass(element, 'line-numbers')) {
        highlight.dataset.start = startLine;
        if (end > startLine) highlight.dataset.end = end;
      }

      // set position of highlight based on line number and offset
      highlight.style.top = `${(startLine - lineOffset - 1) * lineHeight}px`;

      // append highlight to element, or to <code> element if present
      const parentElement = hasClass(element, 'line-numbers') ? element : (element.querySelector('code') || element);
      parentElement.appendChild(highlight);
    });
  }

  // updates highlights based on URL hash
  function updateHighlights() {
    // get hash of URL
    const hash = window.location.hash.slice(1);

    // remove all existing temporary line highlights
    selectElements('.temporary.line-highlight').forEach((temp) => {
      temp.parentNode.removeChild(temp);
    });

    // extract line numbers from hash if present
    // eslint-disable-next-line no-sparse-arrays
    const match = (hash.match(/\.([\d,-]+)$/) || [, ''])[1];

    // if line numbers exist and element does NOT already have highlights
    if (match && !document.getElementById(hash)) {
      const id = hash.slice(0, hash.lastIndexOf('.'));
      const target = document.getElementById(id);

      if (target) {
        if (!target.hasAttribute('data-line')) {
          target.dataset.line = '';
        }

        // add temporary line highlights and scroll them into view
        highlightLines(target, match, 'temporary');
        document.querySelector('.temporary.line-highlight').scrollIntoView();
      }
    }
  }

  if (window.Prism) {
    let timeoutId = 0;

    // hook into Prism's "after-highlight" event
    // eslint-disable-next-line no-undef
    Prism.hooks.add('after-highlight', (env) => {
      const parentElement = env.element.parentNode;
      const lineData = parentElement && parentElement.getAttribute('data-line');

      if (parentElement && lineData && /pre/i.test(parentElement.nodeName)) {
        // clear existing highlights
        clearTimeout(timeoutId);
        selectElements('.line-highlight', parentElement).forEach((highlight) => {
          highlight.parentNode.removeChild(highlight);
        });

        // add highlights
        highlightLines(parentElement, lineData);

        // schedule update to highlights from hash
        timeoutId = setTimeout(updateHighlights, 1);
      }
    });

    // listen for URL hash changes to update highlights
    // eslint-disable-next-line no-restricted-globals
    addEventListener('hashchange', updateHighlights);
  }
}());
