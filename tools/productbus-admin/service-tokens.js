/**
 * ProductBus Admin - Service Tokens (admin only)
 * Backend supports create + revoke only; this view is create-only.
 * Token is shown once after creation — the API never returns it again.
 */

import { apiFetch } from './api.js';
import { showToast, escapeHtml } from './ui.js';

const ALLOWED_PERMISSIONS = [
  'catalog:read',
  'catalog:write',
  'orders:read',
  'orders:write',
  'orders:custom:write',
  'index:read',
  'index:write',
  'customers:read',
  'customers:write',
  'price-rules:read',
  'price-rules:write',
  'journal:general:read',
  'journal:orders:read',
  'journal:*:read',
  'emails:send',
];

const MAX_TTL_SECONDS = 365 * 24 * 60 * 60;

function humanizeSeconds(total) {
  if (total % 86400 === 0) return `${total / 86400} day${total === 86400 ? '' : 's'}`;
  if (total % 3600 === 0) return `${total / 3600} hour${total === 3600 ? '' : 's'}`;
  if (total % 60 === 0) return `${total / 60} minute${total === 60 ? '' : 's'}`;
  return `${total} second${total === 1 ? '' : 's'}`;
}

function renderForm(container, ctx) {
  container.innerHTML = `
    <div class="page-header">
      <h1>Service Tokens</h1>
      <p>Mint a service token for server-to-server use. The token is shown once — copy it immediately.</p>
    </div>
    <form class="service-token-form" id="service-token-form">
      <h2>Permissions</h2>
      <div class="permissions-grid">
        ${ALLOWED_PERMISSIONS.map((p) => `
          <label class="permission-item">
            <input type="checkbox" name="permission" value="${escapeHtml(p)}">
            <code>${escapeHtml(p)}</code>
          </label>
        `).join('')}
      </div>

      <div class="form-field">
        <label for="email-scopes">Email scopes <span class="field-hint-inline">(optional, requires emails:send)</span></label>
        <input type="text" id="email-scopes" placeholder="user@example.com, *@example.com">
        <p class="field-hint">Comma-separated. Each becomes an <code>emails:send:&lt;pattern&gt;</code> permission entry.</p>
      </div>

      <div class="form-field">
        <label for="contact-emails">Contact emails <span class="field-hint-inline">(optional)</span></label>
        <input type="text" id="contact-emails" placeholder="owner@example.com, ops@example.com">
        <p class="field-hint">Comma-separated. Recorded with the token for ownership / contact purposes.</p>
      </div>

      <h2>Time to live</h2>
      <div class="form-row">
        <div class="form-field">
          <label for="ttl-value">Value</label>
          <input type="number" id="ttl-value" min="1" value="24" required>
        </div>
        <div class="form-field">
          <label for="ttl-unit">Unit</label>
          <select id="ttl-unit">
            <option value="60">minutes</option>
            <option value="3600" selected>hours</option>
            <option value="86400">days</option>
          </select>
        </div>
      </div>
      <p class="field-hint">Maximum 365 days.</p>

      <div class="button-group">
        <button type="submit" class="button" id="create-btn">Create Token</button>
      </div>
    </form>
  `;

  const form = container.querySelector('#service-token-form');
  const createBtn = container.querySelector('#create-btn');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const checked = Array.from(form.querySelectorAll('input[name="permission"]:checked')).map((c) => c.value);
    const scopesRaw = form.querySelector('#email-scopes').value.trim();
    const contactEmailsRaw = form.querySelector('#contact-emails').value.trim();
    const ttlValue = Number(form.querySelector('#ttl-value').value);
    const ttlUnit = Number(form.querySelector('#ttl-unit').value);
    const ttl = ttlValue * ttlUnit;

    const scopePatterns = scopesRaw
      ? scopesRaw.split(',').map((s) => s.trim()).filter(Boolean)
      : [];
    const contactEmails = contactEmailsRaw
      ? contactEmailsRaw.split(',').map((s) => s.trim()).filter(Boolean)
      : [];

    const permissions = [...checked];
    if (scopePatterns.length > 0 && !permissions.includes('emails:send')) {
      permissions.push('emails:send');
    }
    scopePatterns.forEach((pat) => {
      permissions.push(`emails:send:${pat}`);
    });

    if (permissions.length === 0) {
      showToast('Select at least one permission', 'error');
      return;
    }
    if (!Number.isInteger(ttl) || ttl <= 0) {
      showToast('TTL must be a positive integer', 'error');
      return;
    }
    if (ttl > MAX_TTL_SECONDS) {
      showToast('TTL exceeds maximum of 365 days', 'error');
      return;
    }

    createBtn.disabled = true;
    createBtn.textContent = 'Creating…';
    try {
      const body = { permissions, ttl };
      if (contactEmails.length > 0) body.contactEmails = contactEmails;
      const resp = await apiFetch(ctx.org, ctx.site, 'auth/service_token', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      if (!resp.ok) {
        const errMsg = resp.headers.get('x-error') || `HTTP ${resp.status}`;
        showToast(errMsg, 'error');
        createBtn.disabled = false;
        createBtn.textContent = 'Create Token';
        return;
      }
      const data = await resp.json();
      // eslint-disable-next-line no-use-before-define
      renderResult(container, ctx, { token: data.token, ttl: data.ttl, permissions });
    } catch (err) {
      showToast(`Failed to create token: ${err.message}`, 'error');
      createBtn.disabled = false;
      createBtn.textContent = 'Create Token';
    }
  });
}

function renderResult(container, ctx, { token, ttl, permissions }) {
  container.innerHTML = `
    <div class="page-header">
      <h1>Service Tokens</h1>
    </div>
    <div class="token-result">
      <div class="token-warning">⚠ Copy this token now — it won't be shown again.</div>
      <div class="token-box">
        <code id="token-value">${escapeHtml(token)}</code>
        <button type="button" class="btn-icon" id="copy-token">Copy</button>
      </div>
      <div class="token-meta"><strong>Expires in:</strong> ${escapeHtml(humanizeSeconds(ttl))}</div>
      <div class="token-meta"><strong>Permissions:</strong></div>
      <ul class="token-permissions">
        ${permissions.map((p) => `<li><code>${escapeHtml(p)}</code></li>`).join('')}
      </ul>
      <div class="button-group">
        <button type="button" class="button outline" id="create-another">Create another</button>
      </div>
    </div>
  `;

  container.querySelector('#copy-token').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(token);
      showToast('Token copied');
    } catch (err) {
      showToast(`Copy failed: ${err.message}`, 'error');
    }
  });

  container.querySelector('#create-another').addEventListener('click', () => {
    renderForm(container, ctx);
  });
}

export async function render(container, ctx) {
  renderForm(container, ctx);
}

export function destroy() {}
