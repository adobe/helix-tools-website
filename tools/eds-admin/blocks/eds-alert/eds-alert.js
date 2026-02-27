import { LitElement, html, nothing } from 'lit';
import getSheet from '../../utils/sheet.js';

const sheet = await getSheet(new URL('./eds-alert.css', import.meta.url).pathname);

export class EdsAlert extends LitElement {
  static properties = {
    variant: { type: String },
    open: { type: Boolean },
  };

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [sheet];
  }

  render() {
    if (this.open === false) return nothing;

    return html`
      <div class="alert ${this.variant || 'info'}" role="alert">
        <slot></slot>
      </div>`;
  }
}

customElements.define('eds-alert', EdsAlert);
