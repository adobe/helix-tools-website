import { LitElement, html, nothing } from 'lit';
import { getRouteDetails, navigate } from '../../../utils/router.js';
import { fetchLogs } from '../../../services/adminApi.js';
import { getApiError } from '../../../utils/apiErrors.js';
import { toast } from '../../../controllers/toast-controller.js';
import '../../../blocks/error-alert/error-alert.js';
import '../../../blocks/eds-button/eds-button.js';
import '../../../blocks/eds-picker/eds-picker.js';

import getSheet from '../../../utils/sheet.js';
import { pageSheet, sharedSheet } from '../../../styles/page-sheets.js';
const sheet = await getSheet(new URL('./site-logs.css', import.meta.url).pathname);

const TIMEFRAMES = [
  { label: 'Last hour', value: '1h' },
  { label: 'Last 6 hours', value: '6h' },
  { label: 'Last 24 hours', value: '1d' },
  { label: 'Last 7 days', value: '7d' },
  { label: 'Last 30 days', value: '30d' },
  { label: 'Custom', value: 'custom' },
];

function formatDate(dateStr) {
  if (!dateStr) return '-';
  try {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return String(dateStr);
  }
}

function toCsvRow(arr) {
  return arr.map((v) => {
    const s = String(v ?? '');
    const needsQuote = s.includes(',') || s.includes('"') || s.includes('\n');
    return needsQuote ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(',');
}

export class SiteLogs extends LitElement {
  static properties = {
    _org: { state: true },
    _site: { state: true },
    _entries: { state: true },
    _timeframe: { state: true },
    _customFrom: { state: true },
    _customTo: { state: true },
    _filter: { state: true },
    _loading: { state: true },
    _error: { state: true },
  };

  constructor() {
    super();
    this._org = '';
    this._site = '';
    this._entries = [];
    this._timeframe = '1d';
    this._customFrom = '';
    this._customTo = '';
    this._filter = '';
    this._loading = true;
    this._error = '';
  }

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [pageSheet, sharedSheet, sheet];
    const details = getRouteDetails();
    this._org = details.org || '';
    this._site = details.site || '';
    if (this._org && this._site) this._load();
  }

  updated(changedProperties) {
    super.updated?.(changedProperties);
    const orgOrSiteChanged = changedProperties.has('_org') || changedProperties.has('_site');
    const timeframeChanged = changedProperties.has('_timeframe');
    if (this._org && this._site) {
      if (orgOrSiteChanged) {
        this._load();
      } else if (timeframeChanged && this._timeframe !== 'custom') {
        this._load();
      }
    }
  }

  async _load() {
    if (!this._org || !this._site) return;
    if (this._timeframe === 'custom' && (!this._customFrom || !this._customTo)) return;
    this._loading = true;
    this._error = '';
    let options;
    if (this._timeframe === 'custom') {
      const fromIso = new Date(this._customFrom).toISOString();
      const toIso = new Date(this._customTo).toISOString();
      options = { from: fromIso, to: toIso };
    } else {
      options = { since: this._timeframe };
    }
    const { data, status, error } = await fetchLogs(this._org, this._site, options);
    const err = getApiError(status, 'load logs', error);
    if (err) {
      this._error = err;
      this._loading = false;
      return;
    }
    const raw = Array.isArray(data) ? data : (data?.entries ?? []);
    raw.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    this._entries = raw;
    this._loading = false;
  }

  _handleCustomFetch() {
    if (this._customFrom && this._customTo) this._load();
  }

  _handleRetry() {
    this._load();
  }

  get _filteredEntries() {
    const q = (this._filter || '').toLowerCase().trim();
    if (!q) return this._entries;
    return this._entries.filter((e) => {
      const str = JSON.stringify(e).toLowerCase();
      return str.includes(q);
    });
  }

  _getEntryRow(entry) {
    const ts = entry.timestamp ?? entry.time ?? entry.created ?? '—';
    const user = entry.user ?? entry.email ?? entry.by ?? '—';
    const action = entry.action ?? entry.type ?? entry.operation ?? entry.route ?? '—';
    const path = entry.path ?? entry.url ?? entry.resource ?? '—';
    const status = entry.status ?? entry.statusCode ?? '—';
    const route = entry.route ?? '—';
    const method = entry.method ?? '—';
    const duration = entry.duration != null ? `${entry.duration}ms` : '—';
    return { timestamp: ts, user, action, path, status, route, method, duration };
  }

  _getPathLink(entry) {
    const path = entry.path ?? entry.url ?? entry.resource;
    if (!path || path === '—') return null;
    const route = (entry.route ?? entry.action ?? entry.type ?? '').toLowerCase();
    if (route === 'preview') {
      return `https://main--${this._site}--${this._org}.aem.page${path}`;
    }
    if (route === 'live') {
      return `https://main--${this._site}--${this._org}.aem.live${path}`;
    }
    if (route === 'config') return `/${this._org}/${this._site}/config`;
    if (route === 'index') return `/${this._org}/${this._site}/index`;
    return null;
  }

  _handlePathClick(e) {
    const href = e.currentTarget.getAttribute('href');
    if (!href) return;
    if (href.startsWith('http')) return;
    e.preventDefault();
    navigate(href);
  }

  _handleExportCsv() {
    const rows = this._filteredEntries;
    const headers = ['timestamp', 'user', 'action', 'path', 'status', 'route', 'method', 'duration'];
    const lines = [headers.join(',')];
    for (const e of rows) {
      const r = this._getEntryRow(e);
      lines.push(toCsvRow([r.timestamp, r.user, r.action, r.path, r.status, r.route, r.method, r.duration]));
    }
    const csv = lines.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `logs-${this._org}-${this._site}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.positive('CSV exported.');
  }

  render() {
    const entries = this._filteredEntries;

    return html`
      <div class="page">
        <div class="page-header">
          <div>
            <h1 class="page-title">Logs</h1>
            <p class="page-subtitle">${this._org} / ${this._site}</p>
          </div>
          <div class="header-actions">
            <eds-picker
              label="Timeframe"
              .value=${this._timeframe}
              .options=${TIMEFRAMES.map((t) => ({ value: t.value, label: t.label }))}
              @change=${(e) => { this._timeframe = (e.detail?.value ?? e.target?.value) ?? '1d'; }}
            ></eds-picker>
            ${this._timeframe === 'custom'
              ? html`
                  <div class="custom-date-row">
                    <label class="date-label">From</label>
                    <input
                      type="datetime-local"
                      class="date-input"
                      .value=${this._customFrom}
                      @input=${(e) => { this._customFrom = e.target.value ?? ''; }}
                    />
                    <label class="date-label">To</label>
                    <input
                      type="datetime-local"
                      class="date-input"
                      .value=${this._customTo}
                      @input=${(e) => { this._customTo = e.target.value ?? ''; }}
                    />
                    <eds-button variant="accent" ?disabled=${this._loading} @click=${this._handleCustomFetch}>
                      Fetch
                    </eds-button>
                  </div>
                `
              : nothing}
            <eds-button variant="secondary" @click=${this._handleExportCsv}>
              CSV Export
            </eds-button>
            <eds-button variant="secondary" ?disabled=${this._loading} @click=${this._load}>
              Refresh
            </eds-button>
          </div>
        </div>

        <error-alert .error=${this._error} @retry=${this._handleRetry}></error-alert>

        ${this._loading
          ? html`<div class="loading"><div class="spinner" aria-label="Loading"></div></div>`
          : nothing}

        ${!this._loading && !this._error
          ? html`
              <div class="filter-row">
                <input
                  type="search"
                  class="search-input"
                  placeholder="Search logs..."
                  .value=${this._filter}
                  @input=${(e) => { this._filter = e.target.value ?? ''; }}
                />
                <span class="filter-count">${entries.length} entries</span>
              </div>

              ${entries.length === 0
                ? html`<p class="empty">No log entries for the selected timeframe.</p>`
                : html`
                    <table class="eds-table compact">
                      <thead>
                        <tr>
                          <th>Timestamp</th>
                          <th>User</th>
                          <th>Action</th>
                          <th>Route</th>
                          <th>Method</th>
                          <th>Path</th>
                          <th>Status</th>
                          <th>Duration</th>
                        </tr>
                      </thead>
                      <tbody>
                        ${entries.map(
                          (entry) => {
                            const r = this._getEntryRow(entry);
                            const pathLink = this._getPathLink(entry);
                            return html`
                              <tr>
                                <td>${formatDate(r.timestamp)}</td>
                                <td>${r.user}</td>
                                <td>${r.action}</td>
                                <td>${r.route}</td>
                                <td>${r.method}</td>
                                <td>${
                                  pathLink
                                    ? html`<a href=${pathLink} class="path-link" @click=${this._handlePathClick} title=${r.path}>${r.path}</a>`
                                    : html`<code class="path">${r.path}</code>`
                                }</td>
                                <td>${r.status}</td>
                                <td>${r.duration}</td>
                              </tr>
                            `;
                          },
                        )}
                      </tbody>
                    </table>
                  `}
            `
          : nothing}
      </div>
    `;
  }

}

customElements.define('site-logs', SiteLogs);
