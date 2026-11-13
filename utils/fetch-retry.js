const RETRY_STATUSES = new Set([429, 502, 503, 504]);
const RETRY_TIMEOUT = 30000;

/**
 * @param {{method?: string, status?: number, error?: Error}} failure
 * @returns {boolean} Whether a failed GET attempt can be replayed.
 */
export function shouldRetry({ method = 'GET', status, error }) {
  return method.toUpperCase() === 'GET'
    && (error instanceof TypeError || RETRY_STATUSES.has(status));
}

/**
 * @param {{attempt: number, retryAfter?: string|null, now: number, elapsed: number}} timing
 * Zero-based retry index, Retry-After value, current timestamp, and elapsed milliseconds.
 * @returns {number|null} Delay in milliseconds, or null when the total budget is exhausted.
 */
export function getRetryDelay({
  attempt, retryAfter, now, elapsed,
}) {
  const remaining = RETRY_TIMEOUT - elapsed;
  if (remaining <= 0) return null;
  let retryDelay = 0;
  if (/^\d+$/.test(retryAfter)) retryDelay = Number(retryAfter) * 1000;
  else if (Number.isNaN(Number(retryAfter))) retryDelay = Date.parse(retryAfter) - now;
  // Retry-After is a minimum wait, not permission to shorten our backoff.
  return Math.min(Math.max(Math.min(1000 * (2 ** attempt), 8000), retryDelay || 0), remaining);
}

/**
 * Fetch with GET-only transport retries and a 30-second budget through response headers.
 * Other methods pass straight through. Non-retryable HTTP responses are returned unchanged;
 * network failures and deadline/cancellation errors reject. Body consumption is caller-owned.
 *
 * @param {string|URL|Request} url
 * @param {RequestInit} [init]
 * @returns {Promise<Response>}
 */
export default async function fetchWithRetry(url, init = {}) {
  const method = init.method ?? (url instanceof Request ? url.method : 'GET');
  if (method.toUpperCase() !== 'GET') return fetch(url, init);
  const signal = init.signal === undefined && url instanceof Request ? url.signal : init.signal;
  if (signal?.aborted) throw signal.reason;
  const started = Date.now();
  const controller = new AbortController();
  const requestSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  let lastError;
  let timer;
  let wait;
  let cancel;
  const pause = (delay) => new Promise((resolve) => { wait = setTimeout(resolve, delay); });
  const timeoutError = () => new Error(`GET ${url} failed after ${RETRY_TIMEOUT}ms`, {
    cause: lastError,
  });
  const stopped = new Promise((resolve, reject) => {
    cancel = (reason) => {
      controller.abort(reason);
      reject(reason);
    };
    timer = setTimeout(() => { cancel(timeoutError()); }, RETRY_TIMEOUT);
  });
  const onAbort = () => { cancel(signal.reason); };
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    for (let attempt = 0; ; attempt += 1) {
      if (Date.now() - started >= RETRY_TIMEOUT) throw timeoutError();
      let response;
      try {
        // eslint-disable-next-line no-await-in-loop
        response = await Promise.race([
          fetch(url, { ...init, signal: requestSignal }),
          stopped,
        ]);
      } catch (error) {
        if (controller.signal.aborted || !shouldRetry({ method, error })) throw error;
        lastError = error;
      }
      if (controller.signal.aborted) throw controller.signal.reason;
      if (Date.now() - started >= RETRY_TIMEOUT) throw timeoutError();
      if (response) {
        if (!shouldRetry({ method, status: response.status })) return response;
        lastError = new Error(`GET ${url} failed: HTTP ${response.status}`);
        if (response.body) {
          // eslint-disable-next-line no-await-in-loop
          await Promise.race([response.body.cancel(), stopped]);
        }
      }
      const now = Date.now();
      const delay = getRetryDelay({
        attempt, retryAfter: response?.headers.get('retry-after'), now, elapsed: now - started,
      });
      if (delay === null) throw timeoutError();
      // eslint-disable-next-line no-await-in-loop
      await Promise.race([
        pause(delay),
        stopped,
      ]);
    }
  } finally {
    clearTimeout(timer);
    clearTimeout(wait);
    signal?.removeEventListener('abort', onAbort);
  }
}
