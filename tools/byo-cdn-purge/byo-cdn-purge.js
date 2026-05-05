import { registerToolReady } from '../../scripts/scripts.js';

const PURGE_SERVICE_URL = 'https://helix-pages.anywhere.run/helix-services/byocdn-push-invalidation/v1';

/** Form/query keys mirrored into the location bar (values trimmed; empty omitted). */
const SYNC_KEYS = [
  'type',
  'host',
  'endpoint',
  'clientSecret',
  'clientToken',
  'accessToken',
  'urls',
  'keys',
];

const SECRET_QUERY_KEYS = ['clientSecret', 'clientToken', 'accessToken'];

const URL_LENGTH_SOFT_MAX = 2000;

/**
 * @param {string} text
 * @returns {string[]}
 */
function linesToList(text) {
  return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

/**
 * @param {HTMLFormElement} form
 * @returns {URLSearchParams}
 */
function buildPurgeBody(form) {
  const fd = new URLSearchParams();
  const type = form.querySelector('#cdn-type')?.value || 'akamai';
  fd.append('type', type);

  const host = form.querySelector('#host')?.value?.trim() || '';
  fd.append('host', host);

  if (type === 'akamai') {
    fd.append('endpoint', form.querySelector('#endpoint')?.value?.trim() || '');
    fd.append('clientSecret', form.querySelector('#clientSecret')?.value || '');
    fd.append('clientToken', form.querySelector('#clientToken')?.value || '');
    fd.append('accessToken', form.querySelector('#accessToken')?.value || '');
  }

  const urls = form.querySelector('#urls')?.value || '';
  const keys = form.querySelector('#keys')?.value || '';
  linesToList(urls).forEach((u) => fd.append('urls', u));
  linesToList(keys).forEach((k) => fd.append('keys', k));

  return fd;
}

/**
 * @param {HTMLFormElement} form
 * @returns {URLSearchParams}
 */
function buildShareParams(form) {
  const params = new URLSearchParams();
  SYNC_KEYS.forEach((key) => {
    const el = form.elements.namedItem(key);
    if (!el || !('value' in el)) return;
    const raw = el.value;
    if (typeof raw !== 'string') return;
    if (key === 'urls' || key === 'keys') {
      if (raw.trim()) params.set(key, raw);
    } else if (raw.trim()) {
      params.set(key, raw.trim());
    }
  });
  return params;
}

/**
 * @param {HTMLFormElement} form
 * @param {URLSearchParams} searchParams
 */
function applySearchParamsToForm(form, searchParams) {
  SYNC_KEYS.forEach((key) => {
    const raw = searchParams.get(key);
    if (raw == null || raw === '') return;
    const el = form.elements.namedItem(key);
    if (el && 'value' in el) {
      el.value = raw;
    }
  });
}

/**
 * @param {HTMLFormElement} form
 */
function replaceUrlFromForm(form) {
  const params = buildShareParams(form);
  const qs = params.toString();
  const next = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
  window.history.replaceState(null, '', next);

  const warn = document.getElementById('url-length-warning');
  if (warn) {
    warn.hidden = next.length <= URL_LENGTH_SOFT_MAX;
  }
}

/**
 * @param {() => void} fn
 * @param {number} ms
 * @returns {() => void}
 */
function debounce(fn, ms) {
  let t = 0;
  return () => {
    window.clearTimeout(t);
    t = window.setTimeout(() => fn(), ms);
  };
}

function stripSecretsFromUrl() {
  const params = new URLSearchParams(window.location.search);
  SECRET_QUERY_KEYS.forEach((k) => params.delete(k));
  const qs = params.toString();
  const next = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
  window.history.replaceState(null, '', next);

  const warn = document.getElementById('url-length-warning');
  if (warn) {
    warn.hidden = next.length <= URL_LENGTH_SOFT_MAX;
  }
}

/**
 * @param {Response} resp
 * @param {string} text
 * @returns {string}
 */
function formatResponseBody(resp, text) {
  const ct = resp.headers.get('content-type') || '';
  if (ct.includes('application/json')) {
    try {
      return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      return text;
    }
  }
  return text;
}

async function init() {
  const form = document.getElementById('purge-form');
  const resultEl = document.getElementById('result');
  const submitBtn = document.getElementById('submit-purge');
  const stripBtn = document.getElementById('strip-query');

  if (!(form instanceof HTMLFormElement) || !resultEl || !submitBtn || !stripBtn) {
    return;
  }

  applySearchParamsToForm(form, new URL(window.location.href).searchParams);
  replaceUrlFromForm(form);

  const pushUrl = debounce(() => replaceUrlFromForm(form), 400);
  form.addEventListener('input', pushUrl);
  form.addEventListener('change', pushUrl);

  stripBtn.addEventListener('click', () => stripSecretsFromUrl());

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!form.reportValidity()) return;

    submitBtn.disabled = true;
    resultEl.textContent = 'Sending…';

    try {
      const body = buildPurgeBody(form);
      const resp = await fetch(PURGE_SERVICE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
      const text = await resp.text();
      const formatted = formatResponseBody(resp, text);
      resultEl.textContent = `${resp.status} ${resp.statusText}\n\n${formatted}`;
    } catch (err) {
      const message = err && typeof err === 'object' && 'message' in err ? err.message : String(err);
      resultEl.textContent = `Request failed: ${message}`;
    } finally {
      submitBtn.disabled = false;
    }
  });
}

registerToolReady(init());
