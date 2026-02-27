import { LitElement, html, nothing } from 'lit';
import { getRouteDetails } from '../../../utils/router.js';
import { toast } from '../../../controllers/toast-controller.js';
import {
  fetchPageStatus,
  previewPage,
  publishPage,
  unpublishPage,
  unpreviewPage,
  bulkStatus,
  fetchJobDetails,
} from '../../../services/adminApi.js';
import { getApiError } from '../../../utils/apiErrors.js';
import { formatDate } from '../../../utils/formatDate.js';
import '../../../blocks/error-alert/error-alert.js';
import '../../../blocks/eds-button/eds-button.js';
import '../../../blocks/eds-textfield/eds-textfield.js';

import getSheet from '../../../utils/sheet.js';
import { pageSheet, sharedSheet } from '../../../styles/page-sheets.js';
const sheet = await getSheet(new URL('./site-status.css', import.meta.url).pathname);

function staleness(ts) {
  if (!ts) return '';
  const diff = Date.now() - new Date(ts).getTime();
  const hours = diff / (1000 * 60 * 60);
  if (hours > 24) return `${Math.round(hours / 24)}d ago`;
  if (hours > 1) return `${Math.round(hours)}h ago`;
  return 'recent';
}

export class SiteStatus extends LitElement {
  static properties = {
    _org: { state: true },
    _site: { state: true },
    _paths: { state: true },
    _statuses: { state: true },
    _newPath: { state: true },
    _loading: { state: true },
    _error: { state: true },
    _actionPending: { state: true },
    _bulkRunning: { state: true },
  };

