/* eslint-env node */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as nextTurn } from 'node:timers/promises';
import fetchWithRetry, { shouldRetry, getRetryDelay } from '../../utils/fetch-retry.js';

describe('shouldRetry()', () => {
  it('only retries GET network failures, including the default and lowercase method', () => {
    const networkError = new TypeError('Failed to fetch');
    const cases = [
      { error: networkError, expected: true },
      { method: 'GET', error: networkError, expected: true },
      { method: 'get', error: networkError, expected: true },
      ...['HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].map((method) => ({
        method, error: networkError, expected: false,
      })),
      { method: 'GET', error: new Error('application failure'), expected: false },
      { method: 'GET', error: new DOMException('Cancelled', 'AbortError'), expected: false },
      { method: 'GET', expected: false },
    ];
    assert.deepEqual(
      cases.map(({ expected, ...input }) => shouldRetry(input)),
      cases.map(({ expected }) => expected),
    );
  });

  it('only retries GET responses with the selected transient statuses', () => {
    const statuses = [200, 204, 301, 400, 401, 403, 404, 408, 429, 500, 501, 502, 503, 504, 505];
    const methods = [undefined, 'GET', 'get', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];
    const cases = methods.flatMap((method) => statuses.map((status) => ({ method, status })));
    assert.deepEqual(cases.map((input) => shouldRetry(input)), cases.map(({ method, status }) => (
      [undefined, 'GET', 'get'].includes(method) && [429, 502, 503, 504].includes(status)
    )));
  });
});

describe('getRetryDelay()', () => {
  it('increases backoff from one second to an eight-second cap', () => {
    assert.deepEqual(
      [0, 1, 2, 3, 4, 5].map((attempt) => getRetryDelay({ attempt, now: 0, elapsed: 0 })),
      [1000, 2000, 4000, 8000, 8000, 8000],
    );
  });

  it('caps the wait to the remaining budget and stops at thirty seconds', () => {
    assert.deepEqual(
      [23000, 29999, 30000, 31000].map((elapsed) => getRetryDelay({
        attempt: 5, now: 100000 + elapsed, elapsed,
      })),
      [7000, 1, null, null],
    );
  });

  it('honors valid Retry-After minimums within the budget and ignores malformed values', () => {
    const now = Date.parse('2026-11-12T16:00:00Z');
    const cases = [
      { retryAfter: '3', expected: 3000 },
      { retryAfter: new Date(now + 5000).toUTCString(), expected: 5000 },
      { retryAfter: '9', expected: 9000 },
      { retryAfter: '0', attempt: 2, expected: 4000 },
      { retryAfter: '60', elapsed: 29000, expected: 1000 },
      { retryAfter: new Date(now + 60000).toUTCString(), elapsed: 29000, expected: 1000 },
      { retryAfter: new Date(now - 1000).toUTCString(), expected: 1000 },
      ...[undefined, null, '', 'invalid', '-1', '1.5'].map((retryAfter) => ({
        retryAfter, now: 0, expected: 1000,
      })),
    ];
    cases.forEach(({ expected, ...input }) => {
      assert.equal(getRetryDelay({
        attempt: 0, now, elapsed: 0, ...input,
      }), expected, JSON.stringify(input));
    });
  });
});

