import { registerToolReady } from '../../scripts/scripts.js';
import { initConfigField, updateConfig } from '../../utils/config/config.js';
import { ensureLogin } from '../../blocks/profile/profile.js';
import { logResponse, logMessage } from '../../blocks/console/console.js';
import {
  getDomainStatus, registerDomain, advanceDomain, requestDeletion, cancelDeletion, retryDomain,
  checkDns,
} from './worker-client.js';
import * as api from './utils.js';

// TODO: replace with the real deployed Worker URL once wired to the deployed
const WORKER_BASE_URL = 'https://aem-domain-onboarding-worker.adobeaem.workers.dev';

const adminForm = document.getElementById('admin-form');
const orgSiteError = document.getElementById('org-site-error');
const org = document.getElementById('org');
const site = document.getElementById('site');
const continueBtn = document.getElementById('fetch');``

const domainForm = document.getElementById('domain-form');
const domainInput = document.getElementById('domain');
const setupBtn = document.getElementById('setup');
const flash = document.getElementById('flash');

const ownerMismatch = document.getElementById('owner-mismatch');
const stepIndicator = document.getElementById('step-indicator');

const panelRecords = document.getElementById('panel-records');
const recordsList = document.getElementById('records-list');
const recordsNote = document.getElementById('records-note');
const verifyBtn = document.getElementById('verify');

const panelLoading = document.getElementById('panel-loading');
const loadingTitle = document.getElementById('loading-title');
const loadingDesc = document.getElementById('loading-desc');

const panelLive = document.getElementById('panel-live');
const liveDomain = document.getElementById('live-domain');
const liveLink = document.getElementById('live-link');

const panelError = document.getElementById('panel-error');
const errorTitle = document.getElementById('error-title');
const errorMessage = document.getElementById('error-message');
const retryBtn = document.getElementById('retry');
const errorRemoveBtn = panelError.querySelector('.remove-domain');

const removalPanel = document.getElementById('removal-panel');
const removalDescription = document.getElementById('removal-description');
const removalRecordsList = document.getElementById('removal-records-list');
const removalNote = document.getElementById('removal-note');
const checkRecordsBtn = document.getElementById('check-records');
const confirmRemovalBtn = document.getElementById('confirm-removal');
const cancelRemovalBtn = document.getElementById('cancel-removal');

const removeButtons = [...document.querySelectorAll('.remove-domain')];
const consoleBlock = document.querySelector('.console');

const PANELS = [
  ownerMismatch, stepIndicator, panelRecords, panelLoading, panelLive, panelError, removalPanel,
];

let currentDomain = null;
let pollGeneration = 0;
let pollTimer = null;
``
function hide(el) {
  el.setAttribute('aria-hidden', 'true');
}

function show(el) {
  el.setAttribute('aria-hidden', 'false');
}

function setNote(el, kind, text) {
  el.dataset.kind = kind;
  el.textContent = text;
  show(el);
}

function setFlash(kind, text) {
  setNote(flash, kind, text);
}

function clearFlash() {
  hide(flash);
}

function logWorkerResult(result) {
  logResponse(consoleBlock, result.status, [result.method, result.url, result.error || '']);
}

// A "deleted" outcome: an HTTP 404, or a 200 body of { status: 'deleted' }.
function isDeleted(result) {
  return result.status === 404 || (result.ok && result.body?.status === 'deleted');
}

// Disables the triggering button with a spinner until the action resolves,
// preventing double-submits.
async function withBusy(btn, fn) {
  if (!btn) return fn();
  btn.setAttribute('data-busy', 'true');
  btn.disabled = true;
  try {
    return await fn();
  } finally {
    btn.disabled = false;
    btn.removeAttribute('data-busy');
  }
}

// After a not-ready Verify/Check, disables the checking buttons with a countdown, then re-enables
// them — stops spam-checking, which only delays detection.
let cooldownTimer = null;
let cooldownButtons = [];

function clearCooldown() {
  if (cooldownTimer) {
    clearInterval(cooldownTimer);
    cooldownTimer = null;
  }
  cooldownButtons.forEach((btn) => { btn.disabled = false; });
  cooldownButtons = [];
}

