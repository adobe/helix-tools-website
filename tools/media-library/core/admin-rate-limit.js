/**
 * Shared rate limiter for admin.hlx.page (10 req/s per project).
 * Same pattern as backfill tool: promise-chain acquire, 429 retry with backoff.
 */

import isPerfEnabled from './params.js';

const ADMIN_API_RATE = 8; /* keep some headroom under the 10 RPS project limit */

function waitForDelay(ms, signal = null) {
  const duration = Math.max(0, ms);
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timeoutId = setTimeout(resolve, duration);
    if (signal) {
      signal.addEventListener('abort', () => {
        clearTimeout(timeoutId);
        resolve();
      }, { once: true });
    }
  });
}

function createRateLimiter(initialRate = ADMIN_API_RATE, getSignal = () => null) {
  let intervalMs = Math.ceil(1000 / initialRate);
  let queue = Promise.resolve();

  return {
    acquire() {
      const gate = queue;
      queue = queue.then(() => waitForDelay(intervalMs, getSignal()));
      return gate;
    },
    handleResponse(res) {
      const rate = parseFloat(res?.headers?.get?.('x-ratelimit-rate'), 10);
      if (Number.isFinite(rate) && rate > 0) {
        intervalMs = Math.ceil(1000 / rate);
      }
    },
    backoff(seconds) {
      const ms = Math.max(0, (typeof seconds === 'number' ? seconds : 1) * 1000);
      queue = queue.then(() => waitForDelay(ms, getSignal()));
    },
    reset() {
      queue = Promise.resolve();
    },
  };
}

let adminLimiter = null;

export function getAdminRateLimiter() {
  if (!adminLimiter) {
    adminLimiter = createRateLimiter(ADMIN_API_RATE);
  }
  return adminLimiter;
}

/**
 * Fetch admin.hlx.page URL with rate limit and 429/503 retry.
 * Call only for URLs under https://admin.hlx.page.
 */
export async function fetchAdminWithRateLimit(
  url,
  options = {},
  { maxRetries = 3, signal } = {},
) {
  const limiter = getAdminRateLimiter();
  const fetchOptions = { ...options, credentials: 'include', signal };

  async function attempt(attemptNumber) {
    await limiter.acquire();
    const res = await fetch(url, fetchOptions);
    limiter.handleResponse(res);

    if (res.status === 429 && attemptNumber < maxRetries) {
      const headerVal = parseInt(
        res.headers.get('x-retry-after') || res.headers.get('retry-after'),
        10,
      );
      const retryAfter = Math.max(headerVal || 2 ** attemptNumber, 30);
      if (isPerfEnabled()) {
        // eslint-disable-next-line no-console
        console.log(`[admin-api] 429 rate limit hit, backing off ${retryAfter}s (attempt ${attemptNumber + 1}/${maxRetries + 1})`);
      }
      limiter.backoff(retryAfter);
      return attempt(attemptNumber + 1);
    }

    if (res.status === 503 && attemptNumber < maxRetries) {
      const delaySec = 2 ** attemptNumber;
      limiter.backoff(delaySec);
      return attempt(attemptNumber + 1);
    }

    return res;
  }

  return attempt(0);
}
