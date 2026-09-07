import { registerToolReady } from '../../scripts/scripts.js';
import { initConfigField } from '../../utils/config/config.js';
import { ensureLogin } from '../../blocks/profile/profile.js';

// Ordered wizard steps. The destination site (site-to-site scenario) is packed
// into the first step, revealed by the "use a different destination site"
// checkbox. `action` is the label of the primary button while a step is active.
const STEPS = [
  { key: 'setup', label: 'Pick site', action: 'Next' },
  { key: 'copy', label: 'Copy content', action: 'Copy content' },
  { key: 'config', label: 'Switch to API Service', action: 'Update config' },
  { key: 'preview', label: 'Preview content', action: 'Preview all' },
  { key: 'publish', label: 'Publish content', action: 'Publish all' },
];

// Steps that run bulk work: they show a progress bar and simulate a few seconds
// of processing before completing. `total` is the mocked item count.
const PROGRESS = {
  copy: { total: 128, unit: 'documents copied', ms: 3200 },
  preview: { total: 128, unit: 'pages previewed', ms: 2600 },
  publish: { total: 128, unit: 'pages published', ms: 2600 },
};

const form = document.getElementById('migration-wizard');
const stepsList = form.querySelector('.da-migration-steps');
const backBtn = form.querySelector('.da-migration-back');
const nextBtn = form.querySelector('.da-migration-next');
const useDestination = form.querySelector('#use-destination');

const completed = new Set();
let currentKey = 'setup';

const destEnabled = () => useDestination.checked;
// the Configure API Service step only applies to an in-place migration; for a
// different destination site the content source is set up with that site
const visibleSteps = () => STEPS.filter((s) => !(s.key === 'config' && destEnabled()));
const stepByKey = (key) => STEPS.find((s) => s.key === key);

function fieldValues() {
  const org = form.querySelector('#org').value.trim();
  const site = form.querySelector('#site').value.trim();
  const destOrg = form.querySelector('#dest-org').value.trim();
  const destSite = form.querySelector('#dest-site').value.trim();
  const target = destEnabled()
    ? { org: destOrg, site: destSite }
    : { org, site };
  return {
    org, site, destOrg, destSite, target,
  };
}

/** Show a validation error in the current step's panel (or clear all). */
function showError(message) {
  form.querySelectorAll('.da-migration-error').forEach((el) => {
    el.textContent = '';
    el.setAttribute('aria-hidden', 'true');
  });
  if (!message) return;
  const el = form.querySelector(`.da-migration-panel[data-step="${currentKey}"] .da-migration-error`);
  if (el) {
    el.textContent = message;
    el.setAttribute('aria-hidden', 'false');
  }
}

/** Validate the fields required to leave the current step. */
function validate(key) {
  const {
    org, site, destOrg, destSite,
  } = fieldValues();
  if (key === 'setup') {
    if (!org || !site) return 'Select an organization and site.';
    if (destEnabled() && (!destOrg || !destSite)) return 'Enter the destination organization and site.';
  }
  if (key === 'copy') {
    if (!form.querySelector('#ims-token').value.trim()) return 'Enter a DA IMS token.';
  }
  return null;
}

/** Fill the per-step description text from the current field values. */
function updateDescriptions() {
  const { org, site, target } = fieldValues();
  const src = `${org || '…'}/${site || '…'}`;
  const dst = `${target.org || '…'}/${target.site || '…'}`;
  const desc = {
    copy: `Copy content from DA storage for ${src} into the API Service for ${dst}.`,
    config: `Switch the content source URL in the site config for ${src} to the new API Service.`,
    preview: `Preview all migrated content for ${dst}.`,
    publish: `Publish all migrated content for ${dst}.`,
  };
  Object.entries(desc).forEach(([step, text]) => {
    const el = form.querySelector(`[data-desc="${step}"]`);
    if (el) el.textContent = text;
  });
}

/** Fill a link group with the preview/live URLs for an org/site. */
function fillLinks(group, org, site, title) {
  group.querySelector('.da-migration-links-title').textContent = title;
  const previewUrl = `https://main--${site}--${org}.aem.page/`;
  const liveUrl = `https://main--${site}--${org}.aem.live/`;
  const previewLink = group.querySelector('.da-migration-preview-link');
  const liveLink = group.querySelector('.da-migration-live-link');
  previewLink.href = previewUrl;
  previewLink.textContent = previewUrl;
  liveLink.href = liveUrl;
  liveLink.textContent = liveUrl;
}

function renderDone() {
  const {
    org, site, destOrg, destSite, target,
  } = fieldValues();
  const scenario = destEnabled() ? 'site-to-site' : 'in-place';
  form.querySelector('.da-migration-done-summary').textContent = destEnabled()
    ? `Content migrated to ${target.org}/${target.site} and published. (${scenario})`
    : `${target.org}/${target.site} migrated and published. (${scenario})`;

  const sourceGroup = form.querySelector('.da-migration-links[data-role="source"]');
  const destGroup = form.querySelector('.da-migration-links[data-role="dest"]');
  if (destEnabled()) {
    // show both sites side by side so the user can compare source and destination
    fillLinks(sourceGroup, org, site, `Source site (${org}/${site})`);
    fillLinks(destGroup, destOrg, destSite, `Destination site (${destOrg}/${destSite})`);
    destGroup.setAttribute('aria-hidden', 'false');
  } else {
    fillLinks(sourceGroup, target.org, target.site, `${target.org}/${target.site}`);
    destGroup.setAttribute('aria-hidden', 'true');
  }
}

