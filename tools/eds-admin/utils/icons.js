import { html, nothing } from 'lit';

const ICON_BASE = new URL('../assets/icons/', import.meta.url).pathname;

export function edsIcon(name, { size = 18, cls = '', label = '' } = {}) {
  const style = `display:inline-flex;width:${size}px;height:${size}px;background:currentColor;-webkit-mask:url(${ICON_BASE}${name}.svg) center/contain no-repeat;mask:url(${ICON_BASE}${name}.svg) center/contain no-repeat;`;
  return html`<span
    class="eds-icon ${cls}"
    style=${style}
    aria-hidden=${label ? 'false' : 'true'}
    aria-label=${label || nothing}
  ></span>`;
}
