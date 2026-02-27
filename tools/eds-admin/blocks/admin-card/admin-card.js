import { LitElement, html, nothing } from 'lit';
import getSheet from '../../utils/sheet.js';

const sheet = await getSheet(new URL('./admin-card.css', import.meta.url).pathname);

export class AdminCard extends LitElement {
  static properties = {
    heading: { type: String },
    subheading: { type: String },
    horizontal: { type: Boolean, reflect: true },
    loading: { type: Boolean, reflect: true },
  };

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [sheet];
  }

  _onSlotChange(e) {
    const hasContent = e.target.assignedElements().length > 0;
    e.target.parentElement.classList.toggle('has-content', hasContent);
  }

  render() {
    if (this.loading) return nothing;
    return html`
      <div class="header">
        <div class="heading-group">
          ${this.heading
            ? html`<h3>${this.heading}</h3>`
            : html`<slot name="heading"></slot>`}
          ${this.subheading
            ? html`<span class="subheading">${this.subheading}</span>`
            : html`<slot name="subheading"></slot>`}
        </div>
        <slot name="actions"></slot>
      </div>
      <div class="body">
        <slot @slotchange=${this._onSlotChange}></slot>
      </div>
      <div class="footer">
        <slot name="footer" @slotchange=${this._onSlotChange}></slot>
      </div>
    `;
  }
}

customElements.define('admin-card', AdminCard);
