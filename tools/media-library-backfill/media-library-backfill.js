import { registerToolReady } from '../../scripts/scripts.js';
import { ensureLogin } from '../../blocks/profile/profile.js';
import { initConfigField, updateConfig } from '../../utils/config/config.js';

const ADMIN_BASE = 'https://admin.hlx.page';
const REF = 'main';
const BATCH_SIZE = 10;
const CONCURRENCY = 5;
const POLL_INTERVAL = 2000;
const ADMIN_API_RATE_LIMIT = 10;
const REQ_INTERVAL = 1000 / ADMIN_API_RATE_LIMIT;

const VIDEO_EXTENSIONS = /\.(mp4|mov|webm|avi|m4v|mkv)$/i;

const MEDIA_EXTENSIONS = /\.(png|jpe?g|gif|webp|avif|svg|mp4|mov|webm|avi|m4v|mkv)$/i;

const CONTENT_TYPE_MAP = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  svg: 'image/svg+xml',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  avi: 'video/x-msvideo',
  m4v: 'video/x-m4v',
  mkv: 'video/x-matroska',
};

// DOM references
const DOM = {};

let abortController = null;
const stats = {
  pages: 0, media: 0, sent: 0, errors: 0, dupes: 0,
};

function initDOM() {
  const form = document.getElementById('backfill-form');
  DOM.form = form;
  DOM.org = form.querySelector('#org');
  DOM.site = form.querySelector('#site');
  DOM.dryRun = form.querySelector('#dry-run');
  DOM.fallbackUser = form.querySelector('#fallback-user');
  DOM.runBtn = form.querySelector('#run-btn');
  DOM.cancelBtn = form.querySelector('#cancel-btn');
  DOM.progressSection = document.getElementById('progress-section');
  DOM.phaseLabel = document.getElementById('phase-label');
  DOM.progressBar = document.getElementById('progress-bar');
  DOM.statPages = document.getElementById('stat-pages');
  DOM.statMedia = document.getElementById('stat-media');
  DOM.statSent = document.getElementById('stat-sent');
  DOM.statErrors = document.getElementById('stat-errors');
  DOM.statDupes = document.getElementById('stat-dupes');
  DOM.console = document.getElementById('console-output');
}

function updateStatsDisplay() {
  DOM.statPages.textContent = stats.pages;
  DOM.statMedia.textContent = stats.media;
  DOM.statSent.textContent = stats.sent;
  DOM.statErrors.textContent = stats.errors;
  DOM.statDupes.textContent = stats.dupes;
}

function resetStats() {
  stats.pages = 0;
  stats.media = 0;
  stats.sent = 0;
  stats.errors = 0;
  stats.dupes = 0;
  updateStatsDisplay();
}

function setPhase(label, progress) {
  DOM.phaseLabel.textContent = label;
  if (progress !== undefined) {
    DOM.progressBar.value = progress;
  }
}

function log(message, level = 'info') {
  const line = document.createElement('p');
  line.className = `log-line ${level}`;
  const ts = new Date().toLocaleTimeString();
  line.textContent = `[${ts}] ${message}`;
  DOM.console.appendChild(line);
  DOM.console.scrollTop = DOM.console.scrollHeight;
}

function showLoadingButton(button) {
  button.disabled = true;
  const { width, height } = button.getBoundingClientRect();
  button.style.minWidth = `${width}px`;
  button.style.minHeight = `${height}px`;
  button.dataset.label = button.textContent || 'Run Backfill';
  button.innerHTML = '<i class="symbol symbol-loading"></i>';
}

function resetLoadingButton(button) {
  button.textContent = button.dataset.label;
  button.removeAttribute('style');
  button.disabled = false;
}

function disableForm() {
  showLoadingButton(DOM.runBtn);
  [...DOM.form.elements].forEach((el) => { el.disabled = true; });
  DOM.cancelBtn.hidden = false;
  DOM.cancelBtn.disabled = false;
}

function enableForm() {
  resetLoadingButton(DOM.runBtn);
  [...DOM.form.elements].forEach((el) => { el.disabled = false; });
  DOM.cancelBtn.hidden = true;
  // site field should reflect org state
  DOM.site.disabled = !DOM.org.value;
}

function isAborted() {
  return abortController && abortController.signal.aborted;
}

async function fetchWithRetry(url, options = {}, maxRetries = 3) {
  const signal = abortController ? abortController.signal : undefined;
  const fetchOptions = { ...options, signal };

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    if (isAborted()) throw new DOMException('Aborted', 'AbortError');
    try {
      // eslint-disable-next-line no-await-in-loop
      const res = await fetch(url, fetchOptions);
      if (res.status === 429 || res.status === 503) {
        if (attempt < maxRetries) {
          const delay = (2 ** attempt) * 1000;
          log(`Rate limited (${res.status}), retrying in ${delay / 1000}s...`, 'warn');
          // eslint-disable-next-line no-await-in-loop
          await new Promise((resolve) => { setTimeout(resolve, delay); });
          // eslint-disable-next-line no-continue
          continue;
        }
      }
      return res;
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      if (attempt < maxRetries) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => { setTimeout(resolve, (2 ** attempt) * 1000); });
      } else {
        throw err;
      }
    }
  }
  throw new Error(`Failed to fetch ${url} after ${maxRetries + 1} attempts`);
}

