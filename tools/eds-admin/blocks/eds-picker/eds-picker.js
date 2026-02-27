import { LitElement, html, nothing } from 'lit';
import getSheet from '../../utils/sheet.js';

const sheet = await getSheet(new URL('./eds-picker.css', import.meta.url).pathname);

const CHEVRON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M5 7.4 1 3.4l.7-.7L5 6 8.3 2.7l.7.7Z"/></svg>';

export class EdsPicker extends LitElement {
  static properties = {
    label: { type: String },
    value: { type: String },
    placeholder: { type: String },
    size: { type: String },
    disabled: { type: Boolean },
    options: { type: Array },
    _open: { state: true },
  };

  constructor() {
    super();
    this.options = [];
    this._open = false;
  }

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [sheet];
  }

  get _selectedLabel() {
    const opt = (this.options || []).find((o) => o.value === this.value);
    return opt?.label || this.value || '';
  }

  _toggle() {
    if (this.disabled) return;
    this._open = !this._open;
  }

  _close() {
    this._open = false;
  }

  _select(val) {
    this.value = val;
    this._open = false;
    this.dispatchEvent(new CustomEvent('change', {
      detail: { value: val },
      bubbles: true,
      composed: true,
    }));
  }

  render() {
    const cls = this.size || 'm';
    const display = this._selectedLabel || this.placeholder || '';
    const isPlaceholder = !this.value;

    return html`
      <div class="picker">
        ${this.label ? html`<label>${this.label}</label>` : nothing}
        <button
          class="trigger ${cls}"
          ?disabled=${this.disabled}
          @click=${this._toggle}
          aria-haspopup="listbox"
          aria-expanded=${this._open}
        >
          <span class="trigger-label ${isPlaceholder ? 'placeholder' : ''}">${display}</span>
          <span class="trigger-icon" .innerHTML=${CHEVRON}></span>
        </button>
        ${this._open ? html`
          <div class="backdrop" @click=${this._close}></div>
          <ul class="listbox" role="listbox">
            ${(this.options || []).map((opt) => html`
              <li
                role="option"
                class=${opt.value === this.value ? 'selected' : ''}
                aria-selected=${opt.value === this.value}
                @click=${() => this._select(opt.value)}
              >${opt.label}</li>
            `)}
          </ul>
        ` : nothing}
      </div>`;
  }
}

customElements.define('eds-picker', EdsPicker);
