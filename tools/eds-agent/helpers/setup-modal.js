import { loadIcon } from './icons.js';
import { escapeHtml } from './markdown.js';
import { getConfig, saveConfig } from './config-storage.js';

export function closeModal() {
  const backdrop = document.querySelector('.eds-modal-backdrop');
  if (backdrop) backdrop.remove();
}

export async function openSetupModal({ mode = 'required', errorText = '', onConnect }) {
  closeModal();
  const config = getConfig();

  const backdrop = document.createElement('div');
  backdrop.className = 'eds-modal-backdrop';

  const modal = document.createElement('div');
  modal.className = 'eds-modal';
  modal.innerHTML = `
    <h2>EDS Admin Agent</h2>
    <p>Connect to your AEM Edge Delivery Services organization using an Admin API key.</p>
    ${errorText ? `<div class="eds-modal-error">${escapeHtml(errorText)}</div>` : ''}
    <div class="eds-modal-field">
      <label for="setup-token">Admin API Key</label>
      <input type="password" id="setup-token" placeholder="Enter your API key" value="${escapeHtml(config.authToken)}" />
    </div>
    <div class="eds-modal-field">
      <label for="setup-org">Organization</label>
      <input type="text" id="setup-org" placeholder="e.g. adobe" value="${escapeHtml(config.org)}" />
    </div>
    <div class="eds-modal-field">
      <label for="setup-site">Site (optional)</label>
      <input type="text" id="setup-site" placeholder="e.g. my-site" value="${escapeHtml(config.site)}" />
    </div>
    <div class="eds-modal-actions">
      <button class="eds-btn eds-btn-accent" id="setup-connect">Connect</button>
    </div>
  `;

  if (mode === 'optional') {
    const closeBtn = document.createElement('button');
    closeBtn.className = 'eds-modal-close';
    closeBtn.setAttribute('aria-label', 'Close');
    modal.appendChild(closeBtn);
    loadIcon('S2_Icon_Close_20_N').then((svg) => closeBtn.appendChild(svg));
    closeBtn.addEventListener('click', closeModal);
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) closeModal();
    });
    document.addEventListener('keydown', function escHandler(e) {
      if (e.key === 'Escape') {
        closeModal();
        document.removeEventListener('keydown', escHandler);
      }
    });
  }

  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);

  const tokenInput = modal.querySelector('#setup-token');
  const orgInput = modal.querySelector('#setup-org');
  const siteInput = modal.querySelector('#setup-site');
  const connectBtn = modal.querySelector('#setup-connect');

  const submit = () => {
    const token = tokenInput.value.trim();
    const org = orgInput.value.trim();
    const site = siteInput.value.trim();
    if (!token) { tokenInput.focus(); return; }
    if (!org) { orgInput.focus(); return; }
    saveConfig(token, org, site);
    closeModal();
    if (onConnect) onConnect();
  };

  connectBtn.addEventListener('click', submit);
  [tokenInput, orgInput, siteInput].forEach((input) => {
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  });

  tokenInput.focus();
}
