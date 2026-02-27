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
    editable: { type: Boolean },
    options: { type: Array },
    _open: { state: true },
    _query: { state: true },
  };

  constructor() {
    super();
    this.options = [];
    this._open = false;
    this._query = null;
  }

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [sheet];
  }

  get _selectedLabel() {
    const opt = (this.options || []).find((o) => o.value === this.value);
    return opt?.label || this.value || '';
  }

  get _filteredOptions() {
    if (!this.editable || this._query === null || this._query === '') {
      return this.options || [];
    }
    const q = this._query.toLowerCase();
    return (this.options || []).filter((o) =>
      o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q),
    );
  }

  get _queryMatchesOption() {
    if (!this._query) return false;
    const q = this._query.toLowerCase().trim();
    return (this.options || []).some(
      (o) => o.value.toLowerCase() === q || o.label.toLowerCase() === q,
    );
  }

  _toggle() {
    if (this.disabled) return;
    this._open = !this._open;
  }

  _close() {
    this._open = false;
    this._query = null;
  }

  _select(val) {
    this.value = val;
    this._open = false;
    this._query = null;
    this.dispatchEvent(new CustomEvent('change', {
      detail: { value: val },
      bubbles: true,
      composed: true,
    }));
  }

  _handleInputFocus(e) {
    this._open = true;
    this._query = '';
    e.target.select();
  }

  _handleInput(e) {
    this._query = e.target.value;
    if (!this._open) this._open = true;
  }

  _handleKeydown(e) {
    if (e.key === 'Escape') {
      this._close();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const q = (this._query || '').trim();
      if (!q) return;

      const match = (this.options || []).find(
        (o) => o.value.toLowerCase() === q.toLowerCase()
          || o.label.toLowerCase() === q.toLowerCase(),
      );
      if (match) {
        this._select(match.value);
      } else {
        this._open = false;
        this._query = null;
        this.dispatchEvent(new CustomEvent('add', {
          detail: { value: q },
          bubbles: true,
          composed: true,
        }));
      }
    }
  }

  _handleAdd() {
    const q = (this._query || '').trim();
    if (!q) return;
    this._open = false;
    this._query = null;
    this.dispatchEvent(new CustomEvent('add', {
      detail: { value: q },
      bubbles: true,
      composed: true,
    }));
  }

  render() {
    const cls = this.size || 'm';
    const display = this._selectedLabel || this.placeholder || '';
    const isPlaceholder = !this.value;

    if (this.editable) {
      const inputVal = this._query !== null ? this._query : (this.value || '');
      const filtered = this._filteredOptions;
      const showAdd = this._query && this._query.trim() && !this._queryMatchesOption;

      return html`
        <div class="picker">
          ${this.label ? html`<label>${this.label}</label>` : nothing}
          <div class="combo-wrap">
            <input
              class="trigger combo-input ${cls}"
              type="text"
              .value=${inputVal}
              placeholder=${this.placeholder || ''}
              ?disabled=${this.disabled}
              @focus=${this._handleInputFocus}
              @input=${this._handleInput}
              @keydown=${this._handleKeydown}
              autocomplete="off"
              spellcheck="false"
            />
            <span class="combo-chevron" .innerHTML=${CHEVRON}></span>
          </div>
          ${this._open ? html`
            <div class="backdrop" @click=${this._close}></div>
            <ul class="listbox" role="listbox">
              ${filtered.map((opt) => html`
                <li
                  role="option"
                  class=${opt.value === this.value ? 'selected' : ''}
                  aria-selected=${opt.value === this.value}
                  @click=${() => this._select(opt.value)}
                >${opt.label}</li>
              `)}
              ${showAdd ? html`
                <li class="add-option" @click=${this._handleAdd}>
                  + Add "${this._query.trim()}"
                </li>
              ` : nothing}
              ${filtered.length === 0 && !showAdd ? html`
                <li class="no-results">No matches</li>
              ` : nothing}
            </ul>
          ` : nothing}
        </div>`;
    }

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
