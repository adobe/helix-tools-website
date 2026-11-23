/**
 * Site Query's sitemap and path filter fields take a path on the site
 * (`/sitemap.xml`), not a full URL. Pasting a full URL in the sitemap field
 * makes the tool request `https://{live host}https://...`, which fails with a
 * misleading CORS error; in the path filter it matches no page.
 * These helpers spot a full URL and offer to cut it down to its path.
 */

/**
 * Returns the path to suggest when a field holds a full URL.
 *
 * @param {string} value the field value
 * @param {{ allowRoot?: boolean }} [options] whether `/` is a useful suggestion
 * @returns {string|null} the URL's path, or null if the value is not a full URL
 *  or its path is `/` and `allowRoot` is false
 */
export function suggestPath(value, { allowRoot = true } = {}) {
  const trimmed = (value || '').trim();
  // http(s) URLs and protocol-relative URLs; anything else is treated as a path
  if (!/^(https?:)?\/\/[^/]/i.test(trimmed)) return null;

  let url;
  try {
    url = new URL(trimmed, 'https://placeholder.invalid');
  } catch {
    return null;
  }

  const { pathname } = url;
  if (pathname === '/' && !allowRoot) return null;
  return pathname;
}

/**
 * Watches a path field and offers to cut a full URL down to its path.
 * While the field holds a full URL it is invalid, so the form does not submit.
 *
 * @param {HTMLInputElement} input the field
 * @param {{ allowRoot?: boolean }} [options] passed to {@link suggestPath}
 */
export function offerPathOnly(input, options = {}) {
  const notice = document.createElement('div');
  notice.className = 'path-suggestion';
  notice.id = `${input.id}-path-suggestion`;
  notice.setAttribute('role', 'status');
  notice.hidden = true;

  const text = document.createElement('p');
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'button outline';
  notice.append(text, button);

  const field = input.closest('.form-field') || input.parentElement;
  field.append(notice);
  input.setAttribute('aria-describedby', [input.getAttribute('aria-describedby'), notice.id]
    .filter(Boolean).join(' '));

  const check = () => {
    const value = input.value.trim();
    const isUrl = /^(https?:)?\/\//i.test(value);
    if (!isUrl) {
      notice.hidden = true;
      input.setCustomValidity('');
      return;
    }

    const path = suggestPath(value, options);
    text.textContent = 'This field takes a path on your site, not a full URL.';
    button.hidden = !path;
    if (path) {
      button.textContent = `Use ${path}`;
      button.dataset.path = path;
    }
    notice.hidden = false;
    input.setCustomValidity(path
      ? `Enter a path on your site, such as ${path}, not a full URL.`
      : 'Enter a path on your site, not a full URL.');
  };

  button.addEventListener('click', () => {
    input.value = button.dataset.path;
    check();
    input.focus();
  });
  input.addEventListener('input', check);
  input.form?.addEventListener('reset', () => {
    // reset runs before field values clear; check once they have
    setTimeout(check);
  });
  check();
}