function startCheckCooldown(buttons, note, { wait, message, kind }) {
  clearCooldown();
  cooldownButtons = buttons.filter(Boolean);
  cooldownButtons.forEach((btn) => { btn.disabled = true; });
  let remaining = Math.max(1, Math.round(wait));
  const render = () => setNote(note, kind, `${message} You can try again in ${remaining}s.`);
  render();
  cooldownTimer = setInterval(() => {
    remaining -= 1;
    if (remaining > 0) {
      render();
      return;
    }
    setNote(note, kind, message);
    clearCooldown();
  }, 1000);
}

// The restore poll, independent of the check cooldown: auto-polls a held cancel until it completes.
let cancelPollTimer = null;

function stopCancelPoll() {
  if (cancelPollTimer) {
    clearTimeout(cancelPollTimer);
    cancelPollTimer = null;
  }
}

async function fetchStatus() {
  const result = await getDomainStatus(WORKER_BASE_URL, currentDomain, org.value, site.value);
  logWorkerResult(result);
  return result;
}

// Builds the Host / Type / Value card for one CNAME, with copy buttons on Host and Value.
function buildRecordCard(title, fields) {
  const card = document.createElement('div');
  card.className = 'record';

  const heading = document.createElement('h3');
  heading.className = 'record-title';
  heading.textContent = title;
  card.append(heading);

  const dl = document.createElement('dl');
  dl.className = 'record-fields';
  [
    ['Host / Name', fields.host, true],
    ['Type', fields.type, false],
    ['Value / Target', fields.value, true],
  ].forEach(([label, value, canCopy]) => {
    const row = document.createElement('div');
    row.className = 'record-field';

    const dt = document.createElement('dt');
    dt.textContent = label;

    const dd = document.createElement('dd');
    const code = document.createElement('code');
    code.textContent = value;
    dd.append(code);

    if (canCopy) {
      const copy = document.createElement('button');
      copy.type = 'button';
      copy.className = 'copy-button';
      copy.textContent = 'Copy';
      copy.dataset.copy = value;
      dd.append(copy);
    }

    row.append(dt, dd);
    dl.append(row);
  });

  card.append(dl);
  return card;
}

// Onboarding: the detailed Host/Type/Value cards with copy buttons.
function renderRecords(container, instructions) {
  container.replaceChildren();
  const acme = api.recordFields(instructions?.acmeChallengeCname);
  const prod = api.recordFields(instructions?.productionCname);
  if (acme) container.append(buildRecordCard('Verification CNAME', acme));
  if (prod) container.append(buildRecordCard('Production CNAME', prod));
}

function renderRemovalRecords(container, instructions) {
  container.replaceChildren();
  const list = document.createElement('ul');
  list.className = 'record-lines';
  [instructions?.acmeChallengeCname, instructions?.productionCname]
    .map(api.recordFields)
    .filter(Boolean)
    .forEach((fields) => {
      const li = document.createElement('li');
      const code = document.createElement('code');
      code.textContent = api.formatRecordLine(fields);
      li.append(code);
      list.append(li);
    });
  container.append(list);
}

function renderStepIndicator(status) {
  const steps = api.getStepIndicator(status);
  if (!steps) {
    hide(stepIndicator);
    return;
  }
  steps.forEach((step, i) => {
    stepIndicator.children[i].className = `step ${step.state}`;
  });
  show(stepIndicator);
}

function showLoading(title, desc) {
  loadingTitle.textContent = title;
  loadingDesc.textContent = desc;
  show(panelLoading);
}

function showError(title, message, { canRemove }) {
  errorTitle.textContent = title;
  errorMessage.textContent = message;
  if (canRemove) show(errorRemoveBtn);
  else hide(errorRemoveBtn);
  show(panelError);
}

function hideAllPanels() {
  PANELS.forEach(hide);
  hide(recordsNote);
  hide(removalNote);
}