/** Rebuild the stepper badges and reflect active/complete state. */
function renderStepper() {
  const steps = visibleSteps();
  stepsList.innerHTML = '';
  steps.forEach((step, i) => {
    const li = document.createElement('li');
    li.className = 'da-migration-steps-item';
    li.dataset.step = step.key;
    if (step.key === currentKey || currentKey === 'done') li.classList.add('is-active');
    if (completed.has(step.key)) li.classList.add('is-complete');
    // once we reach the terminal panel, every step reads as complete
    if (currentKey === 'done') li.classList.remove('is-active');

    const num = document.createElement('span');
    num.className = 'da-migration-steps-num';
    num.textContent = completed.has(step.key) || currentKey === 'done' ? '✓' : `${i + 1}`;

    const label = document.createElement('span');
    label.className = 'da-migration-steps-label';
    label.textContent = step.label;

    li.append(num, label);
    stepsList.append(li);
  });
}

function render() {
  updateDescriptions();
  renderStepper();

  form.querySelectorAll('.da-migration-panel').forEach((panel) => {
    panel.setAttribute('aria-hidden', panel.dataset.step === currentKey ? 'false' : 'true');
  });

  const nav = form.querySelector('.da-migration-nav');
  if (currentKey === 'done') {
    nav.setAttribute('aria-hidden', 'true');
    renderDone();
    return;
  }
  nav.setAttribute('aria-hidden', 'false');

  const steps = visibleSteps();
  const idx = steps.findIndex((s) => s.key === currentKey);
  backBtn.disabled = idx === 0;
  nextBtn.disabled = false;
  nextBtn.textContent = stepByKey(currentKey).action;
}

/**
 * Simulate a few seconds of bulk work, animating the step's progress bar and
 * item counter from 0 to the mocked total.
 */
function runProgress(stepKey) {
  const { total, unit, ms } = PROGRESS[stepKey];
  const panel = form.querySelector(`.da-migration-panel[data-step="${stepKey}"]`);
  const wrap = panel.querySelector('.da-migration-progress');
  const bar = wrap.querySelector('.da-migration-progress-bar');
  const label = wrap.querySelector('.da-migration-progress-label');
  wrap.setAttribute('aria-hidden', 'false');

  return new Promise((resolve) => {
    const start = performance.now();
    const tick = (now) => {
      const pct = Math.min(100, ((now - start) / ms) * 100);
      bar.style.width = `${pct}%`;
      label.textContent = `${Math.round((pct / 100) * total)} / ${total} ${unit}`;
      if (pct < 100) {
        requestAnimationFrame(tick);
      } else {
        resolve();
      }
    };
    requestAnimationFrame(tick);
  });
}

async function goNext() {
  const error = validate(currentKey);
  if (error) {
    showError(error);
    return;
  }
  showError('');

  // leaving the Site step starts the migration work against api.aem.live, so
  // make sure the user is signed in for the target org/site first
  if (currentKey === 'setup') {
    nextBtn.disabled = true;
    try {
      const { target } = fieldValues();
      await ensureLogin(target.org, target.site);
    } finally {
      nextBtn.disabled = false;
    }
  }

  // once copying starts, the token has been used — hide the field and its label
  if (currentKey === 'copy') {
    form.querySelector('#ims-token').closest('.form-field').style.display = 'none';
  }

  // bulk steps run a simulated progress bar before completing
  if (PROGRESS[currentKey]) {
    nextBtn.disabled = true;
    backBtn.disabled = true;
    await runProgress(currentKey);
  }

  completed.add(currentKey);

  const steps = visibleSteps();
  const idx = steps.findIndex((s) => s.key === currentKey);
  if (idx === steps.length - 1) {
    currentKey = 'done';
  } else {
    currentKey = steps[idx + 1].key;
  }
  render();
}

function goBack() {
  showError('');
  const steps = visibleSteps();
  const idx = steps.findIndex((s) => s.key === currentKey);
  if (idx > 0) {
    currentKey = steps[idx - 1].key;
    render();
  }
}

async function init() {
  try {
    await initConfigField();
  } catch {
    // config autocomplete is best-effort; the fields still work as plain inputs
  }
  const destFields = form.querySelector('.da-migration-destination');
  const orgInput = form.querySelector('#org');
  const destOrgInput = form.querySelector('#dest-org');
  const siteLabel = form.querySelector('label[for="site"]');
  // the destination always lives in the source org; mirror it and keep readonly
  const syncDestOrg = () => { destOrgInput.value = orgInput.value; };
  // clarify the site field is the source when a separate destination is used
  const updateSiteLabel = () => { siteLabel.textContent = destEnabled() ? 'Source site' : 'Site'; };
  orgInput.addEventListener('input', syncDestOrg);
  syncDestOrg();
  nextBtn.addEventListener('click', goNext);
  backBtn.addEventListener('click', goBack);
  useDestination.addEventListener('change', () => {
    destFields.setAttribute('aria-hidden', destEnabled() ? 'false' : 'true');
    updateSiteLabel();
    render();
  });
  updateSiteLabel();
  render();
}

registerToolReady(init());
