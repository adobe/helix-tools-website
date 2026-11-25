/* eslint-env node */
import {
  describe, it, beforeEach, mock,
} from 'node:test';
import assert from 'node:assert/strict';

// Mock the collaborators before importing the helper. This is one of the rare
// places where mocking is the right call (see TESTING.md): the helper's only job
// IS to orchestrate imslib and updateConfig into a result, so the seam under
// test is the contract with those collaborators.
let updateConfigCalls;
let imsToken;
let imsTokenFresh;
let loadImsStub;
let signInCalls;
let signInResult;
let signInStub;
mock.module('../../utils/config/config.js', {
  namedExports: { updateConfig: () => { updateConfigCalls += 1; } },
});
mock.module('../../utils/ims.js', {
  namedExports: {
    getImsToken: () => imsToken,
    isImsTokenFresh: () => imsTokenFresh,
    loadIms: () => loadImsStub(),
    signIn: () => signInStub(),
  },
});
const {
  executeAdminRequest, ensureAdminLogin, isAdminSignedIn, AuthMode,
} = await import('../../utils/admin-request.js');

const settle = () => new Promise((resolve) => { setImmediate(resolve); });

// answers with the given statuses in turn, repeating the last one
function requestFnReturning(...statuses) {
  const fn = async () => {
    const status = statuses[Math.min(fn.calls, statuses.length - 1)];
    fn.calls += 1;
    return { status, ok: status >= 200 && status < 300 };
  };
  fn.calls = 0;
  return fn;
}

beforeEach(() => {
  updateConfigCalls = 0;
  imsToken = undefined;
  imsTokenFresh = false;
  loadImsStub = async () => {};
  signInCalls = 0;
  signInResult = false;
  signInStub = async () => {
    signInCalls += 1;
    return signInResult;
  };
});

describe('ensureAdminLogin', () => {
  it('is signed in with a fresh IMS token', async () => {
    imsToken = 'ims-token';
    imsTokenFresh = true;
    assert.equal(await ensureAdminLogin(), true);
    assert.equal(signInCalls, 0);
  });

  it('opens the sign-in when the IMS token expires soon, keeping it if the user closes the tab', async () => {
    imsToken = 'ims-token';
    assert.equal(await ensureAdminLogin(), true);
    assert.equal(signInCalls, 1);
  });

  it('signs in with Adobe without a token', async () => {
    assert.equal(await ensureAdminLogin(), false);
    signInResult = true;
    assert.equal(await ensureAdminLogin(), true);
    assert.equal(signInCalls, 2);
  });

  it('does not sign in when imslib is unavailable', async () => {
    loadImsStub = async () => { throw new Error('IMS timeout'); };
    assert.equal(await ensureAdminLogin(), false);
    assert.equal(signInCalls, 0);
  });
});

describe('isAdminSignedIn', () => {
  it('is true only with a fresh IMS token, and never signs in', async () => {
    imsToken = 'ims-token';
    imsTokenFresh = true;
    assert.equal(await isAdminSignedIn(), true);

    // a token that expires soon would need a sign-in
    imsTokenFresh = false;
    assert.equal(await isAdminSignedIn(), false);

    loadImsStub = async () => { throw new Error('IMS timeout'); };
    assert.equal(await isAdminSignedIn(), false);
    assert.equal(signInCalls, 0);
  });
});

