import { initConfigField } from '../../utils/config/config.js';
import { logResponse } from '../../blocks/console/console.js';

const adminForm = document.getElementById('admin-form');
const bodyForm = document.getElementById('body-form');
const body = document.getElementById('body');
const consoleBlock = document.querySelector('.console');
const site = document.getElementById('site');
const org = document.getElementById('org');

async function init() {
  await initConfigField();

  bodyForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!org.value || !site.value) {
      // eslint-disable-next-line no-alert
      alert('Please select an organization and site first');
      return;
    }

    const robotsUrl = `https://admin.hlx.page/config/${org.value}/sites/${site.value}/robots.txt`;
    const resp = await fetch(robotsUrl, {
      method: 'POST',
      body: body.value,
      headers: {
        'content-type': 'text/plain',
      },
    });

    resp.text().then(() => {
      logResponse(consoleBlock, resp.status, ['POST', robotsUrl, resp.headers.get('x-error') || '']);
    });
  });

  adminForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!org.value || !site.value) {
      // eslint-disable-next-line no-alert
      alert('Please select an organization and site first');
      return;
    }

    const robotsUrl = `https://admin.hlx.page/config/${org.value}/sites/${site.value}/robots.txt`;
    const resp = await fetch(robotsUrl);
    const text = await resp.text();
    body.value = text;
    logResponse(consoleBlock, resp.status, ['GET', robotsUrl, resp.headers.get('x-error') || '']);
  });
}

const initPromise = init();

// eslint-disable-next-line import/prefer-default-export
export function ready() {
  return initPromise;
}
