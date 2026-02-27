import { LitElement, html } from 'lit';
import getSheet from '../../utils/sheet.js';
import '../eds-toast/eds-toast.js';

const sheet = await getSheet(new URL('./toast-container.css', import.meta.url).pathname);

export class ToastContainer extends LitElement {
  static properties = {
    _toasts: { state: true },
  };

  constructor() {
    super();
    this._toasts = [];
    this._nextId = 0;
  }

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [sheet];
  }

  addToast(message, variant = 'info', timeout = 6000) {
    const id = this._nextId;
    this._nextId += 1;
    this._toasts = [...this._toasts, { id, message, variant }];

    if (timeout > 0) {
      setTimeout(() => this._removeToast(id), timeout);
    }
  }

  _removeToast(id) {
    this._toasts = this._toasts.filter((t) => t.id !== id);
  }

  render() {
    return html`
      <div class="toast-stack">
        ${this._toasts.map((t) => html`
          <eds-toast
            variant=${t.variant}
            open
            @close=${() => this._removeToast(t.id)}
          >
            ${t.message}
          </eds-toast>
        `)}
      </div>
    `;
  }
}

customElements.define('toast-container', ToastContainer);
