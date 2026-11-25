/* eslint-env node */
import { it, mock } from 'node:test';
import assert from 'node:assert/strict';

// Keep real persistence isolated from admin-request.test.js's config-module mock.
mock.module('../../utils/ims.js', {
  exports: {
    getImsToken: () => 'ims-token',
    isImsTokenFresh: () => true,
    loadIms: async () => {},
    signIn: async () => true,
  },
});

const { executeAdminRequest, AuthMode } = await import('../../utils/admin-request.js');
const { getAdminClientForSite, getAdminClientForOrg } = await import('../../scripts/admin-compat.js');

function snapshot() {
  return {
    url: window.location.href,
    projects: JSON.parse(localStorage.getItem('aem-projects')),
    orgs: [...document.getElementById('org-list').options].map(({ value }) => value),
    sites: [...document.getElementById('site-list').options].map(({ value }) => value),
    form: {
      org: document.getElementById('org').value,
      site: document.getElementById('site').value,
    },
  };
}

it('persists successful bound targets without persisting or overwriting subsequent form edits', async () => {
  global.localStorage = window.localStorage;
  const savedProjects = { orgs: ['saved-org'], sites: { 'saved-org': ['saved-site'] } };
  window.localStorage.setItem('use-h6-api', '');
  const siteClient = await getAdminClientForSite({ org: 'loaded-org', site: 'loaded-site' });
  const orgClient = await getAdminClientForOrg({ org: 'loaded-org' });
  const cases = [
    { client: siteClient, edits: { org: 'edited-org', site: 'loaded-site' } },
    { client: siteClient, edits: { org: 'loaded-org', site: 'edited-site' } },
    { client: siteClient, edits: { org: 'loaded-org', site: '' } },
    { client: orgClient, edits: { org: 'edited-org', site: '' } },
    { client: orgClient, edits: { org: 'loaded-org', site: 'edited-site' } },
  ];
  const actual = [];
  const expected = [];

  const run = async ({ client, edits }) => {
    const target = { org: client.coords.org, site: client.coords.site ?? '' };
    document.body.innerHTML = `
      <div class="config-field">
        <input id="org" />
        <datalist id="org-list"><option value="saved-org"></option></datalist>
        <input id="site" />
        <datalist id="site-list"><option value="saved-site"></option></datalist>
      </div>`;
    document.getElementById('org').value = target.org;
    document.getElementById('site').value = target.site;
    window.history.replaceState({}, '', '/tools/user-admin/index.html?org=saved-org&site=saved-site');
    localStorage.setItem('aem-projects', JSON.stringify(savedProjects));

    const response = { ok: true, status: 200 };
    const urls = [];
    const request = async () => {
      urls.push(client.config().url);
      return response;
    };
    const loaded = await executeAdminRequest(request, client, { policy: AuthMode.NONE });
    const afterLoad = snapshot();
    const updated = await executeAdminRequest(async () => {
      document.getElementById('org').value = edits.org;
      document.getElementById('site').value = edits.site;
      return request();
    }, client, { policy: AuthMode.NONE });

    const projects = {
      orgs: ['loaded-org', 'saved-org'],
      sites: {
        'saved-org': ['saved-site'],
        ...(target.site ? { 'loaded-org': ['loaded-site'] } : {}),
      },
    };
    const persisted = {
      url: `http://localhost/tools/user-admin/index.html?org=loaded-org${target.site ? '&site=loaded-site' : ''}`,
      projects,
      orgs: ['saved-org', 'loaded-org'],
      sites: target.site ? ['saved-site', 'loaded-site'] : ['saved-site'],
      form: target,
    };
    const url = target.site
      ? 'https://api.aem.live/loaded-org/sites/loaded-site/config.json'
      : 'https://api.aem.live/loaded-org/config.json';
    assert.equal(loaded, response);
    assert.equal(updated, response);
    actual.push({ urls, afterLoad, afterUpdate: snapshot() });
    expected.push({
      urls: [url, url],
      afterLoad: persisted,
      afterUpdate: { ...persisted, form: edits },
    });
  };

  try {
    for (let i = 0; i < cases.length; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await run(cases[i]);
    }
    assert.deepEqual(actual, expected);
  } finally {
    window.localStorage.removeItem('use-h6-api');
    window.localStorage.removeItem('aem-projects');
  }
});
