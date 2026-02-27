import { LitElement, html, nothing } from 'lit';
import { getRouteDetails } from '../../../utils/router.js';
import { toast } from '../../../controllers/toast-controller.js';
import {
  fetchSiteConfig,
  fetchPsi,
  syncCode,
  savePublicConfig,
  fetchLogs,
  fetchRumDay,
} from '../../../services/adminApi.js';
import { getApiError } from '../../../utils/apiErrors.js';
import { getDAEditorURL } from '../../../utils/contentSource.js';
import '../../../blocks/psi-chart/psi-chart.js';
import '../../../blocks/error-alert/error-alert.js';
import '../../../blocks/eds-button/eds-button.js';
import '../../../blocks/eds-dialog/eds-dialog.js';
import '../../../blocks/eds-textfield/eds-textfield.js';
import '../../../blocks/eds-alert/eds-alert.js';
import '../../../blocks/admin-card/admin-card.js';
import { edsIcon } from '../../../utils/icons.js';
import { parsePsiScores } from '../../../utils/psi.js';

import getSheet from '../../../utils/sheet.js';
import { pageSheet, sharedSheet } from '../../../styles/page-sheets.js';
const sheet = await getSheet(new URL('./site-overview.css', import.meta.url).pathname);

const PSI_MAX_RUNS = 20;

const PSI_STORE_BASE = 'https://psi-store.aem-poc-lab.workers.dev';

function buildPsiActionYaml(org, site) {
  return [
  '# .github/workflows/psi-on-deploy.yml',
  'name: PSI on Deploy',
  '',
  'on:',
  '  push:',
  '    branches: [main]',
  '',
  'jobs:',
  '  psi:',
  '    runs-on: ubuntu-latest',
  '    steps:',
  '      - uses: usman-khalid/aem-psi-action@v1',
  '        with:',
  `          org: ${org}`,
  `          site: ${site}`,
  '          admin-api-key: ${{ secrets.AEM_ADMIN_API_KEY }}',
  ].join('\n');
}

export class SiteOverview extends LitElement {
  static properties = {
    _org: { state: true },
    _site: { state: true },
    _config: { state: true },
    _loading: { state: true },
    _error: { state: true },
    _psiRunning: { state: true },
    _psiHistory: { state: true },
    _psiError: { state: true },
    _psiEnabled: { state: true },
    _psiToggleSaving: { state: true },
    _showPsiDialog: { state: true },
    _syncingCode: { state: true },
    _logEntries: { state: true },
    _logsLoading: { state: true },
    _rumPageviews: { state: true },
    _rumLoading: { state: true },
    _rumError: { state: true },
    _rumKeyInput: { state: true },
    _rumKeySaving: { state: true },
  };