async function runWithConcurrency(items, fn, limit) {
  const results = [];
  let index = 0;

  async function worker() {
    while (index < items.length) {
      if (isAborted()) return;
      const i = index;
      index += 1;
      // eslint-disable-next-line no-await-in-loop
      results[i] = await fn(items[i], i);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

// Phase 1: Discover all pages via bulk status job
async function discoverPages(org, site) {
  setPhase('Phase 1: Discovering pages...', 0);
  log('Starting page discovery via bulk status job...');

  const jobUrl = `${ADMIN_BASE}/status/${org}/${site}/${REF}/*`;
  const res = await fetchWithRetry(jobUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paths: ['/*'], select: ['preview'] }),
  });

  if (!res.ok) {
    throw new Error(`Failed to create status job: ${res.status}`);
  }

  const job = await res.json();
  const { links } = job;
  const selfUrl = links?.self;
  if (!selfUrl) throw new Error('No job URL returned from status API');

  log(`Status job created: ${selfUrl}`);

  // Poll until complete
  let { state } = job;
  while (state !== 'completed' && state !== 'stopped') {
    if (isAborted()) throw new DOMException('Aborted', 'AbortError');
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => { setTimeout(resolve, POLL_INTERVAL); });
    // eslint-disable-next-line no-await-in-loop
    const pollRes = await fetchWithRetry(selfUrl);
    // eslint-disable-next-line no-await-in-loop
    const pollData = await pollRes.json();
    state = pollData.state;
    const progress = pollData.progress ? Math.round(pollData.progress * 100) : 0;
    setPhase(`Phase 1: Discovering pages... (${state} ${progress}%)`, Math.min(progress * 0.2, 20));
  }

  // Get details
  const detailsUrl = `${selfUrl}/details`;
  const detailsRes = await fetchWithRetry(detailsUrl);
  if (!detailsRes.ok) throw new Error(`Failed to fetch job details: ${detailsRes.status}`);

  const details = await detailsRes.json();
  const resources = details.data?.resources || details.resources || [];

  const pages = [];
  const standaloneMedia = [];

  resources.forEach((r) => {
    if (!r.previewLastModified) return;
    if (MEDIA_EXTENSIONS.test(r.path)) {
      standaloneMedia.push({
        path: r.path,
        lastModified: r.previewLastModified,
        user: r.previewLastModifiedBy || '',
      });
    } else if (!r.path.match(/\.\w+$/)) {
      pages.push({
        path: r.path,
        lastModified: r.previewLastModified,
        user: r.previewLastModifiedBy || '',
      });
    }
  });

  stats.pages = pages.length;
  updateStatsDisplay();
  log(`Discovered ${pages.length} pages and ${standaloneMedia.length} standalone media files`);
  return { pages, standaloneMedia };
}

// Phase 2: Enrich with user info from audit logs
async function enrichWithUsers(org, site) {
  setPhase('Phase 2: Loading user data from logs...', 20);
  log('Fetching audit logs for user data...');

  const userMap = new Map();

  try {
    let nextUrl = `${ADMIN_BASE}/log/${org}/${site}/${REF}?since=30d&limit=1000`;
    while (nextUrl) {
      if (isAborted()) throw new DOMException('Aborted', 'AbortError');
      // eslint-disable-next-line no-await-in-loop
      const res = await fetchWithRetry(nextUrl);
      if (!res.ok) {
        if (res.status === 403) {
          log('No log:read permission — user enrichment skipped', 'warn');
          return userMap;
        }
        throw new Error(`Log API returned ${res.status}`);
      }
      // eslint-disable-next-line no-await-in-loop
      const data = await res.json();
      const entries = data.entries || [];
      entries.forEach((entry) => {
        if (entry.route === 'preview' && entry.path && entry.user) {
          if (!userMap.has(entry.path)) {
            userMap.set(entry.path, entry.user);
          }
        }
      });
      nextUrl = data.links?.next || null;
    }
    log(`Found user data for ${userMap.size} paths`);
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    log(`User enrichment failed: ${err.message}`, 'warn');
  }

  return userMap;
}

