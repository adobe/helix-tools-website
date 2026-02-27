import { LitElement, html, nothing } from 'lit';
import { getRouteDetails, navigate } from '../../../utils/router.js';
import { toast } from '../../../controllers/toast-controller.js';
import {
  fetchOrgSites,
  fetchSiteConfig,
  fetchPsi,
  saveSiteConfig,
  createSiteConfig,
  deleteSiteConfig,
} from '../../../services/adminApi.js';
import { addProject, getFavorites, toggleFavorite } from '../../../services/storage.js';
import { getApiError } from '../../../utils/apiErrors.js';
import { getContentSourceType, getDAEditorURL } from '../../../utils/contentSource.js';
import { scoreColor, parsePsiScores } from '../../../utils/psi.js';
import '../../../blocks/admin-card/admin-card.js';
import '../../../blocks/error-alert/error-alert.js';
import '../../../blocks/eds-button/eds-button.js';
import '../../../blocks/eds-dialog/eds-dialog.js';
import '../../../blocks/eds-textfield/eds-textfield.js';
import '../../../blocks/eds-menu/eds-menu.js';
import '../../../blocks/eds-alert/eds-alert.js';
import { edsIcon } from '../../../utils/icons.js';

import getSheet from '../../../utils/sheet.js';
import { pageSheet, sharedSheet } from '../../../styles/page-sheets.js';
const sheet = await getSheet(new URL('./org-dashboard.css', import.meta.url).pathname);

const PSI_STORE_BASE = 'https://psi-store.aem-poc-lab.workers.dev';
const MAX_CONCURRENT_DETAIL_FETCHES = 6;

export class OrgDashboard extends LitElement {
  static properties = {
    _org: { state: true },
    _sites: { state: true },
    _siteDetails: { state: true },
    _loading: { state: true },
    _error: { state: true },
    _accessDenied: { state: true },
    _searchQuery: { state: true },
    _favorites: { state: true },
    _showAddDialog: { state: true },
    _newSiteName: { state: true },
    _newContentUrl: { state: true },
    _newCodeUrl: { state: true },
    _adding: { state: true },
    _isCloneMode: { state: true },
    _editTarget: { state: true },
    _editCodeUrl: { state: true },
    _editContentUrl: { state: true },
    _saving: { state: true },
    _deleteTarget: { state: true },
    _deleting: { state: true },
    _psiHistories: { state: true },
    _psiRunning: { state: true },
    _goToSite: { state: true },
  };

  constructor() {
    super();
    this._org = '';
    this._sites = [];
    this._siteDetails = {};
    this._loading = true;
    this._error = null;
    this._accessDenied = false;
    this._searchQuery = '';
    this._favorites = [];
    this._showAddDialog = false;
    this._newSiteName = '';
    this._newContentUrl = '';
    this._newCodeUrl = '';
    this._adding = false;
    this._isCloneMode = false;
    this._editTarget = null;
    this._editCodeUrl = '';
    this._editContentUrl = '';
    this._saving = false;
    this._deleteTarget = null;
    this._deleting = false;
    this._psiHistories = {};
    this._psiRunning = {};
    this._goToSite = '';

    this._observedSites = new Set();
    this._detailQueue = [];
    this._detailInflight = 0;
    this._cardObserver = null;
  }

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [pageSheet, sharedSheet, sheet];
    const details = getRouteDetails();
    this._org = details.org || '';

