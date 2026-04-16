/**
 * ProductBus Admin - Journals viewer (admin only)
 */

import { apiFetch } from './api.js';
import { showToast } from './ui.js';

const FILTER_DEBOUNCE_MS = 150;
const MAX_RANGE_MS = 12 * 60 * 60 * 1000;
const RANGE_ADJUST_MS = 15 * 60 * 1000;

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function toDatetimeLocal(date) {
  const pad = (n) => String(n).padStart(2, '0');
  const y = date.getFullYear();
  const mo = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const h = pad(date.getHours());
  const mi = pad(date.getMinutes());
  return `${y}-${mo}-${d}T${h}:${mi}`;
}

function fromDatetimeLocal(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

/**
 * Parse a timestamp string. Accepts any format the Date constructor handles,
 * plus partial ISO-like timestamps with dash or colon time separators
 * (matching the filesystem-safe form used in journal buckets and order IDs):
 *   2026-04-02T17-49-29.869Z
 *   2026-04-02T17-49-29
 *   2026-04-02T17
 *   2026-04-02
 * Missing time components default to 0. Missing Z is treated as UTC.
 */
function parseFlexibleDate(input) {
  const str = input.trim();
  let d = new Date(str);
  if (!Number.isNaN(d.getTime())) return d;
  const m = str.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2})(?:[-:](\d{2})(?:[-:](\d{2})(\.\d+)?)?)?)?(Z)?$/);
  if (m) {
    const [, y, mo, dy, h = '00', mi = '00', s = '00', ms = '', z = ''] = m;
    const iso = `${y}-${mo}-${dy}T${h}:${mi}:${s}${ms}${z || 'Z'}`;
    d = new Date(iso);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

function entryKey(entry) {
  if (entry.id) return entry.id;
  // Stable fallback: timestamp + event + any known identifier field.
  return `${entry.timestamp || ''}|${entry.event || ''}|${entry.orderId || entry.entityId || ''}`;
}

function summarizeEntry(entry) {
  const ts = entry.timestamp ? new Date(entry.timestamp).toISOString().replace('T', ' ').replace('Z', '') : '—';
  const parts = [];
  if (entry.event) parts.push(entry.event);
  if (entry.orderId) parts.push(`order:${entry.orderId}`);
  if (entry.type && entry.entityId) parts.push(`${entry.type}:${entry.entityId}`);
  else if (entry.type) parts.push(entry.type);
  if (entry.state) parts.push(`state:${entry.state}`);
  if (entry.actor) parts.push(`by ${entry.actor}`);
  return { ts, detail: parts.join(' · ') };
}

async function copyText(text, successMsg) {
  try {
    await navigator.clipboard.writeText(text);
    showToast(successMsg);
  } catch (err) {
    showToast(`Copy failed: ${err.message}`, 'error');
  }
}

export async function render(container, ctx) {
  const urlParams = new URLSearchParams(window.location.search);
  const initJournal = urlParams.get('journal') === 'orders' ? 'orders' : 'general';

  function parseIsoParam(key, fallbackMs) {
    const raw = urlParams.get(key);
    if (raw) {
      const d = new Date(raw);
      if (!Number.isNaN(d.getTime())) return d.toISOString();
    }
    return new Date(fallbackMs).toISOString();
  }

  const state = {
    journal: initJournal,
    orderId: urlParams.get('orderId') || '',
    filter: urlParams.get('filter') || '',
    sinceIso: parseIsoParam('since', Date.now() - 15 * 60 * 1000),
    untilIso: parseIsoParam('until', Date.now()),
    allEntries: [],
    expanded: new Set(),
    loading: false,
  };

  function syncUrl() {
    const url = new URL(window.location.href);
    url.searchParams.set('journal', state.journal);
    url.searchParams.set('since', state.sinceIso);
    url.searchParams.set('until', state.untilIso);
    if (state.orderId) url.searchParams.set('orderId', state.orderId);
    else url.searchParams.delete('orderId');
    if (state.filter) url.searchParams.set('filter', state.filter);
    else url.searchParams.delete('filter');
    window.history.replaceState({}, '', url);
  }

  container.innerHTML = `
    <div class="page-header">
      <h1>Journals</h1>
      <p>Inspect journal entries for this site. Maximum time range is 12 hours.</p>
    </div>
    <div class="journals-controls">
      <div class="view-switcher" id="journal-type">
        <button type="button" data-journal="general" class="${state.journal === 'general' ? 'active' : ''}">General</button>
        <button type="button" data-journal="orders" class="${state.journal === 'orders' ? 'active' : ''}">Orders</button>
      </div>
      <div class="form-field journals-range">
        <label for="journals-since">Since</label>
        <input type="datetime-local" id="journals-since" value="${toDatetimeLocal(new Date(state.sinceIso))}">
      </div>
      <div class="form-field journals-range">
        <label for="journals-until">Until</label>
        <input type="datetime-local" id="journals-until" value="${toDatetimeLocal(new Date(state.untilIso))}">
      </div>
      <div class="form-field journals-orderid"${state.journal === 'orders' ? '' : ' hidden'}>
        <label for="journals-orderid">Order ID</label>
        <input type="text" id="journals-orderid" placeholder="order id (optional)" value="${escapeHtml(state.orderId)}">
      </div>
      <div class="form-field journals-filter">
        <label for="journals-filter">Filter</label>
        <input type="text" id="journals-filter" placeholder="filter entries…" value="${escapeHtml(state.filter)}">
      </div>
      <div class="journals-actions">
        <button type="button" class="button" id="journals-refresh">Refresh</button>
        <button type="button" class="button outline" id="journals-copy-all">Copy all</button>
      </div>
    </div>
    <div id="journals-list"></div>
    <div class="journals-status" id="journals-status"></div>
  `;

  syncUrl();

  const typeSwitcher = container.querySelector('#journal-type');
  const sinceInput = container.querySelector('#journals-since');
  const untilInput = container.querySelector('#journals-until');
  const orderIdWrap = container.querySelector('.journals-orderid');
  const orderIdInput = container.querySelector('#journals-orderid');
  const filterInput = container.querySelector('#journals-filter');
  const refreshBtn = container.querySelector('#journals-refresh');
  const copyAllBtn = container.querySelector('#journals-copy-all');
  const listEl = container.querySelector('#journals-list');
  const statusEl = container.querySelector('#journals-status');

  function getFilteredEntries() {
    if (!state.filter) return state.allEntries;
    const needle = state.filter.toLowerCase();
    return state.allEntries.filter((e) => JSON.stringify(e).toLowerCase().includes(needle));
  }

  function renderList() {
    const visible = getFilteredEntries();
    const total = state.allEntries.length;

    if (state.loading) {
      listEl.innerHTML = '<p class="loading">Loading entries…</p>';
      statusEl.textContent = '';
      return;
    }

    if (visible.length === 0) {
      listEl.innerHTML = `
        <div class="empty-state">
          <h3>No entries</h3>
          <p>${total === 0 ? 'No journal entries in this time range.' : 'No entries match your filter.'}</p>
        </div>
      `;
    } else {
      listEl.innerHTML = visible.map((entry) => {
        const { ts, detail } = summarizeEntry(entry);
        const key = entryKey(entry);
        const isExpanded = state.expanded.has(key);
        const pretty = JSON.stringify(entry, null, 2);
        return `
          <div class="journals-entry ${isExpanded ? 'expanded' : ''}" data-key="${escapeHtml(key)}">
            <div class="journals-entry-summary">
              <span class="journals-entry-ts">${escapeHtml(ts)}</span>
              <span class="journals-entry-detail">${escapeHtml(detail)}</span>
              <button type="button" class="btn-icon journals-copy-btn" data-action="copy">Copy</button>
            </div>
            <div class="journals-entry-details">
              <pre class="json-display">${escapeHtml(pretty)}</pre>
            </div>
          </div>
        `;
      }).join('');
    }

    statusEl.textContent = `${visible.length} of ${total} entries · ${new Date(state.sinceIso).toISOString()} → ${new Date(state.untilIso).toISOString()}`;
  }

  async function fetchEntries() {
    state.loading = true;
    state.expanded.clear();
    renderList();

    const params = new URLSearchParams();
    params.set('since', state.sinceIso);
    params.set('until', state.untilIso);
    if (state.journal === 'orders' && state.orderId) {
      params.set('orderId', state.orderId);
    }
    const path = state.journal === 'orders' ? `orders/journal?${params}` : `journal?${params}`;

    try {
      const resp = await apiFetch(ctx.org, ctx.site, path, { method: 'GET' });
      if (!resp.ok) {
        const errMsg = resp.headers.get('x-error') || `HTTP ${resp.status}`;
        if (resp.status === 404 && state.journal === 'orders' && state.orderId) {
          showToast('Order not found', 'error');
          state.allEntries = [];
        } else {
          showToast(errMsg, 'error');
          state.allEntries = [];
        }
      } else {
        const data = await resp.json();
        const entries = Array.isArray(data.entries) ? data.entries : [];
        entries.sort((a, b) => {
          const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
          const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
          return tb - ta;
        });
        state.allEntries = entries;
      }
    } catch (err) {
      showToast(`Failed to load journal: ${err.message}`, 'error');
      state.allEntries = [];
    } finally {
      state.loading = false;
      renderList();
    }
  }

  function updateOrderIdVisibility() {
    orderIdWrap.hidden = state.journal !== 'orders';
  }

  typeSwitcher.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-journal]');
    if (!btn) return;
    const next = btn.dataset.journal;
    if (next === state.journal) return;
    state.journal = next;
    typeSwitcher.querySelectorAll('button').forEach((b) => {
      b.classList.toggle('active', b.dataset.journal === next);
    });
    updateOrderIdVisibility();
    syncUrl();
    fetchEntries();
  });

  function bindPasteToDatetimeLocal(input, kind) {
    input.addEventListener('paste', (e) => {
      const text = (e.clipboardData || window.clipboardData)?.getData('text');
      if (!text) return;
      const d = parseFlexibleDate(text);
      if (!d) return;
      e.preventDefault();

      input.value = toDatetimeLocal(d);
      if (kind === 'since') state.sinceIso = d.toISOString();
      else state.untilIso = d.toISOString();

      const sinceMs = new Date(state.sinceIso).getTime();
      const untilMs = new Date(state.untilIso).getTime();
      const diff = untilMs - sinceMs;
      if (diff > MAX_RANGE_MS || diff < 0) {
        if (kind === 'since') {
          const newUntil = new Date(d.getTime() + RANGE_ADJUST_MS);
          state.untilIso = newUntil.toISOString();
          untilInput.value = toDatetimeLocal(newUntil);
        } else {
          const newSince = new Date(d.getTime() - RANGE_ADJUST_MS);
          state.sinceIso = newSince.toISOString();
          sinceInput.value = toDatetimeLocal(newSince);
        }
      }
      syncUrl();
    });
  }

  sinceInput.addEventListener('change', () => {
    const iso = fromDatetimeLocal(sinceInput.value);
    if (iso) {
      state.sinceIso = iso;
      syncUrl();
    }
  });
  untilInput.addEventListener('change', () => {
    const iso = fromDatetimeLocal(untilInput.value);
    if (iso) {
      state.untilIso = iso;
      syncUrl();
    }
  });
  bindPasteToDatetimeLocal(sinceInput, 'since');
  bindPasteToDatetimeLocal(untilInput, 'until');

  orderIdInput.addEventListener('change', () => {
    state.orderId = orderIdInput.value.trim();
    syncUrl();
  });
  orderIdInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      state.orderId = orderIdInput.value.trim();
      syncUrl();
      fetchEntries();
    }
  });

  let filterTimer = null;
  filterInput.addEventListener('input', () => {
    clearTimeout(filterTimer);
    filterTimer = setTimeout(() => {
      state.filter = filterInput.value;
      syncUrl();
      renderList();
    }, FILTER_DEBOUNCE_MS);
  });

  refreshBtn.addEventListener('click', () => {
    const sinceIso = fromDatetimeLocal(sinceInput.value);
    const untilIso = fromDatetimeLocal(untilInput.value);
    if (sinceIso) state.sinceIso = sinceIso;
    if (untilIso) state.untilIso = untilIso;
    state.orderId = orderIdInput.value.trim();
    syncUrl();
    fetchEntries();
  });

  copyAllBtn.addEventListener('click', () => {
    const visible = getFilteredEntries();
    if (visible.length === 0) {
      showToast('No entries to copy', 'error');
      return;
    }
    copyText(JSON.stringify(visible, null, 2), `Copied ${visible.length} entries`);
  });

  listEl.addEventListener('click', (e) => {
    const copyBtn = e.target.closest('[data-action="copy"]');
    const entryEl = e.target.closest('.journals-entry');
    if (!entryEl) return;
    const { key } = entryEl.dataset;
    const entry = state.allEntries.find((en) => entryKey(en) === key);
    if (copyBtn) {
      e.stopPropagation();
      if (entry) copyText(JSON.stringify(entry, null, 2), 'Entry copied');
      return;
    }
    if (state.expanded.has(key)) state.expanded.delete(key);
    else state.expanded.add(key);
    entryEl.classList.toggle('expanded');
  });

  updateOrderIdVisibility();
  fetchEntries();
}

export function destroy() {}
