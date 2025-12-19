import { ensureLogin } from '../../blocks/profile/profile.js';

const log = document.getElementById('logger');
const adminVersion = new URLSearchParams(window.location.search).get('hlx-admin-version');
const adminVersionSuffix = adminVersion ? `?hlx-admin-version=${adminVersion}` : '';

const append = (string, status = 'unknown') => {
  const p = document.createElement('p');
  p.textContent = string;
  if (status !== 'unknown') {
    p.className = `status-light http${Math.floor(status / 100) % 10}`;
  }
  log.append(p);
  p.scrollIntoView();
  return p;
};

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function extractOrgSite(url) {
  const { hostname } = new URL(url);
  const [, site, org] = hostname.split('.')[0].split('--');
  return { org, site };
}

/**
 * Show a confirmation dialog with sanitization warnings
 * @param {Object} changes - Sanitization analysis results
 * @param {Array<{original: string, reason: string}>} changes.rejected
 *   URLs that failed validation
 * @param {Array<{original: string, sanitized: string, changes: string[]}>} changes.modified
 *   URLs that were sanitized
 * @param {string[]} changes.deduplicated - Duplicate URLs that will be removed
 * @returns {Promise<boolean>} True if user confirms to proceed, false if cancelled
 */
const showSanitizationWarning = (changes) => {
  const { rejected, modified, deduplicated } = changes;

  return new Promise((resolve) => {
    const modal = document.createElement('dialog');
    modal.className = 'sanitization-warning';

    const title = document.createElement('h2');
    title.textContent = 'URL Sanitization Warning';
    modal.appendChild(title);

    if (rejected.length > 0) {
      const h3 = document.createElement('h3');
      h3.textContent = `⚠️ ${rejected.length} URL(s) will be rejected:`;
      modal.appendChild(h3);

      const ul = document.createElement('ul');
      ul.className = 'url-list rejected';
      rejected.forEach(({ original, reason }) => {
        const li = document.createElement('li');
        const code = document.createElement('code');
        code.textContent = original;
        li.appendChild(code);

        const span = document.createElement('span');
        span.className = 'reason';
        span.textContent = ` (${reason})`;
        li.appendChild(span);

        ul.appendChild(li);
      });
      modal.appendChild(ul);
    }

    if (modified.length > 0) {
      const h3 = document.createElement('h3');
      h3.textContent = `🔧 ${modified.length} URL(s) will be modified:`;
      modal.appendChild(h3);

      const ul = document.createElement('ul');
      ul.className = 'url-list modified';
      modified.forEach(({ original, sanitized, changes: urlChanges }) => {
        const li = document.createElement('li');
        const changeDiv = document.createElement('div');
        changeDiv.className = 'url-change';

        const originalDiv = document.createElement('div');
        const originalStrong = document.createElement('strong');
        originalStrong.textContent = 'Original:';
        originalDiv.appendChild(originalStrong);
        originalDiv.appendChild(document.createTextNode(' '));
        const originalCode = document.createElement('code');
        originalCode.textContent = original;
        originalDiv.appendChild(originalCode);
        changeDiv.appendChild(originalDiv);

        const sanitizedDiv = document.createElement('div');
        const sanitizedStrong = document.createElement('strong');
        sanitizedStrong.textContent = 'Sanitized:';
        sanitizedDiv.appendChild(sanitizedStrong);
        sanitizedDiv.appendChild(document.createTextNode(' '));
        const sanitizedCode = document.createElement('code');
        sanitizedCode.textContent = sanitized;
        sanitizedDiv.appendChild(sanitizedCode);
        changeDiv.appendChild(sanitizedDiv);

        const reasonDiv = document.createElement('div');
        reasonDiv.className = 'change-reason';
        reasonDiv.textContent = urlChanges.join(', ');
        changeDiv.appendChild(reasonDiv);

        li.appendChild(changeDiv);
        ul.appendChild(li);
      });
      modal.appendChild(ul);
    }

    if (deduplicated.length > 0) {
      const h3 = document.createElement('h3');
      h3.textContent = `🔗 ${deduplicated.length} duplicate URL(s) were detected:`;
      modal.appendChild(h3);

      const ul = document.createElement('ul');
      ul.className = 'url-list deduplicated';
      deduplicated.forEach((url) => {
        const li = document.createElement('li');
        const code = document.createElement('code');
        code.textContent = url;
        li.appendChild(code);
        ul.appendChild(li);
      });
      modal.appendChild(ul);
    }

    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'dialog-actions';

    const confirmBtn = document.createElement('button');
    confirmBtn.className = 'button primary';
    confirmBtn.id = 'confirm-sanitize';
    confirmBtn.textContent = 'Proceed with sanitized URLs';
    actionsDiv.appendChild(confirmBtn);

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'button secondary';
    cancelBtn.id = 'cancel-sanitize';
    cancelBtn.textContent = 'Cancel';
    actionsDiv.appendChild(cancelBtn);

    modal.appendChild(actionsDiv);
    document.querySelector('.bulk-ops').appendChild(modal);

    modal.querySelector('#confirm-sanitize').addEventListener('click', () => {
      modal.close();
      modal.remove();
      resolve(true);
    });

    modal.querySelector('#cancel-sanitize').addEventListener('click', () => {
      modal.close();
      modal.remove();
      resolve(false);
    });

    modal.addEventListener('close', () => {
      modal.remove();
      resolve(false);
    });

    modal.showModal();
  });
};