  constructor() {
    super();
    this._org = '';
    this._site = '';
    this._config = null;
    this._loading = true;
    this._error = null;
    this._psiRunning = false;
    this._psiHistory = [];
    this._psiError = null;
    this._psiEnabled = false;
    this._psiToggleSaving = false;
    this._showPsiDialog = false;
    this._syncingCode = false;
    this._logEntries = [];
    this._logsLoading = true;
    this._rumPageviews = null;
    this._rumLoading = false;
    this._rumError = null;
    this._rumKeyInput = '';
    this._rumKeySaving = false;
  }

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [pageSheet, sharedSheet, sheet];
    const details = getRouteDetails();
    this._org = details.org || '';
    this._site = details.site || '';
    if (this._org && this._site) {
      this._load();
    }
  }

  updated(changedProperties) {
    super.updated?.(changedProperties);
    if (changedProperties.has('_org') || changedProperties.has('_site')) {
      if (this._org && this._site) {
        this._load();
      }
    }
  }

  async _load() {
    if (!this._org || !this._site) return;

    this._loading = true;
    this._logsLoading = true;
    this._error = null;

    const [configResult, logsResult] = await Promise.all([
      fetchSiteConfig(this._org, this._site),
      fetchLogs(this._org, this._site, { since: '7d' }),
    ]);

    const { data, status, error } = configResult;

    if (status === 401) {
      this._error = 'Session expired. Please sign in again.';
      this._loading = false;
      this._logsLoading = false;
      return;
    }
    if (status === 403) {
      this._error = getApiError(status, 'view this site', error);
      this._loading = false;
      this._logsLoading = false;
      return;
    }
    const err = getApiError(status, 'load site config', error);
    if (err) {
      this._error = err;
      this._loading = false;
      this._logsLoading = false;
      return;
    }

    this._config = data || {};
    this._psiEnabled = !!this._config.public?.psi?.enabled;
    this._logEntries = Array.isArray(logsResult.data) ? logsResult.data : [];
    this._loading = false;
    this._logsLoading = false;

    this._loadPsiHistory();
    this._loadRum();
  }

  async _loadPsiHistory() {
    try {
      const resp = await fetch(`${PSI_STORE_BASE}/psi/${this._org}/${this._site}`);
      if (!resp.ok) return;
      const history = await resp.json();
      if (Array.isArray(history)) {
        this._psiHistory = history.slice(0, PSI_MAX_RUNS);
      }
    } catch { /* worker not available */ }
  }

  async _loadRum() {
    const domainkey = this._config?.public?.rum?.domainkey;
    if (!domainkey) {
      this._rumPageviews = null;
      this._rumLoading = false;
      return;
    }
    const domain = this._config?.cdn?.prod?.host
      || `main--${this._site}--${this._org}.aem.live`;

    this._rumLoading = true;
    this._rumError = null;

    const now = new Date();
    const dayPromises = [];
    for (let i = 0; i < 7; i += 1) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      dayPromises.push(
        fetchRumDay(domain, domainkey, dateStr)
          .then(({ data }) => ({ dateStr, bundles: data || [] })),
      );
    }

    try {
      const days = await Promise.all(dayPromises);
      let totalPageviews = 0;
      const dailyCounts = [];
      const urlCounts = new Map();
      const lcpValues = [];
      const clsValues = [];
      const inpValues = [];

      for (const { dateStr, bundles } of days) {
        let dayViews = 0;
        for (const b of bundles) {
          const w = b.weight || 1;
          dayViews += w;
          if (b.url) {
            try {
              const path = new URL(b.url).pathname;
              urlCounts.set(path, (urlCounts.get(path) || 0) + w);
            } catch { /* skip malformed URLs */ }
          }
          SiteOverview._extractCwv(b, lcpValues, clsValues, inpValues);
        }
        totalPageviews += dayViews;
        dailyCounts.push({ date: dateStr, views: dayViews });
      }
      dailyCounts.sort((a, b) => a.date.localeCompare(b.date));
      const topPages = [...urlCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([path, views]) => ({ path, views }));

      const cwv = {
        lcp: SiteOverview._percentile75(lcpValues),
        cls: SiteOverview._percentile75(clsValues),
        inp: SiteOverview._percentile75(inpValues),
      };
      this._rumPageviews = { total: totalPageviews, daily: dailyCounts, topPages, cwv };
    } catch (e) {
      this._rumError = e.message || 'Failed to load RUM data';
      this._rumPageviews = null;
    }
    this._rumLoading = false;
  }

  async _saveRumDomainKey() {
    const key = this._rumKeyInput?.trim();
    if (!key) return;

    this._rumKeySaving = true;
    const pub = this._config?.public || {};
    const updated = { ...pub, rum: { ...(pub.rum || {}), domainkey: key } };
    const { status, error } = await savePublicConfig(this._org, this._site, updated);
    this._rumKeySaving = false;

    const err = getApiError(status, 'save domain key', error);
    if (err) { toast.negative(err); return; }

    toast.positive('RUM domain key saved.');
    this._config = { ...this._config, public: updated };
    this._rumKeyInput = '';
    this._loadRum();
  }

  async _handleRunLighthouse() {
    if (!this._org || !this._site) return;

    this._psiRunning = true;
    this._psiError = null;

    const testUrl = `https://main--${this._site}--${this._org}.aem.live/`;
    const { data, status, error } = await fetchPsi(this._org, this._site, testUrl);

    this._psiRunning = false;

    if (status !== 200 || !data) {
      this._psiError = error || getApiError(status, 'run Lighthouse', error) || 'PSI run failed';
      return;
    }

    const cats = data?.lighthouseResult?.categories || {};
    const scores = parsePsiScores(cats);
    const entry = { timestamp: Date.now(), scores };

    this._psiHistory = [entry, ...this._psiHistory].slice(0, PSI_MAX_RUNS);
    toast.positive('Lighthouse run completed.');

    fetch(`${PSI_STORE_BASE}/psi/${this._org}/${this._site}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry),
    }).catch(() => {});
  }

  async _handleTogglePsiEnabled(e) {
    this._psiEnabled = e.target.checked;
    this._psiToggleSaving = true;
    const pub = this._config?.public || {};
    const updated = { ...pub, psi: { ...(pub.psi || {}), enabled: this._psiEnabled } };
    const { status, error: apiError } = await savePublicConfig(this._org, this._site, updated);
    this._psiToggleSaving = false;
    const err = getApiError(status, 'save PSI auto-run', apiError);
    if (err) {
      toast.negative(err);
      this._psiEnabled = !this._psiEnabled;
    } else {
      this._config = { ...this._config, public: updated };
      if (this._psiEnabled) {
        this._showPsiDialog = true;
      } else {
        toast.positive('PSI auto-run disabled.');
      }
    }
  }

  async _handleSyncCode() {
    const owner = this._config?.code?.owner;
    const repo = this._config?.code?.repo;
    if (!owner || !repo) {
      toast.negative('Code source (owner/repo) not configured.');
      return;
    }

    this._syncingCode = true;
    const { status, error } = await syncCode(owner, repo);
    this._syncingCode = false;

    const err = getApiError(status, 'sync code', error);
    if (err) {
      toast.negative(err);
    } else {
      toast.positive('Code sync triggered.');
    }
  }

  _getConfigTableRows() {
    const c = this._config;
    if (!c) return [];

    const rows = [];
    if (c.code?.owner) rows.push({ key: 'Organization', value: c.code.owner });
    if (c.code?.owner && c.code?.repo) {
      const repoUrl = `https://github.com/${c.code.owner}/${c.code.repo}`;
      rows.push({ key: 'Code Repository', value: repoUrl, link: true });
    }
    if (c.content?.source?.url) {
      const editorUrl = getDAEditorURL(c.content.source.url);
      rows.push({
        key: 'Content Repository',
        value: editorUrl || c.content.source.url,
        label: editorUrl || c.content.source.url,
        link: true,
      });
    }
    if (c.cdn?.prod?.host) {
      const prodUrl = `https://${c.cdn.prod.host}/`;
      rows.push({ key: 'Production', value: prodUrl, link: true });
    }
    return rows;
  }

  _hasPreviewAuth() {
    const access = this._config?.access || {};
    return !!(access.preview || access.site);
  }

  _hasLiveAuth() {
    const access = this._config?.access || {};
    return !!(access.live || access.site);
  }

  static _ACTION_ROUTES = new Set(['preview', 'live', 'code', 'index', 'config']);

  get _recentActivity() {
    return this._logEntries
      .filter((e) => SiteOverview._ACTION_ROUTES.has(e.route))
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, 10)
      .map((e) => ({
        timestamp: e.timestamp,
        user: e.user || '',
        action: e.route,
        path: e.path || '/',
      }));
  }

  static _relativeTime(ts) {
    const ms = new Date(ts).getTime();
    if (Number.isNaN(ms)) return '—';
    const diff = Math.max(0, Math.floor((Date.now() - ms) / 1000));
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  }

  static _actionLabel(route) {
    const map = { preview: 'Preview', live: 'Publish', code: 'Code Sync', index: 'Index', config: 'Config' };
    return map[route] || route;
  }

  static _actionVariant(route) {
    const map = { preview: 'info', live: 'positive', code: 'neutral', index: 'neutral', config: 'neutral' };
    return map[route] || 'neutral';
  }

  _renderRecentActivity() {
    const items = this._recentActivity;
    if (items.length === 0) {
      return html`<p class="text-muted">No recent activity in the last 7 days.</p>`;
    }
    return html`
      <table class="eds-table compact">
        <thead>
          <tr>
            <th>When</th>
            <th>User</th>
            <th>Action</th>
            <th>Path</th>
          </tr>
        </thead>
        <tbody>
          ${items.map((item) => {
            const userShort = item.user.includes('@') ? item.user.split('@')[0] : item.user;
            return html`
              <tr>
                <td>${SiteOverview._relativeTime(item.timestamp)}</td>
                <td title="${item.user}">${userShort}</td>
                <td><span class="action-badge action-badge--${SiteOverview._actionVariant(item.action)}">${SiteOverview._actionLabel(item.action)}</span></td>
                <td title="${item.path}">${item.path}</td>
              </tr>
            `;
          })}
        </tbody>
      </table>
    `;
  }

  // --- Traffic Snapshot ---

  static _formatNumber(n) {
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
    return String(n);
  }

  static _extractCwv(bundle, lcpArr, clsArr, inpArr) {
    if (!bundle.events) return;
    for (const evt of bundle.events) {
      if (evt.checkpoint === 'cwv-lcp' && evt.value != null) lcpArr.push(evt.value);
      else if (evt.checkpoint === 'cwv-cls' && evt.value != null) clsArr.push(evt.value);
      else if (evt.checkpoint === 'cwv-inp' && evt.value != null) inpArr.push(evt.value);
    }
  }

  static _percentile75(arr) {
    if (arr.length === 0) return null;
    const sorted = [...arr].sort((a, b) => a - b);
    const idx = Math.floor(sorted.length * 0.75);
    return sorted[Math.min(idx, sorted.length - 1)];
  }

  static _CWV_THRESHOLDS = {
    lcp: { good: 2500, poor: 4000 },
    cls: { good: 0.1, poor: 0.25 },
    inp: { good: 200, poor: 500 },
  };

  static _scoreCwv(metric, value) {
    if (value == null) return null;
    const t = SiteOverview._CWV_THRESHOLDS[metric];
    if (value <= t.good) return 'good';
    if (value <= t.poor) return 'needs-improvement';
    return 'poor';
  }

  static _formatCwv(metric, value) {
    if (value == null) return '—';
    if (metric === 'lcp') return `${(value / 1000).toFixed(2)}s`;
    if (metric === 'cls') return value.toFixed(3);
    if (metric === 'inp') return `${Math.round(value)}ms`;
    return String(value);
  }

  _renderTrafficSnapshot() {
    const domainkey = this._config?.public?.rum?.domainkey;
    if (!domainkey) {
      return html`
        <p class="text-muted">
          Request a RUM domain key from Adobe and enter it here.  The best practice is to use the public-facing domain which generates user traffic, as the data from development URLs will generally be too sparse to be meaningful.
        </p>
        <div class="rum-key-form">
          <eds-textfield
            size="s"
            placeholder="Domain key"
            .value=${this._rumKeyInput}
            @input=${(e) => { this._rumKeyInput = e.target.value; }}
          ></eds-textfield>
          <eds-button
            size="s"
            variant="accent"
            ?disabled=${this._rumKeySaving || !this._rumKeyInput?.trim()}
            @click=${this._saveRumDomainKey}
          >${this._rumKeySaving ? 'Saving…' : 'Save'}</eds-button>
        </div>
      `;
    }
    if (this._rumError) {
      return html`<p class="text-muted">Failed to load traffic data: ${this._rumError}</p>`;
    }
    if (!this._rumPageviews) {
      return html`<p class="text-muted">No traffic data available.</p>`;
    }
    const { total, daily, topPages, cwv } = this._rumPageviews;
    const activeDays = daily.filter((d) => d.views > 0).length || 1;
    const dailyAvg = Math.round(total / activeDays);
    const max = Math.max(1, ...daily.map((d) => d.views));

    const cwvMetrics = cwv ? [
      { key: 'lcp', label: 'LCP', value: cwv.lcp },
      { key: 'cls', label: 'CLS', value: cwv.cls },
      { key: 'inp', label: 'INP', value: cwv.inp },
    ] : [];

    return html`
      <div class="rum-metrics">
        <div class="rum-metric">
          <span class="rum-number">${SiteOverview._formatNumber(total)}</span>
          <span class="rum-label">pageviews</span>
        </div>
        <div class="rum-metric">
          <span class="rum-number">${SiteOverview._formatNumber(dailyAvg)}</span>
          <span class="rum-label">daily avg</span>
        </div>
      </div>
      <div class="rum-sparkline">
        ${daily.map((d) => {
          const pct = Math.max(4, Math.round((d.views / max) * 100));
          const dayLabel = new Date(d.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' });
          return html`<div class="rum-spark-col" title="${d.date}: ${d.views.toLocaleString()} views">
            <div class="rum-spark-bar" style="height:${pct}%"></div>
            <span class="rum-spark-label">${dayLabel}</span>
          </div>`;
        })}
      </div>
      ${cwvMetrics.some((m) => m.value != null) ? html`
        <div class="cwv-row">
          ${cwvMetrics.map((m) => {
            const score = SiteOverview._scoreCwv(m.key, m.value);
            return html`
              <div class="cwv-pill cwv-pill--${score || 'none'}" title="${m.label} p75: ${SiteOverview._formatCwv(m.key, m.value)}">
                <span class="cwv-label">${m.label}</span>
                <span class="cwv-value">${SiteOverview._formatCwv(m.key, m.value)}</span>
              </div>
            `;
          })}
        </div>
      ` : nothing}
      ${topPages && topPages.length > 0 ? html`
        <div class="rum-top-pages">
          <span class="rum-top-title">Top pages</span>
          ${topPages.map((p) => html`
            <div class="rum-top-row">
              <code class="rum-top-path" title="${p.path}">${p.path}</code>
              <span class="rum-top-views">${SiteOverview._formatNumber(p.views)}</span>
            </div>
          `)}
        </div>
      ` : nothing}
      <div style="margin-top: 12px;">
        <a href="${SiteOverview._rumExplorerUrl(this._config, this._org, this._site)}"
          target="_blank" rel="noopener noreferrer">
          <eds-button variant="secondary" size="s">
            <span slot="icon">${edsIcon('data', { size: 16 })}</span>
            View Full RUM Dashboard
          </eds-button>
        </a>
      </div>
    `;
  }

  static _rumExplorerUrl(config, org, site) {
    const domain = config?.cdn?.prod?.host || `main--${site}--${org}.aem.live`;
    const domainkey = config?.public?.rum?.domainkey || '';
    return `https://www.aem.live/tools/rum/explorer.html?domain=${encodeURIComponent(domain)}&domainkey=${encodeURIComponent(domainkey)}`;
  }

  render() {
    const previewUrl = `https://main--${this._site}--${this._org}.aem.page/`;
    const liveUrl = `https://main--${this._site}--${this._org}.aem.live/`;
    const cdnHost = this._config?.cdn?.prod?.host;
    const prodUrl = cdnHost ? `https://${cdnHost}/` : '';

    return html`
      <div class="page">
        <div class="page-header">
          <div>
            <h1 class="page-title">Site Overview</h1>
          </div>
          ${!this._loading && this._config
            ? html`
                <div class="header-actions">
                  <a href="${previewUrl}" target="_blank" rel="noopener noreferrer" class="env-link" title="${previewUrl}">
                    <eds-button variant="secondary" size="m" title="Open preview environment">
                      ${this._hasPreviewAuth()
                        ? html`<span slot="icon">${edsIcon('lock-closed', { size: 16 })}</span>`
                        : nothing}
                      Preview
                    </eds-button>
                  </a>
                  <a href="${liveUrl}" target="_blank" rel="noopener noreferrer" class="env-link" title="${liveUrl}">
                    <eds-button variant="secondary" size="m" title="Open live environment">
                      ${this._hasLiveAuth()
                        ? html`<span slot="icon">${edsIcon('lock-closed', { size: 16 })}</span>`
                        : nothing}
                      Live
                    </eds-button>
                  </a>
                  ${prodUrl ? html`
                    <a href="${prodUrl}" target="_blank" rel="noopener noreferrer" class="env-link" title="${prodUrl}">
                      <eds-button variant="accent" size="m" title="Open production site">
                        Production
                      </eds-button>
                    </a>
                  ` : nothing}
                </div>
              `
            : nothing}
        </div>

        <error-alert .error=${this._error} @retry=${this._load}></error-alert>

        ${this._loading
          ? html`
              <div class="loading">
                <div class="spinner" aria-label="Loading"></div>
              </div>
            `
          : html`
              <div class="sections">
                <section class="section">
                  <h2 class="section-title">Configuration</h2>
                  ${this._getConfigTableRows().length > 0
                    ? html`
                        <table class="eds-table">
                          <thead>
                            <tr>
                              <th>Property</th>
                              <th>Value</th>
                            </tr>
                          </thead>
                          <tbody>
                            ${this._getConfigTableRows().map(
                              (r) => html`
                                <tr>
                                  <td>${r.key}</td>
                                  <td>
                                    ${r.link
                                      ? html`<a href="${r.value}" target="_blank" rel="noopener noreferrer" class="config-link" title="${r.value}">${r.label || r.value}</a>`
                                      : html`<span title="${r.value}">${r.value}</span>`}
                                  </td>
                                </tr>
                              `,
                            )}
                          </tbody>
                        </table>
                      `
                    : html`<p class="text-muted">No config properties to display.</p>`}

                  <div class="code-sync-row">
                    <eds-button
                      variant="secondary"
                      size="s"
                      ?disabled=${this._syncingCode || !this._config?.code?.owner}
                      @click=${this._handleSyncCode}
                    >
                      <span slot="icon">${edsIcon('data-refresh', { size: 16 })}</span>
                      ${this._syncingCode ? 'Syncing...' : 'Code Sync'}
                    </eds-button>
                  </div>
                </section>

                <hr class="divider" />

                <section class="section">
                  <div class="psi-header">
                    <h2 class="section-title">Insights</h2>
                    <div class="psi-header-actions">
                      <eds-button
                        variant="accent"
                        size="s"
                        ?disabled=${this._psiRunning}
                        @click=${this._handleRunLighthouse}
                      >
                        ${this._psiRunning
                          ? html`
                              <div class="spinner s" slot="icon" aria-label="Running"></div>
                              Running...
                            `
                          : 'Run Lighthouse'}
                      </eds-button>
                      <span class="psi-toggle-row">
                        <label class="switch-label">
                          <input
                            type="checkbox"
                            role="switch"
                            .checked=${this._psiEnabled}
                            ?disabled=${this._psiToggleSaving}
                            @change=${this._handleTogglePsiEnabled}
                          />
                          ${this._psiToggleSaving ? 'Saving…' : 'Auto-run on deploy'}
                        </label>
                        <eds-button
                          size="s"
                          quiet
                          aria-label="PSI setup info"
                          @click=${() => (this._showPsiDialog = true)}
                        >
                          <span slot="icon">${edsIcon('info', { size: 16 })}</span>
                        </eds-button>
                      </span>
                    </div>
                  </div>
                  ${this._psiError
                    ? html`
                      <div class="psi-error-banner">
                        <eds-alert variant="negative" open>
                            Last PSI run failed — ${this._psiError}
                          </eds-alert>
                        </div>
                      `
                    : nothing}
                  ${this._psiHistory.length > 0
                    ? html`<psi-chart .runs=${this._psiHistory} width="100%"></psi-chart>`
                    : nothing}

                  <div class="insights-grid">
                    <admin-card heading="Operational Telemetry" ?loading=${this._rumLoading}>
                      ${this._renderTrafficSnapshot()}
                    </admin-card>
                    <admin-card heading="Recent Activity" ?loading=${this._logsLoading}>
                      ${this._renderRecentActivity()}
                    </admin-card>
                  </div>
                </section>
              </div>
            `}
      </div>

      ${this._showPsiDialog
        ? html`
            <eds-dialog
              open
              headline=${this._psiEnabled ? 'PSI Auto-Run Active' : 'Setup PSI Auto-Run'}
              size="l"
              @close=${() => { this._showPsiDialog = false; }}
            >
              ${this._psiEnabled
                ? html`<p>PSI auto-run has been enabled in the site config. To complete the setup, ensure you have an <a href="/${this._org}/${this._site}/api-keys">Admin API Key</a>,
                    the <code>AEM_ADMIN_API_KEY</code> secret is configured in your GitHub repo settings,
                    and the workflow below is in your repository at <code>.github/workflows/psi-on-deploy.yml</code>.</p>`
                : html`<p>To auto-run Lighthouse on every deploy, create an <a href="/${this._org}/${this._site}/api-keys">Admin API Key</a>,
                    add it as the <code>AEM_ADMIN_API_KEY</code> secret in your GitHub repo settings,
                    and add this workflow to your repository at <code>.github/workflows/psi-on-deploy.yml</code>.</p>`}
              <pre class="yaml-block">${buildPsiActionYaml(this._org, this._site)}</pre>
              <div class="dialog-buttons">
                <eds-button variant="accent" @click=${() => { this._showPsiDialog = false; }}>
                  Close
                </eds-button>
              </div>
            </eds-dialog>
          `
        : nothing}
    `;
  }

}

customElements.define('site-overview', SiteOverview);