  constructor() {
    super();
    this._org = '';
    this._site = '';
    this._paths = ['/', '/nav', '/footer'];
    this._statuses = {};
    this._newPath = '';
    this._loading = true;
    this._error = null;
    this._actionPending = {};
    this._bulkRunning = false;
  }

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [pageSheet, sharedSheet, sheet];
    const details = getRouteDetails();
    this._org = details.org || '';
    this._site = details.site || '';
    const searchParams = new URLSearchParams(window.location.search);
    const pathFromQuery = searchParams.get('path');
    if (pathFromQuery) {
      const normalized = pathFromQuery.startsWith('/') ? pathFromQuery : `/${pathFromQuery}`;
      this._paths = this._paths.includes(normalized) ? this._paths : [normalized, ...this._paths];
    }
    this._fetchAllStatuses();
  }

  async _fetchAllStatuses() {
    this._loading = true;
    this._error = null;
    const results = {};
    await Promise.all(this._paths.map(async (path) => {
      const { data, status, error } = await fetchPageStatus(this._org, this._site, path);
      if (status === 200 && data) {
        results[path] = data;
      } else {
        results[path] = { error: getApiError(status, 'fetch status', error) || 'Unknown error' };
      }
    }));
    this._statuses = results;
    this._loading = false;
  }

  _addPath() {
    const path = this._newPath.trim();
    if (!path) return;
    const normalized = path.startsWith('/') ? path : `/${path}`;
    if (!this._paths.includes(normalized)) {
      this._paths = [...this._paths, normalized];
      this._fetchStatus(normalized);
    }
    this._newPath = '';
  }

  _addQuickPath(path) {
    if (!this._paths.includes(path)) {
      this._paths = [...this._paths, path];
      this._fetchStatus(path);
    }
  }

  async _fetchStatus(path) {
    const { data, status } = await fetchPageStatus(this._org, this._site, path);
    if (status === 200 && data) {
      this._statuses = { ...this._statuses, [path]: data };
    }
  }

  _removePath(path) {
    this._paths = this._paths.filter((p) => p !== path);
    const copy = { ...this._statuses };
    delete copy[path];
    this._statuses = copy;
    const url = new URL(window.location.href);
    if (url.searchParams.get('path') === path) {
      url.searchParams.delete('path');
      window.history.replaceState(null, '', url.toString());
    }
  }

  async _runAction(path, action, fn) {
    this._actionPending = { ...this._actionPending, [`${path}-${action}`]: true };
    this._error = null;
    const { status, error } = await fn(this._org, this._site, path);
    this._actionPending = { ...this._actionPending, [`${path}-${action}`]: false };
    const err = getApiError(status, action, error);
    if (err) {
      this._error = err;
      return;
    }
    toast.positive(`${action} successful for ${path}`);
    await this._fetchStatus(path);
  }

  _applyBulkResults(resources) {
    for (const r of resources) {
      const p = r.path ?? r.url;
      if (p) this._statuses = { ...this._statuses, [p]: r };
    }
  }

  async _pollBulkJob(topic, name) {
    const terminalStates = ['stopped', 'completed', 'failed'];
    const poll = async () => {
      const { data, status } = await fetchJobDetails(this._org, this._site, topic, name);
      if (status !== 200 || !data) {
        this._bulkRunning = false;
        this._error = 'Could not fetch bulk status job.';
        return;
      }
      const state = (data.state ?? data.status ?? '').toLowerCase();
      if (terminalStates.includes(state)) {
        const resources = data.data?.resources ?? data.resources ?? [];
        this._applyBulkResults(resources);
        this._bulkRunning = false;
        if (state === 'failed') {
          this._error = data.message || 'Bulk status job failed.';
        } else {
          toast.positive('Bulk status refreshed.');
        }
        return;
      }
      setTimeout(poll, 3000);
    };
    setTimeout(poll, 2000);
  }

  async _runBulkStatus() {
    if (!this._paths.length) {
      toast.negative('Add at least one path first.');
      return;
    }
    this._bulkRunning = true;
    this._error = null;
    const { data, status, error } = await bulkStatus(
      this._org, this._site, this._paths, { select: ['edit', 'preview', 'live'] },
    );
    const err = getApiError(status, 'bulk status', error);
    if (err) {
      this._bulkRunning = false;
      this._error = err;
      return;
    }

    if (status === 202 && data?.job) {
      const topic = data.job.topic ?? 'status';
      const name = data.job.name;
      if (name) {
        this._pollBulkJob(topic, name);
      } else {
        this._bulkRunning = false;
        this._error = 'Bulk status job created but no job name returned.';
      }
      return;
    }

    const results = Array.isArray(data) ? data : (data?.resources ?? data?.data?.resources ?? []);
    this._applyBulkResults(results);
    this._bulkRunning = false;
    toast.positive('Bulk status refreshed.');
  }

  render() {
    const quickPaths = ['/', '/nav', '/footer'];

    return html`
      <div class="page">
        <div>
          <h1>Page Status</h1>
          <p class="page-subtitle">Check preview/live status for individual pages in ${this._site}</p>
        </div>

        <error-alert .error=${this._error} @retry=${this._fetchAllStatuses}></error-alert>

        ${!this._loading ? html`<div class="add-row">
          <label class="field-label" for="site-status-path">Path</label>
          <eds-textfield
            id="site-status-path"
            label="Path"
            placeholder="/my-page"
            .value=${this._newPath}
            @input=${(e) => { this._newPath = e.target.value; }}
            @keydown=${(e) => { e.stopPropagation(); if (e.key === 'Enter') this._addPath(); }}
          ></eds-textfield>
          <eds-button variant="accent" @click=${this._addPath}>Add</eds-button>
          ${quickPaths.map((p) => html`
            <eds-button variant="secondary" size="s" @click=${() => this._addQuickPath(p)}
              ?disabled=${this._paths.includes(p)}>
              ${p}
            </eds-button>
          `)}
          <div style="flex:1"></div>
          <eds-button variant="secondary" @click=${this._runBulkStatus} ?disabled=${this._bulkRunning}>
            ${this._bulkRunning ? 'Running...' : 'Run Bulk Status'}
          </eds-button>
        </div>` : nothing}

        ${this._loading ? html`
          <div class="center">
            <div class="spinner" aria-label="Loading"></div>
          </div>
        ` : html`
          <table>
            <thead>
              <tr>
                <th>Path</th>
                <th>Source Last Modified</th>
                <th>Preview</th>
                <th>Live</th>
                <th>Actions</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              ${this._paths.map((path) => this._renderPathRow(path))}
            </tbody>
          </table>
        `}
      </div>
    `;
  }

  _renderPathRow(path) {
    const status = this._statuses[path];
    const sourceTs = status?.sourceLastModified;
    const prevTs = status?.preview?.lastModified;
    const liveTs = status?.live?.lastModified;
    const isPending = (action) => this._actionPending[`${path}-${action}`];
    const hasRedirect = status?.redirectLocation || status?.previewRedirectLocation || status?.liveRedirectLocation;

    return html`
      <tr>
        <td class="path-cell">
          ${path}
          ${hasRedirect
            ? html`<span class="redirect-badge" title="${[status?.redirectLocation, status?.previewRedirectLocation, status?.liveRedirectLocation].filter(Boolean).join('; ')}">↪</span>`
            : nothing}
        </td>
        <td>
          ${sourceTs ? html`
            <span class="ts">${staleness(sourceTs)}</span>
            <div class="ts">${formatDate(sourceTs)}</div>
          ` : html`<span class="ts">-</span>`}
        </td>
        <td>
          ${prevTs ? html`
            <span class="status-light s positive">${staleness(prevTs)}</span>
            <div class="ts">${formatDate(prevTs)}</div>
          ` : html`<span class="status-light s neutral">Not previewed</span>`}
        </td>
        <td>
          ${liveTs ? html`
            <span class="status-light s positive">${staleness(liveTs)}</span>
            <div class="ts">${formatDate(liveTs)}</div>
          ` : html`<span class="status-light s neutral">Not live</span>`}
        </td>
        <td>
          <div class="action-row">
            <eds-button size="s" variant="secondary"
              @click=${() => this._runAction(path, 'preview', previewPage)}
              ?disabled=${isPending('preview')}>
              Preview
            </eds-button>
            <eds-button size="s" variant="primary"
              @click=${() => this._runAction(path, 'publish', publishPage)}
              ?disabled=${isPending('publish')}>
              Publish
            </eds-button>
            ${liveTs ? html`
              <eds-button size="s" variant="secondary"
                @click=${() => this._runAction(path, 'unpublish', unpublishPage)}
                ?disabled=${isPending('unpublish')}>
                Unpublish
              </eds-button>
            ` : nothing}
            ${prevTs ? html`
              <eds-button size="s" variant="secondary"
                @click=${() => this._runAction(path, 'unpreview', unpreviewPage)}
                ?disabled=${isPending('unpreview')}>
                Unpreview
              </eds-button>
            ` : nothing}
          </div>
        </td>
        <td>
          <eds-button size="s" variant="secondary" @click=${() => this._removePath(path)}>
            Remove
          </eds-button>
        </td>
      </tr>
    `;
  }
}

customElements.define('site-status', SiteStatus);