describe('executeAdminRequest', () => {
  it('waits for imslib, then sends the request once', async () => {
    let imsReady;
    loadImsStub = () => new Promise((resolve) => { imsReady = resolve; });
    imsToken = 'ims-token';
    const requestFn = requestFnReturning(200);
    const promise = executeAdminRequest(requestFn, { org: 'adobe', site: 'x' });
    await settle();
    assert.equal(requestFn.calls, 0);

    imsReady();
    const result = await promise;
    assert.equal(result.status, 200);
    assert.equal(requestFn.calls, 1);
    assert.equal(updateConfigCalls, 1);
  });

  describe('bound-client overload', () => {
    [
      {
        name: 'preflights and retries with the third-argument policy',
        options: { policy: AuthMode.PREFLIGHT_AND_RETRY },
        statuses: [401, 200],
        events: [['signIn'], ['request', 401], ['signIn'], ['request', 200]],
      },
      {
        name: 'signs in on a 401 with an explicit 401-retry policy',
        options: { policy: AuthMode.RETRY_ON_401 },
        statuses: [401, 200],
        events: [['request', 401], ['signIn'], ['request', 200]],
      },
      {
        name: 'defaults to 401 retry when the third argument is omitted',
        options: undefined,
        statuses: [401, 200],
        events: [['request', 401], ['signIn'], ['request', 200]],
      },
      {
        name: 'honors the none policy without sign-in or retry',
        options: { policy: AuthMode.NONE },
        statuses: [401],
        events: [['request', 401]],
      },
    ].forEach(({
      name, options, statuses, events: expectedEvents,
    }) => {
      it(name, async () => {
        const client = Object.freeze({
          coords: Object.freeze({ org: 'bound-org', site: 'bound-site', ref: 'main' }),
        });
        const events = [];
        signInStub = async () => {
          events.push(['signIn']);
          return true;
        };
        const responses = statuses.map((status) => ({ status, ok: status === 200 }));
        let attempt = 0;
        const requestFn = async () => {
          const response = responses[Math.min(attempt, responses.length - 1)];
          attempt += 1;
          events.push(['request', response.status]);
          return response;
        };

        const result = await executeAdminRequest(requestFn, client, options);

        assert.deepEqual(events, expectedEvents);
        assert.equal(result, responses[responses.length - 1]);
        assert.equal(updateConfigCalls, result.ok ? 1 : 0);
      });
    });
  });

  it('signs in on a 401 sent without an IMS token, then sends the request again', async () => {
    signInResult = true;
    const requestFn = requestFnReturning(401, 200);
    const result = await executeAdminRequest(requestFn, { org: 'adobe' });
    assert.equal(result.status, 200);
    assert.equal(requestFn.calls, 2);
    assert.equal(signInCalls, 1);
    assert.equal(updateConfigCalls, 1);
  });

  it('returns null if the user does not complete the sign-in', async () => {
    const requestFn = requestFnReturning(401);
    const result = await executeAdminRequest(requestFn, { org: 'adobe' });
    assert.equal(result, null);
    assert.equal(requestFn.calls, 1);
    assert.equal(signInCalls, 1);
  });

  it('returns a 401 sent with an IMS token without signing in', async () => {
    imsToken = 'ims-token';
    const result = await executeAdminRequest(requestFnReturning(401), { org: 'adobe' });
    assert.equal(result.status, 401);
    assert.equal(signInCalls, 0);
  });

  it('never signs in with policy none', async () => {
    const result = await executeAdminRequest(requestFnReturning(401), {
      org: 'adobe', policy: AuthMode.NONE,
    });
    assert.equal(result.status, 401);
    assert.equal(signInCalls, 0);
  });

  it('returns the 401 without signing in when imslib is unavailable', async () => {
    loadImsStub = async () => { throw new Error('IMS timeout'); };
    const result = await executeAdminRequest(requestFnReturning(401), { org: 'adobe' });
    assert.equal(result.status, 401);
    assert.equal(signInCalls, 0);
  });

  it('does not update the config on non-2xx responses', async () => {
    imsToken = 'ims-token';
    await executeAdminRequest(requestFnReturning(404), { org: 'adobe' });
    assert.equal(updateConfigCalls, 0);
  });

  describe('policy: preflightAndRetry', () => {
    it('skips the request when the user does not complete the sign-in', async () => {
      const requestFn = requestFnReturning(200);
      const result = await executeAdminRequest(requestFn, {
        org: 'adobe', policy: AuthMode.PREFLIGHT_AND_RETRY,
      });
      assert.equal(result, null);
      assert.equal(requestFn.calls, 0);
      assert.equal(signInCalls, 1);
    });
  });
});