// Renders exactly one panel for the given worker state. Display only — polling and the
// action buttons are wired separately.
function applyStatus(state) {
  const { status, instructions } = state;
  hideAllPanels();
  const desc = api.describeStatus(status);
  if (!desc) return;
  // Hide the domain box once a domain is driven; restored on owner-mismatch,
  // lookup error, or removal.
  hide(domainForm);
  renderStepIndicator(status);

  switch (desc.view) {
    case 'onboarding':
      showLoading('Preparing your domain…', 'We\'re setting things up. This only takes a moment.');
      break;
    case 'records':
      renderRecords(recordsList, instructions);
      show(panelRecords);
      break;
    case 'issuing':
      showLoading('Issuing your SSL certificate…', 'This usually takes a few minutes. You can leave this page open.');
      break;
    case 'live':
      liveDomain.textContent = currentDomain;
      liveDomain.href = `https://${currentDomain}`;
      liveLink.href = `https://${currentDomain}`;
      show(panelLive);
      break;
    case 'error-onboard':
      showError('We couldn\'t set up this domain', 'Retry, or remove the domain and start over.', { canRemove: true });
      break;
    case 'error-cert':
      showError('We couldn\'t issue your SSL certificate', 'Retry, or remove the domain.', { canRemove: true });
      break;
    case 'removal': {
      // Served → DNS-gated: keep the Check-records gate, Confirm stays disabled until released.
      // Never-served → offboards directly: drop the gate, allow Confirm now.
      renderRemovalRecords(removalRecordsList, instructions);
      const removal = api.describeRemoval(state.served);
      removalDescription.textContent = removal.description;
      cancelRemovalBtn.disabled = false;
      if (removal.requiresRecordCheck) {
        show(checkRecordsBtn);
        checkRecordsBtn.disabled = false;
        confirmRemovalBtn.disabled = true;
      } else {
        hide(checkRecordsBtn);
        confirmRemovalBtn.disabled = false;
      }
      setNote(removalNote, removal.note.kind, removal.note.message);
      show(removalPanel);
      break;
    }
    case 'deleting':
      showLoading('Removing your domain…', 'This can take a few minutes.');
      break;
    case 'error-offboard':
      showError('We couldn\'t remove this domain', 'Retry, or contact the team.', { canRemove: false });
      break;
    default:
      break;
  }
}

function setDomainInUrl(domain) {
  const url = new URL(window.location.href);
  url.searchParams.set('domain', domain);
  window.history.replaceState(null, '', url);
}

function clearDomainInUrl() {
  const url = new URL(window.location.href);
  url.searchParams.delete('domain');
  window.history.replaceState(null, '', url);
}

function stopPolling() {
  pollGeneration += 1;
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
}

function applyDeleted() {
  stopPolling();
  clearCooldown();
  stopCancelPoll();
  hideAllPanels();
  logMessage(consoleBlock, 'info', ['status', `${currentDomain} has been removed.`]);
  domainInput.value = '';
  show(domainForm);
  setFlash('success', `${currentDomain} has been removed. Remember to delete its two CNAME records at your DNS provider.`);
  clearDomainInUrl();
}

// Polls GET on exponential backoff while in a transient state; stops on any terminal/failed
// state or deletion.
function startPolling() {
  stopPolling();
  const gen = pollGeneration;
  let attempt = 0;

  const tick = async () => {
    if (gen !== pollGeneration) return;
    const result = await fetchStatus();
    if (gen !== pollGeneration) return;

    if (isDeleted(result)) {
      applyDeleted();
      return;
    }
    if (result.ok) {
      applyStatus(result.body);
      if (api.isFailedStatus(result.body.status) || !api.isPollableStatus(result.body.status)) {
        stopPolling();
        return;
      }
    }
    attempt += 1;
    if (gen === pollGeneration) pollTimer = setTimeout(tick, api.pollDelay(attempt));
  };

  pollTimer = setTimeout(tick, api.pollDelay(attempt));
}

function driveState(state) {
  clearFlash();
  clearCooldown();
  stopCancelPoll();
  applyStatus(state);
  if (api.isPollableStatus(state.status)) startPolling();
  else stopPolling();
}

