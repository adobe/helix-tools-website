const log = document.getElementById('logger');
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

document.getElementById('urls-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  let counter = 0;
  const urls = document.getElementById('urls').value
    .split('\n')
    .map((u) => u.trim())
    .filter((u) => u.length > 0);
  const total = urls.length;
  const operation = document.getElementById('operation').dataset.value;
  const slow = document.getElementById('slow').checked;
  const forceUpdate = document.getElementById('force').checked;

  const executeOperation = async (url) => {
    const { hostname, pathname } = new URL(url);
    const [branch, repo, owner] = hostname.split('.')[0].split('--');
    const adminURL = `https://admin.hlx.page/${operation}/${owner}/${repo}/${branch}${pathname}`;
    const resp = await fetch(adminURL, { method: 'POST', credentials: 'include' });
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
      const bulkResp = await fetch(`https://admin.hlx.page/${operation}/${owner}/${repo}/${branch}/*`, {
        method: 'POST',
        credentials: 'include',
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
            const jobResp = await fetch(`https://admin.hlx.page/job/${owner}/${repo}/${branch}/${VERB[operation]}/${name}/details`, { credentials: 'include' });
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
              append(`bulk ${operation} completed in ${duration}s`);
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
    let concurrency = operation === 'live' ? 40 : 3;
    if (slow) {
      concurrency = 1;
    }
    for (let i = 0; i < concurrency; i += 1) {
      dequeue(urls);
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
