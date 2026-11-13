import { analyzeUrls, groupUrlsByTarget } from './utils.js';
import { getAdminClientForSite } from '../../scripts/admin-compat.js';
import { executeAdminRequest, AuthMode } from '../../utils/admin-request.js';

const resultsContainer = document.getElementById('results-container');
const runButton = document.getElementById('run');
const adminVersion = new URLSearchParams(window.location.search).get('hlx-admin-version');

const OPERATION_LABELS = {
  preview: 'Preview',
  live: 'Publish',
  index: 'Index',
  unpublish: 'Unpublish',
  unpreview: 'Unpreview',
};

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

// Keep target blocks within their run so earlier runs retain their own results.
const createRunBlock = (container, coords, onProgress) => {
  const details = document.createElement('details');
  details.className = 'run-result';
  const targetLabel = coords ? `${coords.org}/${coords.site} (${coords.ref}) - ` : '';
  if (coords) {
    Object.assign(details.dataset, coords);
    details.classList.add('run-bucket');
  }

  const summary = document.createElement('summary');
  summary.textContent = 'Running…';
  details.append(summary);

  const messages = document.createElement('div');
  messages.className = 'run-messages';
  details.append(messages);

  const list = document.createElement('ol');
  list.className = 'results-list';
  if (coords) details.append(list);

  if (coords) container.append(details);
  else container.prepend(details);

  let successCount = 0;
  let failCount = 0;

  const updateSummary = (processed, total, label, counts) => {
    if (counts) {
      failCount = counts.failCount;
      successCount = counts.successCount;
    }
    summary.textContent = `${targetLabel}${label} ${processed} of ${total} - ${failCount} failed, ${successCount} succeeded`;
    onProgress?.({ processed, failCount, successCount });
  };

  const appendMessage = (string, status = 'unknown') => {
    const p = document.createElement('p');
    p.textContent = string;
    if (status !== 'unknown') {
      p.className = `status-light http${Math.floor(status / 100) % 10}`;
    }
    messages.append(p);
    p.scrollIntoView();
    return p;
  };

  // Failures are prepended (newest on top) so they stay grouped above successes
  // as results stream in; successes are appended in arrival order.
  const appendResult = (text, status, processed, total, label) => {
    const li = document.createElement('li');
    li.textContent = text;
    // status 0 means a network/transport failure, not a real 2xx/3xx outcome.
    const failed = !status || status >= 400;
    li.className = `status-light http${Math.floor(status / 100) % 10}${failed ? ' is-failure' : ''}`;
    if (failed) {
      list.prepend(li);
      failCount += 1;
    } else {
      list.appendChild(li);
      successCount += 1;
    }
    updateSummary(processed, total, label);
    return li;
  };

  return {
    appendMessage, appendResult, updateSummary, element: details,
  };
};

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

async function executeBucket({ coords, paths, ui }, {
  operation, label, slow, forceUpdate,
}, pendingJobs) {
  const total = paths.length;
  let counter = 0;
  const { appendMessage, appendResult, updateSummary } = ui;
  const reportError = (error) => {
    // eslint-disable-next-line no-console
    console.error(error);
    appendMessage(`Unexpected error: ${error.message}`, 500);
    updateSummary(counter, total, `${label} failed`);
  };

  try {
    let admin = await getAdminClientForSite(coords);
    if (adminVersion) admin = admin.pinVersion(adminVersion);

    if (['preview', 'live'].includes(operation)) {
      const verb = operation === 'preview' ? 'preview' : 'publish';
      const bulkResp = await executeAdminRequest(
        () => admin[operation]().bulk({ paths, forceUpdate }),
        admin,
        { policy: AuthMode.PREFLIGHT_AND_RETRY },
      );
      if (!bulkResp) {
        appendMessage('Sign-in cancelled');
        updateSummary(0, total, `${label} cancelled`);
        return false;
      }
      if (!bulkResp.ok) {
        appendMessage(`Failed to bulk ${verb} ${total} URLs on ${coords.org}/${coords.site}: ${await bulkResp.text()}`, bulkResp.status);
        updateSummary(total, total, `${label} failed`, { failCount: total, successCount: 0 });
        return true;
      }
      const { job, links } = await bulkResp.json();
      const { name } = job;
      const readStatus = async (url) => {
        const response = await executeAdminRequest(
          () => admin.raw('GET', url),
          admin,
          { policy: AuthMode.NONE },
        );
        if (!response?.ok) {
          throw new Error(`Failed to get status for job ${name}: HTTP ${response?.status ?? 'no response'}`);
        }
        return response.json();
      };

      // Follow API-returned links: H5 details and H6 reports have different URLs.
      let detailsUrl = links?.details;
      if (!detailsUrl && links?.self) {
        detailsUrl = (await readStatus(links.self)).links?.details;
      }
      if (!detailsUrl) {
        appendMessage(`Bulk ${operation} started (job ${name}) but the API returned no status link`, 500);
        updateSummary(0, total, `${label} failed`);
        return true;
      }

      let loggedCount = 0;
      let polling = false;
      const completion = new Promise((resolve, reject) => {
        const jobStatusPoll = window.setInterval(async () => {
          if (polling) return;
          polling = true;
          try {
            const {
              state,
              progress: { processed = 0 } = {},
              startTime,
              stopTime,
              data: { resources = [] } = {},
            } = await readStatus(detailsUrl);
            counter = processed;
            for (let i = loggedCount; i < resources.length; i += 1) {
              const res = resources[i];
              if (!res.status) break;
              const path = res.resourcePath || res.path;
              appendResult(`${path} (${res.status})`, res.status, processed, total, label);
              loggedCount = i + 1;
            }
            updateSummary(processed, total, label);
            if (state === 'stopped') {
              window.clearInterval(jobStatusPoll);
              const duration = (new Date(stopTime).valueOf()
                - new Date(startTime).valueOf()) / 1000;
              appendMessage(`Bulk ${operation} completed in ${duration}s`);
              resolve();
            }
          } catch (error) {
            window.clearInterval(jobStatusPoll);
            reject(error);
          } finally {
            polling = false;
          }
        }, 1000);
      });
      pendingJobs.push(completion.catch(reportError));
      return true;
    }

    const endpoint = { unpublish: 'live', unpreview: 'preview' }[operation] || operation;
    const remove = ['unpublish', 'unpreview'].includes(operation);
    const resource = admin[endpoint]();
    const doAdminOp = (path, policy = AuthMode.NONE) => executeAdminRequest(
      () => (remove ? resource.remove(path) : resource.update(path, null)),
      admin,
      { policy },
    );
    const logOp = async (response) => {
      await response.text();
      counter += 1;
      appendResult(`${counter}/${total}: ${response.request.url}`, response.status, counter, total, label);
    };
    const remaining = [...paths];
    appendMessage(`URLs: ${total}`);
    const firstResp = await doAdminOp(remaining.shift(), AuthMode.PREFLIGHT_AND_RETRY);
    if (!firstResp) {
      appendMessage('Sign-in cancelled');
      updateSummary(0, total, `${label} cancelled`);
      return false;
    }
    await logOp(firstResp);
    const dequeue = async () => {
      while (remaining.length) {
        const path = remaining.shift();
        try {
          // eslint-disable-next-line no-await-in-loop
          const response = await doAdminOp(path);
          // eslint-disable-next-line no-await-in-loop
          if (response) await logOp(response);
        } catch (error) {
          // eslint-disable-next-line no-console
          console.error(error);
          counter += 1;
          appendResult(`${path} (failed: ${error.message})`, 0, counter, total, label);
        }
        // eslint-disable-next-line no-await-in-loop
        if (slow) await sleep(1500);
      }
    };
    let concurrency = remove ? 40 : 3;
    if (slow) concurrency = 1;
    await Promise.all(Array.from({ length: concurrency }, dequeue));
  } catch (error) {
    reportError(error);
  }
  return true;
}