// Calls the worker for a user action and drives the resulting state.
async function performAction(btn, actionName, workerCall) {
  return withBusy(btn, async () => {
    const result = await workerCall();
    logWorkerResult(result);

    if (isDeleted(result)) {
      applyDeleted();
      return;
    }
    if (!result.ok) {
      logMessage(consoleBlock, 'error', [actionName, result.error || 'Unexpected error']);
      setFlash('warning', api.getErrorMessage(result.status, result.error));
      return;
    }

    driveState(result.body);
  });
}

// The removal panel's read-only DNS check: gates Confirm on whether the records are released.
// Returns `{ wait, message, kind }` when not yet released, else null.
async function performCheckRemovalRecords() {
  return withBusy(checkRecordsBtn, async () => {
    const result = await checkDns(WORKER_BASE_URL, currentDomain, org.value, site.value);
    logWorkerResult(result);
    if (!result.ok) {
      logMessage(consoleBlock, 'error', ['check-records', result.error || 'Unexpected error']);
      setFlash('warning', api.getErrorMessage(result.status, result.error));
      return null;
    }
    const { kind, message } = api.describeDnsCheck(result.body.dns, 'offboard', currentDomain);
    setNote(removalNote, kind, message);
    const ready = api.dnsReady(result.body.dns);
    confirmRemovalBtn.disabled = !ready; // gate: only offer removal once the records are released
    if (ready) return null;
    return { wait: api.dnsWaitSeconds(result.body.dns), message, kind };
  });
}

// Attempts the DNS-gated advance directly for `phase` 'onboard' or 'offboard'.
// Returns `{ wait, message, kind }` when the worker declines, else null.
async function verifyAndAdvance(btn, phase) {
  const note = phase === 'offboard' ? removalNote : recordsNote;
  return withBusy(btn, async () => {
    const result = await advanceDomain(WORKER_BASE_URL, currentDomain, org.value, site.value);
    logWorkerResult(result);
    if (isDeleted(result)) {
      applyDeleted();
      return null;
    }
    if (!result.ok) {
      logMessage(consoleBlock, 'error', [`advance-${phase}`, result.error || 'Unexpected error']);
      setFlash('warning', api.getErrorMessage(result.status, result.error));
      return null;
    }
    // Worker declined — DNS not ready yet. Re-render and hand back the wait so the caller can cool
    // the buttons.
    const wait = api.dnsWaitSeconds(result.body);
    if (wait != null) {
      driveState(result.body);
      const { kind, message } = api.describeDnsCheck(result.body.dns, phase, currentDomain);
      setNote(note, kind, message);
      return { wait, message, kind };
    }
    driveState(result.body);
    return null;
  });
}

// Cancels a pending deletion, restoring the domain. A served restore may hold for DNS freshness, so
// this auto-polls until it completes, keeping removal actions disabled meanwhile.
async function runCancel() {
  stopCancelPoll();
  clearCooldown(); // supersede any running check cooldown
  cancelRemovalBtn.disabled = true;
  checkRecordsBtn.disabled = true;
  confirmRemovalBtn.disabled = true;

  const result = await cancelDeletion(WORKER_BASE_URL, currentDomain, org.value, site.value);
  logWorkerResult(result);
  if (!result.ok) {
    logMessage(consoleBlock, 'error', ['cancel-removal', result.error || 'Unexpected error']);
    setFlash('warning', api.getErrorMessage(result.status, result.error));
    cancelRemovalBtn.disabled = false;
    checkRecordsBtn.disabled = false; // confirm stays gated behind a fresh Check records
    return;
  }
  if (result.body.status === 'PENDING_DELETION') {
    // Still holding for DNS freshness — poll again shortly.
    const wait = api.dnsWaitSeconds(result.body) ?? 30;
    setNote(removalNote, 'info', 'Restoring your domain — confirming your DNS records are still valid… This may take a few minutes.');
    cancelPollTimer = setTimeout(runCancel, wait * 1000);
    return;
  }
  driveState(result.body); // restored (ACTIVE / REGISTERED)
  // REGISTERED means the worker couldn't confirm the records, so the domain dropped back to setup.
  if (result.body.status === 'REGISTERED') {
    setNote(recordsNote, 'warning', 'We couldn\'t confirm your CNAME records, so you\'re back at the setup step. Re-check both records, then verify.');
  }
}

