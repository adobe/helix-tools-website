import { LitElement, html } from 'lit';
import { edsIcon } from '../../utils/icons.js';
import getSheet from '../../utils/sheet.js';

const sheet = await getSheet(new URL('./eds-toast.css', import.meta.url).pathname);

export class EdsToast extends LitElement {
  static properties = {
    variant: { type: String },
    open: { type: Boolean, reflect: true },
  };

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [sheet];
  }

  _close() {
    this.open = false;
    this.dispatchEvent(new Event('close', { bubbles: true, composed: true }));
  }

  render() {
    return html`
      <div class="toast ${this.variant || 'info'}" role="status">
        <span class="toast-message"><slot></slot></span>
        <button class="toast-close" @click=${this._close} aria-label="Close">${edsIcon('close', { size: 16 })}</button>
      </div>`;
  }
}

customElements.define('eds-toast', EdsToast);
