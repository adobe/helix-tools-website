/* eslint-env node */
import {
  describe, it, beforeEach, mock,
} from 'node:test';
import assert from 'node:assert/strict';

// Mocking is the right call here (see TESTING.md): orchestrating imslib and
// updateConfig is this helper's contract.
let updateConfigCalls;
let imsToken;
let waitForImsStub;
let ensureSignedInCalls;
let ensureSignedInResult;
let ensureSignedInStub;
let signInCalls;
let signInResult;
let signInStub;
mock.module('../../utils/config/config.js', {
  exports: { updateConfig: () => { updateConfigCalls += 1; } },
});
mock.module('../../utils/ims.js', {
  exports: {
    ensureSignedIn: () => ensureSignedInStub(),
    getImsToken: () => imsToken,
    signIn: () => signInStub(),
    waitForIms: () => waitForImsStub(),
  },
});
const { executeAdminRequest, AuthMode } = await import('../../utils/admin-request.js');

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
  waitForImsStub = async () => true;
  ensureSignedInCalls = 0;
  ensureSignedInResult = true;
  ensureSignedInStub = async () => {
    ensureSignedInCalls += 1;
    return ensureSignedInResult;
  };
  signInCalls = 0;
  signInResult = false;
  signInStub = async () => {
    signInCalls += 1;
    return signInResult;
  };
});

describe('executeAdminRequest', () => {
  it('waits for imslib, then sends the request once', async () => {
    let imsReady;
    waitForImsStub = () => new Promise((resolve) => { imsReady = () => resolve(true); });
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

  it('sends nothing and opens no sign-in while the page leaves to sign in', async () => {
    // neither settles once the page leaves for the sign-in page
    waitForImsStub = () => new Promise(() => {});
    ensureSignedInStub = () => new Promise(() => {});
    const requestFn = requestFnReturning(401);
    executeAdminRequest(requestFn, { org: 'adobe', site: 'x' });
    executeAdminRequest(requestFn, {
      org: 'adobe', site: 'x', policy: AuthMode.PREFLIGHT_AND_RETRY,
    });
    await settle();
    assert.equal(requestFn.calls, 0);
    assert.equal(signInCalls, 0);
  });

  describe('bound-client overload', () => {
    [
      {
        name: 'preflights and retries with the third-argument policy',
        options: { policy: AuthMode.PREFLIGHT_AND_RETRY },
        statuses: [401, 200],
        events: [['ensureSignedIn'], ['request', 401], ['signIn'], ['request', 200]],
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
        ensureSignedInStub = async () => {
          events.push(['ensureSignedIn']);
          return true;
        };
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
    waitForImsStub = async () => false;
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
      ensureSignedInResult = false;
      const requestFn = requestFnReturning(200);
      const result = await executeAdminRequest(requestFn, {
        org: 'adobe', policy: AuthMode.PREFLIGHT_AND_RETRY,
      });
      assert.equal(result, null);
      assert.equal(requestFn.calls, 0);
      assert.equal(ensureSignedInCalls, 1);
    });
  });
});
