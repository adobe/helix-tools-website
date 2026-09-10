/**
 * ProductBus Admin - Config page
 */

import { apiFetch } from './api.js';
import {
  showToast, createFormField, confirmModal, escapeHtml,
} from './ui.js';

function buildFormHTML(config) {
  const c = config || {};
  return `
    <form class="form-view" id="config-form">
      <div class="form-field">
        <label for="authEnabled">
          <input type="checkbox" id="authEnabled" name="authEnabled" ${c.authEnabled ? 'checked' : ''}>
          Auth Enabled
        </label>
      </div>
      ${createFormField('authOrigins', 'Auth Origins (comma-separated)', 'text', {
    value: Array.isArray(c.authOrigins) ? c.authOrigins.join(', ') : (c.authOrigins || ''),
  }).outerHTML}
      ${createFormField('otpEmailSender', 'OTP Email Sender', 'email', {
    value: c.otpEmailSender || '',
  }).outerHTML}
      ${createFormField('otpEmailSubject', 'OTP Email Subject', 'text', {
    value: c.otpEmailSubject || '', maxLength: '255',
  }).outerHTML}
      <div class="form-field">
        <label for="otpEmailBodyTemplate">OTP Email Body Template</label>
        <textarea id="otpEmailBodyTemplate" name="otpEmailBodyTemplate" rows="6" maxlength="102400">${escapeHtml(c.otpEmailBodyTemplate || '')}</textarea>
      </div>
      ${createFormField('otpEmailBodyUrl', 'OTP Email Body URL', 'text', {
    value: c.otpEmailBodyUrl || '', maxLength: '1024',
  }).outerHTML}
    </form>
  `;
}

function getFormConfig(form) {
  const fd = new FormData(form);
  const config = {};

  config.authEnabled = form.querySelector('#authEnabled').checked;

  const origins = fd.get('authOrigins');
  if (origins) {
    config.authOrigins = origins.split(',').map((s) => s.trim()).filter(Boolean);
  }

  ['otpEmailSender', 'otpEmailSubject', 'otpEmailBodyTemplate', 'otpEmailBodyUrl'].forEach((key) => {
    const val = fd.get(key);
    if (val) config[key] = val;
  });

  return config;
}

export async function render(container, ctx) {
  container.innerHTML = `
    <div class="page-header">
      <h1>Configuration</h1>
    </div>
    <div id="config-content">
      <p class="loading">Loading configuration...</p>
    </div>
  `;

  let config = {};
  try {
    const resp = await apiFetch(ctx.org, ctx.site, 'config', { method: 'GET' });
    if (resp.ok) {
      config = await resp.json();
    }
  } catch (err) {
    // Config may not exist yet
    if (!err.message.includes('Forbidden')) {
      config = {};
    } else {
      container.querySelector('#config-content').innerHTML = `<p class="error">Failed to load config: ${err.message}</p>`;
      return;
    }
  }

  let currentView = 'form';

  function renderView() {
    const content = container.querySelector('#config-content');
    if (currentView === 'form') {
      content.innerHTML = `
        <div class="view-switcher">
          <button type="button" class="active" data-view="form">Form</button>
          <button type="button" data-view="json">JSON</button>
        </div>
        ${buildFormHTML(config)}
        <div class="config-actions">
          <button class="button danger outline" id="delete-config-btn">Delete Config</button>
          <button class="button" id="save-config-btn">Save Config</button>
        </div>
      `;
    } else {
      content.innerHTML = `
        <div class="view-switcher">
          <button type="button" data-view="form">Form</button>
          <button type="button" class="active" data-view="json">JSON</button>
        </div>
        <textarea class="json-editor" id="json-editor" style="min-height: 400px;">${escapeHtml(JSON.stringify(config, null, 2))}</textarea>
        <div class="config-actions">
          <button class="button danger outline" id="delete-config-btn">Delete Config</button>
          <button class="button" id="save-config-btn">Save Config</button>
        </div>
      `;
    }

    content.querySelectorAll('.view-switcher button').forEach((btn) => {
      btn.addEventListener('click', () => {
        currentView = btn.dataset.view;
        renderView();
      });
    });

    content.querySelector('#save-config-btn').addEventListener('click', async () => {
      const saveBtn = content.querySelector('#save-config-btn');
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';

      try {
        let configData;
        if (currentView === 'json') {
          configData = JSON.parse(content.querySelector('#json-editor').value);
        } else {
          configData = getFormConfig(content.querySelector('#config-form'));
        }

        await apiFetch(ctx.org, ctx.site, 'config', {
          method: 'POST',
          body: JSON.stringify(configData),
        });
        config = configData;
        showToast('Config saved');
      } catch (err) {
        showToast(`Failed to save: ${err.message}`, 'error');
      }
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save Config';
    });

    content.querySelector('#delete-config-btn').addEventListener('click', async () => {
      const ok = await confirmModal('Delete configuration? This cannot be undone.', {
        title: 'Delete config',
        confirmLabel: 'Delete',
        destructive: true,
      });
      if (!ok) return;
      try {
        await apiFetch(ctx.org, ctx.site, 'config', { method: 'DELETE' });
        config = {};
        showToast('Config deleted');
        renderView();
      } catch (err) {
        showToast(`Failed to delete: ${err.message}`, 'error');
      }
    });
  }

  renderView();
}

export function destroy() {}
