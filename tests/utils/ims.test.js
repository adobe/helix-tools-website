/* eslint-env node */
import {
  describe, it, before, beforeEach, afterEach, mock,
} from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

let loadScriptStub;
// imslib loads via a script element; the stub fails it by throwing
const stubScriptLoading = () => mock.method(document.head, 'append', (script) => {
  loadScriptStub(script.src).catch(() => script.onerror());
});
stubScriptLoading();

// a fresh module per case, so the memoized IMS promise isn't shared
let instance = 0;
function importIms() {
  instance += 1;
  return import(`../../utils/ims.js?instance=${instance}`);
}

const settle = () => new Promise((resolve) => { setImmediate(resolve); });

// fake imslib: installs window.adobeIMS, then calls the adobeid callbacks
function imslib({
  token, expire, profile, errorFirst = false,
} = {}) {
  const adobeIMS = {
    token,
    expire,
    getAccessToken: () => (adobeIMS.token
      ? { token: adobeIMS.token, expire: adobeIMS.expire }
      : null),
    getProfile: async () => {
      if (profile instanceof Error) throw profile;
      return profile;
    },
    signIn: mock.fn(),
    signOut: mock.fn(),
  };
  loadScriptStub = mock.fn(async () => {
    window.adobeIMS = adobeIMS;
    if (errorFirst) window.adobeid.onError('token_validation', 'invalid token');
    window.adobeid.onReady();
  });
  return adobeIMS;
}

const HOUR = 60 * 60 * 1000;

function assertSignInTab(open) {
  assert.deepEqual(open.mock.calls[0].arguments, ['/utils/ims-sign-in.html', '_blank']);
}

// each IMS step reloads the sign-in page, so each run gets a fresh module
async function runSignInPage() {
  return (await importIms()).runSignInPage();
}

// JSDOM has no modal dialogs
function stubDialogs({ HTMLDialogElement }) {
  HTMLDialogElement.prototype.showModal = function showModal() { this.open = true; };
  HTMLDialogElement.prototype.close = function close() {
    this.open = false;
    this.dispatchEvent(new Event('close'));
  };
}

// a window at this URL replaces the global one until restored: the shared window's host
// (localhost) never signs in on page load
function openPage(url) {
  const shared = { window: global.window, document: global.document, Event: global.Event };
  const dom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>', { url });
  global.window = dom.window;
  global.document = dom.window.document;
  global.Event = dom.window.Event;
  stubScriptLoading();
  stubDialogs(dom.window);
  return () => {
    dom.window.close();
    Object.assign(global, shared);
  };
}

// JSDOM can't navigate: it reports each try as a console.error
function countNavigations(error) {
  return error.mock.calls.filter(({ arguments: [message] }) => /navigation/.test(message)).length;
}

