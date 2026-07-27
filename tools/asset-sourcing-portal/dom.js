/**
 * Creates an element without parsing HTML. Text and attributes are assigned through DOM APIs.
 * @param {string} tag
 * @param {{ className?: string, text?: string, attrs?: Record<string, string> }} options
 * @param {...Node} children
 */
export function createElement(tag, options = {}, ...children) {
  const element = document.createElement(tag);
  if (options.className) element.className = options.className;
  if (options.text !== undefined) element.textContent = options.text;
  Object.entries(options.attrs || {}).forEach(([name, value]) => {
    element.setAttribute(name, value);
  });
  element.append(...children);
  return element;
}

export function replaceContent(container, ...children) {
  container.replaceChildren(...children);
}

export function setMessage(element, message, kind = '') {
  element.textContent = message || '';
  element.className = ['portal-message', kind].filter(Boolean).join(' ');
  element.hidden = !message;
}
