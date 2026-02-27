import { LitElement, html, nothing } from 'lit';
import { getRouteDetails } from '../../../utils/router.js';
import { toast } from '../../../controllers/toast-controller.js';
import {
  fetchSitemapConfig,
  saveSitemapConfig,
} from '../../../services/adminApi.js';
import { getApiError } from '../../../utils/apiErrors.js';
import '../../../blocks/error-alert/error-alert.js';
import '../../../blocks/admin-card/admin-card.js';
import { parse, stringify } from 'yaml';
import '../../../blocks/eds-button/eds-button.js';
import '../../../blocks/eds-dialog/eds-dialog.js';
import '../../../blocks/eds-textfield/eds-textfield.js';
import { edsIcon } from '../../../utils/icons.js';
import getSheet from '../../../utils/sheet.js';
import { pageSheet, sharedSheet } from '../../../styles/page-sheets.js';
const sheet = await getSheet(new URL('./site-sitemaps.css', import.meta.url).pathname);

export class SiteSitemaps extends LitElement {
  static properties = {
    _org: { state: true },
    _site: { state: true },
    _yamlRaw: { state: true },
    _sitemaps: { state: true },
    _loading: { state: true },
    _saving: { state: true },
    _error: { state: true },
    _showDialog: { state: true },
    _editingSitemap: { state: true },
    _dialogType: { state: true },
    _dialogStep: { state: true },
    _dialogForm: { state: true },
    _deleteConfirm: { state: true },
  };

  constructor() {
    super();
    this._org = '';
    this._site = '';
    this._yamlRaw = '';
    this._sitemaps = [];
    this._loading = true;
    this._saving = false;
    this._error = null;
    this._showDialog = false;
    this._editingSitemap = null;
    this._dialogType = 'simple';
    this._dialogStep = 'type';
    this._dialogForm = this._emptySimpleForm();
    this._deleteConfirm = null;
  }

  _emptySimpleForm() {
    return {
      name: '',
      source: '/query-index.json',
      destination: '/sitemap.xml',
      origin: '',
      lastmod: '',
    };
  }

  _emptyMultilangForm() {
    return {
      name: '',
      languages: [{ source: '/query-index.json', destination: '/sitemap-en.xml', alternate: '', hreflang: 'en' }],
    };
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
    if ((changedProperties.has('_org') || changedProperties.has('_site')) && this._org && this._site) {
      this._load();
    }
  }

  async _load() {
    if (!this._org || !this._site) return;
    this._loading = true;
    this._error = null;
    const { data, status, error } = await fetchSitemapConfig(this._org, this._site);
    const err = getApiError(status, 'load sitemap config', error);
    if (err) { this._error = err; this._loading = false; return; }
    this._yamlRaw = data || '';
    this._parseSitemaps();
    this._loading = false;
  }

  _parseSitemaps() {
    this._sitemaps = [];
    if (!this._yamlRaw?.trim()) return;
    try {
      const parsed = parse(this._yamlRaw);
      const smObj = parsed?.sitemaps || {};
      this._sitemaps = Object.entries(smObj).map(([name, cfg]) => {
        const hasLanguages = Array.isArray(cfg.languages) && cfg.languages.length > 0;
        return {
          name,
          type: hasLanguages ? 'multilang' : 'simple',
          ...(hasLanguages
            ? { languages: cfg.languages }
            : {
              source: cfg.source || '',
              destination: cfg.destination || '',
              origin: cfg.origin || '',
              lastmod: cfg.lastmod || '',
            }),
        };
      });
    } catch {
      this._sitemaps = [];
    }
  }

  _buildYamlFromSitemaps() {
    const obj = { version: 1, sitemaps: {} };
    for (const sm of this._sitemaps) {
      if (sm.type === 'multilang' && sm.languages?.length) {
        obj.sitemaps[sm.name] = { languages: sm.languages };
      } else {
        obj.sitemaps[sm.name] = {
          source: sm.source || '/query-index.json',
          destination: sm.destination || '/sitemap.xml',
          ...(sm.origin ? { origin: sm.origin } : {}),
          ...(sm.lastmod ? { lastmod: sm.lastmod } : {}),
        };
      }
    }
    return stringify(obj);
  }

  _openAdd() {
    this._editingSitemap = null;
    this._dialogStep = 'type';
    this._dialogType = 'simple';
    this._dialogForm = this._emptySimpleForm();
    this._showDialog = true;
  }

