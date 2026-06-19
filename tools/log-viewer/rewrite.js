/* eslint-disable class-methods-use-this */
import { toUTCDate } from './utils.js';
import admin from '../../scripts/helix-admin.js';

/**
 * Transforms raw log data values into display-ready DOM nodes.
 */
export class RewrittenData {
  /**
   * @param {Object} data - Original log entry.
   * @param {string} live - Live hostname.
   * @param {string} preview - Preview hostname.
   * @param {Function} onAdminClick - Called with (requestFn, button) when an admin button is clicked.
   */
  constructor(data, live, preview, onAdminClick = async () => {}) {
    this.data = data;
    this.live = live;
    this.preview = preview;
    this.onAdminClick = onAdminClick;
  }

  timestamp(value) {
    if (!value) return null;
    return toUTCDate(new Date(value));
  }

  user(value) {
    if (!value) return null;
    const [username] = value.split('@');
    const a = document.createElement('a');
    a.href = `mailto:${value}`;
    a.title = value;
    a.textContent = username;
    return a;
  }

  path(value) {
    const { data } = this;
    const type = data.route || data.source;
    if (!type) return value || null;

    const writeA = (href, text) => {
      const a = document.createElement('a');
      a.href = `https://${href}`;
      a.target = '_blank';
      a.textContent = text;
      return a;
    };

    const writeAdminDetails = (requestFn, text) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'button outline';
      button.value = text;
      button.title = text;
      button.textContent = text.length > 26 ? `${text.substring(0, 26)}…` : text;
      button.addEventListener('click', () => this.onAdminClick(requestFn, button));
      return button;
    };

    if (type === 'code') {
      return writeA(`github.com/${data.owner}/${data.repo}/tree/${data.ref}`, value);
    }
    if (type === 'config') {
      return writeAdminDetails(
        () => admin.config({ org: data.org, site: data.site }).read(),
        value,
      );
    }
    if (type === 'index' || type === 'live') {
      return writeA(`${this.live}${value}`, value);
    }
    if (type === 'indexer') {
      if (!data.changes) return value || null;
      const updateMs = !data.duration;
      if (updateMs) data.duration = 0;
      const changesList = Array.isArray(data.changes) ? data.changes : [data.changes];
      const fragment = document.createDocumentFragment();
      changesList.forEach((change, i) => {
        if (i > 0) {
          fragment.append(document.createElement('br'));
          fragment.append(document.createElement('br'));
        }
        const parts = String(change).split(' ');
        const segment = parts.find((s) => s.startsWith('/'));
        if (updateMs) {
          const ms = parts.find((s) => s.endsWith('ms') && s !== segment);
          if (ms) {
            const n = Number.parseInt(ms.replace('ms', ''), 10);
            if (!Number.isNaN(n)) data.duration += n;
          }
        }
        if (segment) {
          fragment.append(writeAdminDetails(
            () => admin.index({ org: data.owner, site: data.repo, ref: data.ref }).get(segment),
            segment,
          ));
        } else {
          fragment.append('/');
        }
      });
      return fragment;
    }
    if (type === 'job' || type.includes('-job')) {
      return writeAdminDetails(
        () => admin.job({ org: data.org, site: data.site, ref: data.ref }).get(`${value}/details`),
        value,
      );
    }
    if (type === 'snapshot') {
      const { job: jobId } = data;
      if (jobId) {
        return writeAdminDetails(
          () => admin.job({ org: data.org, site: data.site, ref: data.ref }).get(`${jobId}/details`),
          jobId,
        );
      }
      return value || null;
    }
    if (type === 'preview') {
      return writeA(`${this.preview}${value}`, value);
    }
    if (type === 'sitemap') {
      if (data.updated) {
        const firstGroup = data.updated[0];
        if (!Array.isArray(firstGroup)) return value || null;
        const fragment = document.createDocumentFragment();
        firstGroup.forEach((update, i) => {
          if (i > 0) {
            fragment.append(document.createElement('br'));
            fragment.append(document.createElement('br'));
          }
          fragment.append(writeA(`${this.live}${update}`, update));
        });
        return fragment;
      }
      return writeA(`${this.live}${data.path}`, data.path);
    }
    if (type === 'status') {
      return writeAdminDetails(
        () => admin.status({ org: data.owner, site: data.repo, ref: data.ref }).get(value),
        value,
      );
    }
    if (type === 'auth') {
      return value || null;
    }
    // eslint-disable-next-line no-console
    console.warn('unhandled log type:', type, data);
    return value || null;
  }

  errors(value) {
    if (!value || !Array.isArray(value) || value.length === 0) return null;
    const fragment = document.createDocumentFragment();
    const nodes = value.flatMap((err, i) => {
      const { message, target } = err;
      const text = message ? `${message} (${target})` : String(err);
      return i === 0 ? [text] : [', ', document.createElement('br'), text];
    });
    fragment.append(...nodes);
    return fragment;
  }

  method(value) {
    if (!value) return null;
    const code = document.createElement('code');
    code.textContent = value;
    return code;
  }

  status(value) {
    if (!value) return null;
    const badge = document.createElement('span');
    badge.textContent = value;
    badge.className = `status-light http${Math.floor(value / 100) % 10}`;
    return badge;
  }

  duration(value) {
    if (!value) return null;
    return `${(value / 1000).toFixed(1)} s`;
  }

  rewrite(keys) {
    keys.forEach((key) => {
      if (this[key]) {
        this.data[key] = this[key](this.data[key]);
      }
    });
  }
}

export default RewrittenData;
