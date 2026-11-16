import { registerToolReady } from '../../scripts/scripts.js';
import { getAdminClientForSite } from '../../scripts/admin-compat.js';
import { initConfigField } from '../../utils/config/config.js';
import { logResponse } from '../../blocks/console/console.js';
import { readRobots, writeRobots } from './api.js';

const adminForm = document.getElementById('admin-form');
const bodyForm = document.getElementById('body-form');
const body = document.getElementById('body');
const consoleBlock = document.querySelector('.console');
const site = document.getElementById('site');
const org = document.getElementById('org');

// `client` is pinned only by a successful Fetch, until the next one: edits to the org/site
// inputs and failed fetches don't retarget a later Save. Save without a Fetch targets the
// current inputs each time.
let client = null;

const log = (res) => logResponse(
  consoleBlock,
  res.status,
  [res.request.method, res.request.url, res.error],
);

/**
 * Detects H5 or H6 for the selected site and logs a detection failure to the console.
 * @returns {Promise<import('../../scripts/admin-types.js').BoundAdminClient|null>}
 */
async function loadClient() {
  try {
    return await getAdminClientForSite({ org: org.value, site: site.value });
  } catch (error) {
    logResponse(consoleBlock, 500, ['GET', `${org.value}/${site.value}`, error.message]);
    return null;
  }
}

async function init() {
  await initConfigField();

  bodyForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!org.value || !site.value) {
      // eslint-disable-next-line no-alert
      alert('Please select an organization and site first');
      return;
    }

    const target = client ?? await loadClient();
    if (!target) return;
    await writeRobots(target, log, body.value);
  });

  adminForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!org.value || !site.value) {
      // eslint-disable-next-line no-alert
      alert('Please select an organization and site first');
      return;
    }

    const loaded = await loadClient();
    if (!loaded) return;
    const text = await readRobots(loaded, log);
    if (text === null) return;
    body.value = text;
    client = loaded;
  });
}

registerToolReady(init());
