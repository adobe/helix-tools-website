import { LitElement, html } from 'lit';
import { isSessionExpired, isPermissionError } from '../../utils/apiErrors.js';
import { edsIcon } from '../../utils/icons.js';
import getSheet from '../../utils/sheet.js';
import '../eds-button/eds-button.js';
import '../eds-alert/eds-alert.js';

const sheet = await getSheet(new URL('./error-alert.css', import.meta.url).pathname);

export class ErrorAlert extends LitElement {
  static properties = {
    error: { type: String },
  };

  constructor() {
    super();
    this.error = '';
  }

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [sheet];
  }

  _handleRetry() {
    this.dispatchEvent(new Event('retry'));
  }

  render() {
    if (!this.error) return html``;

    if (isPermissionError(this.error)) {
      this.setAttribute('access-denied', '');
      return html`
        <div class="access-denied">
          ${edsIcon('lock-closed', { size: 48 })}
          <h2>Access Denied</h2>
          <p>${this.error}</p>
          <eds-button variant="accent" @click=${() => { window.location.href = '/'; }}>
            Sign in with a different account
          </eds-button>
        </div>
      `;
    }
    this.removeAttribute('access-denied');

    const expired = isSessionExpired(this.error);

    return html`
      <eds-alert variant="negative" open>
        <span>${this.error}</span>
        <div class="actions">
          ${expired ? html`
            <eds-button variant="secondary" size="s" @click=${() => { window.location.href = '/'; }}>
              Sign in
            </eds-button>
          ` : html`
            <eds-button variant="secondary" size="s" @click=${this._handleRetry}>
              Retry
            </eds-button>
          `}
        </div>
      </eds-alert>
    `;
  }
}

customElements.define('error-alert', ErrorAlert);