function getContentType(url) {
  const ext = url.split('.').pop().split(/[?#]/)[0].toLowerCase();
  return CONTENT_TYPE_MAP[ext] || 'application/octet-stream';
}

function extractDimensions(url) {
  const match = url.match(/media_[\da-f]+\.[\w]+[?#]width=(\d+)&height=(\d+)/);
  if (match) return { width: parseInt(match[1], 10), height: parseInt(match[2], 10) };
  return {};
}

function parseMediaFromMarkdown(markdown) {
  const mediaUrls = [];

  // Inline images: ![alt](url) or ![alt](url "title")
  const inlineImageRegex = /!\[[^\]]*]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  let match = inlineImageRegex.exec(markdown);
  while (match) {
    mediaUrls.push(match[1]);
    match = inlineImageRegex.exec(markdown);
  }

  // Reference-style images: ![alt][ref] paired with [ref]: url
  const refDefs = {};
  const refDefRegex = /^\[([^\]]+)]:\s*(.+)$/gm;
  match = refDefRegex.exec(markdown);
  while (match) {
    refDefs[match[1].toLowerCase()] = match[2].trim();
    match = refDefRegex.exec(markdown);
  }
  const refImageRegex = /!\[[^\]]*]\[([^\]]+)]/g;
  match = refImageRegex.exec(markdown);
  while (match) {
    const def = refDefs[match[1].toLowerCase()];
    if (def) mediaUrls.push(def);
    match = refImageRegex.exec(markdown);
  }

  // Video links: [text](url) where url ends with video extension
  const linkRegex = /\[[^\]]*]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  match = linkRegex.exec(markdown);
  while (match) {
    if (VIDEO_EXTENSIONS.test(match[1])) {
      mediaUrls.push(match[1]);
    }
    match = linkRegex.exec(markdown);
  }

  return mediaUrls
    .filter((url) => url.startsWith('https'))
    .map((url) => url.replace(/\.hlx\.(page|live)/, '.aem.$1'));
}

// Phase 3: Fetch and parse markdown for each page
async function processPages(org, site, pages) {
  setPhase('Phase 3: Processing page content...', 30);
  log(`Processing ${pages.length} pages for media references...`);

  const allEntries = [];
  const seenMedia = new Set();
  let processed = 0;
  let useAdminApi = false;
  let lastAdminRequest = 0;

  async function throttledAdminFetch(url, options) {
    const now = Date.now();
    const wait = REQ_INTERVAL - (now - lastAdminRequest);
    if (wait > 0) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => { setTimeout(resolve, wait); });
    }
    lastAdminRequest = Date.now();
    return fetchWithRetry(url, options, 1);
  }

  async function fetchMarkdown(page) {
    if (!useAdminApi) {
      try {
        const cdnUrl = `https://${REF}--${site}--${org}.aem.page${page.path}.md`;
        const res = await fetchWithRetry(cdnUrl, {}, 1);
        if (res.ok) return res.text();
      } catch (err) {
        if (err.name === 'AbortError') throw err;
      }
      if (!useAdminApi) {
        useAdminApi = true;
        log('CDN not accessible, switching to admin API...', 'warn');
      }
    }

    const adminUrl = `${ADMIN_BASE}/preview/${org}/${site}/${REF}${page.path}.md`;
    const adminRes = await throttledAdminFetch(adminUrl);
    if (adminRes.ok) return adminRes.text();
    return null;
  }

  await runWithConcurrency(pages, async (page) => {
    if (isAborted()) return;

    let markdown;
    try {
      markdown = await fetchMarkdown(page);
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      log(`Failed to fetch ${page.path}: ${err.message}`, 'error');
      stats.errors += 1;
    }

    if (markdown) {
      const urls = parseMediaFromMarkdown(markdown);
      urls.forEach((url) => {
        const operation = seenMedia.has(url) ? 'reuse' : 'ingest';
        if (operation === 'reuse') {
          stats.dupes += 1;
        }
        seenMedia.add(url);

        const entry = {
          operation,
          path: url,
          resourcePath: page.path,
          contentType: getContentType(url),
          ...extractDimensions(url),
        };
        allEntries.push({ entry, page });
      });
    }

    processed += 1;
    const pct = 30 + Math.round((processed / pages.length) * 40);
    setPhase(`Phase 3: Processing pages... (${processed}/${pages.length})`, pct);
    stats.media = allEntries.length;
    updateStatsDisplay();
  }, CONCURRENCY);

  log(`Found ${allEntries.length} media entries across ${pages.length} pages`);
  return allEntries;
}

