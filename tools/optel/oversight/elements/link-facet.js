import escapeHTML from '../../../../utils/html.js';
import ListFacet from './list-facet.js';

function urlDecode(part, rich = false) {
  if (!part) return '/';
  // replace %3C(number|hex|base64|uuid)%3E with <...> (ignore case for the url encoding)

  return rich
    ? part.replace(/%3C(number|hex|base64|uuid)%3E/gi, '<span class="withheld">$1</span>')
    : part.replace(/%3[Cc](number|hex|base64|uuid)%3[Ee]/g, '<$1>');
}

export function labelURLParts(url, prefix, solo = false) {
  if (prefix && url.startsWith(prefix) && !solo) {
    return `<span class="collapse" title="${escapeHTML(url)}">${escapeHTML(prefix)}</span><span class="suffix" title="${escapeHTML(urlDecode(url))}">${urlDecode(escapeHTML(url.replace(prefix, '')), true)}</span>`;
  }
  try {
    const u = new URL(url);
    return ['protocol', 'hostname', 'port', 'pathname', 'search', 'hash']
      .map((part) => ({ part, value: u[part], full: u.href }))
      .reduce(
        (acc, { part, value, full }) => `${acc}<span class="${part}" title="${escapeHTML(full)}">${escapeHTML(value)}</span>`,
        '',
      );
  } catch {
    return escapeHTML(url);
  }
}

export function isThumbnailUrl(labelText) {
  return labelText.startsWith('http://')
    || labelText.startsWith('https://')
    || labelText.startsWith('android-app://');
}

export function is404CheckpointActive(location = typeof window !== 'undefined' ? window.location : null) {
  if (!location?.href) return false;
  return new URL(location.href).searchParams.getAll('checkpoint').includes('404');
}

export function getOgImageUrl(labelText) {
  const u = new URL('https://www.aem.live/tools/rum/_ogimage');
  u.searchParams.set('proxyurl', labelText);
  return u.href;
}

export function getFaviconUrl(labelText) {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(labelText)}&sz=256`;
}

export function appendThumbnail(container, labelText, { favicon = false, ImageCtor = Image } = {}) {
  const ogUrl = getOgImageUrl(labelText);
  const probe = new ImageCtor();
  probe.onload = () => {
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.src = ogUrl;
    img.title = labelText;
    img.alt = '';
    container.prepend(img);
  };
  probe.onerror = () => {
    if (!favicon) return;
    const favUrl = getFaviconUrl(labelText);
    const favProbe = new ImageCtor();
    favProbe.onload = () => {
      const img = document.createElement('img');
      img.loading = 'lazy';
      img.src = favUrl;
      img.title = labelText;
      img.alt = '';
      img.classList.add('favicon');
      container.prepend(img);
    };
    favProbe.src = favUrl;
  };
  probe.src = ogUrl;
}

/**
 * A custom HTML element to display a list of facets with links.
 * <link-facet facet="userAgent" drilldown="share.html" mode="all">
 *   <legend>Referrer</legend>
 * </link-facet>
 */
export default class LinkFacet extends ListFacet {
  createValueSpan(entry, prefix, solo = false) {
    const valuespan = super.createValueSpan(entry, prefix, solo);
    this.maybeLoadThumbnail(valuespan, entry.value);
    return valuespan;
  }

  maybeLoadThumbnail(container, labelText) {
    if (this.getAttribute('thumbnail') !== 'true') return;
    if (is404CheckpointActive()) return;
    if (!isThumbnailUrl(labelText)) return;
    appendThumbnail(container, labelText, {
      favicon: this.getAttribute('favicon') === 'true',
    });
  }

  // eslint-disable-next-line class-methods-use-this
  createLabelHTML(labelText, prefix, solo = false) {
    const thumbnailAtt = this.getAttribute('thumbnail') === 'true';
    const isCensored = labelText.includes('...')
      || labelText.includes('<number>') || labelText.includes('%3Cnumber%3E')
      || labelText.includes('<hex>') || labelText.includes('%3Chex%3E')
      || labelText.includes('<base64>') || labelText.includes('%3Cbase64%3E')
      || labelText.includes('<uuid>') || labelText.includes('%3Cuuid%3E');
    if (isCensored) {
      return labelURLParts(labelText, prefix, solo);
    }
    if (thumbnailAtt && isThumbnailUrl(labelText)) {
      return `<a href="${escapeHTML(labelText)}" target="_new">${labelURLParts(labelText, prefix, solo)}</a>`;
    }
    if (labelText.startsWith('https://') || labelText.startsWith('http://')) {
      return `<a href="${escapeHTML(labelText)}" target="_new">${labelURLParts(labelText, prefix, solo)}</a>`;
    }
    if (labelText.startsWith('referrer:')) {
      return `<a href="${escapeHTML(labelText.replace('referrer:', 'https://'))}" target="_new">${escapeHTML(labelText.replace('referrer:', ''))}</a>`;
    }
    if (labelText.startsWith('navigate:')) {
      const domain = new URL(window.location.href).searchParams.get('domain');
      return `navigate from <a href="${escapeHTML(labelText.replace('navigate:', `https://${domain}`))}" target="_new">${escapeHTML(labelText.replace('navigate:', ''))}</a>`;
    }
    if (this.placeholders && this.placeholders[labelText]) {
      return (`${escapeHTML(this.placeholders[labelText])} [${escapeHTML(labelText)}]`);
    }
    return escapeHTML(labelText);
  }
}
