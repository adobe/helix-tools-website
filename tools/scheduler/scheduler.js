import { registerToolReady } from '../../scripts/scripts.js';
import { ensureLogin } from '../../blocks/profile/profile.js';
import { initConfigField } from '../../utils/config/config.js';
import { logResponse } from '../../blocks/console/console.js';
import * as api from './utils.js';

const siteForm = document.getElementById('site-form');
const orgInput = document.getElementById('org');
const siteInput = document.getElementById('site');
const resetBtn = document.getElementById('reset');
const statusContainer = document.getElementById('status-container');
const statusText = statusContainer.querySelector('.status-text');
const refreshBtn = document.getElementById('refresh');
const scheduleContainer = document.getElementById('schedule-container');
const scheduleList = document.getElementById('schedule-list');
const consoleBlock = document.querySelector('.console');
const confirmDialog = document.getElementById('confirm-dialog');
const confirmMessage = document.getElementById('confirm-message');
const confirmOk = document.getElementById('confirm-ok');

let currentOrg = '';
let currentSite = '';
let registered = null;

function log(resp, method, url) {
  if (!resp) return;
  const err = resp.headers?.get?.('x-error') || '';
  logResponse(consoleBlock, resp.status, [method, url, err]);
}

function setStatus(message, kind = 'info') {
  statusText.textContent = message;
  statusContainer.dataset.kind = kind;
  statusContainer.removeAttribute('aria-hidden');
}

function clearStatus() {
  statusText.textContent = '';
  statusContainer.setAttribute('aria-hidden', 'true');
  delete statusContainer.dataset.kind;
}

function setButtons({ refresh }) {
  refreshBtn.hidden = !refresh;
}

function renderEmptyList() {
  scheduleContainer.setAttribute('aria-hidden', 'true');
  [...scheduleList.querySelectorAll('.schedule-row:not(.schedule-header)')]
    .forEach((row) => row.remove());
}

function showConfirm(message, okLabel = 'Delete') {
  return new Promise((resolve) => {
    confirmMessage.textContent = message;
    confirmOk.textContent = okLabel;
    confirmDialog.addEventListener(
      'close',
      () => resolve(confirmDialog.returnValue === 'confirm'),
      { once: true },
    );
    confirmDialog.showModal();
  });
}

async function loadSchedule() {
  setStatus('Loading scheduled items…');
  let viewNonce;
  try {
    viewNonce = await api.ensureViewNonce(currentOrg, currentSite);
  } catch (err) {
    setStatus(err.message || 'Could not record view intent.', 'warning');
    renderEmptyList();
    return;
  }

  let result = await api.fetchSchedule(currentOrg, currentSite, viewNonce);
  log(result.resp, 'GET', `/schedule/${currentOrg}/${currentSite}`);

  if (result.error && /expired/i.test(result.error)) {
    // session nonce stale — rotate and retry once
    api.invalidateViewNonceCache();
    const fresh = await api.ensureViewNonce(currentOrg, currentSite);
    result = await api.fetchSchedule(currentOrg, currentSite, fresh);
    log(result.resp, 'GET', `/schedule/${currentOrg}/${currentSite}`);
  }

  if (result.error) {
    setStatus(result.error, 'warning');
    renderEmptyList();
    return;
  }
  const n = result.entries.length;
  setStatus(
    n
      ? `Found ${n} scheduled item${n === 1 ? '' : 's'}.`
      : 'No scheduled pages or snapshots for this site.',
    n ? 'success' : 'info',
  );
  // eslint-disable-next-line no-use-before-define
  renderEntries(result.entries);
}