document.getElementById('urls-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  runButton.disabled = true;
  const run = createRunBlock(resultsContainer);
  const { appendMessage, element: runElement } = run;
  const finish = () => { runButton.disabled = false; };

  const rawUrls = document.getElementById('urls').value
    .split('\n')
    .map((u) => u.trim())
    .filter((u) => u.length > 0);

  if (rawUrls.length === 0) {
    appendMessage('No URLs provided');
    finish();
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
      appendMessage('Operation cancelled by user');
      finish();
      return false;
    }
    urlsToUse = choice === 'unsanitized' ? urlsUnsanitized : urls;
    if (choice === 'sanitized' || choice === true) {
      document.getElementById('urls').value = urls.join('\n');
      appendMessage(`URL(s) updated with ${urls.length} sanitized URL(s)`);
    } else {
      appendMessage(`Proceeding with ${urlsToUse.length} original URL(s)`);
    }
  }

  const total = urlsToUse.length;
  if (urlsToUse.length === 0) {
    appendMessage('No valid URLs after sanitization');
    finish();
    return false;
  }

  const operation = document.getElementById('operation').dataset.value;
  const label = OPERATION_LABELS[operation] || operation;
  const slow = document.getElementById('slow').checked;
  const forceUpdate = document.getElementById('force').checked;
  let buckets;
  try {
    buckets = groupUrlsByTarget(urlsToUse);
  } catch (error) {
    appendMessage(error.message);
    finish();
    return false;
  }
  const progress = new Map();
  const updateRun = (runLabel = label) => {
    const counts = [...progress.values()].reduce((sum, item) => ({
      processed: sum.processed + item.processed,
      failCount: sum.failCount + item.failCount,
      successCount: sum.successCount + item.successCount,
    }), { processed: 0, failCount: 0, successCount: 0 });
    run.updateSummary(counts.processed, total, runLabel, counts);
  };
  const planned = buckets.map((bucket) => {
    const ui = createRunBlock(runElement, bucket.coords, (counts) => {
      progress.set(bucket, counts);
      updateRun();
    });
    ui.updateSummary(0, bucket.paths.length, label);
    return { ...bucket, ui };
  });
  runElement.open = true;
  const pendingJobs = [];
  let outcome = 'finished';
  try {
    // Sequential starts avoid competing login dialogs and preserve direct-request limits.
    for (let i = 0; i < planned.length; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const proceed = await executeBucket(planned[i], {
        operation, label, slow, forceUpdate,
      }, pendingJobs);
      if (!proceed) {
        outcome = 'cancelled';
        // Stop new submissions on cancellation; accepted jobs still finish reporting.
        planned.slice(i + 1).forEach(({ paths, ui }) => {
          ui.appendMessage('Skipped because sign-in was cancelled');
          ui.updateSummary(0, paths.length, `${label} skipped`);
        });
        break;
      }
    }
    await Promise.all(pendingJobs);
  } finally {
    updateRun(`${label} ${outcome}`);
    finish();
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
