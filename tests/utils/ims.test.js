/* eslint-env node */
import {
  describe, it, before, beforeEach, afterEach, mock,
} from 'node:test';
import assert from 'node:assert/strict';

let loadScriptStub;
// imslib loads through a script element: hand its URL to the stub, which fails it by throwing
mock.method(document.head, 'append', (script) => {
  loadScriptStub(script.src).catch(() => script.onerror());
});

// a fresh module instance per case, so the memoized IMS promise is not shared
let instance = 0;
function importIms() {
  instance += 1;
  return import(`../../utils/ims.js?instance=${instance}`);
}

// flushes pending promise callbacks
const settle = () => new Promise((resolve) => { setImmediate(resolve); });

// simulates imslib: installs window.adobeIMS, then calls the adobeid callbacks
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

// checks that window.open showed the sign-in page in a new tab
function assertSignInTab(open) {
  assert.deepEqual(open.mock.calls[0].arguments, ['/utils/ims-sign-in.html', '_blank']);
}

// loads the sign-in page in a fresh module instance, as each step at Adobe reloads it
async function runSignInPage() {
  return (await importIms()).runSignInPage();
}

describe('utils/ims', () => {
  let warn;

  before(() => {
    // JSDOM only dispatches its own events
    global.Event = window.Event;
  });

  beforeEach(() => {
    warn = mock.method(console, 'warn', () => {});
  });

  afterEach(() => {
    warn.mock.restore();
    delete window.adobeid;
    delete window.adobeIMS;
    window.sessionStorage.clear();
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
    const { onReady, onError, ...config } = window.adobeid;
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
    const { loadIms, isSignedIn, createImsLogin } = await importIms();
    await loadIms();
    assert.equal(warn.mock.callCount(), 1);
    assert.equal(await isSignedIn(), false);

    mock.timers.enable({ apis: ['setInterval'] });
    const open = mock.method(window, 'open', () => ({ closed: false }));
    try {
      const login = createImsLogin();
      await settle();
      const button = login.querySelector('button.button');
      assert.equal(button.textContent, 'Sign in with Adobe');
      button.click();
      assertSignInTab(open);
    } finally {
      open.mock.restore();
      mock.timers.reset();
    }
  });

  it('rejects when imslib fails to load', async () => {
    loadScriptStub = mock.fn(async () => { throw new Error('load failed'); });
    const { loadIms, isSignedIn, createImsLogin } = await importIms();
    await assert.rejects(loadIms(), /IMS failed to load/);
    assert.equal(await isSignedIn(), false);

    const login = createImsLogin();
    await settle();
    assert.equal(login.textContent, 'Adobe sign-in is unavailable. Reload the page to try again.');
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
    const { getImsToken, isSignedIn } = await importIms();
    assert.equal(getImsToken(), undefined);
    assert.equal(await isSignedIn(), false);

    adobeIMS.token = 'token-1';
    assert.equal(getImsToken(), 'token-1');
    assert.equal(await isSignedIn(), true);

    adobeIMS.token = null;
    assert.equal(getImsToken(), undefined);
    assert.equal(await isSignedIn(), false);
  });

  it('shows the signed-in user with a sign-out button', async () => {
    const adobeIMS = imslib({ token: 'token-1', profile: { email: 'alice@example.com', displayName: 'Alice' } });
    const { createImsLogin } = await importIms();
    const login = createImsLogin();
    assert.equal(login.className, 'ims-login');
    assert.equal(login.textContent, 'Checking Adobe sign-in…');

    await settle();
    assert.equal(login.querySelector('span').textContent, 'Signed in as alice@example.com');
    const button = login.querySelector('button.button');
    assert.equal(button.textContent, 'Sign out');
    button.click();
    assert.equal(adobeIMS.signOut.mock.callCount(), 1);
  });

  it('falls back to a generic signed-in text if the profile cannot be read', async () => {
    imslib({ token: 'token-1', profile: new Error('profile failed') });
    const { createImsLogin } = await importIms();
    const login = createImsLogin();
    await settle();
    assert.equal(login.querySelector('span').textContent, 'Signed in with Adobe');
  });

  it('signs in in a new tab, and updates the page once the tab closes signed in', async () => {
    // setTimeout too: the event redraws the sign-in of earlier cases, which waits for expiry
    mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
    const tab = { closed: false };
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

      // the tab leaves the token in the shared localStorage, then closes
      adobeIMS.token = 'token-1';
      adobeIMS.expire = new Date(Date.now() + 24 * HOUR);
      mock.timers.tick(500);
      assert.equal(updates, 0);
      tab.closed = true;
      mock.timers.tick(500);
      assert.equal(await signedIn, true);
      assert.equal(updates, 1);
    } finally {
      window.removeEventListener('ims-signed-in', onSignedIn);
      open.mock.restore();
      mock.timers.reset();
    }
  });

  it('first asks IMS without a page, and closes the tab at once if signed in to Adobe', async () => {
    document.body.innerHTML = '<p class="ims-sign-in-status"></p>';
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

  it('shows the sign-in button again once the token expires', async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const adobeIMS = imslib({
        token: 'token-1',
        expire: new Date(Date.now() + 2000),
        profile: { email: 'alice@example.com' },
      });
      const { createImsLogin } = await importIms();
      const login = createImsLogin();
      await settle();
      assert.equal(login.querySelector('button').textContent, 'Sign out');

      // imslib no longer returns a token once it has expired
      adobeIMS.token = null;
      mock.timers.tick(3000);
      await settle();
      assert.equal(login.querySelector('button').textContent, 'Sign in with Adobe');
    } finally {
      mock.timers.reset();
    }
  });
});
