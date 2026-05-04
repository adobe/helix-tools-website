/* eslint-disable no-console */
import admin from '../../scripts/helix-admin.js';

const RUN_REPORT_BUTTON = document.getElementById('run-report');
const ORPHANED_PAGES_LIST = document.getElementById('orphaned-pages-list');
const SPINNER = document.getElementById('spinner');
const STATUS = document.getElementById('orphaned-pages-status');
const HIDE_DRAFTS = document.getElementById('hide-drafts');
const params = new URLSearchParams(window.location.search);
const ORG = params.get('owner');
const SITE = params.get('repo');
const ORPHANED_PAGES_ACTIONS = document.getElementById('orphaned-pages-actions');
let JOB_DETAILS = null;
let LIVE_HOST = null;

const statusAdmin = admin.withRequestInit({
  mode: 'cors',
  cache: 'no-cache',
  credentials: 'same-origin',
  redirect: 'follow',
  referrerPolicy: 'no-referrer',
});
const jobAdmin = admin.withRequestInit({ mode: 'cors' });

// data fetching
/**
 * Fetches the live and preview host URLs for org/site.
 * @param {string} org
 * @param {string} site
 * @returns {Promise<{live: string|null, preview: string|null}>}
 */
async function fetchHosts(org, site) {
  try {
    const res = await admin.status({ org, site }).get();
    if (!res.ok) throw new Error(`Status ${res.status}`);
    const json = await res.json();
    return {
      live: new URL(json.live.url).host,
      preview: new URL(json.preview.url).host,
    };
  } catch (error) {
    return { live: null, preview: null };
  }
}

async function submitJob() {
  try {
    const body = JSON.stringify({
      paths: ['/*'],
      select: ['edit', 'preview', 'live'],
    });
    const res = await statusAdmin.status({ org: ORG, site: SITE }).update('/*', body);
    if (!res.ok) throw res;
    const json = await res.json();
    if (!json.job || json.job.state !== 'created') {
      const error = new Error();
      error.status = 'Job';
      throw error;
    }
    return json.job.name || null;
  } catch (error) {
    console.error('Error creating job', error);
    return null;
  }
}

function displayJobDetails() {
  const details = JOB_DETAILS.data.resources;
  STATUS.innerHTML = `Phase: ${JOB_DETAILS.data.phase}`;
  if (details && details.length > 0) {
    STATUS.innerHTML = `Scanned ${details.length} pages...`;
    const orphanedPages = details.filter(
      (detail) => {
        let keep = false;
        const exclude = ['/sitemap.xml', '/helix-env.json', '/sitemap.json'];
        if (detail.publishLastModified
          && !detail.sourceLastModified
          && !detail.publishConfigRedirectLocation
        ) keep = true;
        if (exclude.includes(detail.path)) keep = false;
        return keep;
      },
    ).sort((a, b) => a.path.localeCompare(b.path));
    orphanedPages.forEach((detail) => {
      ORPHANED_PAGES_LIST.innerHTML += `<li class="${detail.path.includes('/drafts/') ? 'draft' : ''}">
      <input type="checkbox" class="orphaned-page-checkbox" value="${detail.path}">
      <a href="https://${LIVE_HOST}${detail.path}" target="_blank">${detail.path}</a></li>`;
    });
    if (orphanedPages.length === 0) {
      if (JOB_DETAILS.state === 'stopped') {
        SPINNER.ariaHidden = 'true';
        ORPHANED_PAGES_LIST.innerHTML = '<li>No orphaned pages found</li>';
      }
    } else {
      SPINNER.ariaHidden = 'true';
    }
  }
}

async function unpublishOrphanedPages(paths) {
  console.log('Unpublishing', paths);
  const body = JSON.stringify({ paths, delete: true });
  const liveRes = await admin.live({ org: ORG, site: SITE }).update('/*', body);
  if (!liveRes.ok) throw liveRes;
  const liveJson = await liveRes.json();
  const previewRes = await admin.preview({ org: ORG, site: SITE }).update('/*', body);
  if (!previewRes.ok) throw previewRes;
  const previewJson = await previewRes.json();
  console.log('Unpublished', liveJson, previewJson);
  STATUS.textContent = `Unpublished ${paths.length} Page${paths.length === 1 ? '' : 's'}, re-run report to check again.`;
}

function getCheckedOrphanedPages() {
  return [...document.querySelectorAll('.orphaned-page-checkbox:checked')].map((checkbox) => checkbox.value);
}

function pollJob(jobName) {
  setTimeout(async () => {
    const res = await jobAdmin.job({ org: ORG, site: SITE }).get(`status/${jobName}/details`);
    const json = await res.json();
    JOB_DETAILS = json;
    displayJobDetails();
    if (JOB_DETAILS.state !== 'stopped') {
      pollJob(jobName);
    } else {
      document.querySelectorAll('.orphaned-page-checkbox').forEach((checkbox) => {
        checkbox.addEventListener('change', () => {
          const checked = getCheckedOrphanedPages();
          ORPHANED_PAGES_ACTIONS.textContent = `Unpublish ${checked.length} Page${checked.length === 1 ? '' : 's'}`;
          ORPHANED_PAGES_ACTIONS.disabled = checked.length === 0;
        });
      });
    }
  }, 10000);
}

async function init() {
  if (window.self === window.top) {
    document.body.classList.add('standalone');
  }

  const hosts = await fetchHosts(ORG, SITE);
  LIVE_HOST = hosts.live;

  HIDE_DRAFTS.addEventListener('change', () => {
    if (HIDE_DRAFTS.checked) {
      ORPHANED_PAGES_LIST.classList.add('hide-drafts');
    } else {
      ORPHANED_PAGES_LIST.classList.remove('hide-drafts');
    }
  });
  ORPHANED_PAGES_ACTIONS.addEventListener('click', () => {
    const checked = getCheckedOrphanedPages();
    // eslint-disable-next-line no-alert
    if (prompt(`To unpublish ${checked.length} Page${checked.length === 1 ? '' : 's'}, enter the site name (${SITE})`) === SITE) {
      unpublishOrphanedPages(checked);
    }
  });

  RUN_REPORT_BUTTON.addEventListener('click', async () => {
    ORPHANED_PAGES_LIST.innerHTML = '';
    STATUS.textContent = 'Running report...';
    ORPHANED_PAGES_ACTIONS.textContent = 'Unpublish 0 Pages';
    ORPHANED_PAGES_ACTIONS.disabled = true;
    const jobName = await submitJob();
    if (jobName) {
      pollJob(jobName);
      SPINNER.ariaHidden = 'false';
    }
  });
}

init();