describe('fetchWithRetry()', () => {
  it('uses the GET retry policy while preserving request options and the final response', async (t) => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 });
    const url = 'https://admin.hlx.page/test';
    const init = {
      method: 'get', credentials: 'omit', cache: 'no-store', headers: { 'x-test': 'keep' },
    };
    const response = new Response(null, { status: 401 });
    let discardedBodies = 0;
    const unavailable = new Response(new ReadableStream({
      cancel() { discardedBodies += 1; },
    }), { status: 503, headers: { 'Retry-After': '3' } });
    const attempts = [];
    t.mock.method(global, 'fetch', async (input, options) => {
      attempts.push({ input, options, time: Date.now() });
      return attempts.length === 1 ? unavailable : response;
    });
    const pending = fetchWithRetry(url, init);
    await nextTurn();
    assert.equal(discardedBodies, 1);
    t.mock.timers.tick(2999);
    await nextTurn();
    assert.equal(attempts.length, 1);
    t.mock.timers.tick(1);
    await nextTurn();
    assert.equal(await pending, response);
    const { signal } = attempts[0].options;
    assert.ok(signal instanceof AbortSignal);
    assert.deepEqual(attempts, [
      { input: url, options: { ...init, signal }, time: 0 },
      { input: url, options: { ...init, signal }, time: 3000 },
    ]);
    t.mock.timers.tick(30000);
    assert.equal(signal.aborted, false);
    assert.equal(init.signal, undefined);
  });

  it('uses the method on a Request when init does not override it', async (t) => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 });
    const request = new Request('https://admin.hlx.page/test', { method: 'POST' });
    const response = new Response(null, { status: 503 });
    const fetchMock = t.mock.method(global, 'fetch', async () => response);
    let outcome;
    fetchWithRetry(request).then((result) => { outcome = result; });
    await nextTurn();
    assert.equal(outcome, response);
    assert.equal(fetchMock.mock.callCount(), 1);
    assert.equal(fetchMock.mock.calls[0].arguments[0], request);
    assert.deepEqual(fetchMock.mock.calls[0].arguments[1], {});
  });

  it('does not send an already-cancelled GET', async (t) => {
    const controller = new AbortController();
    const reason = new TypeError('Cancelled by the caller');
    controller.abort(reason);
    const fetchMock = t.mock.method(global, 'fetch', async () => new Response(null));
    const request = new Request('https://admin.hlx.page/test', { signal: controller.signal });
    await Promise.all([
      [request.url, { signal: controller.signal }],
      [request, {}],
    ].map(async ([input, init]) => {
      const result = await fetchWithRetry(input, init).catch((error) => error);
      assert.equal(result, reason);
    }));
    assert.equal(fetchMock.mock.callCount(), 0);
  });

  it('preserves caller cancellation after returning response headers', async (t) => {
    const controller = new AbortController();
    const reason = new Error('Cancel response body');
    let requestSignal;
    t.mock.method(global, 'fetch', async (url, init) => {
      requestSignal = init.signal;
      return new Response(null);
    });
    await fetchWithRetry('https://admin.hlx.page/test', { signal: controller.signal });
    controller.abort(reason);
    assert.equal(requestSignal.aborted, true);
    assert.equal(requestSignal.reason, reason);
  });

  ['request', 'backoff'].forEach((phase) => {
    it(`honors caller cancellation during ${phase} without another attempt`, async (t) => {
      t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 });
      const controller = new AbortController();
      const reason = new TypeError('Cancelled by the caller');
      let requestSignal;
      const fetchMock = t.mock.method(global, 'fetch', (url, init) => {
        requestSignal = init.signal;
        return phase === 'request'
          ? new Promise(() => {})
          : Promise.resolve(new Response(null, { status: 503 }));
      });
      let outcome;
      fetchWithRetry('https://admin.hlx.page/test', { signal: controller.signal }).then(
        (response) => { outcome = response; },
        (error) => { outcome = error; },
      );
      await nextTurn();
      t.mock.timers.tick(100);
      controller.abort(reason);
      await nextTurn();
      assert.equal(outcome, reason);
      assert.equal(requestSignal.aborted, true);
      assert.equal(requestSignal.reason, reason);
      t.mock.timers.tick(30000);
      await nextTurn();
      assert.equal(fetchMock.mock.callCount(), 1);
    });
  });

  it('includes request time in the deadline and aborts a hung retry', async (t) => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 });
    const attempts = [];
    const networkError = new TypeError('Failed to fetch');
    let rejectFirst;
    let resolveHung;
    t.mock.method(global, 'fetch', (url, init) => {
      attempts.push({ time: Date.now(), signal: init.signal });
      if (attempts.length === 1) {
        return new Promise((resolve, reject) => { rejectFirst = reject; });
      }
      // Ignore abort deliberately: a non-cooperating fetch must not hold up the caller.
      return new Promise((resolve) => { resolveHung = resolve; });
    });
    let outcome;
    fetchWithRetry('https://admin.hlx.page/test').then(
      (response) => { outcome = { response, time: Date.now() }; },
      (error) => { outcome = { error, time: Date.now() }; },
    );
    t.mock.timers.tick(5000);
    rejectFirst(networkError);
    await nextTurn();
    t.mock.timers.tick(1000);
    await nextTurn();
    assert.deepEqual(attempts.map(({ time }) => time), [0, 6000]);
    t.mock.timers.tick(23999);
    await nextTurn();
    assert.equal(outcome, undefined);
    t.mock.timers.tick(1);
    await nextTurn();
    assert.equal(outcome?.time, 30000);
    assert.match(outcome.error.message, /GET https:\/\/admin.hlx.page\/test.*30000/);
    assert.equal(outcome.error.cause, networkError);
    attempts.forEach(({ signal }) => {
      assert.equal(signal.aborted, true);
      assert.equal(signal.reason, outcome.error);
    });
    resolveHung(new Response(null));
    await nextTurn();
    t.mock.timers.tick(10000);
    await nextTurn();
    assert.equal(attempts.length, 2);
    assert.equal(outcome.time, 30000);
  });

  it('passes non-GET requests through once without retry options or a retry deadline', async (t) => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 });
    const url = 'https://admin.hlx.page/test';
    const response = new Response(null, { status: 503 });
    const failure = new TypeError('Failed to fetch');
    let reject = false;
    const fetchMock = t.mock.method(global, 'fetch', async () => {
      if (reject) throw failure;
      return response;
    });
    const requests = ['HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].map((method) => ({ method }));
    const results = await Promise.all(requests.map((init) => fetchWithRetry(url, init)));
    results.forEach((result, index) => {
      assert.equal(result, response);
      assert.equal(fetchMock.mock.calls[index].arguments[0], url);
      assert.equal(fetchMock.mock.calls[index].arguments[1], requests[index]);
    });
    assert.equal(fetchMock.mock.callCount(), 6);
    reject = true;
    await assert.rejects(fetchWithRetry(url, { method: 'POST' }), (error) => error === failure);
    assert.equal(fetchMock.mock.callCount(), 7);
    t.mock.timers.tick(30000);
    await nextTurn();
    assert.equal(fetchMock.mock.callCount(), 7);
  });
});
