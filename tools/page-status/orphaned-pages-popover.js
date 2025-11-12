/* eslint-disable no-console */
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

// data fetching
/**
 * Fetches the live and preview host URLs for org/site.
 * @param {string} org - Organization name.
 * @param {string} site - Site name within org.
 * @returns {Promise<>} Object with `live` and `preview` hostnames.
 */
async function fetchHosts(org, site) {
  try {
    const url = `https://admin.hlx.page/status/${org}/${site}/main`;
    const res = await fetch(url);
    if (!res.ok) throw res;
    const json = await res.json();
    return {
      live: new URL(json.live.url).host,
      preview: new URL(json.preview.url).host,
    };
  } catch (error) {
    return {
      live: null,
      preview: null,
    };
  }
}

async function fetchJobUrl() {
  try {
    const options = {
      body: JSON.stringify({
        paths: ['/*'],
        select: ['edit', 'preview', 'live'],
      }),
      method: 'POST',
      mode: 'cors',
      cache: 'no-cache',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      redirect: 'follow',
      referrerPolicy: 'no-referrer',
    };
    const res = await fetch(
      `https://admin.hlx.page/status/${ORG}/${SITE}/main/*`,
      options,
    );
    if (!res.ok) throw res;
    const json = await res.json();
    if (!json.job || json.job.state !== 'created') {
      const error = new Error();
      error.status = 'Job';
      throw error;
    }
    // update url param with job
    return json.links ? json.links.self : null;
  } catch (error) {
    console.error('Error fetching job URL', error);
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
  // eslint-disable-next-line no-console
  console.log('Unpublishing', paths);
  const options = {
    body: JSON.stringify({
      paths,
      delete: true,
    }),
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  };
  const liveResp = await fetch(
    `https://admin.hlx.page/live/${ORG}/${SITE}/main/*`,
    options,
  );
  if (!liveResp.ok) throw liveResp;
  const liveJson = await liveResp.json();
  const previewResp = await fetch(
    `https://admin.hlx.page/preview/${ORG}/${SITE}/main/*`,
    options,
  );
  if (!previewResp.ok) throw previewResp;
  const previewJson = await previewResp.json();
  console.log('Unpublished', liveJson, previewJson);
  STATUS.innerHTML = `Unpublished ${paths.length} Page${paths.length === 1 ? '' : 's'}, re-run report to check again.`;
}

function getCheckedOrphanedPages() {
  return [...document.querySelectorAll('.orphaned-page-checkbox:checked')].map((checkbox) => checkbox.value);
}

function pollJob(detailsURL) {
  setTimeout(async () => {
    const res = await fetch(detailsURL);
    const json = await res.json();
    JOB_DETAILS = json;
    displayJobDetails();
    if (JOB_DETAILS.state !== 'stopped') {
      pollJob(detailsURL);
    } else {
      document.querySelectorAll('.orphaned-page-checkbox').forEach((checkbox) => {
        checkbox.addEventListener('change', () => {
          const checked = getCheckedOrphanedPages();
          ORPHANED_PAGES_ACTIONS.innerHTML = `Unpublish ${checked.length} Page${checked.length === 1 ? '' : 's'}`;
          if (checked.length > 0) {
            ORPHANED_PAGES_ACTIONS.disabled = false;
          } else {
            ORPHANED_PAGES_ACTIONS.disabled = true;
          }
        });
      });
    }
  }, 1000);
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
    STATUS.innerHTML = 'Running report...';
    ORPHANED_PAGES_ACTIONS.innerHTML = 'Unpublish 0 Pages';
    ORPHANED_PAGES_ACTIONS.disabled = true;
    const jobUrl = await fetchJobUrl();
    if (jobUrl) {
      const resp = await fetch(jobUrl);
      const job = await resp.json();
      const detailsURL = job.links.details;
      pollJob(detailsURL);
      SPINNER.ariaHidden = 'false';
    }
  });
}

init();