  _selectType(type) {
    this._dialogType = type;
    this._dialogForm = type === 'multilang' ? this._emptyMultilangForm() : this._emptySimpleForm();
    this._dialogStep = 'form';
  }

  _openEdit(sm) {
    this._editingSitemap = sm.name;
    this._dialogType = sm.type || 'simple';
    this._dialogStep = 'form';
    if (sm.type === 'multilang') {
      this._dialogForm = {
        name: sm.name,
        languages: (sm.languages || []).map((l) => ({
          source: l.source || '',
          destination: l.destination || '',
          alternate: l.alternate || '',
          hreflang: l.hreflang || '',
        })),
      };
    } else {
      this._dialogForm = {
        name: sm.name,
        source: sm.source || '/query-index.json',
        destination: sm.destination || '/sitemap.xml',
        origin: sm.origin || '',
        lastmod: sm.lastmod || '',
      };
    }
    this._showDialog = true;
  }

  _closeDialog() {
    this._showDialog = false;
    this._editingSitemap = null;
  }

  _addLang() {
    this._dialogForm = {
      ...this._dialogForm,
      languages: [...(this._dialogForm.languages || []), { source: '', destination: '', alternate: '', hreflang: '' }],
    };
  }

  _removeLang(i) {
    const arr = [...(this._dialogForm.languages || [])];
    arr.splice(i, 1);
    this._dialogForm = { ...this._dialogForm, languages: arr };
  }

  async _saveDialog() {
    const form = this._dialogForm;
    if (!form.name?.trim()) { toast.negative('Sitemap name is required.'); return; }

    const sitemaps = [...this._sitemaps];
    const existing = sitemaps.find((i) => i.name === form.name);
    if (existing && this._editingSitemap !== form.name) { toast.negative('A sitemap with that name already exists.'); return; }
    const idx = existing ? sitemaps.indexOf(existing) : -1;

    if (this._dialogType === 'multilang') {
      const languages = (form.languages || []).filter((l) => l.source?.trim() && l.destination?.trim());
      if (languages.length === 0) { toast.negative('At least one language with source and destination is required.'); return; }
      const data = { name: form.name, type: 'multilang', languages };
      if (idx >= 0) sitemaps[idx] = data; else sitemaps.push(data);
    } else {
      const data = {
        name: form.name,
        type: 'simple',
        source: form.source?.trim() || '/query-index.json',
        destination: form.destination?.trim() || '/sitemap.xml',
        origin: form.origin?.trim() || '',
        lastmod: form.lastmod?.trim() || '',
      };
      if (idx >= 0) sitemaps[idx] = data; else sitemaps.push(data);
    }

    this._sitemaps = sitemaps;
    this._yamlRaw = this._buildYamlFromSitemaps();

    this._saving = true;
    const { status, error } = await saveSitemapConfig(this._org, this._site, this._yamlRaw, { create: false });
    this._saving = false;
    const err = getApiError(status, 'save sitemap config', error);
    if (err) { toast.negative(err); return; }

    toast.positive('Sitemap configuration saved.');
    this._closeDialog();
  }

  async _handleDeleteSitemap() {
    const name = this._deleteConfirm;
    if (!name) return;
    this._deleteConfirm = null;
    this._sitemaps = this._sitemaps.filter((s) => s.name !== name);
    this._yamlRaw = this._buildYamlFromSitemaps();
    this._saving = true;
    const { status, error } = await saveSitemapConfig(this._org, this._site, this._yamlRaw, { create: false });
    this._saving = false;
    const err = getApiError(status, 'save sitemap config', error);
    if (err) { toast.negative(err); return; }
    toast.positive(`Sitemap "${name}" deleted.`);
  }

  _renderCard(sm) {
    return html`
      <admin-card heading=${sm.name} subheading=${sm.type === 'multilang' ? 'Multilang' : 'Simple'}>
        <div class="sm-card-meta">
          ${sm.type === 'simple' ? html`
            <span>Source: ${sm.source}</span>
            <span>Destination: ${sm.destination}</span>
          ` : html`
            <span>Languages: ${(sm.languages || []).map((l) => l.hreflang || l.destination).join(', ')}</span>
          `}
        </div>
        <div slot="footer" class="sm-card-footer">
          <eds-button size="m" variant="secondary" @click=${() => this._openEdit(sm)}>Edit</eds-button>
          <eds-button quiet aria-label="Delete sitemap" @click=${() => { this._deleteConfirm = sm.name; }}>
            <span slot="icon">${edsIcon('delete', { size: 16 })}</span>
          </eds-button>
        </div>
      </admin-card>
    `;
  }