/**
 * Analyze URLs for sanitization issues
 * @param {string[]} rawUrls - Array of raw URL strings
 * @returns {Object} Analysis results
 * @property {string[]} urls - Unique, sanitized URLs ready for processing
 * @property {Array<{original: string, reason: string}>} rejected
 *   URLs that failed validation
 * @property {Array<{original: string, sanitized: string, changes: string[]}>} modified
 *   URLs that were sanitized
 * @property {string[]} deduplicated
 *   URLs that appeared multiple times (after sanitization)
 */
const analyzeUrls = (rawUrls) => {
  const rejected = [];
  const modified = [];
  const validUrls = [];

  const sanitizeUrl = (urlObj) => {
    urlObj.hash = '';
    urlObj.search = '';
    const decodedPath = decodeURIComponent(urlObj.pathname);
    urlObj.pathname = decodedPath
      .toLowerCase()
      .replace(/\/{2,}/g, '/')
      .split('/')
      .map((segment) => segment
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, ''))
      .join('/');
    return urlObj.toString();
  };

  rawUrls.forEach((rawUrl) => {
    if (!rawUrl) return;

    try {
      const urlObj = new URL(rawUrl.trim());
      if (urlObj.protocol !== 'https:') {
        rejected.push({
          original: rawUrl,
          reason: `Protocol '${urlObj.protocol}' not allowed (only https)`,
        });
        return;
      }

      const sanitized = sanitizeUrl(urlObj);

      if (sanitized !== rawUrl) {
        const changes = [];
        try {
          const original = new URL(rawUrl);
          const result = new URL(sanitized);
          if (original.hash && !result.hash) changes.push('hash removed');
          if (original.search && !result.search) changes.push('query params removed');
          if (original.pathname !== result.pathname) {
            const decodedOriginalPath = decodeURIComponent(original.pathname);
            const pathChanges = [];
            if (decodedOriginalPath !== decodedOriginalPath.toLowerCase()) {
              pathChanges.push('converted to lowercase');
            }
            if (/[^a-zA-Z0-9/-]/.test(decodedOriginalPath)) {
              pathChanges.push('special characters replaced');
            }
            if (/\/{2,}/.test(decodedOriginalPath)) {
              pathChanges.push('duplicate slashes removed');
            }
            if (pathChanges.length > 0) {
              changes.push(`path: ${pathChanges.join(', ')}`);
            } else {
              changes.push('path normalized');
            }
          }
        } catch {
          changes.push('normalized');
        }
        modified.push({ original: rawUrl, sanitized, changes });
        validUrls.push(sanitized);
      } else {
        validUrls.push(sanitized);
      }
    } catch {
      rejected.push({ original: rawUrl, reason: 'Invalid URL format' });
    }
  });

  const urlCounts = new Map();
  validUrls.forEach((url) => {
    urlCounts.set(url, (urlCounts.get(url) || 0) + 1);
  });

  const urls = [...urlCounts.keys()];
  const deduplicated = Array.from(urlCounts.entries())
    .filter(([, count]) => count > 1)
    .map(([url]) => url);

  return {
    urls, rejected, modified, deduplicated,
  };
};