    this._cardObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const siteName = entry.target.dataset.site;
          if (siteName) {
            this._cardObserver.unobserve(entry.target);
            this._enqueueDetailFetch(siteName);
          }
        }
      },
      { rootMargin: '200px', threshold: 0 },
    );
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._cardObserver?.disconnect();
    this._cardObserver = null;
  }

  updated(changedProperties) {
    super.updated?.(changedProperties);
    if (changedProperties.has('_org') && this._org) {
      this._observedSites.clear();
      this._detailQueue.length = 0;
      this._detailInflight = 0;
      this._siteDetails = {};
      this._psiHistories = {};
      this._loadSites();
      this._favorites = getFavorites(this._org);
    }
    this._observeNewCards();
  }

  _observeNewCards() {
    if (!this._cardObserver) return;
    const cards = this.shadowRoot.querySelectorAll('admin-card[data-site]');
    for (const card of cards) {
      const siteName = card.dataset.site;
      if (siteName && !this._observedSites.has(siteName) && !this._siteDetails[siteName]) {
        this._cardObserver.observe(card);
      }
    }
  }

  async _loadSites() {
    if (!this._org) return;

    this._loading = true;
    this._error = null;
    this._accessDenied = false;

    const { data, status } = await fetchOrgSites(this._org);

    if (status === 401) {
      this._error = 'Session expired. Please sign in again.';
      this._loading = false;
      return;
    }
    if (status === 403) {
      this._accessDenied = true;
      this._loading = false;
      return;
    }
    if (status === 200 && data) {
      const siteList = data.sites || data;
      const list = Array.isArray(siteList) ? siteList : [];
      this._sites = list;
      if (list.length > 0) {
        addProject(this._org, list[0].name);
      }
    } else {
      this._error = `Failed to load sites (${status})`;
    }
    this._loading = false;
  }

  _enqueueDetailFetch(siteName) {
    if (this._observedSites.has(siteName)) return;
    this._observedSites.add(siteName);
    this._detailQueue.push(siteName);
    this._drainDetailQueue();
  }

  _drainDetailQueue() {
    while (this._detailQueue.length > 0 && this._detailInflight < MAX_CONCURRENT_DETAIL_FETCHES) {
      const name = this._detailQueue.shift();
      this._detailInflight++;
      this._fetchSiteConfig(name).finally(() => {
        this._detailInflight--;
        this._drainDetailQueue();
      });
    }
  }

  async _fetchSiteConfig(siteName) {
    const [{ data }, psiHistory] = await Promise.all([
      fetchSiteConfig(this._org, siteName),
      this._fetchPsiHistory(siteName),
    ]);
    if (psiHistory) {
      this._psiHistories = { ...this._psiHistories, [siteName]: psiHistory };
    }
    if (data) {
      this._siteDetails = { ...this._siteDetails, [siteName]: data };
    }
  }

  async _fetchPsiHistory(siteName) {
    try {
      const resp = await fetch(`${PSI_STORE_BASE}/psi/${this._org}/${siteName}`);
      if (!resp.ok) return null;
      const history = await resp.json();
      return Array.isArray(history) ? history : null;
    } catch { return null; }
  }

  _handleToggleFavorite(siteName) {
    this._favorites = toggleFavorite(this._org, siteName);
  }

  async _handleRunLighthouse(siteName) {
    this._psiRunning = { ...this._psiRunning, [siteName]: true };
    const testUrl = `https://main--${siteName}--${this._org}.aem.live/`;
    const { data } = await fetchPsi(this._org, siteName, testUrl);

    if (data?.lighthouseResult?.categories) {
      const scores = parsePsiScores(data.lighthouseResult.categories);
      const entry = { timestamp: Date.now(), scores };
      const prevHistory = this._psiHistories[siteName] || [];
      this._psiHistories = {
        ...this._psiHistories,
        [siteName]: [entry, ...prevHistory].slice(0, 20),
      };
      toast.positive(`Lighthouse run completed for ${siteName}.`);

      fetch(`${PSI_STORE_BASE}/psi/${this._org}/${siteName}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry),
      }).catch(() => {});
    } else {
      toast.negative(`Lighthouse run failed for ${siteName}.`);
    }

    this._psiRunning = { ...this._psiRunning, [siteName]: false };
  }

  _handleClone(siteName, codeUrl, contentUrl) {
    this._newSiteName = '';
    this._newContentUrl = contentUrl || '';
    this._newCodeUrl = codeUrl || '';
    this._isCloneMode = true;
    this._showAddDialog = true;
  }

  _handleEdit(siteName, codeUrl, contentUrl) {
    this._editTarget = siteName;
    this._editCodeUrl = codeUrl || '';
    this._editContentUrl = contentUrl || '';
  }

  async _handleEditSave() {
    if (!this._editTarget) return;

    this._saving = true;
    this._error = null;

    const existing = this._siteDetails[this._editTarget] || {};
    const updated = { ...existing };
    const codeSrc = this._editCodeUrl.trim();
    const contentSrc = this._editContentUrl.trim();

    if (codeSrc) {
      try {
        const codeURL = new URL(codeSrc);
        const [, owner, repo] = codeURL.pathname.split('/');
        updated.code = {
          ...(existing.code || {}),
          owner,
          repo,
          source: { type: 'github', url: codeSrc },
        };
      } catch {
        updated.code = {
          ...(existing.code || {}),
          source: { ...(existing.code?.source || {}), url: codeSrc },
        };
      }
    }
    if (contentSrc) {
      const source = { ...(existing.content?.source || {}), url: contentSrc };
      try {
        if (contentSrc.startsWith('https://drive.google.com/drive')) {
          const contentURL = new URL(contentSrc);
          source.type = 'google';
          source.id = contentURL.pathname.split('/').pop();
        } else if (contentSrc.includes('sharepoint.com/')) {
          source.type = 'onedrive';
        } else if (contentSrc.includes('da.live/')) {
          source.type = 'markup';
        }
      } catch {
        /* keep existing */
      }
      updated.content = { ...(existing.content || {}), source };
    }

    const { status, error } = await saveSiteConfig(this._org, this._editTarget, updated);
    this._saving = false;

    const err = getApiError(status, 'save site config', error);
    if (err) {
      this._error = err;
      return;
    }

    toast.positive('Site config updated.', 3000);
    const target = this._editTarget;
    this._editTarget = null;
    const { data } = await fetchSiteConfig(this._org, target);
    if (data) {
      this._siteDetails = { ...this._siteDetails, [target]: data };
    }
  }

  _handleDeleteRequest(siteName) {
    this._deleteTarget = siteName;
  }

  async _handleDeleteConfirm() {
    if (!this._deleteTarget) return;

    this._deleting = true;
    this._error = null;

    const { status, error } = await deleteSiteConfig(this._org, this._deleteTarget);
    this._deleting = false;

    const err = getApiError(status, 'delete site', error);
    if (err) {
      this._error = err;
      return;
    }

    toast.positive('Site deleted.', 3000);
    const nameToRemove = this._deleteTarget;
    this._deleteTarget = null;
    this._observedSites.delete(nameToRemove);
    delete this._siteDetails[nameToRemove];
    delete this._psiHistories[nameToRemove];
    this._siteDetails = { ...this._siteDetails };
    this._psiHistories = { ...this._psiHistories };
    await this._loadSites();
  }

  async _handleAddSite() {
    if (!this._newSiteName.trim()) return;

    this._adding = true;
    this._error = null;

    const config = {};
    const codeSrc = this._newCodeUrl.trim();
    const contentSrc = this._newContentUrl.trim();

    if (codeSrc) {
      try {
        const codeURL = new URL(codeSrc);
        const [, owner, repo] = codeURL.pathname.split('/');
        config.code = { owner, repo, source: { type: 'github', url: codeSrc } };
      } catch {
        config.code = { source: { url: codeSrc } };
      }
    }
    if (contentSrc) {
      const content = { source: { type: 'markup', url: contentSrc } };
      try {
        if (contentSrc.startsWith('https://drive.google.com/drive')) {
          const contentURL = new URL(contentSrc);
          content.source.type = 'google';
          content.source.id = contentURL.pathname.split('/').pop();
        } else if (contentSrc.includes('sharepoint.com/')) {
          content.source.type = 'onedrive';
        } else if (contentSrc.includes('da.live/')) {
          content.source.type = 'markup';
        }
      } catch {
        /* defaults */
      }
      config.content = content;
    }

    const { status, error } = await createSiteConfig(this._org, this._newSiteName.trim(), config);
    this._adding = false;

    const err = getApiError(status, 'add site', error);
    if (err) {
      this._error = err;
      return;
    }

    toast.positive(this._isCloneMode ? 'Site cloned.' : 'Site added.', 3000);
    this._showAddDialog = false;
    this._newSiteName = '';
    this._newContentUrl = '';
    this._newCodeUrl = '';
    await this._loadSites();
  }

  _handleNavigate(path) {
    navigate(`/${this._org}/${path}`);
  }

  _handleGoToSite() {
    const name = this._goToSite.trim();
    if (!name) return;
    addProject(this._org, name);
    navigate(`/${this._org}/${name}`);
  }

  _openAddDialog() {
    this._newSiteName = '';
    this._newContentUrl = '';
    this._newCodeUrl = '';
    this._isCloneMode = false;
    this._showAddDialog = true;
  }

  _closeAddDialog() {
    this._showAddDialog = false;
  }

  _closeEditDialog() {
    this._editTarget = null;
  }

  _closeDeleteDialog() {
    this._deleteTarget = null;
  }

  _renderSiteCard(site) {
    const details = this._siteDetails[site.name];
    const isLoading = !details;
    const contentUrl = details?.content?.source?.url || '';
    const contentSourceType = details?.content?.source?.type || '';
    const codeUrl = details?.code?.source?.url || '';
    const cdnHost = details?.cdn?.prod?.host || details?.cdn?.host;
    const hasPreviewAuth = !!(details?.access?.preview || details?.access?.site);
    const hasLiveAuth = !!(details?.access?.live || details?.access?.site);
    const source = getContentSourceType(contentUrl, contentSourceType);
    const contentEditorUrl = getDAEditorURL(contentUrl);
    const previewUrl = `https://main--${site.name}--${this._org}.aem.page/`;
    const liveUrl = `https://main--${site.name}--${this._org}.aem.live/`;
    const isFavorite = this._favorites.includes(site.name);
    const psiHistory = this._psiHistories[site.name] || [];
    const psiRunning = !!this._psiRunning[site.name];

    const validHistory = psiHistory.filter((run) => {
      const s = run?.scores || {};
      return Object.values(s).some((v) => v > 0);
    });
    const cats = [
      { id: 'performance', label: 'Perf' },
      { id: 'accessibility', label: 'A11y' },
      { id: 'best-practices', label: 'BP' },
    ];

    const psiContent = (() => {
      if (hasLiveAuth) return null;
      if (psiRunning) {
        return html`
          <div class="card-psi-running">
            <div class="spinner s" aria-label="Running Lighthouse"></div>
            <span class="text-muted">Running Lighthouse...</span>
          </div>
        `;
      }
      if (validHistory.length === 0) return null;
      const scores = validHistory[0]?.scores || {};
      const ts = validHistory[0]?.timestamp;
      const dateStr = ts
        ? new Date(ts).toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })
        : null;
      return html`
        <div class="card-psi">
          <div class="psi-scores">
            ${cats.map((cat) => {
              const s = scores[cat.id];
              if (s == null) return null;
              const color = scoreColor(s);
              return html`
                <span
                  class="psi-badge"
                  style="background: ${color}18; border: 1px solid ${color}40; color: ${color}"
                >
                  <span class="psi-value">${s}</span>
                  <span class="psi-label">${cat.label}</span>
                </span>
              `;
            })}
          </div>
          ${dateStr
            ? html`<span class="psi-date">Last run: ${dateStr}</span>`
            : ''}
        </div>
      `;
    })();

    return html`
      <admin-card heading=${site.name} data-site=${site.name} ?loading=${isLoading}>
        ${!isLoading
          ? html`<span slot="subheading" class="source-badge">${source.label}</span>`
          : nothing}
        ${!isLoading
          ? html`
              <eds-menu quiet slot="actions" label="More actions" placement="bottom-end" @click=${(e) => e.stopPropagation()}>
                <span slot="trigger">${edsIcon('more', { size: 18 })}</span>
                <button role="menuitem" @click=${() => this._handleToggleFavorite(site.name)}>
                  ${isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                </button>
                ${!hasLiveAuth
                  ? html`
                      <button role="menuitem" @click=${() => this._handleRunLighthouse(site.name)}>
                        Run Lighthouse
                      </button>
                    `
                  : nothing}
                <button role="menuitem" @click=${() => this._handleEdit(site.name, codeUrl, contentUrl)}>
                  Edit Source Config
                </button>
                <button role="menuitem" @click=${() => this._handleClone(site.name, codeUrl, contentUrl)}>
                  Clone Site Config
                </button>
                <button role="menuitem" @click=${() => this._handleDeleteRequest(site.name)}>
                  Delete Site
                </button>
              </eds-menu>
            `
          : nothing}
        <div class="card-body">
          <div class="card-description">
            ${cdnHost
              ? html`
                  <span class="status-light s positive">Online</span>
                  <a
                    class="card-domain-link"
                    href="https://${cdnHost}/"
                    target="_blank"
                    rel="noopener noreferrer"
                    @click=${(e) => e.stopPropagation()}
                  >
                    ${cdnHost}
                  </a>
                `
              : html`
                  <span class="status-light s neutral">No CDN configured</span>
                  <a
                    class="card-domain-link"
                    href="${`/${this._org}/${site.name}/cdn`}"
                    @click=${(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      this._handleNavigate(`${site.name}/cdn`);
                    }}
                  >
                    Configure a CDN
                  </a>
                `}
          </div>
          ${psiContent ? psiContent : nothing}
        </div>
        <div slot="footer" class="card-footer-bar" @click=${(e) => e.stopPropagation()}>
          <div class="card-footer-left">
            <eds-button
              size="s"
              variant="secondary"
              ?disabled=${isLoading}
              @click=${() => !isLoading && window.open(previewUrl, '_blank')}
            >
              ${hasPreviewAuth ? html`<span slot="icon">${edsIcon('lock-closed', { size: 14 })}</span>` : nothing}
              Preview
            </eds-button>
            <eds-button
              size="s"
              variant="accent"
              ?disabled=${isLoading}
              @click=${() => !isLoading && window.open(liveUrl, '_blank')}
            >
              ${hasLiveAuth ? html`<span slot="icon">${edsIcon('lock-closed', { size: 14 })}</span>` : nothing}
              Live
            </eds-button>
          </div>
          <div class="card-footer-right">
            ${isLoading || codeUrl
              ? html`
                  <eds-button
                    size="s"
                    quiet
                    aria-label="Open code repository"
                    @click=${() => !isLoading && codeUrl && window.open(codeUrl, '_blank')}
                  >
                    <span slot="icon">${edsIcon('code', { size: 16 })}</span>
                  </eds-button>
                `
              : nothing}
            ${isLoading || contentEditorUrl
              ? html`
                  <eds-button
                    size="s"
                    quiet
                    aria-label="Open content editor"
                    @click=${() => !isLoading && contentEditorUrl && window.open(contentEditorUrl, '_blank')}
                  >
                    <span slot="icon">${edsIcon('document', { size: 16 })}</span>
                  </eds-button>
                `
              : nothing}
            <eds-button
              size="s"
              quiet
              aria-label="Manage site"
              @click=${() => this._handleNavigate(site.name)}
            >
              <span slot="icon">${edsIcon('settings', { size: 16 })}</span>
            </eds-button>
          </div>
        </div>
      </admin-card>
    `;
  }

  render() {
    const filtered = this._sites.filter((s) =>
      s.name.toLowerCase().includes(this._searchQuery.toLowerCase()),
    );
    const favSites = filtered
      .filter((s) => this._favorites.includes(s.name))
      .sort((a, b) => a.name.localeCompare(b.name));
    const otherSites = filtered
      .filter((s) => !this._favorites.includes(s.name))
      .sort((a, b) => a.name.localeCompare(b.name));

    return html`
      <div class="org-dashboard">
        <div class="header-row">
          <div>
            <h1 class="page-title">Sites</h1>
            <span class="page-subtitle">
              ${this._accessDenied ? this._org : nothing}
              ${!this._accessDenied
                ? (this._loading
                    ? 'Loading sites...'
                    : `${this._sites.length} site${this._sites.length !== 1 ? 's' : ''} in ${this._org}`)
                : nothing}
            </span>
          </div>
          ${!this._loading && !this._error && !this._accessDenied ? html`
            <eds-button variant="accent" @click=${this._openAddDialog}>
              <span slot="icon">${edsIcon('add', { size: 16 })}</span>
              Add Site
            </eds-button>
          ` : nothing}
        </div>

        ${!this._accessDenied
          ? html`
              <input
                type="search"
                class="search-input search-field"
                placeholder="Search sites"
                .value=${this._searchQuery}
                @input=${(e) => {
                  this._searchQuery = e.target?.value ?? '';
                }}
              />
            `
          : nothing}

        ${this._loading
          ? html`
              <div class="card-grid">
                ${Array.from({ length: 3 }, () => html`<admin-card loading></admin-card>`)}
              </div>
            `
          : nothing}

        ${this._error
          ? html`
              <div class="error-section">
                <eds-alert variant="negative" open> ${this._error} </eds-alert>
                ${this._error.includes('Session expired')
                  ? html`
                      <eds-button variant="accent" @click=${() => navigate('/')}>
                        Sign in
                      </eds-button>
                    `
                  : nothing}
              </div>
            `
          : nothing}

        ${!this._loading && this._accessDenied
          ? html`
              <div class="access-denied-section">
                <eds-alert variant="info" open>
                  You don't have access to list all sites in this organization. Use the site picker
                  in the header or enter a site name below to navigate directly.
                </eds-alert>
                <div class="go-to-site">
                  <h3>Go to a specific site</h3>
                  <div class="go-to-site-row">
                    <label class="field-label" for="go-to-site-name">Site name</label>
                    <eds-textfield
                      id="go-to-site-name"
                      placeholder="my-website"
                      .value=${this._goToSite}
                      @input=${(e) => {
                        this._goToSite = e.target?.value ?? e.detail?.value ?? '';
                      }}
                      @keydown=${(e) => {
                        if (e.key === 'Enter') this._handleGoToSite();
                      }}
                    ></eds-textfield>
                    <eds-button
                      variant="accent"
                      @click=${this._handleGoToSite}
                      ?disabled=${!this._goToSite.trim()}
                    >
                      Go
                    </eds-button>
                  </div>
                </div>
              </div>
            `
          : nothing}

        ${!this._loading && !this._error && !this._accessDenied
          ? html`
              ${favSites.length > 0
                ? html`
                    <div class="section">
                      <div class="section-header">
                        <span>${edsIcon('star', { size: 16 })}</span>
                        <h3>Favorites</h3>
                      </div>
                      <div class="card-grid">
                        ${favSites.map((s) => this._renderSiteCard(s))}
                      </div>
                    </div>
                  `
                : nothing}

              ${favSites.length > 0 && otherSites.length > 0
                ? html`<hr class="divider" />`
                : nothing}

              ${otherSites.length > 0
                ? html`
                    <div class="section">
                      ${favSites.length > 0
                        ? html`<h3 class="section-title">All Sites</h3>`
                        : nothing}
                      <div class="card-grid">
                        ${otherSites.map((s) => this._renderSiteCard(s))}
                      </div>
                    </div>
                  `
                : nothing}

              ${filtered.length === 0 && this._searchQuery
                ? html`<p class="text-muted">No sites matching "${this._searchQuery}"</p>`
                : nothing}
              ${filtered.length === 0 && !this._searchQuery
                ? html`<p class="text-muted">No sites yet. Add one to get started.</p>`
                : nothing}
            `
          : nothing}
      </div>

      ${this._showAddDialog
        ? html`
            <eds-dialog
              open
              headline=${this._isCloneMode ? 'Clone Site' : 'Add Site'}
              size="m"
              @close=${this._closeAddDialog}
            >
              <label class="field-label" for="add-site-name">Site name</label>
              <eds-textfield
                id="add-site-name"
                placeholder="my-website"
                .value=${this._newSiteName}
                @input=${(e) => {
                  this._newSiteName = e.target?.value ?? e.detail?.value ?? '';
                }}
                required
              ></eds-textfield>
              <label class="field-label" for="add-content-url">Content source URL</label>
              <eds-textfield
                id="add-content-url"
                placeholder="https://drive.google.com/..."
                .value=${this._newContentUrl}
                @input=${(e) => {
                  this._newContentUrl = e.target?.value ?? e.detail?.value ?? '';
                }}
              ></eds-textfield>
              <label class="field-label" for="add-code-url">Code source URL</label>
              <eds-textfield
                id="add-code-url"
                placeholder="https://github.com/..."
                .value=${this._newCodeUrl}
                @input=${(e) => {
                  this._newCodeUrl = e.target?.value ?? e.detail?.value ?? '';
                }}
              ></eds-textfield>
              <div class="dialog-buttons">
                <eds-button variant="secondary" treatment="outline" @click=${this._closeAddDialog}>Cancel</eds-button>
                <eds-button
                  variant="accent"
                  @click=${this._handleAddSite}
                  ?disabled=${!this._newSiteName.trim() || this._adding}
                >
                  ${this._adding ? 'Adding...' : this._isCloneMode ? 'Clone' : 'Add Site'}
                </eds-button>
              </div>
            </eds-dialog>
          `
        : ''}

      ${this._editTarget
        ? html`
            <eds-dialog
              open
              headline="Edit Source Config"
              size="m"
              @close=${this._closeEditDialog}
            >
              <p class="dialog-subtitle">${this._editTarget}</p>
              <label class="field-label" for="edit-content-url">Content source URL</label>
              <eds-textfield
                id="edit-content-url"
                placeholder="https://drive.google.com/..."
                .value=${this._editContentUrl}
                @input=${(e) => {
                  this._editContentUrl = e.target?.value ?? e.detail?.value ?? '';
                }}
              ></eds-textfield>
              <label class="field-label" for="edit-code-url">Code source URL</label>
              <eds-textfield
                id="edit-code-url"
                placeholder="https://github.com/..."
                .value=${this._editCodeUrl}
                @input=${(e) => {
                  this._editCodeUrl = e.target?.value ?? e.detail?.value ?? '';
                }}
              ></eds-textfield>
              <div class="dialog-buttons">
                <eds-button variant="secondary" treatment="outline" @click=${this._closeEditDialog}>Cancel</eds-button>
                <eds-button
                  variant="accent"
                  @click=${this._handleEditSave}
                  ?disabled=${this._saving}
                >
                  ${this._saving ? 'Saving...' : 'Save'}
                </eds-button>
              </div>
            </eds-dialog>
          `
        : ''}

      ${this._deleteTarget
        ? html`
            <eds-dialog
              open
              headline="Delete Site"
              size="s"
              @close=${this._closeDeleteDialog}
            >
              <p>
                Are you sure you want to delete "${this._deleteTarget}"? This action cannot be
                undone.
              </p>
              <div class="dialog-buttons">
                <eds-button variant="secondary" treatment="outline" @click=${this._closeDeleteDialog}>Cancel</eds-button>
                <eds-button
                  variant="negative"
                  @click=${this._handleDeleteConfirm}
                  ?disabled=${this._deleting}
                >
                  ${this._deleting ? 'Deleting...' : 'Delete'}
                </eds-button>
              </div>
            </eds-dialog>
          `
        : ''}
    `;
  }

}

customElements.define('org-dashboard', OrgDashboard);
