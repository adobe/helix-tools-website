/**
 * Thin client for the aem-domain-registration-worker REST API -
 * every call returns { ok, status, body, error, method, url }.
 */

import { buildOwnerQuery, isTransientStatus, TRANSIENT_RETRY_DELAYS } from './utils.js';

function delay(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

async function fetchWorker(url, { method, body }) {
  try {
    const resp = await fetch(url, {
      method,
      cache: 'no-store',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const responseBody = await resp.json().catch(() => null);
    const error = responseBody?.error || resp.headers.get('x-error') || '';
    return {
      ok: resp.ok, status: resp.status, body: responseBody, error, method, url,
    };
  } catch (error) {
    return {
      ok: false, status: 0, body: null, error: error.message, method, url,
    };
  }
}

// Wraps fetchWorker with a bounded transient retry.
async function callWorker(workerBaseUrl, path, { method = 'GET', body } = {}) {
  const url = `${workerBaseUrl}${path}`;
  let result = await fetchWorker(url, { method, body });
  for (let attempt = 0; attempt < TRANSIENT_RETRY_DELAYS.length; attempt += 1) {
    if (!isTransientStatus(result.status)) break;
    // eslint-disable-next-line no-await-in-loop
    await delay(TRANSIENT_RETRY_DELAYS[attempt]);
    // eslint-disable-next-line no-await-in-loop
    result = await fetchWorker(url, { method, body });
  }
  return result;
}

function domainPath(domain) {
  return `/domains/${encodeURIComponent(domain)}`;
}

export function getDomainStatus(workerBaseUrl, domain, org, site) {
  return callWorker(workerBaseUrl, `${domainPath(domain)}${buildOwnerQuery(org, site)}`);
}

// PUT registers a new domain, and — on a PENDING_DELETION domain — cancels the
// pending deletion. cancelDeletion below is an alias for this same call.
export function registerDomain(workerBaseUrl, domain, org, site) {
  return callWorker(workerBaseUrl, domainPath(domain), {
    method: 'PUT',
    body: { org, site },
  });
}

export const cancelDeletion = registerDomain;

// POST advances the operation the domain's status implies.
export function advanceDomain(workerBaseUrl, domain, org, site) {
  return callWorker(workerBaseUrl, `${domainPath(domain)}${buildOwnerQuery(org, site)}`, {
    method: 'POST',
  });
}

// Read-only DNS check behind the removal panel's "Check records" button — resolves the two CNAMEs
// and returns their state under `dns`, without advancing.
export function checkDns(workerBaseUrl, domain, org, site) {
  return callWorker(workerBaseUrl, `${domainPath(domain)}${buildOwnerQuery(org, site)}&checkDns`);
}

// DELETE stages a live domain into PENDING_DELETION (a confirmable removal request).
export function requestDeletion(workerBaseUrl, domain, org, site) {
  return callWorker(workerBaseUrl, `${domainPath(domain)}${buildOwnerQuery(org, site)}`, {
    method: 'DELETE',
  });
}

// The Retry button re-drives a stuck/failed operation — the same POST as advance.
export const retryDomain = advanceDomain;
