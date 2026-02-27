import { LitElement, html } from 'lit';
import getSheet from '../../utils/sheet.js';

const sheet = await getSheet(new URL('./eds-button.css', import.meta.url).pathname);

export class EdsButton extends LitElement {
  static properties = {
    variant: { type: String },
    size: { type: String },
    disabled: { type: Boolean, reflect: true },
    quiet: { type: Boolean },
    treatment: { type: String },
    href: { type: String },
    target: { type: String },
    type: { type: String },
  };

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [sheet];
  }

  render() {
    const classes = [
      this.variant || '',
      this.size || 'm',
      this.quiet ? 'quiet' : '',
      this.treatment === 'outline' ? 'outline' : '',
    ].filter(Boolean).join(' ');

    if (this.href) {
      return html`
        <a href=${this.href} target=${this.target || ''} rel=${this.target === '_blank' ? 'noopener noreferrer' : ''}>
          <button class=${classes} ?disabled=${this.disabled} type="button">
            <slot name="icon"></slot>
            <slot></slot>
          </button>
        </a>`;
    }

    return html`
      <button class=${classes} ?disabled=${this.disabled} type=${this.type || 'button'}>
        <slot name="icon"></slot>
        <slot></slot>
      </button>`;
  }
}

customElements.define('eds-button', EdsButton);