async function setupDomain(btn) {
  return withBusy(btn, async () => {
    const result = await fetchStatus();

    if (result.status === 404) {
      const reg = await registerDomain(WORKER_BASE_URL, currentDomain, org.value, site.value);
      logWorkerResult(reg);
      if (!reg.ok) {
        logMessage(consoleBlock, 'error', ['register', reg.error || 'Unexpected error']);
        setFlash('warning', api.getErrorMessage(reg.status, reg.error));
        return;
      }
      driveState(reg.body);
      return;
    }
    if (result.status === 403) {
      stopPolling();
      hideAllPanels();
      show(domainForm);
      show(ownerMismatch);
      return;
    }
    if (!result.ok) {
      logMessage(consoleBlock, 'error', ['lookup', result.error || 'Unexpected error']);
      setFlash('warning', api.getErrorMessage(result.status, result.error));
      return;
    }
    driveState(result.body);
  });
}

async function enterDomainStep() {
  // Org/site are committed at the domain step — keep them visible but retire the Continue button.
  hide(continueBtn.closest('.button-wrapper'));
  domainForm.removeAttribute('disabled');
  show(domainForm);

  const domainParam = new URLSearchParams(window.location.search).get('domain');
  if (domainParam && !domainInput.value) {
    domainInput.value = domainParam;
    currentDomain = domainParam.trim().toLowerCase();
    await setupDomain(setupBtn);
  }
}

async function init() {
  await initConfigField();

  adminForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    hide(orgSiteError);

    if (!org.value || !site.value) {
      orgSiteError.textContent = 'Please select an organization and site.';
      show(orgSiteError);
      return;
    }

    updateConfig();

    const signedIn = await ensureLogin(org.value, site.value);
    if (!signedIn) {
      orgSiteError.textContent = 'Please sign in with your AEM account to continue.';
      show(orgSiteError);
      return;
    }

    await enterDomainStep();
  });

  domainForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!domainInput.value) return;
    stopPolling();
    clearFlash();
    currentDomain = domainInput.value.trim().toLowerCase();
    setDomainInUrl(currentDomain);
    await setupDomain(setupBtn);
  });

  verifyBtn.addEventListener('click', async () => {
    const held = await verifyAndAdvance(verifyBtn, 'onboard');
    if (held) startCheckCooldown([verifyBtn], recordsNote, held);
  });

  retryBtn.addEventListener('click', () => performAction(
    retryBtn,
    'retry',
    () => retryDomain(WORKER_BASE_URL, currentDomain, org.value, site.value),
  ));

  removeButtons.forEach((btn) => btn.addEventListener('click', () => performAction(
    btn,
    'remove',
    () => requestDeletion(WORKER_BASE_URL, currentDomain, org.value, site.value),
  )));

  checkRecordsBtn.addEventListener('click', async () => {
    const held = await performCheckRemovalRecords();
    if (held) startCheckCooldown([checkRecordsBtn], removalNote, held);
  });

  confirmRemovalBtn.addEventListener('click', async () => {
    const held = await verifyAndAdvance(confirmRemovalBtn, 'offboard');
    if (held) {
      // Records regressed since the check — re-gate Confirm behind a fresh Check records.
      confirmRemovalBtn.disabled = true;
      startCheckCooldown([checkRecordsBtn], removalNote, held);
    }
  });

  cancelRemovalBtn.addEventListener('click', () => runCancel());

  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('.copy-button');
    if (!btn) return;
    try {
      await navigator.clipboard.writeText(btn.dataset.copy);
      const previous = btn.textContent;
      btn.textContent = 'Copied';
      setTimeout(() => { btn.textContent = previous; }, 1500);
    } catch {
      // Clipboard unavailable (e.g. insecure context); the value is still selectable.
    }
  });

  // Resume from a reload: if org, site, domain are set and the user is signed in, re-enter.
  const params = new URLSearchParams(window.location.search);
  if (params.get('domain') && org.value && site.value) {
    const signedIn = await ensureLogin(org.value, site.value);
    if (signedIn) await enterDomainStep();
  }
}

registerToolReady(init());
