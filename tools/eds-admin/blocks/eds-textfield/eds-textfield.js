import { LitElement, html, nothing } from 'lit';
import getSheet from '../../utils/sheet.js';

const sheet = await getSheet(new URL('./eds-textfield.css', import.meta.url).pathname);

export class EdsTextfield extends LitElement {
  static properties = {
    label: { type: String },
    placeholder: { type: String },
    value: { type: String },
    type: { type: String },
    multiline: { type: Boolean },
    rows: { type: Number },
    size: { type: String },
    required: { type: Boolean },
    invalid: { type: Boolean },
    disabled: { type: Boolean },
  };

  constructor() {
    super();
    this.value = '';
  }

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [sheet];
  }

  _onInput(e) {
    this.value = e.target.value;
    this.dispatchEvent(new CustomEvent('input', { detail: { value: this.value }, bubbles: true, composed: true }));
  }

  _onKeydown(e) {
    this.dispatchEvent(new KeyboardEvent('keydown', { key: e.key, bubbles: true, composed: true }));
  }

  get inputElement() {
    return this.shadowRoot?.querySelector('input, textarea');
  }

  render() {
    const cls = [this.size || '', this.invalid ? 'invalid' : ''].filter(Boolean).join(' ');

    return html`
      <div class="field">
        ${this.label ? html`<label>${this.label}</label>` : nothing}
        ${this.multiline
          ? html`<textarea
              class=${cls}
              placeholder=${this.placeholder || ''}
              .value=${this.value || ''}
              rows=${this.rows || 3}
              ?required=${this.required}
              ?disabled=${this.disabled}
              @input=${this._onInput}
              @keydown=${this._onKeydown}
            ></textarea>`
          : html`<input
              class=${cls}
              type=${this.type || 'text'}
              placeholder=${this.placeholder || ''}
              .value=${this.value || ''}
              ?required=${this.required}
              ?disabled=${this.disabled}
              @input=${this._onInput}
              @keydown=${this._onKeydown}
            />`}
        <slot name="help-text"></slot>
      </div>`;
  }
}

customElements.define('eds-textfield', EdsTextfield);
