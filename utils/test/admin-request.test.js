/* eslint-env node */
import {
  describe, it, before, beforeEach, mock,
} from 'node:test';
import assert from 'node:assert/strict';

// Mock the profile and config modules before importing the helper. This is
// one of the rare places where mocking is the right call (see TESTING.md):
// the helper's only job IS to orchestrate ensureLogin + window events +
// updateConfig into a result, so the seam under test is the contract with
// those collaborators.
let ensureLoginStub;
let updateConfigCalls;
mock.module('../../blocks/profile/profile.js', {
  namedExports: { ensureLogin: (...args) => ensureLoginStub(...args) },
});
mock.module('../config/config.js', {
  namedExports: { updateConfig: () => { updateConfigCalls += 1; } },
});

const { executeAdminRequest, AuthMode } = await import('../admin-request.js');

// Minimal `window` shim — just enough for addEventListener/removeEventListener
// and dispatchEvent. Not a DOM, just an EventTarget under a `window` name.
function setupWindow() {
  const target = new EventTarget();
  global.window = {
    addEventListener: (...a) => target.addEventListener(...a),
    removeEventListener: (...a) => target.removeEventListener(...a),
    dispatchEvent: (...a) => target.dispatchEvent(...a),
  };
}

function dispatchProfile(event, detail) {
  global.window.dispatchEvent(new CustomEvent(`profile-${event}`, { detail }));
}

function requestFnReturning(...statuses) {
  let i = 0;
  const calls = [];
  const fn = async () => {
    calls.push(i);
    const status = statuses[Math.min(i, statuses.length - 1)];
    i += 1;
    return { status, ok: status >= 200 && status < 300 };
  };
  fn.calls = calls;
  return fn;
}

function stubReturning(...values) {
  let i = 0;
  const calls = [];
  const fn = async (...args) => {
    calls.push(args);
    const v = values[Math.min(i, values.length - 1)];
    i += 1;
    return v;
  };
  fn.calls = calls;
  return fn;
}

before(() => setupWindow());

beforeEach(() => {
  ensureLoginStub = stubReturning(true);
  updateConfigCalls = 0;
});

