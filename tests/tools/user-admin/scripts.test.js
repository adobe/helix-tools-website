/* eslint-env node */
import {
  describe, it, before, beforeEach, afterEach, mock,
} from 'node:test';
import assert from 'node:assert/strict';
import createMockAemApi from '../../helpers/mock-aem-api.js';

let loginCalls = [];

mock.module('../../../blocks/profile/profile.js', {
  exports: {
    ensureLogin: async (org, site) => {
      loginCalls.push([org, site]);
      return true;
    },
  },
});
mock.module('../../../utils/config/config.js', {
  exports: { updateConfig: () => {}, initConfigField: async () => {} },
});
mock.module('../../../scripts/scripts.js', {
  exports: { registerToolReady: () => {} },
});
mock.module('../../../blocks/console/console.js', {
  exports: { logResponse: () => {} },
});
mock.module('../../../utils/card-ui/card-ui.js', {
  exports: { loadIcon: async () => {}, icon: () => '', showToast: () => {} },
});

const waitFor = async (predicate, timeoutMs = 3000) => {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('timed out waiting for the tool');
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => { setTimeout(resolve, 10); });
  }
};

const ORG_USERS = { users: [{ email: 'a@example.com', roles: ['author'], id: 'u1' }] };
const SITE_ACCESS = { admin: { role: { author: ['a@example.com'] } } };

