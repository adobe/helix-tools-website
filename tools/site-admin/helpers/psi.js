import admin from '../../../scripts/helix-admin.js';
import { executeAdminRequest, AuthMode } from '../../../utils/admin-request.js';
import {
  getPsiScores,
  savePsiScores,
  getScoreClass,
  formatTimestamp,
  showToast,
} from './utils.js';

export const renderPsiScores = (card, siteName, orgValue) => {
  const scores = getPsiScores();
  const siteKey = `${orgValue}/${siteName}`;
  const siteScores = scores[siteKey];
  const psiContainer = card.querySelector('.psi-scores');
  if (!psiContainer) return;

  if (siteScores) {
    const bp = siteScores.bestPractices ?? '--';
    psiContainer.innerHTML = `
      <div class="psi-scores-row">
        <div class="psi-score">
          <div class="psi-score-circle ${getScoreClass(siteScores.performance)}">${siteScores.performance}</div>
          <span class="psi-score-label">Perf</span>
        </div>
        <div class="psi-score">
          <div class="psi-score-circle ${getScoreClass(siteScores.accessibility)}">${siteScores.accessibility}</div>
          <span class="psi-score-label">A11y</span>
        </div>
        <div class="psi-score">
          <div class="psi-score-circle ${getScoreClass(bp)}">${bp}</div>
          <span class="psi-score-label">BP</span>
        </div>
      </div>
      <span class="psi-timestamp">As of ${formatTimestamp(siteScores.timestamp)}</span>
    `;
  } else {
    psiContainer.innerHTML = '';
  }
};

export const runPsiForCard = async (card, siteName, orgValue) => {
  const psiContainer = card.querySelector('.psi-scores');
  if (!psiContainer) return;

  psiContainer.innerHTML = `
    <div class="psi-loading">
      <div class="psi-spinner"></div>
      <span>Running</span>
    </div>
  `;

  const liveUrl = `https://main--${siteName}--${orgValue}.aem.live/`;
  const resp = await executeAdminRequest(
    () => admin.psi({ org: orgValue, site: siteName }).get('', { params: { url: liveUrl } }),
    { org: orgValue, site: siteName, policy: AuthMode.NONE },
  );
  let result = null;
  if (resp?.ok) {
    const data = await resp.json();
    const categories = data.lighthouseResult?.categories || {};
    result = {
      performance: Math.round((categories.performance?.score || 0) * 100),
      accessibility: Math.round((categories.accessibility?.score || 0) * 100),
      bestPractices: Math.round((categories['best-practices']?.score || 0) * 100),
      timestamp: Date.now(),
    };
  }

  if (result) {
    const scores = getPsiScores();
    scores[`${orgValue}/${siteName}`] = result;
    savePsiScores(scores);
    renderPsiScores(card, siteName, orgValue);
    showToast('PSI scores updated', 'success');
  } else {
    psiContainer.innerHTML = '<span class="psi-error">PSI failed</span>';
    showToast('Failed to fetch PSI scores', 'error');
  }
};
