import { LitElement, html, nothing } from 'lit';
import { getRouteDetails } from '../../../utils/router.js';
import {
  bulkPreview,
  bulkPublish,
  bulkUnpreview,
  bulkUnpublish,
  bulkIndex,
  deleteFromIndex,
  fetchJobDetails,
} from '../../../services/adminApi.js';
import { getApiError } from '../../../utils/apiErrors.js';
import { toast } from '../../../controllers/toast-controller.js';
import '../../../blocks/error-alert/error-alert.js';
import '../../../blocks/eds-button/eds-button.js';
import '../../../blocks/eds-dialog/eds-dialog.js';
import '../../../blocks/eds-textfield/eds-textfield.js';

import getSheet from '../../../utils/sheet.js';
import { pageSheet, sharedSheet } from '../../../styles/page-sheets.js';
const sheet = await getSheet(new URL('./site-bulk.css', import.meta.url).pathname);

function parsePaths(text) {
  return (text || '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

export class SiteBulk extends LitElement {
  static properties = {
    _org: { state: true },
    _site: { state: true },
    _pathsText: { state: true },
    _forceUpdate: { state: true },
    _log: { state: true },
    _running: { state: true },
    _error: { state: true },
    _confirmAction: { state: true },
    _jobStatus: { state: true },
  };

  constructor() {
    super();
    this._org = '';
    this._site = '';
    this._pathsText = '';
    this._forceUpdate = false;
    this._log = '';
    this._running = false;
    this._error = '';
    this._confirmAction = null;
    this._jobStatus = null;
    this._pollAbort = false;
  }

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [pageSheet, sharedSheet, sheet];
    const details = getRouteDetails();
    this._org = details.org || '';
    this._site = details.site || '';
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._pollAbort = true;
  }

  _appendLog(msg) {
    this._log += `${new Date().toISOString()} ${msg}\n`;
  }

  _getPaths() {
    return parsePaths(this._pathsText);
  }

  /**
   * Poll job status every 3 seconds until the job completes.
   * @param {string} topic - Job topic (e.g. 'preview', 'live', 'index')
   * @param {string} name - Job name
   */
  async _pollJob(topic, name) {
    this._pollAbort = false;
    const pollInterval = 3000;
    const terminalStates = ['stopped', 'completed', 'failed'];

    const poll = async () => {
      if (this._pollAbort) return;
      const { data, status } = await fetchJobDetails(this._org, this._site, topic, name);
      if (this._pollAbort) return;
      if (status !== 200 || !data) {
        this._jobStatus = { topic, name, state: 'unknown', progress: null };
        this._appendLog(`Job ${topic}/${name}: could not fetch status (HTTP ${status}).`);
        this._running = false;
        this._jobStatus = null;
        return;
      }
      const state = data.state ?? data.status ?? 'unknown';
      const progress = data.progress ?? data.percent ?? null;
      this._jobStatus = { topic, name, state, progress };

      if (terminalStates.includes(String(state).toLowerCase())) {
        this._appendLog(`Job ${topic}/${name}: ${state}.`);
        if (state === 'failed') {
          this._error = data.message || data.error || 'Job failed.';
        } else {
          toast.positive(`Bulk job completed (${state}).`);
        }
        this._running = false;
        this._jobStatus = null;
        return;
      }

      this._jobStatus = { topic, name, state, progress };
      setTimeout(poll, pollInterval);
    };

    setTimeout(poll, pollInterval);
  }

  _startPollingIfJob(data) {
    const job = data?.job ?? data;
    const topic = job?.topic;
    const name = job?.name;
    if (topic && name) {
      this._jobStatus = { topic, name, state: job?.state ?? 'created', progress: job?.progress ?? null };
      this._pollJob(topic, name);
    } else {
      this._running = false;
    }
  }

  async _runPreview() {
    const paths = this._getPaths();
    if (!paths.length) {
      toast.negative('Enter at least one path.');
      return;
    }
    this._running = true;
    this._error = '';
    this._jobStatus = null;
    this._pollAbort = false;
    this._appendLog(`Preview All (${paths.length} paths, forceUpdate=${this._forceUpdate})...`);
    const { data, status, error } = await bulkPreview(this._org, this._site, paths, {
      forceUpdate: this._forceUpdate,
    });
    const err = getApiError(status, 'preview', error);
    if (err) {
      this._error = err;
      this._appendLog(`FAILED: ${err}`);
      this._running = false;
    } else if (status === 202 && (data?.job ?? data)?.topic && (data?.job ?? data)?.name) {
      this._appendLog('Preview job scheduled. Polling for status...');
      this._startPollingIfJob(data);
    } else {
      this._appendLog('Preview completed.');
      toast.positive('Preview completed.');
      this._running = false;
    }
  }

  async _runPublish() {
    const paths = this._getPaths();
    if (!paths.length) {
      toast.negative('Enter at least one path.');
      return;
    }
    this._running = true;
    this._error = '';
    this._jobStatus = null;
    this._pollAbort = false;
    this._confirmAction = null;
    this._appendLog(`Publish All (${paths.length} paths, forceUpdate=${this._forceUpdate})...`);
    const { data, status, error } = await bulkPublish(this._org, this._site, paths, {
      forceUpdate: this._forceUpdate,
    });
    const err = getApiError(status, 'publish', error);
    if (err) {
      this._error = err;
      this._appendLog(`FAILED: ${err}`);
      this._running = false;
    } else if (status === 202 && (data?.job ?? data)?.topic && (data?.job ?? data)?.name) {
      this._appendLog('Publish job scheduled. Polling for status...');
      this._startPollingIfJob(data);
    } else {
      this._appendLog('Publish completed.');
      toast.positive('Publish completed.');
      this._running = false;
    }
  }

  async _runUnpreview() {
    const paths = this._getPaths();
    if (!paths.length) {
      toast.negative('Enter at least one path.');
      return;
    }
    this._running = true;
    this._error = '';
    this._jobStatus = null;
    this._pollAbort = false;
    this._confirmAction = null;
    this._appendLog(`Unpreview All (${paths.length} paths)...`);
    const { data, status, error } = await bulkUnpreview(this._org, this._site, paths);
    const err = getApiError(status, 'unpreview', error);
    if (err) {
      this._error = err;
      this._appendLog(`FAILED: ${err}`);
      this._running = false;
    } else if (status === 202 && (data?.job ?? data)?.topic && (data?.job ?? data)?.name) {
      this._appendLog('Unpreview job scheduled. Polling for status...');
      this._startPollingIfJob(data);
    } else {
      this._appendLog('Unpreview completed.');
      toast.positive('Unpreview completed.');
      this._running = false;
    }
  }

  async _runIndex() {
    const paths = this._getPaths();
    if (!paths.length) {
      toast.negative('Enter at least one path.');
      return;
    }
    this._running = true;
    this._error = '';
    this._jobStatus = null;
    this._pollAbort = false;
    this._appendLog(`Index All (${paths.length} paths)...`);
    const { data, status, error } = await bulkIndex(this._org, this._site, paths);
    const err = getApiError(status, 'index', error);
    if (err) {
      this._error = err;
      this._appendLog(`FAILED: ${err}`);
      this._running = false;
    } else if (status === 202 && (data?.job ?? data)?.topic && (data?.job ?? data)?.name) {
      this._appendLog('Index job scheduled. Polling for status...');
      this._startPollingIfJob(data);
    } else {
      this._appendLog('Index completed.');
      toast.positive('Index completed.');
      this._running = false;
    }
  }

  async _runUnpublish() {
    const paths = this._getPaths();
    if (!paths.length) {
      toast.negative('Enter at least one path.');
      return;
    }
    this._running = true;
    this._error = '';
    this._jobStatus = null;
    this._pollAbort = false;
    this._confirmAction = null;
    this._appendLog(`Unpublish All (${paths.length} paths)...`);
    const { data, status, error } = await bulkUnpublish(this._org, this._site, paths);
    const err = getApiError(status, 'unpublish', error);
    if (err) {
      this._error = err;
      this._appendLog(`FAILED: ${err}`);
      this._running = false;
    } else if (status === 202 && (data?.job ?? data)?.topic && (data?.job ?? data)?.name) {
      this._appendLog('Unpublish job scheduled. Polling for status...');
      this._startPollingIfJob(data);
    } else {
      this._appendLog('Unpublish completed.');
      toast.positive('Unpublish completed.');
      this._running = false;
    }
  }

  async _runDeleteFromIndex() {
    const paths = this._getPaths();
    if (!paths.length) {
      toast.negative('Enter at least one path.');
      return;
    }
    this._running = true;
    this._error = '';
    this._confirmAction = null;
    this._appendLog(`Delete from Index (${paths.length} paths)...`);
    let failed = 0;
    for (const path of paths) {
      const { status, error } = await deleteFromIndex(this._org, this._site, path);
      const err = getApiError(status, `delete ${path}`, error);
      if (err) {
        this._appendLog(`  ${path}: FAILED - ${err}`);
        failed += 1;
      } else {
        this._appendLog(`  ${path}: OK`);
      }
    }
    if (failed > 0) {
      this._appendLog(`Delete from index: ${failed} failed.`);
    } else {
      this._appendLog('Delete from index completed.');
      toast.positive('Delete from index completed.');
    }
    this._running = false;
  }

  _handlePreview() {
    this._runPreview();
  }

  _handlePublish() {
    this._confirmAction = 'publish';
  }

  _handleUnpublish() {
    this._confirmAction = 'unpublish';
  }

  _handleUnpreview() {
    this._confirmAction = 'unpreview';
  }

  _handleIndex() {
    this._runIndex();
  }

  _handleDeleteFromIndex() {
    this._confirmAction = 'deleteFromIndex';
  }

  async _handleConfirm() {
    if (this._confirmAction === 'publish') await this._runPublish();
    if (this._confirmAction === 'unpublish') await this._runUnpublish();
    if (this._confirmAction === 'unpreview') await this._runUnpreview();
    if (this._confirmAction === 'deleteFromIndex') await this._runDeleteFromIndex();
  }

  _getJobProgressPercent() {
    const p = this._jobStatus?.progress;
    if (p == null) return 0;
    if (typeof p === 'number') return p;
    if (typeof p === 'object' && p.total > 0) {
      return Math.round(((p.processed ?? 0) / p.total) * 100);
    }
    return 0;
  }

  _renderConfirmDialog() {
    if (!this._confirmAction) return nothing;
    const labels = {
      publish: 'Publish All',
      unpublish: 'Unpublish All',
      unpreview: 'Unpreview All',
      deleteFromIndex: 'Delete from Index',
    };
    const desc = {
      publish: 'This will publish all listed paths to live. Are you sure?',
      unpublish: 'This will remove all listed paths from live. Are you sure?',
      unpreview: 'This will remove all listed paths from preview. Are you sure?',
      deleteFromIndex: 'This will delete all listed paths from the index. Are you sure?',
    };
    const negativeActions = ['deleteFromIndex', 'unpublish'];
    const variant = negativeActions.includes(this._confirmAction) ? 'negative' : 'accent';
    return html`
      <eds-dialog
        open
        headline=${labels[this._confirmAction]}
        size="s"
        @close=${() => { this._confirmAction = null; }}
      >
        <p>${desc[this._confirmAction]}</p>
        <div class="dialog-buttons">
          <eds-button variant="secondary" treatment="outline" @click=${() => { this._confirmAction = null; }}>Cancel</eds-button>
          <eds-button variant=${variant} ?disabled=${this._running} @click=${this._handleConfirm}>
            ${this._running ? 'Running...' : 'Confirm'}
          </eds-button>
        </div>
      </eds-dialog>
    `;
  }

  render() {
    const statusVariant = this._jobStatus?.state === 'failed' ? 'negative' : this._jobStatus?.state === 'running' || this._jobStatus?.state === 'created' ? 'informative' : 'positive';
    return html`
      <div class="page">
        <div class="page-header">
          <div>
            <h1 class="page-title">Bulk Operations</h1>
            <p class="page-subtitle">${this._org} / ${this._site}</p>
          </div>
        </div>

        <error-alert .error=${this._error} @retry=${() => { this._error = ''; }}></error-alert>

        <div class="paths-section">
          <label class="field-label" for="bulk-paths">Paths (one per line)</label>
          <eds-textfield
            id="bulk-paths"
            multiline
            rows="6"
            placeholder="/path/to/page1&#10;/path/to/page2"
            .value=${this._pathsText}
            @input=${(e) => { this._pathsText = e.target.value ?? e.detail?.value ?? ''; }}
            ?disabled=${this._running}
          ></eds-textfield>

          <div class="checkbox-row">
            <label class="checkbox-label">
              <input type="checkbox"
                .checked=${this._forceUpdate}
                @change=${(e) => { this._forceUpdate = e.target.checked; }}
              />
              Force update (preview/publish)
            </label>
          </div>

          <div class="buttons-row">
            <eds-button variant="secondary" ?disabled=${this._running} @click=${this._handlePreview}>
              Preview All
            </eds-button>
            <eds-button variant="accent" ?disabled=${this._running} @click=${this._handlePublish}>
              Publish All
            </eds-button>
            <eds-button variant="secondary" ?disabled=${this._running} @click=${this._handleUnpreview}>
              Unpreview All
            </eds-button>
            <eds-button variant="negative" ?disabled=${this._running} @click=${this._handleUnpublish}>
              Unpublish All
            </eds-button>
            <eds-button variant="secondary" ?disabled=${this._running} @click=${this._handleIndex}>
              Index All
            </eds-button>
            <eds-button variant="negative" ?disabled=${this._running} @click=${this._handleDeleteFromIndex}>
              Delete from Index
            </eds-button>
          </div>
        </div>

        <div class="log-section">
          <h3 class="log-title">Operation Log</h3>
          <pre class="log-output">${this._log || 'No operations yet.'}</pre>
        </div>

        ${this._jobStatus
          ? html`
              <div class="job-status-section">
                <h3 class="job-status-title">Job Progress</h3>
                <div class="job-status-content">
                  <div class="job-status-row">
                    <span class="status-light s ${statusVariant}">${this._jobStatus.state}</span>
                    <span class="job-status-label">${this._jobStatus.topic}/${this._jobStatus.name}</span>
                  </div>
                  ${this._getJobProgressPercent() > 0
                    ? html`
                        <div class="progress-bar-wrap">
                          <label>Progress</label>
                          <div class="progress-bar">
                            <div class="progress-bar-fill" style="width:${this._getJobProgressPercent()}%"></div>
                          </div>
                        </div>
                      `
                    : html`
                        <div class="spinner s" aria-label="Job in progress"></div>
                      `}
                </div>
              </div>
            `
          : nothing}
      </div>

      ${this._renderConfirmDialog()}
    `;
  }

}

customElements.define('site-bulk', SiteBulk);
