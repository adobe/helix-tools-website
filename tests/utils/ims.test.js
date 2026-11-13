/* eslint-env node */
import {
  describe, it, beforeEach, afterEach, mock,
} from 'node:test';
import assert from 'node:assert/strict';

let loadScriptStub;
mock.module('../../scripts/aem.js', {
  namedExports: { loadScript: (...args) => loadScriptStub(...args) },
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
function imslib({ token, profile, errorFirst = false } = {}) {
  const adobeIMS = {
    token,
    getAccessToken: () => (adobeIMS.token ? { token: adobeIMS.token } : null),
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

describe('utils/ims', () => {
  let warn;

  beforeEach(() => {
    warn = mock.method(console, 'warn', () => {});
  });

  afterEach(() => {
    warn.mock.restore();
    delete window.adobeid;
    delete window.adobeIMS;
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
      scope: 'AdobeID,openid,additional_info.ownerOrg',
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
    const adobeIMS = imslib({ errorFirst: true });
    const { loadIms, isSignedIn, createImsLogin } = await importIms();
    await loadIms();
    assert.equal(warn.mock.callCount(), 1);
    assert.equal(await isSignedIn(), false);

    const login = createImsLogin();
    await settle();
    const button = login.querySelector('button.button');
    assert.equal(button.textContent, 'Sign in with Adobe');
    button.click();
    assert.equal(adobeIMS.signIn.mock.callCount(), 1);
  });

  it('rejects when imslib fails to load', async () => {
    loadScriptStub = mock.fn(async () => { throw new Error('load failed'); });
    const { loadIms, isSignedIn, createImsLogin } = await importIms();
    await assert.rejects(loadIms(), /load failed/);
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
});