document.getElementById('urls-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  let counter = 0;

  const rawUrls = document.getElementById('urls').value
    .split('\n')
    .map((u) => u.trim())
    .filter((u) => u.length > 0);

  if (rawUrls.length === 0) {
    append('No URLs provided');
    return false;
  }

  // Analyze URLs for sanitization issues
  const {
    urls, rejected, modified, deduplicated,
  } = analyzeUrls(rawUrls);
  const total = urls.length;

  // Check if there are any sanitization issues
  const hasIssues = rejected.length > 0 || modified.length > 0 || deduplicated.length > 0;

  if (hasIssues) {
    const confirmed = await showSanitizationWarning({ rejected, modified, deduplicated });
    if (!confirmed) {
      append('Operation cancelled by user');
      return false;
    }

    document.getElementById('urls').value = urls.join('\n');
    append(`URL(s) updated with ${urls.length} sanitized URL(s)`);
  }

  if (urls.length === 0) {
    append('No valid URLs after sanitization');
    return false;
  }

  const { org, site } = extractOrgSite(urls[0]);
  if (!await ensureLogin(org, site)) {
    window.addEventListener('profile-update', ({ detail: loginInfo }) => {
      if (loginInfo.includes(org)) {
        e.target.querySelector('button[type="submit"]').click();
      }
    }, { once: true });
    append(`Awaiting sign in to ${org}...`);
    return false;
  }

  const operation = document.getElementById('operation').dataset.value;
  const slow = document.getElementById('slow').checked;
  const forceUpdate = document.getElementById('force').checked;

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
    resp.text().then(() => {
      counter += 1;
      append(`${counter}/${total}: ${adminURL}`, resp.status);
      document.getElementById('total').textContent = `${counter}/${total}`;
    });
  };

  const dequeue = async () => {
    while (urls.length) {
      const url = urls.shift();
      // eslint-disable-next-line no-await-in-loop
      await executeOperation(url, total);
      // eslint-disable-next-line no-await-in-loop
      if (slow) await sleep(1500);
    }
  };

  const doBulkOperation = async () => {
    if (total > 0) {
      const VERB = {
        preview: 'preview',
        live: 'publish',
      };
      const { hostname } = new URL(urls[0]); // use first URL to determine project details
      const [branch, repo, owner] = hostname.split('.')[0].split('--');
      const bulkText = `$1/${total} URL(s) bulk ${VERB[operation]}ed on ${owner}/${repo} ${forceUpdate ? '(force update)' : ''}`;
      const bulkLog = append(bulkText.replace('$1', 0));
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
        append(`Failed to bulk ${VERB[operation]} ${paths.length} URLs on ${origin}: ${await bulkResp.text()}`);
      } else {
        const { job } = await bulkResp.json();
        const { name } = job;
        const jobStatusPoll = window.setInterval(async () => {
          try {
            const jobResp = await fetch(`https://admin.hlx.page/job/${owner}/${repo}/${branch}/${VERB[operation]}/${name}/details`);
            const jobStatus = await jobResp.json();
            const {
              state,
              progress: {
                processed = 0,
              } = {},
              startTime,
              stopTime,
              data: {
                resources = [],
              } = {},
            } = jobStatus;
            if (state === 'stopped') {
              // job done, stop polling
              window.clearInterval(jobStatusPoll);
              // show job summary
              resources.forEach((res) => append(`${res.path} (${res.status})`, res.status));
              bulkLog.textContent = bulkText.replace('$1', processed);
              const duration = (new Date(stopTime).valueOf()
                - new Date(startTime).valueOf()) / 1000;
              append(`Bulk ${operation} completed in ${duration}s`);
            } else {
              // show job progress
              bulkLog.textContent = bulkText.replace('$1', processed);
            }
          } catch (error) {
            // eslint-disable-next-line no-console
            console.error(`failed to get status for job ${name}: ${error}`);
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
    append(`URLs: ${urls.length}`);
    let concurrency = ['live', 'unpublish', 'unpreview'].includes(operation) ? 40 : 3;
    if (slow) {
      concurrency = 1;
    }
    for (let i = 0; i < concurrency; i += 1) {
      dequeue(urls);
    }
  }
  return true;
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
