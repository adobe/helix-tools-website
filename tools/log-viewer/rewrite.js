/* eslint-disable class-methods-use-this */
import { toUTCDate } from './utils.js';

/**
 * Transforms raw log data values into display-ready DOM nodes.
 */
export class RewrittenData {
  /**
   * @param {Object} data - Original log entry.
   * @param {string} live - Live hostname.
   * @param {string} preview - Preview hostname.
   * @param {Function} onAdminClick - Called with (requestFn|data, button) on detail button click.
   * @param {object} adminClient - Active admin API client.
   */
  constructor(data, live, preview, onAdminClick = async () => {}, adminClient = null) {
    this.data = data;
    this.live = live;
    this.preview = preview;
    this.onAdminClick = onAdminClick;
    this.admin = adminClient;
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

    // the partition property determines which content-bus partition was written
    const contentHost = data.partition === 'preview' ? this.preview : this.live;

    const writeA = (href, text) => {
      const a = document.createElement('a');
      a.href = `https://${href}`;
      a.target = '_blank';
      a.textContent = text;
      return a;
    };

    const writeDetails = (source, text) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'button outline';
      button.value = text;
      button.title = text;
      button.textContent = text.length > 26 ? `${text.substring(0, 26)}…` : text;
      button.addEventListener('click', () => this.onAdminClick(source, button));
      return button;
    };

    if (type === 'code') {
      return writeA(`github.com/${data.owner}/${data.repo}/tree/${data.ref}`, value);
    }
    if (type === 'config') {
      return writeDetails(
        () => this.admin.config({ org: data.org, site: data.site }).read(),
        value,
      );
    }
    if (type === 'index' || type === 'live') {
      return writeA(`${contentHost}${value}`, value);
    }
    if (type === 'indexer') {
      if (!data.changes) return value || null;
      const updateMs = !data.duration;
      if (updateMs) data.duration = 0;
      const changesList = Array.isArray(data.changes) ? data.changes : [data.changes];
      // changes read like "<index>: <action> <path>", collect a change log per index
      const byIndex = new Map();
      const unparsed = [];
      changesList.forEach((change) => {
        const parts = String(change).split(' ').filter((s) => s);
        if (!parts.length) return;
        const msParts = parts.filter((s) => /^\d+ms$/.test(s));
        if (updateMs) {
          msParts.forEach((ms) => {
            const n = Number.parseInt(ms.replace('ms', ''), 10);
            if (!Number.isNaN(n)) data.duration += n;
          });
        }
        const index = parts[0].endsWith(':') ? parts[0].slice(0, -1) : null;
        const rest = index ? parts.slice(1) : parts;
        const segment = rest.find((s) => s.startsWith('/'));
        if (!index || !segment) {
          unparsed.push(parts.filter((s) => !msParts.includes(s)).join(' '));
          return;
        }
        if (index.startsWith('#internal-')) return;
        const action = rest
          .filter((s) => s !== segment && !msParts.includes(s))
          .join(' ') || 'changed';
        if (!byIndex.has(index)) byIndex.set(index, {});
        const log = byIndex.get(index);
        if (!log[action]) log[action] = [];
        log[action].push(`https://${contentHost}${segment}`);
      });
      const fragment = document.createDocumentFragment();
      byIndex.forEach((log, index) => {
        fragment.append(writeDetails({ index, ...log }, index));
      });
      if (unparsed.length) fragment.append(unparsed.join(', '));
      return fragment.childNodes.length ? fragment : null;
    }
    if (type === 'job' || type.includes('-job')) {
      return writeDetails(
        () => this.admin.job({ org: data.org, site: data.site, ref: data.ref }).get(`${value}/details`),
        value,
      );
    }
    if (type === 'snapshot') {
      const { job: jobId } = data;
      if (jobId) {
        return writeDetails(
          () => this.admin.job({ org: data.org, site: data.site, ref: data.ref }).get(`${jobId}/details`),
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
          fragment.append(writeA(`${contentHost}${update}`, update));
        });
        return fragment;
      }
      return writeA(`${contentHost}${data.path}`, data.path);
    }
    if (type === 'status') {
      return writeDetails(
        () => this.admin.status({ org: data.owner, site: data.repo, ref: data.ref }).get(value),
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
