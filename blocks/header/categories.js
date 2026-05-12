export function slugify(label) {
  return String(label)
    .toLowerCase()
    .replace(/&/g, ' ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function pathFromHref(href) {
  try {
    return new URL(href, 'https://tools.aem.live/').pathname;
  } catch {
    return href;
  }
}

export function parseCategories(html) {
  if (!html) return [];
  const doc = new window.DOMParser().parseFromString(html, 'text/html');
  const topUl = doc.querySelector('ul');
  if (!topUl) return [];

  const categories = [];
  [...topUl.children].forEach((li) => {
    const sub = li.querySelector(':scope > ul');
    if (!sub) return;
    const labelText = [...li.childNodes]
      .filter((n) => n.nodeType === 3 || (n.nodeType === 1 && n.tagName !== 'UL'))
      .map((n) => n.textContent)
      .join(' ')
      .trim();
    if (!labelText) return;
    const tools = [...sub.querySelectorAll('a[href]')].map((a) => ({
      url: pathFromHref(a.getAttribute('href')),
      label: a.textContent.trim(),
    }));
    categories.push({ slug: slugify(labelText), label: labelText, tools });
  });
  return categories;
}
