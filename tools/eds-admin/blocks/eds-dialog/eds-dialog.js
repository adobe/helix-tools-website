import { LitElement, html, nothing } from 'lit';
import { edsIcon } from '../../utils/icons.js';
import getSheet from '../../utils/sheet.js';

const sheet = await getSheet(new URL('./eds-dialog.css', import.meta.url).pathname);

export class EdsDialog extends LitElement {
  static properties = {
    open: { type: Boolean, reflect: true },
    headline: { type: String },
    size: { type: String },
    dismissable: { type: Boolean },
    underlay: { type: Boolean },
  };

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [sheet];
  }

  _close() {
    this.dispatchEvent(new Event('close', { bubbles: true, composed: true }));
  }

  _onOverlayClick(e) {
    if (e.target === e.currentTarget) this._close();
  }

  _onKeyDown(e) {
    if (e.key === 'Escape') this._close();
  }

  render() {
    if (!this.open) return nothing;

    return html`
      <div class="overlay" @click=${this._onOverlayClick} @keydown=${this._onKeyDown}>
        <dialog class=${this.size || 'm'} open>
          <div class="dialog-header">
            <h2>${this.headline || ''}</h2>
            <button class="close-btn" @click=${this._close} aria-label="Close">${edsIcon('close', { size: 18 })}</button>
          </div>
          <div class="dialog-body">
            <slot></slot>
          </div>
        </dialog>
      </div>`;
  }
}

customElements.define('eds-dialog', EdsDialog);
