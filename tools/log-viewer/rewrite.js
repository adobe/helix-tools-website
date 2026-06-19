/* eslint-disable class-methods-use-this */
import { toUTCDate } from './utils.js';

/**
 * Transforms raw log data values into display-ready markup.
 */
export class RewrittenData {
  /**
   * Creates instance of RewrittenData.
   * @param {Object} data - Original data object.
   * @param {string} live - Hostname for live environment.
   * @param {string} preview - Hostname for preview environment.
  */
  constructor(data, live, preview) {
    this.data = data;
    this.live = live;
    this.preview = preview;
  }

  /**
   * Formats timestamp value into UTC format.
   * @param {string|number|null} value - Timestamp.
   * @returns {string} Formatted UTC date (or '-' if no value provided).
   */
  timestamp(value) {
    if (!value) return '-';
    return toUTCDate(new Date(value));
  }

  /**
   * Formats user email address into a :mailto link.
   * @param {string|null} value - User email address.
   * @returns {string} Mailto link formatted from email address (or '-' if no value provided).
   */
  user(value) {
    if (!value) return '-';
    return `<a href="mailto:${value}" title="${value}">${value.split('@')[0]}</a>`;
  }

  /**
   * Generates link or button based on type of path.
   * @param {string|null} value - Path or identifier for constructing the link/button.
   * @returns {string} Link or button (or '-' if no value or unhandled type).
   */
  path(value) {
    const writeA = (href, text) => `<a href="https://${href}" target="_blank">${text}</a>`;
    const writeAdminDetails = (href, text) => `<button
        type='button'
        class='button outline'
        data-url='https://${href}'
        value='${text}'
        title='${text}'>
          ${text.length > 26 ? `${text.substring(0, 26)}…` : text}
      </button>`;
    // path is created based on route/source
    const ADMIN = 'admin.hlx.page';
    const type = this.data.route || this.data.source;
    if (!type) return value || '-';
    if (type === 'code') {
      return writeA(`github.com/${this.data.owner}/${this.data.repo}/tree/${this.data.ref}`, value);
    }
    if (type === 'config') {
      return writeAdminDetails(`${ADMIN}/config/${this.data.org}/sites/${this.data.site}.json`, value);
    }
    if (type === 'index' || type === 'live') {
      return writeA(`${this.live}${value}`, value);
    }
    if (type === 'indexer') {
      if (!this.data.changes) return value || '-';
      // changes is producer-defined and not guaranteed to be an array of strings;
      // normalize to an array and coerce items to strings so .map/.split never throw.
      const changesList = Array.isArray(this.data.changes)
        ? this.data.changes
        : [this.data.changes];
      // sometimes ms appears in indexer path?
      const updateMs = !this.data.duration;
      if (updateMs) this.data.duration = 0;
      const changes = changesList.map((change) => {
        const segments = String(change).split(' ');
        const segment = segments.find((s) => s.startsWith('/'));
        if (updateMs) {
          const ms = segments.find((s) => s.endsWith('ms'));
          if (ms && ms !== segment) {
            const number = Number.parseInt(ms.replace('ms', ''), 10);
            if (!Number.isNaN(number)) this.data.duration += number;
          }
        }
        return segment ? writeAdminDetails(`${ADMIN}/index/${this.data.owner}/${this.data.repo}/${this.data.ref}${segment}`, segment) : '/';
      });
      return changes.join('<br /><br />');
    }
    if (type === 'job' || type.includes('-job')) {
      return writeAdminDetails(`${ADMIN}/job/${this.data.org}/${this.data.site}/${this.data.ref}${value}/details`, value);
    }
    if (type === 'snapshot') {
      // snapshot logs have job ID in the 'job' field, not 'path'
      const jobId = this.data.job;
      if (jobId) {
        return writeAdminDetails(`${ADMIN}/job/${this.data.org}/${this.data.site}/${this.data.ref}/${jobId}/details`, jobId);
      }
      return value || '-';
    }
    if (type === 'preview') {
      return writeA(`${this.preview}${value}`, value);
    }
    if (type === 'sitemap') {
      // when source: sitemap, we get arrays of paths
      if (this.data.updated) {
        const paths = this.data.updated[0].map(
          (update) => writeA(`${this.live}${update}`, update),
        );
        return paths.join('<br /><br />');
      }
      // when route: sitemap, we only get a path
      return writeA(`${this.live}${this.data.path}`, this.data.path);
    }
    if (type === 'status') {
      return writeAdminDetails(`${ADMIN}/status/${this.data.owner}/${this.data.repo}/${this.data.ref}${value}`, value);
    }
    // eslint-disable-next-line no-console
    console.warn('unhandled log type:', type, this.data);
    return value || '-';
  }

  /**
   * Formats array of error messages for display.
   * @param {Array|null} value - Array of error objects.
   * @returns {string} Error messages (or '-' if no errors present).
   */
  errors(value) {
    if (!value || value.length === 0) return '-';
    const errs = value.map((err) => {
      const { message, target } = err;
      if (message) {
        return `${message} (${target})`;
      }
      return err;
    });
    return errs.join(', <br />');
  }

  /**
   * Styles HTTP method in code tags.
   * @param {string|null} value - HTTP method.
   * @returns {string} HTTP method wrapped in <code> tags (or '-' if no value provided).
   */
  method(value) {
    if (!value) return '-';
    return `<code>${value}</code>`;
  }

  /**
   * Creates a status light for HTTP status code.
   * @param {number|null} value - HTTP status code.
   * @returns {string} Status light with HTTP status code (or '-' if no value provided).
   */
  status(value) {
    if (!value) return '-';
    const badge = document.createElement('span');
    badge.textContent = value;
    badge.className = `status-light http${Math.floor(value / 100) % 10}`;
    return badge.outerHTML;
  }

  /**
   * Formats the duration in seconds.
   * @param {number|null} value - Duration (in ms).
   * @returns {string} Duration in seconds (or '-' if no value provided).
   */
  duration(value) {
    if (!value) return '-';
    return `${(value / 1000).toFixed(1)} s`;
  }

  /**
   * Transforms data based on key.
   * @param {string[]} keys - Array of keys in data object.
   */
  rewrite(keys) {
    keys.forEach((key) => {
      if (this[key]) {
        this.data[key] = this[key](this.data[key]);
      }
    });
  }
}

export default RewrittenData;
