class ToastManager {
  _findContainer() {
    const light = document.querySelector('toast-container');
    if (light) return light;
    const app = document.querySelector('admin-app');
    if (app?.shadowRoot) {
      return app.shadowRoot.querySelector('toast-container');
    }
    return null;
  }

  show(message, variant = 'info', timeout = 6000) {
    const container = this._findContainer();
    if (!container) {
      console.warn('[ToastManager] No <toast-container> found in DOM');
      return;
    }
    container.addToast(message, variant, timeout);
  }

  positive(message, timeout) {
    this.show(message, 'positive', timeout);
  }

  negative(message, timeout) {
    this.show(message, 'negative', timeout);
  }

  info(message, timeout) {
    this.show(message, 'info', timeout);
  }
}

export const toast = new ToastManager();