describe('utils/ims', () => {
  let warn;
  let addEventListener;
  let timeouts;

  before(() => {
    // JSDOM only dispatches its own events
    global.Event = window.Event;
    stubDialogs(window);
  });

  beforeEach(() => {
    warn = mock.method(console, 'warn', () => {});
    timeouts = mock.method(global, 'setTimeout');
    // so afterEach can drop this case's window listeners
    addEventListener = mock.method(window, 'addEventListener');
  });

  afterEach(() => {
    addEventListener.mock.calls.forEach((call) => window.removeEventListener(...call.arguments));
    addEventListener.mock.restore();
    timeouts.mock.calls.forEach(({ result }) => clearTimeout(result));
    timeouts.mock.restore();
    warn.mock.restore();
    delete window.adobeid;
    delete window.adobeIMS;
    delete window.opener;
    window.sessionStorage.clear();
    document.querySelectorAll('dialog').forEach((dialog) => dialog.remove());
  });

  it('configures imslib for the tools client and loads it once', async () => {
    imslib();
    const { loadIms } = await importIms();
    const ready = loadIms();
    assert.equal(loadIms(), ready);
    await ready;
    await loadIms();

    assert.equal(loadScriptStub.mock.callCount(), 1);
    assert.deepEqual(
      loadScriptStub.mock.calls[0].arguments,
      ['https://auth.services.adobe.com/imslib/imslib.min.js'],
    );
    const {
      onReady, onError, onSignOutEventReceived, ...config
    } = window.adobeid;
    assert.deepEqual(config, {
      client_id: 'darkalley',
      scope: 'AdobeID,openid,additional_info.ownerOrg,read_organizations,aem.frontend.all',
      locale: 'en_US',
      environment: 'stg1',
      useLocalStorage: true,
      autoValidateToken: true,
      alwaysRemoveTokenFromUrl: true,
    });
  });

  it('resolves only once imslib calls onReady', async () => {
    loadScriptStub = mock.fn(async () => {});
    const { loadIms } = await importIms();
    let ready = false;
    const promise = loadIms().then(() => { ready = true; });
    await settle();
    assert.equal(ready, false);

    window.adobeid.onReady();
    await promise;
    assert.equal(ready, true);
  });

  it('treats onError as non-fatal when onReady follows', async () => {
    imslib({ errorFirst: true });
    const { loadIms, getImsToken, leaveToSignIn } = await importIms();
    await loadIms();
    assert.equal(warn.mock.callCount(), 1);
    assert.equal(getImsToken(), undefined);

    const error = mock.method(console, 'error', () => {});
    try {
      leaveToSignIn();
      assert.equal(window.sessionStorage.getItem('ims-sign-in-return'), 'http://localhost/');
      assert.equal(countNavigations(error), 1);
    } finally {
      error.mock.restore();
    }
  });

  it('rejects when imslib fails to load', async () => {
    loadScriptStub = mock.fn(async () => { throw new Error('load failed'); });
    const { loadIms, waitForIms } = await importIms();
    await assert.rejects(loadIms(), /IMS failed to load/);
    assert.equal(await waitForIms(), false);

    assert.equal(loadScriptStub.mock.callCount(), 1);
  });

  it('rejects when imslib is not ready within 5 seconds', async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      loadScriptStub = mock.fn(async () => {});
      const { loadIms } = await importIms();
      let settled = false;
      const promise = loadIms();
      promise.catch(() => {}).finally(() => { settled = true; });

      mock.timers.tick(4999);
      await settle();
      assert.equal(settled, false);

      mock.timers.tick(1);
      await assert.rejects(promise, /IMS timeout/);
    } finally {
      mock.timers.reset();
    }
  });

  it('reads the token live', async () => {
    const adobeIMS = imslib();
    const { getImsToken, waitForIms } = await importIms();
    assert.equal(await waitForIms(), true);
    assert.equal(getImsToken(), undefined);

    adobeIMS.token = 'token-1';
    assert.equal(getImsToken(), 'token-1');

    adobeIMS.token = null;
    assert.equal(getImsToken(), undefined);
  });

  it('reads the current profile and announces a local sign-out', async () => {
    const profile = { userId: 'alice@AdobeID', email: 'alice@example.com', displayName: 'Alice' };
    const adobeIMS = imslib({ token: 'token-1', profile });
    const { getImsProfile, signOut } = await importIms();
    assert.deepEqual(await getImsProfile(), profile);
    const signedOut = mock.fn();
    window.addEventListener('ims-signed-out', signedOut);
    adobeIMS.signOut.mock.mockImplementation(async () => { adobeIMS.token = null; });
    await signOut();
    assert.equal(adobeIMS.signOut.mock.callCount(), 1);
    assert.equal(signedOut.mock.callCount(), 1);
    assert.equal(await getImsProfile(), undefined);
  });

  it('propagates profile and sign-out errors to the account UI', async () => {
    imslib({ token: 'token-1', profile: new Error('profile failed') });
    const { getImsProfile, signOut } = await importIms();
    await assert.rejects(getImsProfile(), /profile failed/);
    window.adobeIMS.signOut.mock.mockImplementation(async () => { throw new Error('sign-out failed'); });
    await assert.rejects(signOut(), /sign-out failed/);
  });

  it('signs in in a new tab behind a dialog, and updates the page once the tab closes signed in', async () => {
    mock.timers.enable({ apis: ['setInterval'] });
    const tab = { closed: false, close: mock.fn(), focus: mock.fn() };
    const open = mock.method(window, 'open', () => tab);
    let updates = 0;
    const onSignedIn = () => { updates += 1; };
    window.addEventListener('ims-signed-in', onSignedIn);
    try {
      const adobeIMS = imslib();
      const { loadIms, signIn } = await importIms();
      await loadIms();
      const signedIn = signIn();
      assertSignInTab(open);
      const dialog = document.querySelector('dialog.ims-sign-in-dialog');
      assert.equal(dialog.open, true);
      assert.equal(dialog.querySelector('p').textContent, 'Finish signing in with Adobe in the new tab.');

      // another request shares the sign-in
      assert.equal(signIn(), signedIn);
      assert.equal(open.mock.callCount(), 1);
      assert.equal(tab.focus.mock.callCount(), 1);

      // the tab leaves the token in the shared localStorage, then closes
      adobeIMS.token = 'token-1';
      adobeIMS.expire = new Date(Date.now() + 24 * HOUR);
      mock.timers.tick(500);
      assert.equal(updates, 0);
      tab.closed = true;
      mock.timers.tick(500);
      assert.equal(await signedIn, true);
      assert.equal(updates, 1);
      assert.equal(dialog.isConnected, false);
    } finally {
      window.removeEventListener('ims-signed-in', onSignedIn);
      open.mock.restore();
      mock.timers.reset();
    }
  });

  it('first asks IMS without a page, and closes the tab at once if signed in to Adobe', async () => {
    document.body.innerHTML = '<p class="ims-sign-in-status"></p>';
    // the page that opened the tab (signIn)
    window.opener = {};
    const close = mock.method(window, 'close', () => {});
    try {
      const silent = imslib();
      await runSignInPage();
      assert.deepEqual(silent.signIn.mock.calls[0].arguments, [{ prompt: 'none' }]);
      assert.equal(close.mock.callCount(), 0);

      // back from IMS with a token
      const back = imslib({ token: 'token-1', expire: new Date(Date.now() + 24 * HOUR) });
      await runSignInPage();
      assert.equal(back.signIn.mock.callCount(), 0);
      assert.equal(close.mock.callCount(), 1);
    } finally {
      close.mock.restore();
    }
  });

  it('shows the sign-in form if not signed in to Adobe, then closes the tab', async () => {
    document.body.innerHTML = '<p class="ims-sign-in-status"></p>';
    window.opener = {};
    const close = mock.method(window, 'close', () => {});
    try {
      imslib();
      await runSignInPage();

      // back from IMS without a token (login_required)
      const form = imslib();
      await runSignInPage();
      assert.deepEqual(form.signIn.mock.calls[0].arguments, []);
      assert.equal(close.mock.callCount(), 0);

      imslib({ token: 'token-1', expire: new Date(Date.now() + 24 * HOUR) });
      await runSignInPage();
      assert.equal(close.mock.callCount(), 1);
    } finally {
      close.mock.restore();
    }
  });

  it('announces token expiry without mounting the profile UI', async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const adobeIMS = imslib({
        token: 'token-1',
        expire: new Date(Date.now() + 2000),
        profile: { email: 'alice@example.com' },
      });
      const { loadIms } = await importIms();
      await loadIms();
      const signedOut = mock.fn();
      window.addEventListener('ims-signed-out', signedOut);

      // imslib no longer returns a token once it has expired
      adobeIMS.token = null;
      mock.timers.tick(3000);
      await settle();
      assert.equal(signedOut.mock.callCount(), 1);
    } finally {
      mock.timers.reset();
    }
  });

  it('reschedules expiry when another tab replaces the token', async () => {
    mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    try {
      const adobeIMS = imslib({ token: 'token-1', expire: new Date(Date.now() + 2000) });
      const { loadIms } = await importIms();
      await loadIms();
      const signedOut = mock.fn();
      window.addEventListener('ims-signed-out', signedOut);

      adobeIMS.token = 'token-2';
      adobeIMS.expire = new Date(Date.now() + HOUR);
      window.dispatchEvent(new window.StorageEvent('storage', { newValue: 'token-2' }));
      mock.timers.tick(3000);
      assert.equal(signedOut.mock.callCount(), 0);

      adobeIMS.token = null;
      mock.timers.tick(HOUR);
      assert.equal(signedOut.mock.callCount(), 1);
    } finally {
      mock.timers.reset();
    }
  });

  it('asks for a click in the dialog when the click that started the sign-in has expired', async () => {
    Object.defineProperty(window.navigator, 'userActivation', {
      value: { isActive: false },
      configurable: true,
    });
    mock.timers.enable({ apis: ['setInterval'] });
    const tab = { closed: false, close: mock.fn() };
    const open = mock.method(window, 'open', () => tab);
    try {
      const adobeIMS = imslib();
      const { loadIms, signIn } = await importIms();
      await loadIms();
      const signedIn = signIn();
      assert.equal(open.mock.callCount(), 0);
      const dialog = document.querySelector('dialog.ims-sign-in-dialog');
      assert.equal(dialog.querySelector('p').textContent, 'Sign in with Adobe to continue.');

      // the button's click lets the browser open the tab
      dialog.querySelector('button').click();
      assertSignInTab(open);
      assert.equal(dialog.querySelector('p').textContent, 'Finish signing in with Adobe in the new tab.');

      adobeIMS.token = 'token-1';
      adobeIMS.expire = new Date(Date.now() + 24 * HOUR);
      tab.closed = true;
      mock.timers.tick(500);
      assert.equal(await signedIn, true);
    } finally {
      open.mock.restore();
      mock.timers.reset();
      delete window.navigator.userActivation;
    }
  });

  it('offers another try when the browser blocks the tab, and closes the tab on Cancel', async () => {
    mock.timers.enable({ apis: ['setInterval'] });
    const tab = { closed: false, close: mock.fn() };
    const open = mock.method(window, 'open', () => null);
    try {
      imslib();
      const { loadIms, signIn } = await importIms();
      await loadIms();
      const signedIn = signIn();
      const dialog = document.querySelector('dialog.ims-sign-in-dialog');
      assert.match(dialog.querySelector('p').textContent, /^Your browser blocked the Adobe sign-in tab/);

      open.mock.mockImplementation(() => tab);
      dialog.querySelector('button').click();
      assert.equal(open.mock.callCount(), 2);

      const [cancel] = dialog.querySelectorAll('button');
      assert.equal(cancel.textContent, 'Cancel');
      cancel.click();
      assert.equal(await signedIn, false);
      assert.equal(tab.close.mock.callCount(), 1);
      assert.equal(dialog.isConnected, false);

      // the next sign-in starts over
      signIn();
      assert.equal(open.mock.callCount(), 3);
    } finally {
      open.mock.restore();
      mock.timers.reset();
    }
  });

  it('stops waiting for the sign-in tab once its token arrives, even if the tab stays open', async () => {
    mock.timers.enable({ apis: ['setInterval'] });
    const tab = { closed: false, close: mock.fn() };
    const open = mock.method(window, 'open', () => tab);
    try {
      const adobeIMS = imslib();
      const { loadIms, signIn } = await importIms();
      await loadIms();
      const signedIn = signIn();

      // the tab stores its token in the shared localStorage, but can't close itself
      adobeIMS.token = 'token-1';
      adobeIMS.expire = new Date(Date.now() + 24 * HOUR);
      window.dispatchEvent(new window.StorageEvent('storage', { newValue: 'token-1' }));
      assert.equal(await signedIn, true);
      assert.equal(tab.close.mock.callCount(), 1);
      assert.equal(document.querySelector('dialog.ims-sign-in-dialog'), null);
    } finally {
      open.mock.restore();
      mock.timers.reset();
    }
  });

  it('follows a sign-in in another tab', async () => {
    const adobeIMS = imslib({ profile: { email: 'alice@example.com' } });
    const { loadIms, getImsProfile } = await importIms();
    await loadIms();
    const events = [];
    const record = ({ type }) => events.push(type);
    window.addEventListener('ims-signed-in', record);
    window.addEventListener('ims-signed-out', record);

    // another tab stores its token in the shared localStorage
    adobeIMS.token = 'token-1';
    window.dispatchEvent(new window.StorageEvent('storage', { newValue: 'token-1' }));
    await settle();
    assert.deepEqual(events, ['ims-signed-in']);
    assert.equal((await getImsProfile()).email, 'alice@example.com');

    // other writes change nothing
    window.dispatchEvent(new window.StorageEvent('storage', { newValue: 'other' }));
    await settle();
    assert.deepEqual(events, ['ims-signed-in']);
  });

  it('stays signed out when another tab signs out while the profile loads', async () => {
    let resolveProfile;
    const adobeIMS = imslib({
      token: 'token-1',
      profile: new Promise((resolve) => { resolveProfile = resolve; }),
    });
    const { getImsProfile } = await importIms();
    const pending = getImsProfile();
    await settle();

    // imslib removes the token, then reports the other tab's sign-out
    adobeIMS.token = null;
    window.adobeid.onSignOutEventReceived();
    await settle();
    assert.equal(await getImsProfile(), undefined);

    resolveProfile({ email: 'alice@example.com' });
    assert.equal(await pending, undefined);
  });

  it('discards a late profile from a previous account', async () => {
    let resolveProfile;
    const adobeIMS = imslib({
      token: 'token-1',
      profile: new Promise((resolve) => { resolveProfile = resolve; }),
    });
    const { getImsProfile } = await importIms();
    const pending = getImsProfile();
    await settle();
    adobeIMS.token = 'token-2';
    const currentProfile = { userId: 'bob@AdobeID', displayName: 'Bob' };
    adobeIMS.getProfile = async () => currentProfile;
    window.dispatchEvent(new window.StorageEvent('storage', { newValue: 'token-2' }));
    assert.deepEqual(await getImsProfile(), currentProfile);
    resolveProfile({ userId: 'alice@AdobeID', displayName: 'Alice' });
    assert.equal(await pending, undefined);
    assert.deepEqual(await getImsProfile(), currentProfile);
  });

  describe('ensureSignedIn', () => {
    let open;

    beforeEach(() => {
      mock.timers.enable({ apis: ['setInterval'] });
      open = mock.method(window, 'open', () => ({ closed: false, close: () => {} }));
    });

    afterEach(() => {
      open.mock.restore();
      mock.timers.reset();
    });

    async function cancelSignIn() {
      await settle();
      document.querySelector('dialog.ims-sign-in-dialog button').click();
    }

    it('opens no sign-in with a fresh token', async () => {
      imslib({ token: 'token-1', expire: new Date(Date.now() + 24 * HOUR) });
      assert.equal(await (await importIms()).ensureSignedIn(), true);
      assert.equal(open.mock.callCount(), 0);
    });

    it('opens the sign-in when the token expires soon, keeping it if cancelled', async () => {
      imslib({ token: 'token-1', expire: new Date(Date.now() + HOUR / 2) });
      const signedIn = (await importIms()).ensureSignedIn();
      await cancelSignIn();
      assert.equal(await signedIn, true);
      assert.equal(open.mock.callCount(), 1);
    });

    it('is not signed in without a token when the sign-in is cancelled', async () => {
      imslib();
      const signedIn = (await importIms()).ensureSignedIn();
      await cancelSignIn();
      assert.equal(await signedIn, false);
    });

    it('opens no sign-in when imslib is unavailable', async () => {
      loadScriptStub = mock.fn(async () => { throw new Error('load failed'); });
      assert.equal(await (await importIms()).ensureSignedIn(), false);
      assert.equal(open.mock.callCount(), 0);
    });
  });

  describe('signing in on page load', () => {
    const TOOL = 'http://localhost:3000/tools/sitemap-admin/index.html?org=adobe&site=docs#top';
    let error;

    beforeEach(() => {
      error = mock.method(console, 'error', () => {});
    });

    afterEach(() => {
      error.mock.restore();
    });

    it('leaves for the sign-in page in this tab without a token, which comes back once signed in', async () => {
      const restore = openPage(TOOL);
      try {
        imslib();
        const { requireSignIn } = await importIms();
        let done = false;
        requireSignIn().then(() => { done = true; });
        await settle();
        assert.equal(countNavigations(error), 1);
        assert.equal(window.sessionStorage.getItem('ims-sign-in-return'), TOOL);
        assert.equal(done, false);

        // the sign-in page, in the same tab, back from IMS with a token
        window.history.replaceState(null, '', '/utils/ims-sign-in.html');
        document.body.innerHTML = '<main><p class="ims-sign-in-status"></p></main>';
        const close = mock.method(window, 'close', () => {});
        imslib({ token: 'token-1', expire: new Date(Date.now() + 24 * HOUR) });
        await runSignInPage();
        assert.equal(countNavigations(error), 2);
        assert.equal(close.mock.callCount(), 0);
        assert.equal(window.sessionStorage.getItem('ims-sign-in-return'), null);
      } finally {
        restore();
      }
    });

    it('also leaves with a token that expires within the hour, and stays with a fresh one', async () => {
      const restore = openPage(TOOL);
      try {
        imslib({ token: 'token-1', expire: new Date(Date.now() + HOUR - 1000) });
        (await importIms()).requireSignIn();
        await settle();
        assert.equal(countNavigations(error), 1);

        imslib({ token: 'token-2', expire: new Date(Date.now() + 24 * HOUR) });
        await (await importIms()).requireSignIn();
        assert.equal(countNavigations(error), 1);
        assert.equal(window.sessionStorage.getItem('ims-sign-in-left'), null);
      } finally {
        restore();
      }
    });

    it('opens no sign-in dialog while the page leaves to sign in', async () => {
      const restore = openPage(TOOL);
      try {
        imslib();
        let done = false;
        (await importIms()).ensureSignedIn().then(() => { done = true; });
        await settle();
        assert.equal(countNavigations(error), 1);
        assert.equal(done, false);
        assert.equal(document.querySelector('dialog'), null);
      } finally {
        restore();
      }
    });

    [
      ['on a host not registered for the client', {
        url: 'https://main--helix-tools-website--adobe.aem.page/tools/sitemap-admin/index.html',
      }],
      ['in a frame', { setup: () => { window.self = {}; } }],
      ['without imslib', {
        setup: () => { loadScriptStub = mock.fn(async () => { throw new Error('load failed'); }); },
      }],
      ['after "Continue without signing in"', {
        setup: () => window.sessionStorage.setItem('ims-sign-in-skipped', 'true'),
      }],
      ['less than a minute after leaving to sign in', {
        setup: () => window.sessionStorage.setItem('ims-sign-in-left', String(Date.now() - 1000)),
      }],
    ].forEach(([when, { url = TOOL, setup = () => {} }]) => {
      it(`goes on without a token ${when}`, async () => {
        const restore = openPage(url);
        try {
          imslib();
          setup();
          await (await importIms()).requireSignIn();
          assert.equal(countNavigations(error), 0);
        } finally {
          restore();
        }
      });
    });

    it('leaves again a minute after leaving to sign in', async () => {
      const restore = openPage(TOOL);
      try {
        imslib();
        window.sessionStorage.setItem('ims-sign-in-left', String(Date.now() - 61 * 1000));
        (await importIms()).requireSignIn();
        await settle();
        assert.equal(countNavigations(error), 1);
      } finally {
        restore();
      }
    });

    it('closes the tab instead of going to a return URL on another origin', async () => {
      document.body.innerHTML = '<main><p class="ims-sign-in-status"></p></main>';
      window.opener = {};
      const close = mock.method(window, 'close', () => {});
      try {
        window.sessionStorage.setItem('ims-sign-in-return', 'https://example.com/');
        imslib({ token: 'token-1', expire: new Date(Date.now() + 24 * HOUR) });
        await runSignInPage();
        // eslint-disable-next-line no-script-url
        window.sessionStorage.setItem('ims-sign-in-return', 'javascript:alert(1)');
        await runSignInPage();
        assert.equal(close.mock.callCount(), 2);
        assert.equal(countNavigations(error), 0);
      } finally {
        close.mock.restore();
      }
    });

    it('offers to try again or to go back without signing in when the sign-in stops', async () => {
      document.body.innerHTML = '<main><p class="ims-sign-in-status"></p></main>';
      window.sessionStorage.setItem('ims-sign-in-return', 'http://localhost/tools/sitemap-admin/index.html');
      // back from the IMS form without a token
      window.sessionStorage.setItem('ims-sign-in-stage', 'form');
      imslib();
      await runSignInPage();
      // a second run (Back) doesn't add the buttons twice
      window.sessionStorage.setItem('ims-sign-in-stage', 'form');
      await runSignInPage();
      assert.equal(document.querySelector('.ims-sign-in-status').textContent, 'The Adobe sign-in did not complete.');
      const buttons = [...document.querySelectorAll('main button')];
      assert.deepEqual(buttons.map((button) => button.textContent), ['Try again', 'Continue without signing in']);

      buttons[1].click();
      assert.equal(window.sessionStorage.getItem('ims-sign-in-skipped'), 'true');
      assert.equal(window.sessionStorage.getItem('ims-sign-in-return'), null);
      assert.equal(countNavigations(error), 1);
    });

    it('opens the sign-in tab without the return URL or the stage it would copy', async () => {
      mock.timers.enable({ apis: ['setInterval'] });
      let copied;
      const open = mock.method(window, 'open', () => {
        copied = ['ims-sign-in-return', 'ims-sign-in-stage'].map((key) => window.sessionStorage.getItem(key));
        return { closed: false, close: () => {} };
      });
      try {
        window.sessionStorage.setItem('ims-sign-in-return', 'http://localhost/tools/sitemap-admin/index.html');
        window.sessionStorage.setItem('ims-sign-in-stage', 'form');
        imslib();
        const { loadIms, signIn } = await importIms();
        await loadIms();
        const signedIn = signIn();
        assert.deepEqual(copied, [null, null]);

        document.querySelector('dialog.ims-sign-in-dialog button').click();
        assert.equal(await signedIn, false);
      } finally {
        open.mock.restore();
        mock.timers.reset();
      }
    });

    it('goes to the tools home page once signed in, with neither a page to go back to nor one that opened it', async () => {
      const restore = openPage('http://localhost:3000/utils/ims-sign-in.html');
      try {
        document.body.innerHTML = '<main><p class="ims-sign-in-status"></p></main>';
        const close = mock.method(window, 'close', () => {});
        imslib({ token: 'token-1', expire: new Date(Date.now() + 24 * HOUR) });
        await runSignInPage();
        assert.equal(close.mock.callCount(), 0);
        assert.equal(countNavigations(error), 1);
      } finally {
        restore();
      }
    });

    it('covers a signed-in page once another tab signs out, until a sign-in in this tab or any other', async () => {
      const restore = openPage(TOOL);
      try {
        const adobeIMS = imslib({ token: 'token-1', expire: new Date(Date.now() + 24 * HOUR) });
        await (await importIms()).requireSignIn();

        // imslib removes the token, then reports the other tab's sign-out
        adobeIMS.token = null;
        window.adobeid.onSignOutEventReceived();
        const dialog = document.querySelector('dialog.ims-sign-in-dialog');
        assert.equal(dialog.open, true);
        assert.equal(dialog.querySelector('p').textContent, 'You signed out in another tab. Sign in again to continue.');
        // Esc doesn't close it
        assert.equal(dialog.dispatchEvent(new Event('cancel', { cancelable: true })), false);

        // its button signs in in this tab
        dialog.querySelector('button').click();
        assert.equal(window.sessionStorage.getItem('ims-sign-in-return'), TOOL);
        assert.equal(countNavigations(error), 1);

        // a sign-in in another tab reloads the page, for that account
        adobeIMS.token = 'token-2';
        window.dispatchEvent(new window.StorageEvent('storage', { newValue: 'token-2' }));
        assert.equal(countNavigations(error), 2);
      } finally {
        restore();
      }
    });

    [
      ['after "Continue without signing in"', TOOL, undefined, () => window.sessionStorage.setItem('ims-sign-in-skipped', 'true')],
      ['on a host that does not sign in on load', 'https://main--helix-tools-website--adobe.aem.page/tools/sitemap-admin/index.html', 'token-1', () => {}],
    ].forEach(([where, url, token, setup]) => {
      it(`leaves a page as it is ${where} when another tab signs out`, async () => {
        const restore = openPage(url);
        try {
          const adobeIMS = imslib({ token, expire: new Date(Date.now() + 24 * HOUR) });
          setup();
          const { loadIms, requireSignIn } = await importIms();
          await requireSignIn();
          await loadIms();
          adobeIMS.token = null;
          window.adobeid.onSignOutEventReceived();
          assert.equal(document.querySelector('dialog'), null);
        } finally {
          restore();
        }
      });
    });
  });
});