describe('executeAdminRequest', () => {
  describe('policy: none', () => {
    it('calls the request fn once and returns the result without invoking ensureLogin', async () => {
      ensureLoginStub = stubReturning(true);
      const requestFn = requestFnReturning(401);
      const result = await executeAdminRequest(requestFn, {
        org: 'adobe', site: 'x', policy: AuthMode.NONE,
      });
      assert.equal(requestFn.calls.length, 1);
      assert.equal(ensureLoginStub.calls.length, 0);
      assert.equal(result.status, 401);
    });
  });

  describe('policy: retryOn401 (default)', () => {
    it('returns success without calling ensureLogin', async () => {
      ensureLoginStub = stubReturning(true);
      const requestFn = requestFnReturning(200);
      const result = await executeAdminRequest(requestFn, { org: 'adobe' });
      assert.equal(requestFn.calls.length, 1);
      assert.equal(ensureLoginStub.calls.length, 0);
      assert.equal(result.status, 200);
    });

    it('on 401 with active session, retries once', async () => {
      ensureLoginStub = stubReturning(true);
      const requestFn = requestFnReturning(401, 200);
      const result = await executeAdminRequest(requestFn, { org: 'adobe', site: 'x' });
      assert.equal(requestFn.calls.length, 2);
      assert.deepEqual(ensureLoginStub.calls, [['adobe', 'x']]);
      assert.equal(result.status, 200);
    });

    it('on 401 with no session, awaits profile-update then retries', async () => {
      ensureLoginStub = stubReturning(false);
      const requestFn = requestFnReturning(401, 200);
      const promise = executeAdminRequest(requestFn, { org: 'adobe' });
      // Yield so the helper registers its listeners before we dispatch.
      await new Promise((r) => { queueMicrotask(r); });
      dispatchProfile('update', ['adobe']);
      const result = await promise;
      assert.equal(requestFn.calls.length, 2);
      assert.equal(result.status, 200);
    });

    it('on 401, returns null when user cancels the login modal', async () => {
      ensureLoginStub = stubReturning(false);
      const requestFn = requestFnReturning(401);
      const promise = executeAdminRequest(requestFn, { org: 'adobe' });
      await new Promise((r) => { queueMicrotask(r); });
      dispatchProfile('cancelled');
      const result = await promise;
      assert.equal(requestFn.calls.length, 1);
      assert.equal(result, null);
    });

    it('on 401, returns null when profile-update fires for a different org', async () => {
      ensureLoginStub = stubReturning(false);
      const requestFn = requestFnReturning(401);
      const promise = executeAdminRequest(requestFn, { org: 'adobe' });
      await new Promise((r) => { queueMicrotask(r); });
      dispatchProfile('update', ['other-org']);
      const result = await promise;
      assert.equal(result, null);
    });

    it('returns the second 401 — never retries more than once', async () => {
      ensureLoginStub = stubReturning(true);
      const requestFn = requestFnReturning(401, 401);
      const result = await executeAdminRequest(requestFn, { org: 'adobe' });
      assert.equal(requestFn.calls.length, 2);
      assert.equal(result.status, 401);
    });

    it('does not retry on non-401 errors', async () => {
      ensureLoginStub = stubReturning(true);
      const requestFn = requestFnReturning(500);
      const result = await executeAdminRequest(requestFn, { org: 'adobe' });
      assert.equal(requestFn.calls.length, 1);
      assert.equal(ensureLoginStub.calls.length, 0);
      assert.equal(result.status, 500);
    });
  });

  describe('policy: preflightAndRetry', () => {
    it('returns null and skips request fn when login is cancelled', async () => {
      ensureLoginStub = stubReturning(false);
      const requestFn = requestFnReturning(200);
      const promise = executeAdminRequest(requestFn, {
        org: 'adobe', site: 'x', policy: AuthMode.PREFLIGHT_AND_RETRY,
      });
      await new Promise((r) => { queueMicrotask(r); });
      dispatchProfile('cancelled');
      const result = await promise;
      assert.equal(requestFn.calls.length, 0);
      assert.equal(result, null);
    });

    it('runs the request fn after a successful preflight (already signed in)', async () => {
      ensureLoginStub = stubReturning(true);
      const requestFn = requestFnReturning(200);
      const result = await executeAdminRequest(requestFn, {
        org: 'adobe', policy: AuthMode.PREFLIGHT_AND_RETRY,
      });
      assert.equal(requestFn.calls.length, 1);
      assert.equal(result.status, 200);
    });

    it('runs the request fn after the user completes the modal login', async () => {
      ensureLoginStub = stubReturning(false);
      const requestFn = requestFnReturning(200);
      const promise = executeAdminRequest(requestFn, {
        org: 'adobe', policy: AuthMode.PREFLIGHT_AND_RETRY,
      });
      await new Promise((r) => { queueMicrotask(r); });
      dispatchProfile('update', ['adobe']);
      const result = await promise;
      assert.equal(requestFn.calls.length, 1);
      assert.equal(result.status, 200);
    });

    it('still retries once on 401 after a successful preflight (covers expired session)', async () => {
      ensureLoginStub = stubReturning(true, true);
      const requestFn = requestFnReturning(401, 200);
      const result = await executeAdminRequest(requestFn, {
        org: 'adobe', policy: AuthMode.PREFLIGHT_AND_RETRY,
      });
      assert.equal(requestFn.calls.length, 2);
      assert.equal(ensureLoginStub.calls.length, 2);
      assert.equal(result.status, 200);
    });
  });

  describe('updateConfig persistence', () => {
    it('runs after a successful request', async () => {
      ensureLoginStub = stubReturning(true);
      await executeAdminRequest(requestFnReturning(200), { org: 'adobe' });
      assert.equal(updateConfigCalls, 1);
    });

    it('does not run on non-2xx responses (404, 500, etc) — server didn\'t validate the org/site', async () => {
      ensureLoginStub = stubReturning(true);
      await executeAdminRequest(requestFnReturning(404), { org: 'adobe' });
      assert.equal(updateConfigCalls, 0);
    });

    it('does not run when the user cancels the preflight login', async () => {
      ensureLoginStub = stubReturning(false);
      const promise = executeAdminRequest(requestFnReturning(200), {
        org: 'adobe', policy: AuthMode.PREFLIGHT_AND_RETRY,
      });
      await new Promise((r) => { queueMicrotask(r); });
      dispatchProfile('cancelled');
      await promise;
      assert.equal(updateConfigCalls, 0);
    });

    it('does not run when the user cancels after a 401', async () => {
      ensureLoginStub = stubReturning(false);
      const promise = executeAdminRequest(requestFnReturning(401), { org: 'adobe' });
      await new Promise((r) => { queueMicrotask(r); });
      dispatchProfile('cancelled');
      await promise;
      assert.equal(updateConfigCalls, 0);
    });
  });
});
