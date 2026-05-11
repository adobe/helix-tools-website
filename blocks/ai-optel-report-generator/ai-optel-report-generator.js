/**
 * AI OpTel Report Generator - Main entry point
 */

import { createModalStructure } from './ui/modal-ui.js';
import generateReport from './reports/report-generator.js';
import cleanupMetricsParameter from './cleanup-utils.js';
import { hasValidDomainKey, validateDomainKeyWithBundles } from './domainkey-context.js';

let modalInstance = null;

export function closeReportModal() {
  if (modalInstance) {
    modalInstance.remove();
    modalInstance = null;
    cleanupMetricsParameter();
  }
}

const canCloseModal = (modal) => {
  const hasProgress = modal.querySelector('#circular-progress-container');
  return !hasProgress;
};

function setupCloseHandlers(modal) {
  modal.querySelector('.report-modal-close')?.addEventListener('click', () => {
    if (canCloseModal(modal)) closeReportModal();
  });

  const escHandler = (e) => {
    if (e.key === 'Escape' && canCloseModal(modal)) {
      closeReportModal();
      document.removeEventListener('keydown', escHandler);
    }
  };
  document.addEventListener('keydown', escHandler);
}

async function updateProviderName(providerSpan) {
  if (!providerSpan) return;
  const { getProviderName } = await import('./api/api-factory.js');
  providerSpan.textContent = getProviderName();
}

async function setupGenerateButton(modal) {
  const generateBtn = modal.querySelector('#report-generate-btn');
  const statusDiv = modal.querySelector('#report-status');
  const providerSpan = modal.querySelector('#provider-name');

  await updateProviderName(providerSpan);

  generateBtn?.addEventListener('click', async () => {
    await generateReport(statusDiv, generateBtn, modal);
  });
}

function disableInvalidDomainKey(modal) {
  const btn = modal.querySelector('#report-generate-btn');
  const info = modal.querySelector('.report-info');

  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Generate Report';
  }

  if (info) {
    info.classList.add('warning');
    info.innerHTML = `<div id="report-gate-message" class="report-gate-message">
      <p><strong>Invalid domain key</strong></p>
      <p>This domain key is not accepted for the current domain. Add the correct key in the URL, then open this dialog again to continue generating the report.</p>
    </div>`;
  }
}

async function disableUntilDashboardReady(modal) {
  const btn = modal.querySelector('#report-generate-btn');
  const info = modal.querySelector('.report-info');
  const providerSpan = modal.querySelector('#provider-name');

  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Generate Report';
  }

  if (info) info.classList.add('warning');

  await updateProviderName(providerSpan);

  const gate = modal.querySelector('#report-gate-message');
  if (gate) {
    gate.hidden = false;
    gate.innerHTML = `<p><strong>Dashboard not ready</strong></p>
      <p>A domain key is set once the dashboard has finished loading. Wait for data to appear, or turn off Incognito mode, then open this dialog again.</p>`;
  }
}

export async function openReportModal() {
  if (modalInstance) closeReportModal();

  const { overlay, modal } = createModalStructure();

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay && canCloseModal(modal)) closeReportModal();
  });

  document.body.appendChild(overlay);
  modalInstance = overlay;
  setupCloseHandlers(modal);

  if (!hasValidDomainKey()) {
    await disableUntilDashboardReady(modal);
    return overlay;
  }

  const btn = modal.querySelector('#report-generate-btn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Checking domain key...';
  }

  const bundlesAcceptsKey = await validateDomainKeyWithBundles();
  if (!bundlesAcceptsKey) {
    disableInvalidDomainKey(modal);
    return overlay;
  }

  if (btn) {
    btn.disabled = false;
    btn.textContent = 'Generate Report';
  }

  await setupGenerateButton(modal);
  return overlay;
}

/* Block initialization */
export default function decorate(block) {
  const button = document.createElement('button');
  button.className = 'open-report-modal-btn';
  button.textContent = 'Generate AI RUM Report';
  button.addEventListener('click', openReportModal);
  block.appendChild(button);
}

window.openReportModal = openReportModal;