async function handleDelete(entry) {
  const label = entry.type === 'snapshot' ? 'snapshot' : 'page';
  const confirmed = await showConfirm(`Delete scheduled ${label} "${entry.id}"?`);
  if (!confirmed) return;

  setStatus('Deleting…');
  if (entry.type === 'snapshot') {
    const cleared = await api.clearSnapshotScheduledPublish(currentOrg, currentSite, entry.id);
    log(cleared.resp, 'POST', `/snapshot/${currentOrg}/${currentSite}/main/${entry.id}`);
    if (!cleared.ok) {
      setStatus(cleared.error, 'warning');
      return;
    }
  }
  const nonce = api.generateNonce();
  const route = entry.type === 'page'
    ? 'delete-page-schedule-intent'
    : 'delete-snapshot-schedule-intent';
  const payload = entry.type === 'page' ? { path: entry.id } : { snapshotId: entry.id };
  const intent = await api.writeScheduleIntent(
    currentOrg,
    currentSite,
    { route, nonce, ...payload },
  );
  if (!intent.ok) {
    setStatus(intent.error || 'Could not record delete intent.', 'warning');
    return;
  }

  const result = entry.type === 'snapshot'
    ? await api.deleteSnapshotSchedule(currentOrg, currentSite, entry.id, nonce)
    : await api.deletePageSchedule(currentOrg, currentSite, entry.id, nonce);
  log(result.resp, 'DELETE', `/schedule/${entry.type}/${currentOrg}/${currentSite}/${entry.id}`);
  if (!result.ok) {
    setStatus(result.error, 'warning');
    return;
  }
  await loadSchedule();
}

function renderEntries(entries) {
  renderEmptyList();
  if (!entries.length) return;

  entries.forEach((entry) => {
    const row = document.createElement('div');
    row.className = 'schedule-row';
    row.setAttribute('role', 'row');
    row.dataset.id = entry.id;
    row.dataset.type = entry.type;

    const typeLabels = { page: 'Page', snapshot: 'Snapshot' };
    const typeCell = document.createElement('span');
    typeCell.textContent = typeLabels[entry.type] || 'Unknown';

    const itemCell = document.createElement('span');
    itemCell.className = 'item-id';
    const link = document.createElement('a');
    if (entry.type === 'page') {
      link.href = api.buildPageUrl(currentOrg, currentSite, entry.id);
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
    } else if (entry.type === 'snapshot') {
      link.href = api.buildSnapshotUrl(currentOrg, currentSite, entry.id);
    } else {
      link.href = '#';
    }
    link.textContent = entry.id;
    itemCell.append(link);

    const whenCell = document.createElement('span');
    const whenLabel = document.createElement('span');
    whenLabel.textContent = api.formatDate(entry.scheduledPublish);
    const whenDuration = document.createElement('span');
    whenDuration.className = 'duration';
    whenDuration.textContent = api.formatDuration(entry.scheduledPublish);
    whenCell.append(whenLabel, ' ', whenDuration);

    const byCell = document.createElement('span');
    byCell.textContent = entry.userId || '—';

    const actionsCell = document.createElement('span');
    actionsCell.className = 'schedule-actions';
    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'button outline';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', () => handleDelete(entry));
    actionsCell.append(deleteBtn);

    row.append(typeCell, itemCell, whenCell, byCell, actionsCell);
    scheduleList.append(row);
  });
  scheduleContainer.removeAttribute('aria-hidden');
}

async function loadSiteState() {
  if (!currentOrg || !currentSite) return;
  setButtons({ refresh: false });
  renderEmptyList();
  setStatus('Checking scheduler registration…');

  const reg = await api.checkRegistration(currentOrg, currentSite);
  log(reg.resp, 'GET', `/register/${currentOrg}/${currentSite}`);
  if (reg.error) {
    setStatus(reg.error, 'warning');
    return;
  }
  registered = reg.registered;
  if (!registered) {
    setStatus(
      `${currentOrg}/${currentSite} is not registered for scheduling. Contact your admin to enable scheduling for this site.`,
      'info',
    );
    setButtons({ refresh: false });
    return;
  }
  setButtons({ refresh: true });
  await loadSchedule();
}

async function handleSubmit(event) {
  event.preventDefault();
  currentOrg = orgInput.value.trim();
  currentSite = siteInput.value.trim();
  if (!currentOrg || !currentSite) {
    setStatus('Enter an organization and site to load schedules.', 'warning');
    return;
  }
  const signedIn = await ensureLogin(currentOrg, currentSite);
  if (!signedIn) return;
  await loadSiteState();
}

function handleReset() {
  currentOrg = '';
  currentSite = '';
  registered = null;
  setButtons({ refresh: false });
  renderEmptyList();
  clearStatus();
}

initConfigField();
siteForm.addEventListener('submit', handleSubmit);
resetBtn.addEventListener('click', handleReset);
refreshBtn.addEventListener('click', loadSiteState);

registerToolReady();