  render() {
    return html`
      <div class="page">
        <div class="page-header">
          <div>
            <h1 class="page-title">Sitemap Configuration</h1>
            <p class="page-subtitle">Manage sitemap configurations for your site.</p>
          </div>
          ${!this._loading && !this._error ? html`
            <eds-button variant="accent" @click=${this._openAdd}>
              <span slot="icon">${edsIcon('add', { size: 16 })}</span>
              Add Sitemap
            </eds-button>
          ` : nothing}
        </div>

        <error-alert .error=${this._error} @retry=${this._load}></error-alert>

        ${this._loading
          ? html`<div class="card-grid">${[1, 2, 3].map(() => html`<admin-card loading></admin-card>`)}</div>`
          : this._sitemaps.length === 0
            ? html`<p class="empty">No sitemaps configured. Add one to get started.</p>`
            : html`
                <div class="card-grid">
                  ${this._sitemaps.map((sm) => this._renderCard(sm))}
                </div>
              `}
      </div>

      ${this._showDialog ? this._renderDialog() : nothing}
      ${this._deleteConfirm ? html`
        <eds-dialog
          open
          headline="Delete Sitemap"
          size="s"
          @close=${() => { this._deleteConfirm = null; }}
        >
          <p>Are you sure you want to delete the sitemap <strong>${this._deleteConfirm}</strong>? This will remove it from the configuration.</p>
          <div class="dialog-buttons">
            <eds-button variant="secondary" treatment="outline" @click=${() => { this._deleteConfirm = null; }}>Cancel</eds-button>
            <eds-button variant="negative" ?disabled=${this._saving} @click=${this._handleDeleteSitemap}>
              ${this._saving ? 'Deleting...' : 'Delete'}
            </eds-button>
          </div>
        </eds-dialog>
      ` : nothing}
    `;
  }

  _renderDialog() {
    return html`
      <eds-dialog
        open
        headline=${this._editingSitemap ? 'Edit Sitemap' : 'Add Sitemap'}
        size="l"
        @close=${this._closeDialog}
      >
      
        ${this._dialogStep === 'type'
          ? this._renderTypeStep()
          : this._dialogType === 'simple'
            ? this._renderSimpleFields()
            : this._renderMultilangFields()}

        ${this._dialogStep === 'form' ? html`
          <div class="dialog-buttons">
            ${!this._editingSitemap ? html`
              <eds-button variant="secondary" treatment="outline" @click=${() => { this._dialogStep = 'type'; }}>Back</eds-button>
            ` : nothing}
            <eds-button variant="secondary" treatment="outline" @click=${this._closeDialog}>Cancel</eds-button>
            <eds-button variant="accent" ?disabled=${this._saving} @click=${this._saveDialog}>
              ${this._saving ? 'Saving...' : 'Save'}
            </eds-button>
          </div>
        ` : nothing}
      </eds-dialog>
    `;
  }

  _renderTypeStep() {
    return html`
      <p>Choose the sitemap type to create:</p>
      <div class="type-choices">
        <div class="type-choice" @click=${() => this._selectType('simple')}>
          <h4>Simple</h4>
          <p>A single-language sitemap with one source and destination.</p>
        </div>
        <div class="type-choice" @click=${() => this._selectType('multilang')}>
          <h4>Multilang</h4>
          <p>A multi-language sitemap with multiple hreflang entries.</p>
        </div>
      </div>
    `;
  }

