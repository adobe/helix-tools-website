import { analyzeUrls } from './utils.js';
import admin from '../../scripts/helix-admin.js';
import { executeAdminRequest, AuthMode } from '../../utils/admin-request.js';

const log = document.getElementById('logger');
const adminVersion = new URLSearchParams(window.location.search).get('hlx-admin-version');
const adminVersionParams = adminVersion ? { 'hlx-admin-version': adminVersion } : undefined;

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

/**
 * Show a confirmation dialog with sanitization warnings
 * @param {Object} changes - Sanitization analysis results
 * @param {Array<{original: string, reason: string}>} changes.rejected
 *   URLs that failed validation
 * @param {Array<{original: string, sanitized: string, changes: string[]}>} changes.modified
 *   URLs that were sanitized
 * @param {string[]} changes.deduplicated - Duplicate URLs that will be removed
 * @returns {Promise<boolean|'sanitized'|'unsanitized'>} true or 'sanitized' to proceed with
 *   sanitized URLs, 'unsanitized' to use originals, false if cancelled
 */
const showSanitizationWarning = (changes) => {
  const { rejected, modified, deduplicated } = changes;
  const showUnsanitizedOption = modified.length > 0;

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
    confirmBtn.textContent = showUnsanitizedOption ? 'Proceed with sanitized URLs' : 'Proceed';
    actionsDiv.appendChild(confirmBtn);

    if (showUnsanitizedOption) {
      const unsanitizedBtn = document.createElement('button');
      unsanitizedBtn.className = 'button primary';
      unsanitizedBtn.id = 'confirm-unsanitized';
      unsanitizedBtn.textContent = 'Run with original URLs';
      actionsDiv.appendChild(unsanitizedBtn);
    }

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
      resolve(showUnsanitizedOption ? 'sanitized' : true);
    });

    if (showUnsanitizedOption) {
      modal.querySelector('#confirm-unsanitized').addEventListener('click', () => {
        modal.close();
        modal.remove();
        resolve('unsanitized');
      });
    }

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
    urls, urlsUnsanitized, rejected, modified, deduplicated,
  } = analyzeUrls(rawUrls);

  // Check if there are any sanitization issues
  const hasIssues = rejected.length > 0 || modified.length > 0 || deduplicated.length > 0;

  let urlsToUse = urls;
  if (hasIssues) {
    const choice = await showSanitizationWarning({ rejected, modified, deduplicated });
    if (!choice) {
      append('Operation cancelled by user');
      return false;
    }
    urlsToUse = choice === 'unsanitized' ? urlsUnsanitized : urls;
    if (choice === 'sanitized' || choice === true) {
      document.getElementById('urls').value = urls.join('\n');
      append(`URL(s) updated with ${urls.length} sanitized URL(s)`);
    } else {
      append(`Proceeding with ${urlsToUse.length} original URL(s)`);
    }
  }

  const total = urlsToUse.length;
  if (urlsToUse.length === 0) {
    append('No valid URLs after sanitization');
    return false;
  }

  const operation = document.getElementById('operation').dataset.value;
  const slow = document.getElementById('slow').checked;
  const forceUpdate = document.getElementById('force').checked;

  const ENDPOINTS = { unpublish: 'live', unpreview: 'preview' };
  const METHODS = { unpublish: 'DELETE', unpreview: 'DELETE' };

  // Returns AdminResponse or null (login cancelled).
  const doAdminOp = (url, policy = AuthMode.NONE) => {
    const { hostname, pathname } = new URL(url);
    const [branch, repo, owner] = hostname.split('.')[0].split('--');
    const endpoint = ENDPOINTS[operation] || operation;
    const method = METHODS[operation] || 'POST';
    const resource = admin[endpoint]({ org: owner, site: repo, ref: branch });
    return executeAdminRequest(
      () => (method === 'DELETE'
        ? resource.remove(pathname, { params: adminVersionParams })
        : resource.update(pathname, null, { params: adminVersionParams })),
      { org: owner, site: repo, policy },
    );
  };

  const logOp = (resp) => {
    const { url: reqUrl } = resp.request;
    resp.text().then(() => {
      counter += 1;
      append(`${counter}/${total}: ${reqUrl}`, resp.status);
      document.getElementById('total').textContent = `${counter}/${total}`;
    });
  };

  const executeOperation = async (url) => {
    const resp = await doAdminOp(url);
    if (resp) logOp(resp);
  };

  const dequeue = async () => {
    while (urlsToUse.length) {
      // eslint-disable-next-line no-await-in-loop
      await executeOperation(urlsToUse.shift());
      // eslint-disable-next-line no-await-in-loop
      if (slow) await sleep(1500);
    }
  };

  const doBulkOperation = async () => {
    if (total > 0) {
      const VERB = { preview: 'preview', live: 'publish' };
      const { hostname } = new URL(urlsToUse[0]);
      const [branch, repo, owner] = hostname.split('.')[0].split('--');
      const bulkText = `$1/${total} URL(s) bulk ${VERB[operation]}ed on ${owner}/${repo} ${forceUpdate ? '(force update)' : ''}`;
      const bulkLog = append(bulkText.replace('$1', 0));
      const paths = urlsToUse.map((url) => new URL(url).pathname);
      const bulkResp = await executeAdminRequest(
        () => admin[operation]({ org: owner, site: repo, ref: branch })
          .update('*', JSON.stringify({ paths, forceUpdate }), { params: adminVersionParams }),
        { org: owner, site: repo, policy: AuthMode.PREFLIGHT_AND_RETRY },
      );
      if (!bulkResp) {
        append('Sign-in cancelled');
        return;
      }
      if (!bulkResp.ok) {
        append(`Failed to bulk ${VERB[operation]} ${paths.length} URLs on ${owner}/${repo}: ${await bulkResp.text()}`);
      } else {
        const { job } = await bulkResp.json();
        const { name } = job;
        const jobStatusPoll = window.setInterval(async () => {
          try {
            const jobResp = await admin.job({ org: owner, site: repo, ref: branch })
              .get(`${VERB[operation]}/${name}/details`);
            const jobStatus = await jobResp.json();
            const {
              state,
              progress: { processed = 0 } = {},
              startTime,
              stopTime,
              data: { resources = [] } = {},
            } = jobStatus;
            if (state === 'stopped') {
              window.clearInterval(jobStatusPoll);
              resources.forEach((res) => append(`${res.path} (${res.status})`, res.status));
              bulkLog.textContent = bulkText.replace('$1', processed);
              const duration = (new Date(stopTime).valueOf()
                - new Date(startTime).valueOf()) / 1000;
              append(`Bulk ${operation} completed in ${duration}s`);
            } else {
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
    doBulkOperation();
  } else {
    append(`URLs: ${urlsToUse.length}`);
    let concurrency = ['live', 'unpublish', 'unpreview'].includes(operation) ? 40 : 3;
    if (slow) concurrency = 1;

    // Auth preflight on first URL before launching concurrent dequeues.
    const firstResp = await doAdminOp(urlsToUse.shift(), AuthMode.PREFLIGHT_AND_RETRY);
    if (!firstResp) {
      append('Sign-in cancelled');
      return false;
    }
    logOp(firstResp);

    for (let i = 0; i < concurrency; i += 1) {
      dequeue();
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
