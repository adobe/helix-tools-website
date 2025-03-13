const log = document.getElementById('logger');
const adminVersion = new URLSearchParams(window.location.search).get('hlx-admin-version');
const adminVersionSuffix = adminVersion ? `?hlx-admin-version=${adminVersion}` : '';
const simpleJobStatus = { data: { resources: [] }, links: { job: '' } };
let startTime = null;
let total = 0;
let operation = '';
let slow = false;
let forceUpdate = false;

const logAppend = (string, status = 'unknown') => {
  const p = document.createElement('p');
  p.textContent = string;
  if (status !== 'unknown') {
    p.className = `status-light http${Math.floor(status / 100) % 10}`;
  }
  log.append(p);
  p.scrollIntoView();
  return p;
};

function updateBulkStatus(element, jobStatus) {
  const getProgressSummary = () => {
    const progress = {
      processed: 0,
      success: 0,
      warnings: 0,
      errors: 0,
    };
    if (jobStatus.data && jobStatus.data.resources) {
      jobStatus.data.resources.forEach((res) => {
        if (res.status) progress.processed += 1;
        if (res.status === 200 || res.status === 204) {
          progress.success += 1;
        } else if (res.status === 404) {
          progress.warnings += 1;
        } else if (res.status >= 500) {
          progress.errors += 1;
        }
      });
    }
    return progress;
  };

  const {
    processed,
    success,
    warnings,
    errors,
  } = getProgressSummary(jobStatus);
  const VERB = {
    preview: 'previewed',
    live: 'published',
    unpreview: 'unpreviewed',
    unpublish: 'unpublished',
    index: 'indexed',
    cache: 'purged',
  };
  const [, , owner, repo] = new URL(jobStatus.links.job).pathname.split('/');
  element.innerHTML = `<span class="status-pill status-success">${success}</span> <span class="status-pill status-warning">${warnings}</span> <span class="status-pill status-error">${errors}</span> ${processed}/${total} URL(s) bulk ${VERB[operation]} [${((new Date().valueOf() - startTime.valueOf()) / 1000).toFixed(2)}s]
  <div class="status-details" aria-label="Details" aria-expanded="false"><textarea></textarea></div>`;
  element.querySelector('.status-success').addEventListener('click', () => {
    element.querySelector('.status-details').setAttribute('aria-expanded', 'true');
    element.querySelector('.status-details textarea').textContent = jobStatus.data.resources.filter((r) => r.status === 200 || r.status === 204).map((r) => `https://main--${repo}--${owner}.aem.page${r.path}`).join('\n');
  });
  element.querySelector('.status-warning').addEventListener('click', () => {
    element.querySelector('.status-details').setAttribute('aria-expanded', 'true');
    element.querySelector('.status-details textarea').textContent = jobStatus.data.resources.filter((r) => r.status === 404).map((r) => `https://main--${repo}--${owner}.aem.page${r.path}`).join('\n');
  });
  element.querySelector('.status-error').addEventListener('click', () => {
    element.querySelector('.status-details').setAttribute('aria-expanded', 'true');
    element.querySelector('.status-details textarea').textContent = jobStatus.data.resources.filter((r) => r.status >= 500).map((r) => `https://main--${repo}--${owner}.aem.page${r.path}`).join('\n');
  });
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

document.getElementById('urls-form').addEventListener('submit', async (e) => {
  document.getElementById('urls-form').disabled = true;
  startTime = new Date();
  e.preventDefault();
  const urls = document.getElementById('urls').value
    .split('\n')
    .map((u) => u.trim())
    .filter((u) => u.length > 0);
  total = urls.length;
  operation = document.getElementById('operation').dataset.value;
  slow = document.getElementById('slow').checked;
  forceUpdate = document.getElementById('force').checked;

  const executeOperation = async (url) => {
    const { hostname, pathname } = new URL(url);
    const [branch, repo, owner] = hostname.split('.')[0].split('--');
    const endpoints = {
      unpublish: 'live',
      unpreview: 'preview',
    };
    const methods = {
      unpublish: 'DELETE',
      unpreview: 'DELETE',
    };
    const endpoint = endpoints[operation] || operation;
    const method = methods[operation] || 'POST';
    const adminURL = `https://admin.hlx.page/${endpoint}/${owner}/${repo}/${branch}${pathname}${adminVersionSuffix}`;
    const resp = await fetch(adminURL, {
      method,
    });
    simpleJobStatus.data.resources.push({
      status: resp.status,
      path: pathname,
    });
  };

  const dequeue = async (bulkLog) => {
    while (urls.length) {
      const url = urls.shift();
      // eslint-disable-next-line no-await-in-loop
      await executeOperation(url, total);
      updateBulkStatus(bulkLog, simpleJobStatus);
      // eslint-disable-next-line no-await-in-loop
      if (slow) await sleep(1500);
    }
    updateBulkStatus(bulkLog, simpleJobStatus);
    document.getElementById('urls-form').disabled = false;
  };

  const doBulkOperation = async () => {
    if (total > 0) {
      const { hostname } = new URL(urls[0]); // use first URL to determine project details
      const [branch, repo, owner] = hostname.split('.')[0].split('--');
      const bulkLog = logAppend('');
      updateBulkStatus(bulkLog, { data: { resources: [] }, links: { job: `https://admin.hlx.page/job/${owner}/${repo}/main/simplejob` } });
      const paths = urls.map((url) => new URL(url).pathname);

      const bulkResp = await fetch(`https://admin.hlx.page/${operation}/${owner}/${repo}/${branch}/*${adminVersionSuffix}`, {
        method: 'POST',
        body: JSON.stringify({
          paths,
          forceUpdate,
        }),
        headers: {
          'content-type': 'application/json',
        },
      });
      if (!bulkResp.ok) {
        logAppend(`Failed on ${origin}: ${await bulkResp.text()}`);
      } else {
        const { job } = await bulkResp.json();
        const { name } = job;
        const jobStatusPoll = window.setInterval(async () => {
          try {
            const verb = operation === 'live' ? 'publish' : operation;
            const jobResp = await fetch(`https://admin.hlx.page/job/${owner}/${repo}/${branch}/${verb}/${name}/details`);
            const jobStatus = await jobResp.json();
            if (jobStatus.state === 'stopped') {
              // job done, stop polling
              window.clearInterval(jobStatusPoll);
            }
            updateBulkStatus(bulkLog, jobStatus);
          } catch (error) {
            // eslint-disable-next-line no-console
            console.error(`failed to get status for job ${name}: ${error}`);
            document.getElementById('urls-form').disabled = false;
            window.clearInterval(jobStatusPoll);
          }
        }, 1000);
      }
    }
  };

  if (['preview', 'live'].includes(operation)) {
    // use bulk preview/publish API
    doBulkOperation(urls);
  } else {
    let concurrency = ['live', 'unpublish', 'unpreview'].includes(operation) ? 40 : 3;
    if (slow) {
      concurrency = 1;
    }
    const bulkLog = logAppend('');
    const [, repo, owner] = new URL(urls[0]).hostname.split('--');
    simpleJobStatus.data = { resources: [], links: { job: `https://admin.hlx.page/job/${owner}/${repo}/main/simplejob` } };
    updateBulkStatus(bulkLog, simpleJobStatus);
    for (let i = 0; i < concurrency; i += 1) {
      dequeue(bulkLog);
    }
  }
});

function registerListeners(doc) {
  const PICKER_INPUT = doc.getElementById('operation');
  const PICKER_DROPDOWN = PICKER_INPUT.parentElement.querySelector('ul');
  const PICKER_OPTIONS = PICKER_DROPDOWN.querySelectorAll('ul > li');

  // toggles the request method dropdown
  PICKER_INPUT.addEventListener('click', () => {
    const expanded = PICKER_INPUT.getAttribute('aria-expanded') === 'true';
    PICKER_INPUT.setAttribute('aria-expanded', !expanded);
    PICKER_DROPDOWN.hidden = expanded;
  });

  // handles the selection of a method option from the dropdown
  PICKER_OPTIONS.forEach((option) => {
    option.addEventListener('click', () => {
      PICKER_INPUT.value = option.textContent;
      PICKER_INPUT.dataset.value = option.dataset.value;
      PICKER_INPUT.setAttribute('aria-expanded', false);
      PICKER_DROPDOWN.hidden = true;
      PICKER_OPTIONS.forEach((o) => o.setAttribute('aria-selected', o === option));
    });
  });
}

registerListeners(document);
