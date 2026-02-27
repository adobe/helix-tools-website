import { LitElement, html, nothing } from 'lit';
import getSheet from '../../utils/sheet.js';

const sheet = await getSheet(new URL('./eds-menu.css', import.meta.url).pathname);

const CHEVRON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M5 7.4 1 3.4l.7-.7L5 6 8.3 2.7l.7.7Z"/></svg>';

export class EdsMenu extends LitElement {
  static properties = {
    label: { type: String },
    quiet: { type: Boolean },
    placement: { type: String },
    _open: { state: true },
  };

  constructor() {
    super();
    this._open = false;
  }

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [sheet];
  }

  _toggle(e) {
    e.stopPropagation();
    this._open = !this._open;
  }

  _close() {
    this._open = false;
  }

  _onSlotClick(e) {
    const item = e.target.closest('button, [role="menuitem"]');
    if (!item) return;
    const value = item.dataset.value || item.getAttribute('value');
    if (value) {
      this.dispatchEvent(new CustomEvent('change', { detail: { value }, bubbles: true, composed: true }));
    }
    this._close();
  }

  render() {
    return html`
      <button class="trigger" @click=${this._toggle} aria-label=${this.label || 'Menu'}>
        <slot name="trigger">
          <span>${this.label || '⋯'}</span>
          <span .innerHTML=${CHEVRON}></span>
        </slot>
      </button>
      ${this._open ? html`
        <div class="backdrop" @click=${this._close}></div>
        <div class="menu" role="menu" @click=${this._onSlotClick}>
          <slot></slot>
        </div>
      ` : nothing}`;
  }
}

customElements.define('eds-menu', EdsMenu);
