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

    // The textarea is free text, so Save targets the org/site currently in the form.
    const admin = await loadClient();
    if (!admin) return;
    await writeRobots(admin, log, body.value);
  });

  adminForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!org.value || !site.value) {
      // eslint-disable-next-line no-alert
      alert('Please select an organization and site first');
      return;
    }

    const admin = await loadClient();
    if (!admin) return;
    const text = await readRobots(admin, log);
    if (text !== null) body.value = text;
  });
}

registerToolReady(init());