describe('user-admin:user-admin.js', () => {
  const api = createMockAemApi();
  let probes;
  let probeStatus;

  before(async () => {
    document.body.innerHTML = `
      <form id="admin-form">
        <input id="org" /><input id="site" />
      </form>
      <div id="users-container"></div>
      <div class="console"></div>`;
    global.localStorage = window.localStorage;
    global.Event = window.Event;
    window.HTMLElement.prototype.scrollIntoView = () => {};
    window.HTMLDialogElement.prototype.showModal = function showModal() { this.open = true; };
    window.HTMLDialogElement.prototype.close = function close() { this.open = false; };
    await import('../../../tools/user-admin/user-admin.js');
  });

  beforeEach(() => {
    api.install();
    probes = [];
    probeStatus = 200;
    loginCalls = [];
    const specFetch = global.fetch;
    // Backend detection hits the legacy host, which the spec-routed fake does not serve.
    global.fetch = async (url, init) => {
      if (String(url).startsWith('https://admin.hlx.page/sidekick/')) {
        probes.push(String(url));
        return new Response(null, {
          status: probeStatus,
          headers: { 'x-api-upgrade-available': 'true' },
        });
      }
      return specFetch(url, init);
    };
    window.localStorage.removeItem('use-h6-api');
    document.getElementById('org').value = 'myorg';
    document.getElementById('site').value = '';
    document.getElementById('users-container').innerHTML = '';
  });

  afterEach(() => {
    const { violations } = api;
    api.uninstall();
    api.reset();
    delete global.prompt;
    document.querySelectorAll('dialog').forEach((dialog) => dialog.remove());
    assert.deepEqual(violations, []);
  });

  const submit = () => document.getElementById('admin-form')
    .dispatchEvent(new window.Event('submit', { cancelable: true }));
  const load = async () => {
    submit();
    await waitFor(() => document.querySelector('.user-card, .error'));
  };
  const cards = () => [...document.querySelectorAll('.user-card')].map((c) => c.dataset.email);
  const writes = () => api.calls
    .filter(({ method }) => method !== 'GET')
    .map(({ method, pathname, body }) => [method, pathname, body]);
  const saveModal = async () => {
    const count = api.calls.length;
    document.getElementById('user-admin-modal-form')
      .dispatchEvent(new window.Event('submit', { cancelable: true }));
    await waitFor(() => api.calls.length > count);
  };
  const pick = (role) => document.querySelector(`dialog .roles-field input[value="${role}"]`).click();

  it('loads org users from the H6 org config without detecting a backend', async () => {
    api.respond('getConfigOrg', { status: 200, body: ORG_USERS });
    await load();

    assert.deepEqual(cards(), ['a@example.com']);
    assert.deepEqual(api.calls.map(({ method, url }) => [method, url]), [
      ['GET', 'https://api.aem.live/myorg/config.json'],
    ]);
    assert.deepEqual(probes, []);
    assert.deepEqual(loginCalls, [['myorg', undefined]]);
  });

  it('adds an org user at the org users path', async () => {
    api.respond('getConfigOrg', { status: 200, body: ORG_USERS });
    api.respond('updateConfigOrgSub', { status: 200, body: {} });
    await load();

    document.querySelector('.add-user-btn').click();
    document.querySelector('dialog .user-row-email').value = 'new@example.com';
    pick('author');
    await saveModal();

    assert.deepEqual(writes(), [
      ['POST', '/myorg/config/users.json', { email: 'new@example.com', roles: ['author'] }],
    ]);
  });

  it('adds several org users with one create request each, none carrying an id', async () => {
    api.respond('getConfigOrg', { status: 200, body: ORG_USERS });
    api.respond('updateConfigOrgSub', { status: 200, body: {} });
    await load();

    document.querySelector('.add-user-btn').click();
    document.querySelector('dialog .user-row-email').value = 'one@example.com';
    pick('author');
    document.querySelector('dialog .add-another-btn').click();
    document.querySelectorAll('dialog .user-row-email')[1].value = 'two@example.com';
    await saveModal();
    await waitFor(() => writes().length === 2);

    assert.deepEqual(writes(), [
      ['POST', '/myorg/config/users.json', { email: 'one@example.com', roles: ['author'] }],
      ['POST', '/myorg/config/users.json', { email: 'two@example.com', roles: ['author'] }],
    ]);
  });

  it('stops adding org users at the first rejected create and reports how many were added', async () => {
    api.respond('getConfigOrg', { status: 200, body: ORG_USERS });
    api.respond('updateConfigOrgSub', [{ status: 200, body: {} }, { status: 400 }]);
    await load();

    document.querySelector('.add-user-btn').click();
    document.querySelector('dialog .user-row-email').value = 'one@example.com';
    pick('author');
    document.querySelector('dialog .add-another-btn').click();
    document.querySelectorAll('dialog .user-row-email')[1].value = 'two@example.com';
    document.querySelector('dialog .add-another-btn').click();
    document.querySelectorAll('dialog .user-row-email')[2].value = 'three@example.com';
    await saveModal();
    await waitFor(() => document.querySelector('dialog .modal-error'));

    assert.equal(writes().length, 2);
    assert.match(document.querySelector('dialog .modal-error').textContent, /1 user\(s\) added, 2 failed/);
  });

  it('updates and deletes an org user by id', async () => {
    api.respond('getConfigOrg', { status: 200, body: ORG_USERS });
    api.respond('updateConfigOrgSub', { status: 200, body: {} });
    api.respond('deleteConfigOrgSub', { status: 204 });
    await load();

    document.querySelector('.user-card .edit-btn').click();
    pick('publish');
    await saveModal();

    document.querySelectorAll('dialog').forEach((dialog) => dialog.remove());
    document.querySelector('.user-card .edit-btn').click();
    global.prompt = () => 'a@example.com';
    const count = api.calls.length;
    document.querySelector('dialog .delete-btn').click();
    await waitFor(() => api.calls.length > count);

    assert.deepEqual(writes(), [
      ['POST', '/myorg/config/users/u1.json', { email: 'a@example.com', roles: ['publish'], id: 'u1' }],
      ['DELETE', '/myorg/config/users/u1.json', undefined],
    ]);
  });

  it('keeps writing to the loaded org after the form inputs change', async () => {
    api.respond('getConfigOrg', { status: 200, body: ORG_USERS });
    api.respond('updateConfigOrgSub', { status: 200, body: {} });
    await load();

    document.getElementById('org').value = 'otherorg';
    document.getElementById('site').value = 'othersite';
    document.querySelector('.user-card .edit-btn').click();
    pick('publish');
    await saveModal();

    assert.deepEqual(writes().map(([method, pathname]) => [method, pathname]), [
      ['POST', '/myorg/config/users/u1.json'],
    ]);
  });

  it('detects the backend for a site and reads that site access config', async () => {
    document.getElementById('site').value = 'mysite';
    api.respond('getConfigSiteSub', { status: 200, body: SITE_ACCESS });
    await load();

    assert.deepEqual(probes, ['https://admin.hlx.page/sidekick/myorg/mysite/main/config.json']);
    assert.deepEqual(cards(), ['a@example.com']);
    assert.equal(api.calls[0].pathname, '/myorg/sites/mysite/config/access.json');
    assert.deepEqual(loginCalls, [['myorg', 'mysite']]);
  });

  it('adds a site user by rewriting access.json', async () => {
    document.getElementById('site').value = 'mysite';
    api.respond('getConfigSiteSub', { status: 200, body: SITE_ACCESS });
    api.respond('updateConfigSiteSub', { status: 200, body: {} });
    await load();

    document.querySelector('.add-user-btn').click();
    document.querySelector('dialog .user-row-email').value = 'new@example.com';
    pick('author');
    await saveModal();

    const [[method, pathname, body]] = writes();
    assert.equal(method, 'POST');
    assert.equal(pathname, '/myorg/sites/mysite/config/access.json');
    assert.deepEqual(body.admin.role.author, ['a@example.com', 'new@example.com']);
  });

  it('updates a site user role through access.json', async () => {
    document.getElementById('site').value = 'mysite';
    api.respond('getConfigSiteSub', { status: 200, body: SITE_ACCESS });
    api.respond('updateConfigSiteSub', { status: 200, body: {} });
    await load();

    document.querySelector('.user-card .edit-btn').click();
    pick('publish');
    await saveModal();

    const [[method, pathname, body]] = writes();
    assert.equal(method, 'POST');
    assert.equal(pathname, '/myorg/sites/mysite/config/access.json');
    assert.deepEqual(body.admin.role, { publish: ['a@example.com'] });
  });

  it('deletes a site user by removing them from access.json', async () => {
    document.getElementById('site').value = 'mysite';
    api.respond('getConfigSiteSub', { status: 200, body: SITE_ACCESS });
    api.respond('updateConfigSiteSub', { status: 200, body: {} });
    await load();

    document.querySelector('.user-card .edit-btn').click();
    global.prompt = () => 'a@example.com';
    const count = api.calls.length;
    document.querySelector('dialog .delete-btn').click();
    await waitFor(() => api.calls.length > count);

    const [[method, pathname, body]] = writes();
    assert.equal(method, 'POST');
    assert.equal(pathname, '/myorg/sites/mysite/config/access.json');
    assert.deepEqual(body.admin.role, {});
  });

  it('keeps writing to the loaded site after the form inputs change', async () => {
    document.getElementById('site').value = 'mysite';
    api.respond('getConfigSiteSub', { status: 200, body: SITE_ACCESS });
    api.respond('updateConfigSiteSub', { status: 200, body: {} });
    await load();

    document.getElementById('org').value = 'otherorg';
    document.getElementById('site').value = 'othersite';
    document.querySelector('.user-card .edit-btn').click();
    pick('publish');
    await saveModal();

    assert.deepEqual(writes().map(([method, pathname]) => [method, pathname]), [
      ['POST', '/myorg/sites/mysite/config/access.json'],
    ]);
  });

  it('shows a load error and makes no admin calls when backend detection fails', async () => {
    document.getElementById('site').value = 'detect-fails';
    probeStatus = 404;
    await load();

    assert.equal(document.querySelector('.error').textContent, 'Failed to load users');
    assert.deepEqual(api.calls, []);
  });
});
