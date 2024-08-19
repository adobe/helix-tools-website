/* eslint-disable no-await-in-loop, no-console */
const log = document.getElementById('logger');
const append = (string, status = 'unknown') => {
  const p = document.createElement('p');
  p.textContent = string;
  p.classList.add(`s-${status}`);
  log.append(p);
  p.scrollIntoView();
  return p;
};

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

document.getElementById('start').addEventListener('click', async () => {
  let counter = 0;
  const urls = document.getElementById('textarea').value
    .split('\n')
    .map((e) => e.trim())
    .filter((e) => e.length > 0);
  const total = urls.length;
  const operation = document.getElementById('select').value;
  const slow = document.getElementById('slow').checked;
  const forceUpdate = document.getElementById('force').checked;

  const executeOperation = async (url) => {
    const { hostname, pathname } = new URL(url);
    const [branch, repo, owner] = hostname.split('.')[0].split('--');
    const adminURL = `https://admin.hlx.page/${operation}/${owner}/${repo}/${branch}${pathname}`;
    const resp = await fetch(adminURL, {
      method: 'POST',
    });
    const text = await resp.text();
    console.log(text);
    counter += 1;
    append(`${counter}/${total}: ${adminURL}`, resp.status);
    document.getElementById('total').textContent = `${counter}/${total}`;
  };

  const dequeue = async () => {
    while (urls.length) {
      const url = urls.shift();
      await executeOperation(url, total);
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
              append(`bulk ${operation} completed in ${duration}s`);
            } else {
              // show job progress
              bulkLog.textContent = bulkText.replace('$1', processed);
            }
          } catch (e) {
            console.error(`failed to get status for job ${name}: ${e}`);
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