  _renderSimpleFields() {
    const form = this._dialogForm;
    return html`
      <div class="form-row">
        <label class="field-label" for="sm-name">Sitemap name</label>
        <eds-textfield id="sm-name" placeholder="default" .value=${form.name}
          ?disabled=${!!this._editingSitemap}
          @input=${(e) => { this._dialogForm = { ...this._dialogForm, name: e.target.value ?? e.detail?.value ?? '' }; }}></eds-textfield>
      </div>
      <div class="form-row">
        <label class="field-label" for="sm-source">Source path</label>
        <eds-textfield id="sm-source" placeholder="/query-index.json" .value=${form.source}
          @input=${(e) => { this._dialogForm = { ...this._dialogForm, source: e.target.value ?? e.detail?.value ?? '' }; }}></eds-textfield>
      </div>
      <div class="form-row">
        <label class="field-label" for="sm-dest">Destination</label>
        <eds-textfield id="sm-dest" placeholder="/sitemap.xml" .value=${form.destination}
          @input=${(e) => { this._dialogForm = { ...this._dialogForm, destination: e.target.value ?? e.detail?.value ?? '' }; }}></eds-textfield>
      </div>
      <div class="form-row">
        <label class="field-label" for="sm-origin">Origin (optional)</label>
        <eds-textfield id="sm-origin" placeholder="https://example.com" .value=${form.origin}
          @input=${(e) => { this._dialogForm = { ...this._dialogForm, origin: e.target.value ?? e.detail?.value ?? '' }; }}></eds-textfield>
      </div>
      <div class="form-row">
        <label class="field-label" for="sm-lastmod">Last modified format (optional)</label>
        <eds-textfield id="sm-lastmod" placeholder="YYYY-MM-DD" .value=${form.lastmod}
          @input=${(e) => { this._dialogForm = { ...this._dialogForm, lastmod: e.target.value ?? e.detail?.value ?? '' }; }}></eds-textfield>
      </div>

    `;
  }

  _renderMultilangFields() {
    const form = this._dialogForm;
    return html`
      <div class="form-row">
        <label class="field-label" for="sm-name">Sitemap name</label>
        <eds-textfield id="sm-name" placeholder="default" .value=${form.name}
          ?disabled=${!!this._editingSitemap}
          @input=${(e) => { this._dialogForm = { ...this._dialogForm, name: e.target.value ?? e.detail?.value ?? '' }; }}></eds-textfield>
      </div>

      <div class="form-section-label">Languages</div>
      <div class="languages">
        ${(form.languages || []).map((l, i) => html`
          <div class="lang-card">
            <div class="lang-card-header">
              <span>Language ${i + 1}${l.hreflang ? ` (${l.hreflang})` : ''}</span>
              <eds-button quiet aria-label="Remove language" @click=${() => this._removeLang(i)}>
                <span slot="icon">${edsIcon('delete', { size: 16 })}</span>
              </eds-button>
            </div>
            <div class="lang-card-fields">
              <div class="form-row">
                <label class="field-label">Source</label>
                <eds-textfield placeholder="/query-index.json" .value=${l.source}
                  @input=${(e) => { const arr = [...(this._dialogForm.languages || [])]; arr[i] = { ...arr[i], source: e.target.value ?? e.detail?.value ?? '' }; this._dialogForm = { ...this._dialogForm, languages: arr }; }}></eds-textfield>
              </div>
              <div class="form-row">
                <label class="field-label">Destination</label>
                <eds-textfield placeholder="/sitemap-en.xml" .value=${l.destination}
                  @input=${(e) => { const arr = [...(this._dialogForm.languages || [])]; arr[i] = { ...arr[i], destination: e.target.value ?? e.detail?.value ?? '' }; this._dialogForm = { ...this._dialogForm, languages: arr }; }}></eds-textfield>
              </div>
              <div class="form-row">
                <label class="field-label">Alternate URL</label>
                <eds-textfield placeholder="https://example.com/en/" .value=${l.alternate}
                  @input=${(e) => { const arr = [...(this._dialogForm.languages || [])]; arr[i] = { ...arr[i], alternate: e.target.value ?? e.detail?.value ?? '' }; this._dialogForm = { ...this._dialogForm, languages: arr }; }}></eds-textfield>
              </div>
              <div class="form-row">
                <label class="field-label">hreflang</label>
                <eds-textfield placeholder="en" .value=${l.hreflang}
                  @input=${(e) => { const arr = [...(this._dialogForm.languages || [])]; arr[i] = { ...arr[i], hreflang: e.target.value ?? e.detail?.value ?? '' }; this._dialogForm = { ...this._dialogForm, languages: arr }; }}></eds-textfield>
              </div>
            </div>
          </div>
        `)}
        <eds-button variant="secondary" size="s" @click=${this._addLang}>
          <span slot="icon">${edsIcon('add', { size: 16 })}</span> Add language
        </eds-button>
      </div>
    `;
  }
}

customElements.define('site-sitemaps', SiteSitemaps);
