import getAdminClient from '../../scripts/admin-compat.js';
import * as api from './utils.js';

// The Sidekick popover cannot drive the tools-site profile login flow, so Admin
// calls go directly through the admin client and rely on Sidekick token
// injection (same pattern as page-status/orphaned-pages-popover.js).
let scheduleAdmin;

// Previews the page so it can be scheduled. Returns the shared { ok, error,
// resp } envelope.
async function ensurePreview(org, site, path) {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  const res = await scheduleAdmin.preview({ org, site }).update(cleanPath);
  return {
    ok: res.ok,
    error: res.ok ? '' : (res.error || 'Could not preview page before scheduling.'),
    resp: res,
  };
}

// Records a schedule intent in the Admin log.
async function writeIntent(org, site, entry) {
  const res = await scheduleAdmin.log({ org, site }).update('', JSON.stringify({ entries: [entry] }));
  return {
    ok: res.ok,
    error: res.ok ? '' : (res.error || 'Could not record schedule intent.'),
    resp: res,
  };
}

// Resolves the resource path behind an authoring-surface referrer (SharePoint,
// Google Docs, the admin.hlx.page editor, etc) by asking the Admin API to
// reverse-map the source document URL via its `editUrl` status lookup — the
// same mechanism Sidekick itself uses while editing, since the referrer URL
// there has no relation to the page's web path.
async function resolvePagePath(org, site, editUrl) {
  const res = await scheduleAdmin.status({ org, site }).get('', { params: { editUrl } });
  if (!res.ok) {
    return { path: '', error: res.error || 'Could not resolve the page being edited.', resp: res };
  }
  let json;
  try {
    json = await res.json();
  } catch {
    return { path: '', error: 'Could not parse status response.', resp: res };
  }
  const path = json?.webPath || '';
  return {
    path,
    error: path ? '' : 'Could not resolve the page being edited.',
    resp: res,
  };
}

const missingContext = document.getElementById('missing-context');
const missingContextMessage = missingContext.querySelector('p');
const defaultMissingContextMessage = missingContextMessage.textContent;
const formWrap = document.getElementById('schedule-form-wrap');
const pathValue = document.getElementById('target-path-value');
const siteValue = document.getElementById('target-site-value');
const timeInput = document.getElementById('schedule-time');
const timezoneLabel = document.getElementById('schedule-timezone');
const statusText = document.getElementById('status-text');
const scheduleBtn = document.getElementById('schedule-btn');

const sidekickParams = api.parseSidekickParams(window.location.search);
const {
  org, site, referrer, isProject,
} = sidekickParams;
let { path } = sidekickParams;

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

  setStatus('Previewing page…');
  const preview = await ensurePreview(org, site, path);
  if (!preview.ok) {
    setStatus(preview.error, 'warning');
    disableForm(false);
    return;
  }

  const scheduledPublish = new Date(timeInput.value).toISOString();
  const nonce = api.generateNonce();

  setStatus('Recording intent…');
  const intent = await writeIntent(org, site, {
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

async function init() {
  const admin = await getAdminClient();
  scheduleAdmin = admin.withRequestInit({
    mode: 'cors',
    cache: 'no-cache',
    credentials: 'same-origin',
    redirect: 'follow',
    referrerPolicy: 'no-referrer',
  });

  timeInput.addEventListener('input', () => {
    scheduleBtn.disabled = !timeInput.value;
    setStatus('');
  });
  scheduleBtn.addEventListener('click', handleSchedule);

  // Referrers from an authoring surface (SharePoint, Google Docs, etc)
  // carry the source document's URL, not the page's web path.
  // resolve it via the Admin API instead of guessing.
  if (!path && !isProject && org && site && referrer) {
    setStatus('Resolving page…');
    const resolved = await resolvePagePath(org, site, referrer);
    if (resolved.path) {
      path = resolved.path;
    } else {
      missingContextMessage.textContent = resolved.error || defaultMissingContextMessage;
    }
    setStatus('');
  }

  initContext();
}

init();
