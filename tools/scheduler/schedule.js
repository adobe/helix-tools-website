import { registerToolReady } from '../../scripts/scripts.js';
import { ensureLogin } from '../../blocks/profile/profile.js';
import * as api from './utils.js';

const missingContext = document.getElementById('missing-context');
const formWrap = document.getElementById('schedule-form-wrap');
const pathValue = document.getElementById('target-path-value');
const siteValue = document.getElementById('target-site-value');
const timeInput = document.getElementById('schedule-time');
const timezoneLabel = document.getElementById('schedule-timezone');
const statusText = document.getElementById('status-text');
const scheduleBtn = document.getElementById('schedule-btn');

const { org, site, path } = api.parseSidekickParams(window.location.search);

function setStatus(message, kind = 'info') {
  statusText.textContent = message || '';
  if (message) {
    statusText.dataset.kind = kind;
  } else {
    delete statusText.dataset.kind;
  }
}

function disableForm(busy) {
  scheduleBtn.disabled = busy || !timeInput.value;
  timeInput.disabled = busy;
}

function autoClose() {
  // eslint-disable-next-line no-restricted-globals
  setTimeout(() => window.close(), 3000);
}

async function handleSchedule() {
  setStatus('');
  if (!api.isAtLeastFiveMinAhead(timeInput.value)) {
    setStatus('Pick a date/time at least 5 minutes in the future.', 'warning');
    return;
  }
  disableForm(true);

  setStatus('Signing in…');
  const signedIn = await ensureLogin(org, site);
  if (!signedIn) {
    setStatus('Sign in to AEM to schedule this page.', 'warning');
    disableForm(false);
    return;
  }

  setStatus('Previewing page…');
  const preview = await api.ensurePreview(org, site, path);
  if (!preview.ok) {
    setStatus(preview.error, 'warning');
    disableForm(false);
    return;
  }

  const scheduledPublish = new Date(timeInput.value).toISOString();
  const nonce = api.generateNonce();

  setStatus('Recording intent…');
  const intent = await api.writeScheduleIntent(org, site, {
    route: 'schedule-page-intent',
    nonce,
    path,
    scheduledPublish,
  });
  if (!intent.ok) {
    setStatus(intent.error || 'Could not record schedule intent.', 'warning');
    disableForm(false);
    return;
  }

  setStatus('Scheduling…');
  const result = await api.schedulePage({
    org, site, path, scheduledPublish, nonce,
  });
  if (!result.ok) {
    setStatus(result.error, 'warning');
    disableForm(false);
    return;
  }

  const formatted = new Date(scheduledPublish).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
  setStatus(`Scheduled for ${formatted}.`, 'success');
  autoClose();
}

function initContext() {
  if (!org || !site || !path) {
    formWrap.hidden = true;
    missingContext.hidden = false;
    return;
  }
  pathValue.textContent = path;
  siteValue.textContent = `${org}/${site}`;
  timezoneLabel.textContent = `(${Intl.DateTimeFormat().resolvedOptions().timeZone})`;
}

timeInput.addEventListener('input', () => {
  scheduleBtn.disabled = !timeInput.value;
  setStatus('');
});
scheduleBtn.addEventListener('click', handleSchedule);

initContext();
registerToolReady();