// Phase 4: Post entries to medialog
async function ingestEntries(org, site, entries, userMap, fallbackUser, dryRun) {
  setPhase('Phase 4: Ingesting entries...', 70);

  const enrichedEntries = entries.map(({ entry, page }) => {
    const user = userMap.get(page.path) || page.user || fallbackUser || '';
    return {
      ...entry,
      user,
      timestamp: page.lastModified,
    };
  });

  if (dryRun) {
    log('DRY RUN — entries that would be sent:', 'warn');
    enrichedEntries.forEach((e) => {
      log(`  ${e.operation} ${e.contentType} ${e.path} (from ${e.resourcePath}, user: ${e.user || 'unknown'})`);
    });
    stats.sent = enrichedEntries.length;
    updateStatsDisplay();
    return;
  }

  log(`Posting ${enrichedEntries.length} entries in batches of ${BATCH_SIZE}...`);

  for (let i = 0; i < enrichedEntries.length; i += BATCH_SIZE) {
    if (isAborted()) throw new DOMException('Aborted', 'AbortError');
    const batch = enrichedEntries.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(enrichedEntries.length / BATCH_SIZE);

    try {
      const url = `${ADMIN_BASE}/medialog/${org}/${site}/${REF}/`;
      // eslint-disable-next-line no-await-in-loop
      const res = await fetchWithRetry(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries: batch }),
      });

      if (res.ok) {
        stats.sent += batch.length;
        log(`Batch ${batchNum}/${totalBatches}: sent ${batch.length} entries`);
      } else {
        stats.errors += batch.length;
        log(`Batch ${batchNum}/${totalBatches}: failed (${res.status})`, 'error');
      }
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      stats.errors += batch.length;
      log(`Batch ${batchNum}/${totalBatches}: error — ${err.message}`, 'error');
    }

    updateStatsDisplay();
    const pct = 70 + Math.round(((i + batch.length) / enrichedEntries.length) * 25);
    setPhase(`Phase 4: Ingesting... (${batchNum}/${totalBatches})`, pct);

    // Rate limit delay between batches
    if (i + BATCH_SIZE < enrichedEntries.length) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => { setTimeout(resolve, REQ_INTERVAL); });
    }
  }
}

// Phase 5: Report
function showReport(dryRun) {
  setPhase('Complete', 100);
  log('--- Backfill Summary ---', 'success');
  log(`  Pages crawled: ${stats.pages}`);
  log(`  Media entries: ${stats.media}`);
  log(`  Unique (ingest): ${stats.media - stats.dupes}`);
  log(`  Duplicates (reuse): ${stats.dupes}`);
  if (dryRun) {
    log('  Mode: DRY RUN (no entries were posted)', 'warn');
  } else {
    log(`  Entries sent: ${stats.sent}`);
    log(`  Errors: ${stats.errors}`);
  }
  log('Done.', 'success');
}

async function runBackfill() {
  const org = DOM.org.value.trim();
  const site = DOM.site.value.trim();
  const dryRun = DOM.dryRun.checked;
  const fallbackUser = DOM.fallbackUser.value.trim();

  if (!org || !site) return;

  if (!await ensureLogin(org, site)) {
    window.addEventListener('profile-update', ({ detail: loginInfo }) => {
      if (loginInfo.includes(org)) {
        DOM.runBtn.click();
      }
    }, { once: true });
    return;
  }

  abortController = new AbortController();
  disableForm();
  resetStats();
  DOM.console.innerHTML = '';
  DOM.console.setAttribute('aria-hidden', 'false');
  DOM.progressSection.setAttribute('aria-hidden', 'false');

  try {
    log(`Starting backfill for ${org}/${site}${dryRun ? ' (dry run)' : ''}...`);

    const { pages, standaloneMedia } = await discoverPages(org, site);
    if (isAborted()) return;

    const userMap = await enrichWithUsers(org, site);
    if (isAborted()) return;

    const entries = await processPages(org, site, pages);
    if (isAborted()) return;

    standaloneMedia.forEach((media) => {
      const mediaUrl = `https://${REF}--${site}--${org}.aem.page${media.path}`;
      entries.push({
        entry: {
          operation: 'ingest',
          path: mediaUrl,
          resourcePath: media.path,
          contentType: getContentType(media.path),
        },
        page: media,
      });
      stats.media += 1;
    });
    updateStatsDisplay();

    await ingestEntries(org, site, entries, userMap, fallbackUser, dryRun);
    if (isAborted()) return;

    showReport(dryRun);
    updateConfig();
  } catch (err) {
    if (err.name === 'AbortError') {
      log('Backfill cancelled by user.', 'warn');
      setPhase('Cancelled');
    } else {
      log(`Fatal error: ${err.message}`, 'error');
      setPhase('Error');
      stats.errors += 1;
      updateStatsDisplay();
    }
  } finally {
    enableForm();
    abortController = null;
  }
}

function registerListeners() {
  DOM.form.addEventListener('submit', (e) => {
    e.preventDefault();
    runBackfill();
  });

  DOM.cancelBtn.addEventListener('click', () => {
    if (abortController) {
      abortController.abort();
      DOM.cancelBtn.disabled = true;
    }
  });
}

async function init() {
  initDOM();
  await initConfigField();
  registerListeners();
}

registerToolReady(init());
