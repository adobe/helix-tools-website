/* eslint-disable no-await-in-loop */
import { ensureLogin } from '../../blocks/profile/profile.js';

// CORS proxy for cross-origin requests
const CORS_PROXY_URL = 'https://www.fcors.org';
const CORS_PROXY_KEY = 'iyIjewSFgBzbPVG3';

function corsProxy(url, options = {}) {
  let proxyUrl = `${CORS_PROXY_URL}?url=${encodeURIComponent(url)}&key=${CORS_PROXY_KEY}`;
  if (options.revealHeaders) {
    proxyUrl += '&reveal=headers';
  }
  return proxyUrl;
}

/** Structured console output for production DNS / IP diagnostics. */
function logProdNetworkDiag(payload) {
  /* eslint-disable no-console */
  console.error('[cdn-check:prod-network]', payload);
  /* eslint-enable no-console */
}

// DNS over HTTPS — types from RFC 1035 / 3596
const DNS_TYPE_A = 1;
const DNS_TYPE_CNAME = 5;
const DNS_TYPE_AAAA = 28;

const DOH_DNS_JSON_HEADERS = { Accept: 'application/dns-json' };

/** Multiple DoH endpoints (TLS SNI differs); mitigates ERR_CERT_COMMON_NAME_INVALID on one host. */
function buildDohProviderAttempts(hostname, typeParam) {
  const typeNum = typeParam === 'AAAA' ? DNS_TYPE_AAAA : DNS_TYPE_A;
  return [
    {
      id: 'cloudflare-dns.com',
      url: `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=${typeParam}`,
      headers: DOH_DNS_JSON_HEADERS,
    },
    {
      id: '1.1.1.1',
      url: `https://1.1.1.1/dns-query?name=${encodeURIComponent(hostname)}&type=${typeParam}`,
      headers: DOH_DNS_JSON_HEADERS,
    },
    {
      id: 'dns.google',
      url: `https://dns.google/resolve?name=${encodeURIComponent(hostname)}&type=${typeNum}`,
      headers: { Accept: 'application/json' },
    },
  ];
}

/** ASN → common CDN / edge name (conservative; org string used for ambiguous ASNs). */
const CDN_BY_ASN = new Map([
  [13335, 'Cloudflare'],
  [54113, 'Fastly'],
  [20940, 'Akamai'],
  [35993, 'Akamai'],
  [16625, 'Akamai'],
  [16647, 'Akamai'],
  [32787, 'Akamai'],
  [24319, 'Akamai'],
  [63949, 'Akamai (Linode)'],
]);

async function dnsQueryJson(hostname, typeAaaa) {
  const typeParam = typeAaaa === 'AAAA' ? 'AAAA' : 'A';
  const providers = buildDohProviderAttempts(hostname, typeParam);
  const attempts = [];

  for (let i = 0; i < providers.length; i += 1) {
    const provider = providers[i];
    try {
      const resp = await fetch(provider.url, {
        headers: provider.headers,
        cache: 'no-store',
      });
      if (!resp.ok) {
        logProdNetworkDiag({
          step: 'dns-doh-http-error',
          provider: provider.id,
          hostname,
          recordType: typeParam,
          dnsUrl: provider.url,
          httpStatus: resp.status,
          statusText: resp.statusText,
        });
        attempts.push(`${provider.id}: HTTP ${resp.status}`);
        // eslint-disable-next-line no-continue
        continue;
      }
      const data = await resp.json();
      if (typeof data.Status === 'number' && data.Status === 2) {
        logProdNetworkDiag({
          step: 'dns-doh-servfail',
          provider: provider.id,
          hostname,
          recordType: typeParam,
          dnsStatus: data.Status,
        });
        attempts.push(`${provider.id}: DNS SERVFAIL (status 2)`);
        // eslint-disable-next-line no-continue
        continue;
      }
      /* eslint-disable no-console */
      console.debug('[cdn-check:prod-network] dns-ok', {
        provider: provider.id, hostname, recordType: typeParam,
      });
      /* eslint-enable no-console */
      return data;
    } catch (err) {
      logProdNetworkDiag({
        step: 'dns-doh-provider-failed',
        provider: provider.id,
        hostname,
        recordType: typeParam,
        dnsUrl: provider.url,
        pageOrigin: typeof window !== 'undefined' ? window.location.origin : undefined,
        errorName: err && typeof err === 'object' && 'name' in err ? err.name : undefined,
        errorMessage: err && typeof err === 'object' && 'message' in err ? err.message : String(err),
        cause: err && typeof err === 'object' && 'cause' in err ? err.cause : undefined,
        stack: err && typeof err === 'object' && 'stack' in err ? err.stack : undefined,
      });
      const em = err && typeof err === 'object' && 'message' in err ? err.message : String(err);
      attempts.push(`${provider.id}: ${em}`);
    }
  }

  logProdNetworkDiag({
    step: 'dns-doh-all-providers-failed',
    hostname,
    recordType: typeParam,
    attempts,
    pageOrigin: typeof window !== 'undefined' ? window.location.origin : undefined,
  });

  const summary = attempts.join(' · ');
  throw new Error(
    `DNS over HTTPS (${typeParam} for “${hostname}”) failed for all providers (${providers.length}). `
    + `${summary}`,
  );
}

/**
 * Resolve hostname to IPv4 (A) only, following a single CNAME chain.
 * Skips AAAA: IPv6 metadata is often unavailable from browser-side providers.
 * @param {string} hostname
 * @returns {Promise<string[]>}
 */
async function resolveHostnameToIps(hostname, depth = 0, visited = new Set()) {
  const host = hostname.replace(/\.$/, '').toLowerCase();
  if (depth > 12) {
    throw new Error('DNS alias chain too deep');
  }
  if (visited.has(host)) {
    throw new Error('DNS alias loop detected');
  }
  visited.add(host);

  const aData = await dnsQueryJson(host, 'A');

  const ips = new Set();
  let cnameTarget = null;

  if (aData && Array.isArray(aData.Answer)) {
    aData.Answer.forEach((row) => {
      if (row.type === DNS_TYPE_A && row.data) ips.add(row.data.trim());
      if (row.type === DNS_TYPE_CNAME && row.data && !cnameTarget) {
        cnameTarget = row.data.replace(/\.$/, '').trim();
      }
    });
  }

  if (ips.size > 0) {
    return [...ips];
  }
  if (cnameTarget) {
    return resolveHostnameToIps(cnameTarget, depth + 1, visited);
  }

  if (aData.Status === 3) {
    throw new Error(`No DNS records (NXDOMAIN) for ${host}`);
  }
  throw new Error(`Could not resolve A records for ${host}`);
}

async function fetchJsonFromResponse(resp, ip, label, requestUrl) {
  const text = await resp.text();
  try {
    return JSON.parse(text);
  } catch (parseErr) {
    logProdNetworkDiag({
      step: 'ip-meta-json-parse',
      ip,
      label,
      requestUrl,
      snippet: text.slice(0, 200),
      parseErr: parseErr && typeof parseErr === 'object' && 'message' in parseErr
        ? parseErr.message
        : String(parseErr),
    });
    throw new Error(`${label}: response was not valid JSON (see console).`);
  }
}

function normalizeIpwhoResponse(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('Empty response');
  }
  if (data.success === false) {
    throw new Error(data.message ? String(data.message) : 'ipwho.is declined');
  }
  if (!data.connection) {
    throw new Error('ipwho.is: missing connection');
  }
  return data;
}

function normalizeIpapiCoResponse(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('Empty response');
  }
  if (data.error) {
    const reason = data.reason != null ? String(data.reason) : String(data.error);
    throw new Error(reason);
  }
  const asnRaw = data.asn != null ? String(data.asn) : '';
  const asnMatch = asnRaw.match(/(\d{2,})/);
  const asn = asnMatch ? parseInt(asnMatch[1], 10) : NaN;
  const org = String(data.org || data.organization || '').trim();
  const isp = String(data.isp || org || '').trim();
  return {
    success: true,
    connection: {
      asn: Number.isFinite(asn) ? asn : undefined,
      org,
      isp,
    },
  };
}

/** jCard / RDAP vcardArray: pick org, else fn. */
function vcardOrgOrFn(vcardArray) {
  if (!Array.isArray(vcardArray) || vcardArray.length < 2 || !Array.isArray(vcardArray[1])) {
    return '';
  }
  const rows = vcardArray[1];
  let fn = '';
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    if (Array.isArray(row) && row.length >= 4) {
      const tag = row[0];
      const val = String(row[row.length - 1]);
      if (tag === 'org' && val) return val;
      if (tag === 'fn' && val) fn = fn || val;
    }
  }
  return fn;
}

function anyNonAbuseOrgFromRdapEntities(entities) {
  if (!Array.isArray(entities)) return '';
  for (let i = 0; i < entities.length; i += 1) {
    const e = entities[i];
    if (e.vcardArray) {
      const o = vcardOrgOrFn(e.vcardArray);
      if (o && !/^abuse\b/i.test(o) && o.length > 2) return o.trim();
    }
    const sub = anyNonAbuseOrgFromRdapEntities(e.entities);
    if (sub) return sub;
  }
  return '';
}

/**
 * RDAP bootstrap JSON (rdap.org). Fetched via fcors (different CF surface than ipapi).
 * ASN may be absent; registrant org is enough for classifyIpNetwork.
 */
function normalizeBootstrapRdapResponse(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('Empty RDAP response');
  }
  let org = '';

  function walkEntities(entities) {
    if (!Array.isArray(entities)) return;
    for (let i = 0; i < entities.length; i += 1) {
      const e = entities[i];
      if (Array.isArray(e.roles) && e.roles.includes('registrant') && e.vcardArray) {
        const o = vcardOrgOrFn(e.vcardArray);
        if (o && !org) org = o.trim();
      }
      if (e.entities) walkEntities(e.entities);
    }
  }

  walkEntities(data.entities);

  if (!org) {
    org = anyNonAbuseOrgFromRdapEntities(data.entities);
  }

  if (!org) {
    throw new Error('RDAP: no registrant or organization in response');
  }

  let asn;
  const ao = data.arin_originas0_originautnums;
  if (Array.isArray(ao) && ao.length > 0) {
    const n = Number(ao[0]);
    if (Number.isFinite(n)) asn = n;
  }

  return {
    success: true,
    connection: {
      asn: asn !== undefined ? asn : undefined,
      org,
      isp: org,
    },
  };
}

/**
 * Try each URL until normalize() succeeds.
 * @param {string} ip
 * @param {string} label
 * @param {string[]} urls
 * @param {(data: object) => object} normalize
 * @param {RequestInit} [fetchInit] merged into fetch (e.g. RDAP Accept header).
 * @returns {Promise<object|null>}
 */
async function tryIpMetadataProvider(ip, label, urls, normalize, fetchInit = undefined) {
  const errors = [];
  for (let i = 0; i < urls.length; i += 1) {
    const url = urls[i];
    try {
      const resp = await fetch(url, { cache: 'no-store', ...fetchInit });
      if (!resp.ok) {
        logProdNetworkDiag({
          step: 'ip-meta-http-not-ok',
          ip,
          label,
          requestUrl: url,
          httpStatus: resp.status,
          statusText: resp.statusText,
        });
        errors.push(`HTTP ${resp.status}`);
      } else {
        const raw = await fetchJsonFromResponse(resp, ip, label, url);
        try {
          return normalize(raw);
        } catch (normErr) {
          logProdNetworkDiag({
            step: 'ip-meta-normalize-failed',
            ip,
            label,
            message: normErr && typeof normErr === 'object' && 'message' in normErr
              ? normErr.message
              : String(normErr),
          });
          errors.push(
            String(normErr && typeof normErr === 'object' && 'message' in normErr ? normErr.message : normErr),
          );
        }
      }
    } catch (err) {
      logProdNetworkDiag({
        step: 'ip-meta-fetch-failed',
        ip,
        label,
        requestUrl: url,
        errorName: err && typeof err === 'object' && 'name' in err ? err.name : undefined,
        errorMessage: err && typeof err === 'object' && 'message' in err ? err.message : String(err),
      });
      errors.push(
        String(err && typeof err === 'object' && 'message' in err ? err.message : err),
      );
    }
  }
  logProdNetworkDiag({
    step: 'ip-meta-provider-exhausted',
    ip,
    label,
    errors,
  });
  return null;
}

/**
 * ipwho.is-style payload for classifyIpNetwork.
 * Order: ipwho (direct), ipapi.co (direct), RDAP bootstrap (direct).
 * ipwho/ipapi: no fcors (CF bot HTML). rdap.org allows CORS * — fetch direct from the browser.
 */
async function fetchIpWhoisJson(ip) {
  const ipwhoTarget = `https://ipwho.is/${encodeURIComponent(ip)}`;
  let out = await tryIpMetadataProvider(ip, 'ipwho.is', [ipwhoTarget], normalizeIpwhoResponse);
  if (out) {
    return out;
  }

  const ipapiTarget = `https://ipapi.co/${encodeURIComponent(ip)}/json/`;
  out = await tryIpMetadataProvider(ip, 'ipapi.co', [ipapiTarget], normalizeIpapiCoResponse);
  if (out) {
    /* eslint-disable no-console */
    console.debug('[cdn-check:prod-network] ip-metadata-fallback', { ip, source: 'ipapi.co' });
    /* eslint-enable no-console */
    return out;
  }

  const rdapUrl = `https://rdap.org/ip/${encodeURIComponent(ip)}`;
  out = await tryIpMetadataProvider(
    ip,
    'rdap.org',
    [rdapUrl],
    normalizeBootstrapRdapResponse,
    { headers: { Accept: 'application/rdap+json, application/json' } },
  );
  if (out) {
    /* eslint-disable no-console */
    console.debug('[cdn-check:prod-network] ip-metadata-fallback', { ip, source: 'rdap.org' });
    /* eslint-enable no-console */
    return out;
  }

  throw new Error(
    `Could not load IP metadata for ${ip}. `
    + 'Tried ipwho.is, ipapi.co, then rdap.org (all browser-direct where used).',
  );
}

/**
 * @param {{ asn?: number|string, org?: string, isp?: string }} conn
 * @returns {{ isKnownCdn: boolean, label: string, detail: string }}
 */
function classifyIpNetwork(conn) {
  const asn = Number(conn.asn);
  const org = (conn.org || '').trim();
  const isp = (conn.isp || '').trim();
  const blob = `${org} ${isp}`.toLowerCase();

  if (Number.isFinite(asn) && CDN_BY_ASN.has(asn)) {
    return {
      isKnownCdn: true,
      label: CDN_BY_ASN.get(asn),
      detail: [org, isp, `AS${asn}`].filter(Boolean).join(' · '),
    };
  }

  const cdnByName = [
    ['cloudflare', 'Cloudflare'],
    ['fastly', 'Fastly'],
    ['akamai', 'Akamai'],
    ['cloudfront', 'Amazon CloudFront'],
    ['amazon cloudfront', 'Amazon CloudFront'],
    ['edgecast', 'Edgecast (Verizon)'],
    ['verizon digital media', 'Verizon Media CDN'],
    ['limelight', 'Limelight'],
    ['llnw', 'Limelight'],
    ['stackpath', 'StackPath'],
    ['highwinds', 'StackPath / Highwinds'],
    ['cdn77', 'CDN77'],
    ['bunny.net', 'Bunny.net'],
    ['bunnycdn', 'Bunny.net'],
    ['keycdn', 'KeyCDN'],
    ['azurefd', 'Azure Front Door'],
    ['microsoft-azure', 'Microsoft Azure CDN'],
    ['google edge', 'Google edge'],
    ['gcore', 'Gcore'],
  ];

  const matchedByName = cdnByName.find(([needle]) => blob.includes(needle));
  if (matchedByName) {
    const [, name] = matchedByName;
    return {
      isKnownCdn: true,
      label: name,
      detail: [org, isp, Number.isFinite(asn) ? `AS${asn}` : ''].filter(Boolean).join(' · '),
    };
  }

  if (asn === 16509 || asn === 14618) {
    return {
      isKnownCdn: false,
      label: 'Amazon / AWS',
      detail: [org, isp, `AS${asn}`].filter(Boolean).join(' · ')
        || `AS${asn} (AWS; not auto-classified as CDN without CloudFront signals)`,
    };
  }
  if (asn === 15169) {
    return {
      isKnownCdn: false,
      label: 'Google',
      detail: [org, isp, 'AS15169'].filter(Boolean).join(' · '),
    };
  }
  if (asn === 8075) {
    return {
      isKnownCdn: false,
      label: 'Microsoft',
      detail: [org, isp, 'AS8075'].filter(Boolean).join(' · '),
    };
  }

  const fallback = org || isp || (Number.isFinite(asn) ? `AS${asn}` : 'Unknown network');
  return {
    isKnownCdn: false,
    label: 'Unsupported CDN',
    detail: [org, isp, Number.isFinite(asn) ? `AS${asn}` : ''].filter(Boolean).join(' · ') || fallback,
  };
}

function clearProdNetworkSection() {
  const section = document.getElementById('prod-network-section');
  if (!section) return;
  section.hidden = true;
  section.setAttribute('aria-hidden', 'true');
  const hostEl = section.querySelector('.prod-network-host');
  const listEl = section.querySelector('.prod-network-ip-list');
  if (hostEl) hostEl.textContent = '';
  if (listEl) listEl.innerHTML = '';
}

/** Resolve prod hostname to IPs, RDAP-style IP data, CDN vs other; before HTTP checks. */
async function populateProdNetworkIntel(prodUrlString) {
  clearProdNetworkSection();
  const section = document.getElementById('prod-network-section');
  if (!section) return;

  let hostname;
  try {
    ({ hostname } = new URL(prodUrlString));
  } catch {
    return;
  }

  const hostEl = section.querySelector('.prod-network-host');
  const listEl = section.querySelector('.prod-network-ip-list');
  hostEl.textContent = `Hostname: ${hostname}`;
  listEl.innerHTML = '';

  section.hidden = false;
  section.setAttribute('aria-hidden', 'false');

  const loadingLi = document.createElement('li');
  loadingLi.className = 'prod-network-ip-item prod-network-loading prod-network-span-row';
  loadingLi.textContent = 'Resolving DNS…';
  listEl.appendChild(loadingLi);

  let ips;
  try {
    /* eslint-disable no-console */
    console.debug('[cdn-check:prod-network] start', { prodUrlString, hostname });
    /* eslint-enable no-console */
    ips = await resolveHostnameToIps(hostname);
    /* eslint-disable no-console */
    console.debug('[cdn-check:prod-network] resolved', { hostname, ipCount: ips.length, ips });
    /* eslint-enable no-console */
  } catch (e) {
    logProdNetworkDiag({
      step: 'resolveHostnameToIps-failed',
      prodUrlString,
      hostname,
      errorName: e && typeof e === 'object' && 'name' in e ? e.name : undefined,
      errorMessage: e && typeof e === 'object' && 'message' in e ? e.message : String(e),
      stack: e && typeof e === 'object' && 'stack' in e ? e.stack : undefined,
    });
    listEl.innerHTML = '';
    const errLi = document.createElement('li');
    errLi.className = 'prod-network-ip-item prod-network-error prod-network-span-row';
    const detail = document.createElement('pre');
    detail.className = 'prod-network-error-detail';
    detail.textContent = e && typeof e === 'object' && 'message' in e ? e.message : String(e);
    errLi.appendChild(detail);
    listEl.appendChild(errLi);
    return;
  }

  listEl.innerHTML = '';

  if (ips.length === 0) {
    const errLi = document.createElement('li');
    errLi.className = 'prod-network-ip-item prod-network-error prod-network-span-row';
    errLi.textContent = 'No A records found.';
    listEl.appendChild(errLi);
    return;
  }

  const rows = [];
  for (let idx = 0; idx < ips.length; idx += 1) {
    const ip = ips[idx];
    const li = document.createElement('li');
    li.className = 'prod-network-ip-item';

    const cardTop = document.createElement('div');
    cardTop.className = 'prod-network-card-top';

    const ipStrong = document.createElement('strong');
    ipStrong.className = 'prod-network-ip';
    ipStrong.textContent = ip;
    cardTop.appendChild(ipStrong);

    const cardBody = document.createElement('div');
    cardBody.className = 'prod-network-card-body';

    try {
      const raw = await fetchIpWhoisJson(ip);
      if (!raw.success) {
        throw new Error(raw.message || 'Lookup failed');
      }
      const conn = raw.connection || {};
      const { isKnownCdn, label, detail } = classifyIpNetwork({
        asn: conn.asn,
        org: conn.org,
        isp: conn.isp,
      });

      const badge = document.createElement('span');
      badge.className = `prod-network-badge ${isKnownCdn ? 'is-cdn' : 'is-other'}`;
      let badgeText;
      if (isKnownCdn) {
        badgeText = `Known CDN: ${label}`;
      } else if (label === 'Unsupported CDN') {
        badgeText = 'Unsupported CDN';
      } else {
        badgeText = `Unsupported CDN: ${label}`;
      }
      badge.textContent = badgeText;
      cardTop.appendChild(badge);

      const meta = document.createElement('p');
      meta.className = 'prod-network-meta';
      meta.textContent = detail;
      cardBody.appendChild(meta);
    } catch (err) {
      logProdNetworkDiag({
        step: 'ipwho-row-failed',
        ip,
        errorName: err && typeof err === 'object' && 'name' in err ? err.name : undefined,
        errorMessage: err && typeof err === 'object' && 'message' in err ? err.message : String(err),
        stack: err && typeof err === 'object' && 'stack' in err ? err.stack : undefined,
      });
      li.classList.add('prod-network-error');
      const errP = document.createElement('pre');
      errP.className = 'prod-network-error-detail';
      errP.textContent = err && typeof err === 'object' && 'message' in err ? err.message : String(err);
      cardBody.appendChild(errP);
    }

    li.appendChild(cardTop);
    li.appendChild(cardBody);
    rows.push(li);
    if (idx < ips.length - 1) {
      await new Promise((resolve) => {
        setTimeout(resolve, 400);
      });
    }
  }

  rows.forEach((li) => listEl.appendChild(li));
}

// DOM Elements
const FORM = document.getElementById('cdn-check-form');
const SCORE_SECTION = document.getElementById('score-section');
const RESULTS_SECTION = document.getElementById('results-section');
const ERROR_SECTION = document.getElementById('error-section');
const SCORE_RING = document.querySelector('.score-ring');
const SCORE_NUMBER = document.querySelector('.score-number');
const DETECTED_CDN_VALUE = document.getElementById('detected-cdn-value');

// Check configuration with weights for scoring
const CHECKS = [
  { id: 'check-cdn-config', weight: 20, name: 'CDN Config' },
  { id: 'check-purge', weight: 20, name: 'Push Invalidation' },
  { id: 'check-caching', weight: 15, name: 'Caching' },
  { id: 'check-404-caching', weight: 15, name: '404 Caching' },
  { id: 'check-images', weight: 15, name: 'Image Delivery' },
  { id: 'check-redirects', weight: 15, name: 'Redirects' },
];

// Utility functions
/** @param {string} originTriple branch--site--org */
function buildAemLivePageUrl(originTriple, prodUrlString) {
  const prodUrlObj = new URL(prodUrlString);
  return `https://${originTriple}.aem.live${prodUrlObj.pathname}`;
}

function parseAemUrl(urlString) {
  try {
    const url = new URL(urlString);
    const { hostname, pathname } = url;

    // Check if it's an .aem.live or .aem.page URL
    if (!hostname.endsWith('.aem.live') && !hostname.endsWith('.aem.page')) {
      throw new Error('URL must be an .aem.live or .aem.page domain');
    }

    // Parse: branch--site--org.aem.live
    const parts = hostname.split('.')[0].split('--');
    if (parts.length < 3) {
      throw new Error('Invalid AEM URL format. Expected: branch--site--org.aem.live');
    }

    const [branch, site, org] = parts;
    return {
      url, hostname, pathname, branch, site, org,
    };
  } catch (e) {
    throw new Error(`Invalid URL: ${e.message}`);
  }
}

function showError(message) {
  ERROR_SECTION.setAttribute('aria-hidden', 'false');
  ERROR_SECTION.querySelector('p').textContent = message;
  SCORE_SECTION.setAttribute('aria-hidden', 'true');
  RESULTS_SECTION.setAttribute('aria-hidden', 'true');
}

function hideError() {
  ERROR_SECTION.setAttribute('aria-hidden', 'true');
}

function resetChecks() {
  CHECKS.forEach(({ id }) => {
    const item = document.getElementById(id);
    item.className = 'check-item pending';
    item.querySelector('.check-status').textContent = 'Pending';
    item.querySelector('.check-details').setAttribute('aria-hidden', 'true');
    item.querySelector('.check-result').innerHTML = '';
  });
  // Reset CDN display
  if (DETECTED_CDN_VALUE) {
    DETECTED_CDN_VALUE.textContent = 'Detecting...';
    DETECTED_CDN_VALUE.className = 'cdn-value';
  }
  clearProdNetworkSection();
}

function updateDetectedCdn(cdnType) {
  if (DETECTED_CDN_VALUE && cdnType) {
    const displayName = {
      cloudflare: 'Cloudflare',
      fastly: 'Fastly',
      akamai: 'Akamai',
      cloudfront: 'CloudFront',
      managed: 'Managed (Fastly)',
    };
    DETECTED_CDN_VALUE.textContent = displayName[cdnType] || cdnType;
    DETECTED_CDN_VALUE.className = `cdn-value ${cdnType}`;
  }
}

function updateCheckState(checkId, state, statusText, resultHtml = '') {
  const item = document.getElementById(checkId);
  item.className = `check-item ${state}`;
  item.querySelector('.check-status').textContent = statusText;

  if (resultHtml) {
    const details = item.querySelector('.check-details');
    details.setAttribute('aria-hidden', 'false');
    details.querySelector('.check-result').innerHTML = resultHtml;
  }
}

function addResultLine(checkId, text, type = 'info') {
  const result = document.getElementById(checkId).querySelector('.check-result');
  const line = document.createElement('div');
  line.className = `result-line ${type}`;
  line.textContent = text;
  result.appendChild(line);
  document.getElementById(checkId).querySelector('.check-details').setAttribute('aria-hidden', 'false');
}

function handleAuthError(status, checkId) {
  if (status === 401) {
    updateCheckState(checkId, 'fail', 'Sign In Required');
    addResultLine(checkId, 'You need to sign in to access this project.', 'error');
    addResultLine(checkId, 'Use the profile button (top right) to sign in.', 'info');
    // eslint-disable-next-line no-alert
    alert('Sign in required: Please use the profile button in the top right corner to sign in to this project, then try again.');
    return true;
  }
  if (status === 403) {
    updateCheckState(checkId, 'fail', 'Not Authorized');
    addResultLine(checkId, 'You are not authorized to access this project.', 'error');
    addResultLine(checkId, 'Contact the project admin to request access.', 'info');
    // eslint-disable-next-line no-alert
    alert('Not authorized: You do not have permission to access this project. Contact the project administrator to request access.');
    return true;
  }
  return false;
}

function updateScore(score, inProgress = false) {
  const circumference = 2 * Math.PI * 54; // radius = 54
  const offset = circumference - (score / 100) * circumference;

  SCORE_RING.style.strokeDashoffset = offset;

  // Determine score category
  let category;
  if (inProgress) {
    category = 'in-progress';
  } else if (score < 50) {
    category = 'poor';
  } else if (score < 90) {
    category = 'average';
  } else {
    category = 'good';
  }

  // Use setAttribute for SVG elements (className is read-only on SVG)
  SCORE_RING.setAttribute('class', `score-ring ${category}`);
  SCORE_NUMBER.className = `score-number ${inProgress ? '' : category}`;
  SCORE_NUMBER.textContent = Math.round(score);

  // Update label to show in-progress state
  const scoreLabel = document.querySelector('.score-label');
  if (scoreLabel) {
    scoreLabel.classList.toggle('in-progress', inProgress);
  }
}

// Calculate current score from completed checks
function calculateCurrentScore(scores) {
  let totalScore = 0;
  let totalWeight = 0;

  CHECKS.forEach(({ id, weight }) => {
    const checkScore = scores[id];
    if (checkScore !== undefined) {
      totalScore += checkScore * weight;
      totalWeight += weight;
    }
  });

  return totalWeight > 0 ? Math.round(totalScore / totalWeight) : 0;
}

// Check implementations
async function checkCdnConfig(org, site) {
  const checkId = 'check-cdn-config';
  updateCheckState(checkId, 'running', 'Checking...');

  try {
    // Fetch aggregated config to get CDN settings
    const configUrl = `https://admin.hlx.page/config/${org}/aggregated/${site}.json`;
    const resp = await fetch(configUrl);

    if (!resp.ok) {
      if (handleAuthError(resp.status, checkId)) {
        return { score: 0, cdnConfig: null, authError: true };
      }
      updateCheckState(checkId, 'fail', 'Failed');
      addResultLine(checkId, `Failed to fetch config: ${resp.status}`, 'error');
      return { score: 0, cdnConfig: null };
    }

    const config = await resp.json();
    const cdnConfig = config.cdn?.prod;

    if (!cdnConfig) {
      // No custom CDN - site uses AEM's managed CDN (Fastly)
      updateCheckState(checkId, 'pass', 'Managed');
      addResultLine(checkId, 'Using AEM managed CDN (Fastly)', 'success');
      addResultLine(checkId, 'No custom cdn.prod configuration - site served directly from .aem.live', 'info');
      updateDetectedCdn('managed');
      // Return a synthetic config for the managed CDN (host will be set by caller)
      return { score: 100, cdnConfig: { type: 'managed', host: null } };
    }

    // Check for required fields
    const hasType = !!cdnConfig.type;
    const hasHost = !!cdnConfig.host;

    if (!hasType) {
      updateCheckState(checkId, 'warning', 'Partial Config');
      addResultLine(checkId, 'CDN type is not set', 'warning');
      addResultLine(checkId, `Production host: ${cdnConfig.host || 'not set'}`, 'info');
      return { score: 50, cdnConfig };
    }

    if (!hasHost) {
      updateCheckState(checkId, 'warning', 'Partial Config');
      addResultLine(checkId, `CDN type: ${cdnConfig.type}`, 'success');
      addResultLine(checkId, 'Production host is not set', 'warning');
      return { score: 50, cdnConfig };
    }

    updateCheckState(checkId, 'pass', 'Configured');
    addResultLine(checkId, `CDN type: ${cdnConfig.type}`, 'success');
    addResultLine(checkId, `Production host: ${cdnConfig.host}`, 'success');

    // Update the prominent CDN display
    updateDetectedCdn(cdnConfig.type);

    // Check for additional CDN-specific settings
    if (cdnConfig.route) {
      addResultLine(checkId, `Routes: ${Array.isArray(cdnConfig.route) ? cdnConfig.route.join(', ') : cdnConfig.route}`, 'info');
    }

    return { score: 100, cdnConfig };
  } catch (e) {
    updateCheckState(checkId, 'fail', 'Error');
    addResultLine(checkId, `Error: ${e.message}`, 'error');
    return { score: 0, cdnConfig: null };
  }
}

async function checkPurge(cdnConfig) {
  const checkId = 'check-purge';

  // Skip for managed CDN - purge handled automatically
  if (cdnConfig?.type === 'managed' || !cdnConfig?.host) {
    updateCheckState(checkId, 'skip', 'N/A');
    addResultLine(checkId, 'Managed CDN: Push invalidation handled automatically', 'info');
    return { score: 100, skipped: true };
  }

  if (!cdnConfig.type) {
    updateCheckState(checkId, 'skip', 'Skipped');
    addResultLine(checkId, 'Skipped: CDN type not configured', 'warning');
    return { score: 0 };
  }

  updateCheckState(checkId, 'running', 'Testing...');

  try {
    // Build purge test request based on CDN type
    const purgeUrl = 'https://helix-pages.anywhere.run/helix-services/byocdn-push-invalidation/v1';

    // Prepare form data based on CDN type
    const formData = new URLSearchParams();
    formData.append('type', cdnConfig.type);
    formData.append('host', cdnConfig.host);

    // Add CDN-specific credentials
    switch (cdnConfig.type) {
      case 'fastly':
        if (cdnConfig.serviceId) formData.append('serviceId', cdnConfig.serviceId);
        if (cdnConfig.authToken) formData.append('authToken', cdnConfig.authToken);
        break;
      case 'cloudflare':
        if (cdnConfig.zoneId) formData.append('zoneId', cdnConfig.zoneId);
        if (cdnConfig.apiToken) formData.append('apiToken', cdnConfig.apiToken);
        break;
      case 'akamai':
        if (cdnConfig.endpoint) formData.append('endpoint', cdnConfig.endpoint);
        if (cdnConfig.clientSecret) formData.append('clientSecret', cdnConfig.clientSecret);
        if (cdnConfig.clientToken) formData.append('clientToken', cdnConfig.clientToken);
        if (cdnConfig.accessToken) formData.append('accessToken', cdnConfig.accessToken);
        break;
      case 'cloudfront':
        if (cdnConfig.distributionId) formData.append('distributionId', cdnConfig.distributionId);
        if (cdnConfig.accessKeyId) formData.append('accessKeyId', cdnConfig.accessKeyId);
        if (cdnConfig.secretAccessKey) formData.append('secretAccessKey', cdnConfig.secretAccessKey);
        break;
      case 'managed':
        // Managed CDN doesn't need additional credentials
        updateCheckState(checkId, 'pass', 'Managed CDN');
        addResultLine(checkId, 'Using managed CDN - push invalidation handled automatically', 'success');
        return { score: 100 };
      default:
        updateCheckState(checkId, 'warning', 'Unknown Type');
        addResultLine(checkId, `Unknown CDN type: ${cdnConfig.type}`, 'warning');
        return { score: 50 };
    }

    const resp = await fetch(purgeUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formData.toString(),
    });

    const result = await resp.json();

    // Helper to check if purge status indicates success
    const isSuccessStatus = (status) => ['ok', 'succeeded', 200].includes(status);

    // Check URL purge result
    if (result.urlPurge) {
      if (isSuccessStatus(result.urlPurge.status)) {
        addResultLine(checkId, 'URL purge: Working', 'success');
      } else {
        addResultLine(checkId, `URL purge: ${result.urlPurge.status || 'Failed'}`, 'error');
      }
    }

    // Check key purge result
    if (result.keyPurge) {
      if (isSuccessStatus(result.keyPurge.status)) {
        addResultLine(checkId, 'Key purge: Working', 'success');
      } else {
        addResultLine(checkId, `Key purge: ${result.keyPurge.status || 'Failed'}`, 'warning');
      }
    }

    // Determine overall status
    const urlOk = isSuccessStatus(result.urlPurge?.status);
    const keyOk = isSuccessStatus(result.keyPurge?.status);

    if (urlOk && keyOk) {
      updateCheckState(checkId, 'pass', 'Working');
      return { score: 100 };
    }
    if (urlOk || keyOk) {
      updateCheckState(checkId, 'warning', 'Partial');
      return { score: 75 };
    }

    updateCheckState(checkId, 'fail', 'Failed');
    addResultLine(checkId, 'Push invalidation credentials may be invalid or expired', 'error');
    return { score: 0 };
  } catch (e) {
    updateCheckState(checkId, 'fail', 'Error');
    addResultLine(checkId, `Error testing purge: ${e.message}`, 'error');
    return { score: 0 };
  }
}

// Helper to get cache status info from headers
function getCacheStatus(headers) {
  const getHeader = (name) => {
    if (Array.isArray(headers)) {
      const h = headers.find((hdr) => hdr.name.toLowerCase() === name.toLowerCase());
      return h?.value || '';
    }
    return headers.get?.(name) || '';
  };

  const xCache = getHeader('x-cache');
  const cfCacheStatus = getHeader('cf-cache-status');
  const age = parseInt(getHeader('age') || '0', 10);
  const xCacheHits = getHeader('x-cache-hits');

  // Determine if it's a hit
  // For Cloudflare: cf-cache-status should be "HIT"
  // For Fastly/Varnish: x-cache should contain "HIT" (not MISS)
  // For Akamai: x-cache contains TCP_HIT variants
  let isHit = false;
  let reason = '';

  if (cfCacheStatus) {
    isHit = cfCacheStatus.toUpperCase() === 'HIT';
    reason = `cf-cache-status: ${cfCacheStatus}`;
  } else if (xCache) {
    // Check if ALL layers show HIT (not just one)
    // x-cache: "HIT, HIT" or "HIT" means cached
    // x-cache: "MISS, MISS" or "HIT, MISS" means not fully cached
    const cacheValues = xCache.split(',').map((v) => v.trim().toUpperCase());
    const allHits = cacheValues.every((v) => v.includes('HIT') || v.includes('TCP_HIT') || v.includes('TCP_MEM_HIT') || v.includes('TCP_REFRESH_HIT'));
    const anyHit = cacheValues.some((v) => v.includes('HIT'));
    isHit = allHits || (anyHit && age > 0);
    reason = `x-cache: ${xCache}`;
  } else if (age > 0) {
    isHit = true;
    reason = `age: ${age}`;
  }

  // Also check x-cache-hits for Fastly (should be > 0 for a hit)
  if (xCacheHits && !isHit) {
    const hits = xCacheHits.split(',').map((v) => parseInt(v.trim(), 10));
    if (hits.some((h) => h > 0)) {
      isHit = true;
      reason = `x-cache-hits: ${xCacheHits}`;
    }
  }

  return {
    isHit, age, xCache, cfCacheStatus, xCacheHits, reason,
  };
}

async function checkCaching(cdnConfig, aemUrl, prodPageUrlOverride = null) {
  const checkId = 'check-caching';

  const prodUrl = prodPageUrlOverride
    ? new URL(prodPageUrlOverride).href
    : null;
  const prodHost = cdnConfig?.host || aemUrl.host;

  if (!prodUrl && !prodHost) {
    updateCheckState(checkId, 'skip', 'Skipped');
    addResultLine(checkId, 'Skipped: Production host not configured', 'warning');
    return { score: 0 };
  }

  const urlToTest = prodUrl || `https://${prodHost}${aemUrl.pathname}`;

  updateCheckState(checkId, 'running', 'Testing...');

  try {
    if (prodPageUrlOverride) {
      addResultLine(checkId, 'Using supplied production URL', 'info');
    }
    addResultLine(checkId, `Testing: ${urlToTest}`, 'info');

    // First request using reveal=headers to get actual CDN headers
    const resp1 = await fetch(corsProxy(urlToTest, { revealHeaders: true }), {
      method: 'GET',
    });

    if (!resp1.ok) {
      throw new Error(`Proxy request failed: ${resp1.status}`);
    }

    const data1 = await resp1.json();
    const status1 = parseInt(data1.status, 10);
    const headers1 = data1.headers || [];

    if (status1 >= 400) {
      updateCheckState(checkId, 'fail', 'Unreachable');
      addResultLine(checkId, `Production URL returned ${status1}`, 'error');
      return { score: 0 };
    }

    // Helper to get header value
    const getHeader1 = (name) => headers1.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || '';

    // Use configured CDN type (CORS proxy masks actual CDN headers)
    // For managed sites without cdn.prod, AEM uses Fastly
    const detectedCdn = cdnConfig?.type || 'managed';

    // Display relevant cache headers
    const cacheHeaderNames = [
      'cache-control', 'x-cache', 'x-cache-hits', 'cf-cache-status',
      'age', 'x-served-by', 'x-check-cacheable',
    ];

    addResultLine(checkId, 'Cache headers:', 'info');
    let foundAny = false;
    cacheHeaderNames.forEach((name) => {
      const value = getHeader1(name);
      if (value) {
        addResultLine(checkId, `  ${name}: ${value}`, 'info');
        foundAny = true;
      }
    });

    if (!foundAny) {
      addResultLine(checkId, '  (no cache headers found)', 'warning');
    }

    // Wait before second request
    await new Promise((resolve) => { setTimeout(resolve, 1000); });

    // Second request
    const resp2 = await fetch(corsProxy(urlToTest, { revealHeaders: true }), {
      method: 'GET',
    });

    if (!resp2.ok) {
      throw new Error(`Second proxy request failed: ${resp2.status}`);
    }

    const data2 = await resp2.json();
    const headers2 = data2.headers || [];

    // Get cache status from both requests
    const cache1 = getCacheStatus(headers1);
    const cache2 = getCacheStatus(headers2);

    // Show relevant cache header based on CDN type
    if (detectedCdn === 'cloudflare') {
      addResultLine(checkId, `Second request - cf-cache-status: ${cache2.cfCacheStatus || 'none'}, Age: ${cache2.age}`, 'info');
    } else {
      addResultLine(checkId, `Second request - x-cache: ${cache2.xCache || 'none'}, Age: ${cache2.age}`, 'info');
    }

    // Check if content is being cached (second request should show a hit or increased age)
    const cached = cache2.isHit || (cache2.age > cache1.age);

    if (cached) {
      updateCheckState(checkId, 'pass', 'Caching Active');
      addResultLine(checkId, 'Content is being cached by CDN', 'success');
      return { score: 100 };
    }

    // Check cache-control header
    const cacheControl = getHeader1('cache-control');
    if (cacheControl.includes('no-cache') || cacheControl.includes('no-store') || cacheControl.includes('private')) {
      updateCheckState(checkId, 'warning', 'Not Cacheable');
      addResultLine(checkId, 'Content may not be cacheable due to Cache-Control header', 'warning');
      return { score: 50 };
    }

    updateCheckState(checkId, 'warning', 'Not Cached');
    addResultLine(checkId, 'Content does not appear to be cached', 'warning');
    return { score: 25 };
  } catch (e) {
    updateCheckState(checkId, 'fail', 'Error');
    addResultLine(checkId, `Error: ${e.message}`, 'error');
    return { score: 0 };
  }
}

async function check404Caching(cdnConfig, aemUrl) {
  const checkId = 'check-404-caching';

  // Use production host, or aem.live host for managed CDN
  const prodHost = cdnConfig?.host || aemUrl.host;

  if (!prodHost) {
    updateCheckState(checkId, 'skip', 'Skipped');
    addResultLine(checkId, 'Skipped: Production host not configured', 'warning');
    return { score: 0 };
  }

  updateCheckState(checkId, 'running', 'Testing...');

  try {
    // Create a URL that is very unlikely to exist, appended to the original pathname
    const basePath = aemUrl.pathname.endsWith('/') ? aemUrl.pathname : `${aemUrl.pathname}/`;
    const notFoundPath = `${basePath}404-check-doesnt-exist-${Math.random().toString(36).substring(7)}`;
    const prodUrl = `https://${prodHost}${notFoundPath}`;

    addResultLine(checkId, `Testing: ${prodUrl}`, 'info');

    // First request using reveal=headers to get actual CDN headers
    const resp1 = await fetch(corsProxy(prodUrl, { revealHeaders: true }), {
      method: 'GET',
    });

    if (!resp1.ok) {
      throw new Error(`Proxy request failed: ${resp1.status}`);
    }

    let data1 = await resp1.json();
    let status1 = parseInt(data1.status, 10);
    let headers1 = data1.headers || [];

    // Use configured CDN type (CORS proxy masks actual CDN headers)
    const detectedCdn = cdnConfig?.type || 'managed';

    let urlForSecondRequest = prodUrl;

    if (status1 === 301) {
      const getHeader = (name) => headers1.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || '';
      const location = getHeader('location');
      if (location) {
        const targetUrl = new URL(location, prodUrl).href;
        addResultLine(checkId, 'Received 301 redirect, checking Location URL for caching', 'info');
        addResultLine(checkId, `Target: ${targetUrl}`, 'info');

        const targetResp1 = await fetch(corsProxy(targetUrl, { revealHeaders: true }), { method: 'GET' });
        if (!targetResp1.ok) {
          throw new Error(`Redirect target request failed: ${targetResp1.status}`);
        }
        data1 = await targetResp1.json();
        status1 = parseInt(data1.status, 10);
        headers1 = data1.headers || [];
        urlForSecondRequest = targetUrl;
      } else {
        addResultLine(checkId, '301 without Location header', 'warning');
      }
    } else if (status1 !== 404) {
      addResultLine(checkId, `Unexpected status: ${status1} (expected 404)`, 'warning');
    } else {
      addResultLine(checkId, 'First request: 404 response received', 'info');
    }

    // Get cache info from first request
    const cache1 = getCacheStatus(headers1);

    // Show relevant cache header based on CDN type
    const cacheDisplay = (cache, label) => {
      if (detectedCdn === 'cloudflare') {
        addResultLine(checkId, `${label} - cf-cache-status: ${cache.cfCacheStatus || 'none'}, Age: ${cache.age}`, 'info');
      } else {
        addResultLine(checkId, `${label} - x-cache: ${cache.xCache || 'none'}, Age: ${cache.age}`, 'info');
      }
    };

    cacheDisplay(cache1, 'First request');

    // Wait a moment
    await new Promise((resolve) => { setTimeout(resolve, 1500); });

    // Second request (to same URL as we have headers for: prodUrl or redirect target)
    const resp2 = await fetch(corsProxy(urlForSecondRequest, { revealHeaders: true }), {
      method: 'GET',
    });

    if (!resp2.ok) {
      throw new Error(`Second proxy request failed: ${resp2.status}`);
    }

    const data2 = await resp2.json();
    const headers2 = data2.headers || [];

    // Get cache info from second request
    const cache2 = getCacheStatus(headers2);
    cacheDisplay(cache2, 'Second request');

    // Check if content is being cached (second request should show a hit or increased age)
    const isCached = cache2.isHit || (cache2.age > cache1.age);
    const isRedirectTarget = urlForSecondRequest !== prodUrl;
    const contentLabel = isRedirectTarget ? 'Redirect target' : '404 responses';

    if (isCached) {
      updateCheckState(checkId, 'pass', isRedirectTarget ? 'Redirect Cached' : '404s Cached');
      addResultLine(checkId, `${contentLabel} are cached (${cache2.reason})`, 'success');
      return { score: 100 };
    }

    // Check if cache-control prevents caching
    const getHeader1 = (name) => headers1.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || '';
    const cacheControl = getHeader1('cache-control');
    if (cacheControl.includes('no-cache') || cacheControl.includes('no-store') || cacheControl.includes('private')) {
      updateCheckState(checkId, 'warning', 'Not Cacheable');
      addResultLine(checkId, `Cache-Control: ${cacheControl}`, 'warning');
      addResultLine(checkId, `${contentLabel} may not be cacheable due to headers`, 'warning');
      return { score: 50 };
    }

    updateCheckState(checkId, 'warning', 'Not Cached');
    addResultLine(checkId, `${contentLabel} do not appear to be cached`, 'warning');
    return { score: 25 };
  } catch (e) {
    updateCheckState(checkId, 'fail', 'Error');
    addResultLine(checkId, `Error: ${e.message}`, 'error');
    return { score: 0 };
  }
}

function mimeBase(contentType) {
  if (!contentType) return '';
  return contentType.split(';')[0].trim().toLowerCase();
}

/** SVG / format=svg often differs by bytes across origins while still correct delivery. */
function isLikelySvgAsset(urlString, contentType) {
  const u = (urlString || '').toLowerCase();
  if (u.includes('format=svg') || /\.svg(\?|#|$)/i.test(u)) return true;
  return mimeBase(contentType) === 'image/svg+xml';
}

async function checkImages(cdnConfig, aemUrl, org, site, branch, prodPageUrlOverride = null) {
  const checkId = 'check-images';

  // Skip for managed CDN - images served from same origin (unless prod URL supplied for rewriting)
  if (!cdnConfig?.host && !prodPageUrlOverride) {
    updateCheckState(checkId, 'skip', 'N/A');
    addResultLine(checkId, 'Managed CDN: Images served from same origin', 'info');
    return { score: 100, skipped: true };
  }

  updateCheckState(checkId, 'running', 'Analyzing...');

  try {
    // Fetch the page content from .aem.live to find images
    const aemPageUrl = `https://${branch}--${site}--${org}.aem.live${aemUrl.pathname}`;
    const prodPageUrl = prodPageUrlOverride
      ? new URL(prodPageUrlOverride).href
      : `https://${cdnConfig.host}${aemUrl.pathname}`;
    const prodOrigin = prodPageUrlOverride
      ? new URL(prodPageUrlOverride).origin
      : `https://${cdnConfig.host}`;

    if (prodPageUrlOverride) {
      addResultLine(checkId, 'Using supplied production page URL for comparison', 'info');
    }

    const pageResp = await fetch(corsProxy(aemPageUrl));
    if (!pageResp.ok) {
      updateCheckState(checkId, 'fail', 'Page Error');
      addResultLine(checkId, `Could not fetch page: ${pageResp.status}`, 'error');
      return { score: 0 };
    }

    const html = await pageResp.text();

    // Parse HTML to find images
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const images = doc.querySelectorAll('img[src]');

    if (images.length === 0) {
      updateCheckState(checkId, 'pass', 'No Images');
      addResultLine(checkId, 'No images found on this page to compare', 'info');
      return { score: 100 };
    }

    // Get first few images for comparison
    const imagesToCheck = Array.from(images).slice(0, 3);
    let passCount = 0;
    let failCount = 0;

    await Promise.all(imagesToCheck.map(async (img) => {
      const imgSrc = img.getAttribute('src');
      if (!imgSrc || imgSrc.startsWith('data:')) return;

      // Resolve URLs with page as base so relative paths (e.g. ./media_xxx.png) normalize
      let aemImgUrl;
      let prodImgUrl;

      if (imgSrc.startsWith('http')) {
        aemImgUrl = new URL(imgSrc).href;
        const aemOrigin = new RegExp(
          `^https?://${branch}--${site}--${org}\\.aem\\.(live|page)`,
        );
        prodImgUrl = new URL(imgSrc).href.replace(aemOrigin, prodOrigin);
      } else {
        aemImgUrl = new URL(imgSrc, aemPageUrl).href;
        prodImgUrl = new URL(imgSrc, prodPageUrl).href;
      }

      try {
        // GET via CORS proxy; compare decompressed body bytes (Content-Length header often
        // reflects wire size for gzip/br and does not match the decoded arrayBuffer length).
        const [aemResp, prodResp] = await Promise.all([
          fetch(corsProxy(aemImgUrl), { method: 'GET' }),
          fetch(corsProxy(prodImgUrl), { method: 'GET' }),
        ]);

        const aemType = aemResp.headers.get('content-type');
        const prodType = prodResp.headers.get('content-type');

        let aemBodyBytes = null;
        let prodBodyBytes = null;
        if (aemResp.ok && prodResp.ok) {
          const [aemBuf, prodBuf] = await Promise.all([
            aemResp.arrayBuffer(),
            prodResp.arrayBuffer(),
          ]);
          aemBodyBytes = aemBuf.byteLength;
          prodBodyBytes = prodBuf.byteLength;
        }

        const shortSrc = imgSrc.length > 50 ? `...${imgSrc.slice(-47)}` : imgSrc;

        if (aemResp.ok && prodResp.ok) {
          const aemSize = String(aemBodyBytes);
          const prodSize = String(prodBodyBytes);
          const bothSvg = isLikelySvgAsset(aemImgUrl, aemType)
            && isLikelySvgAsset(prodImgUrl, prodType);
          const sizeMatch = aemSize === prodSize;
          const typeMatch = mimeBase(aemType) === mimeBase(prodType);

          if ((bothSvg && typeMatch) || (sizeMatch && typeMatch)) {
            addResultLine(checkId, `✓ ${shortSrc}`, 'success');
            addResultLine(checkId, `  AEM: ${aemImgUrl}`, 'info');
            addResultLine(checkId, `  Prod: ${prodImgUrl}`, 'info');
            if (bothSvg && typeMatch && !sizeMatch) {
              addResultLine(
                checkId,
                `  SVG: body bytes differ (AEM=${aemSize}, prod=${prodSize}); MIME matches — counted as match`,
                'info',
              );
            }
            passCount += 1;
          } else {
            addResultLine(checkId, `! ${shortSrc}`, 'warning');
            addResultLine(checkId, `  AEM: ${aemImgUrl}`, 'info');
            addResultLine(checkId, `  Prod: ${prodImgUrl}`, 'info');
            if (!sizeMatch) {
              addResultLine(checkId, `  Body bytes: AEM=${aemSize}, Prod=${prodSize}`, 'warning');
            }
            if (!typeMatch) {
              addResultLine(checkId, `  Type: AEM=${aemType}, Prod=${prodType}`, 'warning');
            }
            failCount += 1;
          }
        } else {
          addResultLine(checkId, `✗ ${shortSrc}: Not found on production`, 'error');
          addResultLine(checkId, `  AEM: ${aemImgUrl}`, 'info');
          addResultLine(checkId, `  Prod: ${prodImgUrl}`, 'info');
          failCount += 1;
        }
      } catch (imgError) {
        addResultLine(checkId, `? ${imgSrc}: Could not compare`, 'warning');
        addResultLine(checkId, `  AEM: ${aemImgUrl}`, 'info');
        addResultLine(checkId, `  Prod: ${prodImgUrl}`, 'info');
      }
    }));

    // Calculate score
    const total = passCount + failCount;
    if (total === 0) {
      updateCheckState(checkId, 'pass', 'No Images');
      return { score: 100 };
    }

    const score = Math.round((passCount / total) * 100);

    if (score === 100) {
      updateCheckState(checkId, 'pass', 'Matching');
      addResultLine(checkId, `All ${passCount} images match between AEM and production`, 'success');
    } else if (score >= 50) {
      updateCheckState(checkId, 'warning', 'Partial Match');
    } else {
      updateCheckState(checkId, 'fail', 'Mismatch');
    }

    return { score };
  } catch (e) {
    updateCheckState(checkId, 'fail', 'Error');
    addResultLine(checkId, `Error: ${e.message}`, 'error');
    return { score: 0 };
  }
}

async function checkRedirects(org, site, branch, cdnConfig) {
  const checkId = 'check-redirects';

  updateCheckState(checkId, 'running', 'Testing...');

  try {
    // Fetch redirects.json
    const redirectsUrl = `https://${branch}--${site}--${org}.aem.live/redirects.json`;
    const resp = await fetch(corsProxy(redirectsUrl));

    if (!resp.ok) {
      if (resp.status === 404) {
        updateCheckState(checkId, 'pass', 'No Redirects');
        addResultLine(checkId, 'No redirects.json found - nothing to test', 'info');
        return { score: 100 };
      }
      updateCheckState(checkId, 'fail', 'Fetch Error');
      addResultLine(checkId, `Could not fetch redirects.json: ${resp.status}`, 'error');
      return { score: 0 };
    }

    const data = await resp.json();
    const redirects = data.data || data[':names']?.map((name) => data[name]) || [];

    if (!Array.isArray(redirects) || redirects.length === 0) {
      updateCheckState(checkId, 'pass', 'No Redirects');
      addResultLine(checkId, 'No redirects defined in redirects.json', 'info');
      return { score: 100 };
    }

    // Get first redirect for testing
    const firstRedirect = redirects[0];
    const source = firstRedirect.source || firstRedirect.Source || firstRedirect.from;
    const destination = firstRedirect.destination || firstRedirect.Destination || firstRedirect.to;

    if (!source) {
      updateCheckState(checkId, 'warning', 'Invalid Format');
      addResultLine(checkId, 'Could not parse redirect source', 'warning');
      return { score: 50 };
    }

    addResultLine(checkId, `Testing redirect: ${source} → ${destination || '(dynamic)'}`, 'info');

    // Generate random query parameter
    const randomParam = `_cdncheck=${Math.random().toString(36).substring(7)}`;

    // Determine base URL for testing
    const baseHost = cdnConfig?.host
      ? `https://${cdnConfig.host}`
      : `https://${branch}--${site}--${org}.aem.live`;

    // Construct test URL with query param
    const testUrl = `${baseHost}${source}${source.includes('?') ? '&' : '?'}${randomParam}`;

    addResultLine(checkId, `Request: ${testUrl}`, 'info');

    // Use reveal=headers to get the raw redirect response without following it
    const aemTestUrl = `https://${branch}--${site}--${org}.aem.live${source}${source.includes('?') ? '&' : '?'}${randomParam}`;

    try {
      const testResp = await fetch(corsProxy(aemTestUrl, { revealHeaders: true }), {
        method: 'GET',
      });

      if (!testResp.ok) {
        throw new Error(`Proxy request failed: ${testResp.status}`);
      }

      const proxyData = await testResp.json();
      const status = parseInt(proxyData.status, 10);

      addResultLine(checkId, `Response status: ${status}`, 'info');

      // Check if it's a redirect (3xx)
      if (status >= 300 && status < 400) {
        // Find the location header
        const locationHeader = proxyData.headers?.find(
          (h) => h.name.toLowerCase() === 'location',
        );

        if (locationHeader) {
          const locationValue = locationHeader.value;
          addResultLine(checkId, `Location: ${locationValue}`, 'info');

          // Check if query param is preserved
          if (locationValue.includes(randomParam)) {
            updateCheckState(checkId, 'pass', 'Params Preserved');
            addResultLine(checkId, 'Query parameters are correctly preserved in redirect', 'success');
            return { score: 100 };
          }

          updateCheckState(checkId, 'fail', 'Params Lost');
          addResultLine(checkId, 'Query parameters are NOT preserved in redirect', 'error');
          addResultLine(checkId, `Expected ${randomParam} in Location header`, 'error');
          return { score: 0 };
        }

        updateCheckState(checkId, 'warning', 'No Location');
        addResultLine(checkId, 'Redirect response missing Location header', 'warning');
        return { score: 50 };
      }

      // Not a redirect
      if (status === 200) {
        updateCheckState(checkId, 'warning', 'No Redirect');
        addResultLine(checkId, 'URL did not redirect (200 response)', 'warning');
        addResultLine(checkId, 'The configured redirect may not be active', 'warning');
        return { score: 50 };
      }

      if (status === 404) {
        updateCheckState(checkId, 'warning', 'Not Found');
        addResultLine(checkId, 'Redirect source returned 404', 'warning');
        return { score: 50 };
      }

      updateCheckState(checkId, 'warning', 'Unexpected');
      addResultLine(checkId, `Unexpected status code: ${status}`, 'warning');
      return { score: 50 };
    } catch (proxyError) {
      addResultLine(checkId, `Test error: ${proxyError.message}`, 'error');
      updateCheckState(checkId, 'fail', 'Error');
      return { score: 0 };
    }
  } catch (e) {
    updateCheckState(checkId, 'fail', 'Error');
    addResultLine(checkId, `Error: ${e.message}`, 'error');
    return { score: 0 };
  }
}

// Main check runner
async function runChecks(pageUrl, prodPageUrl = null) {
  hideError();
  resetChecks();

  // Parse URL
  let aemUrl;
  try {
    aemUrl = parseAemUrl(pageUrl);
  } catch (e) {
    showError(e.message);
    return;
  }

  const {
    org, site, branch,
  } = aemUrl;

  // Ensure login
  if (!await ensureLogin(org, site)) {
    // Wait for login event
    window.addEventListener('profile-update', async ({ detail: loginInfo }) => {
      if (loginInfo.includes(org)) {
        runChecks(pageUrl, prodPageUrl);
      }
    }, { once: true });
    return;
  }

  const prodForGate = prodPageUrl && String(prodPageUrl).trim();
  if (prodForGate) {
    await populateProdNetworkIntel(prodForGate);
    try {
      const resp = await fetch(corsProxy(prodForGate, { revealHeaders: true }), {
        method: 'GET',
        cache: 'no-store',
      });
      if (!resp.ok) {
        throw new Error(`Proxy request failed: ${resp.status}`);
      }
      const data = await resp.json();
      const status = parseInt(data.status, 10);
      if (status !== 200) {
        showError(`Production page URL must return HTTP 200 before running checks. Received ${Number.isNaN(status) ? 'unknown' : status} for ${prodForGate}`);
        return;
      }
    } catch (e) {
      showError(`Production URL check failed: ${e.message}`);
      return;
    }
  }

  // Show results sections
  SCORE_SECTION.setAttribute('aria-hidden', 'false');
  RESULTS_SECTION.setAttribute('aria-hidden', 'false');

  // Initialize score display with in-progress state
  updateScore(0, true);

  // Run checks sequentially and collect scores
  const scores = {};

  // Check 1: CDN Config
  const configResult = await checkCdnConfig(org, site);
  scores['check-cdn-config'] = configResult.score;
  updateScore(calculateCurrentScore(scores), true);
  const { cdnConfig } = configResult;

  // Stop if there was an auth error - no point continuing
  if (configResult.authError) {
    // Mark remaining checks as skipped
    ['check-purge', 'check-caching', 'check-404-caching', 'check-images', 'check-redirects'].forEach((id) => {
      updateCheckState(id, 'skip', 'Skipped');
      addResultLine(id, 'Skipped due to authentication error', 'warning');
    });
    updateScore(0, false);
    return;
  }

  // Check 2: Push Invalidation
  const purgeResult = await checkPurge(cdnConfig);
  scores['check-purge'] = purgeResult.score;
  updateScore(calculateCurrentScore(scores), true);

  // Check 3: Caching Behavior
  const cachingResult = await checkCaching(cdnConfig, aemUrl, prodPageUrl || undefined);
  scores['check-caching'] = cachingResult.score;
  updateScore(calculateCurrentScore(scores), true);

  // Check 4: 404 Caching
  const caching404Result = await check404Caching(cdnConfig, aemUrl);
  scores['check-404-caching'] = caching404Result.score;
  updateScore(calculateCurrentScore(scores), true);

  // Check 5: Image Delivery
  const imagesResult = await checkImages(
    cdnConfig,
    aemUrl,
    org,
    site,
    branch,
    prodPageUrl || undefined,
  );
  scores['check-images'] = imagesResult.score;
  updateScore(calculateCurrentScore(scores), true);

  // Check 6: Redirects
  const redirectsResult = await checkRedirects(org, site, branch, cdnConfig);
  scores['check-redirects'] = redirectsResult.score;

  // Final score update - remove in-progress state
  const finalScore = calculateCurrentScore(scores);
  updateScore(finalScore, false);
}

// Origin discovery from CDN headers
function extractOriginFromHeaders(headers) {
  // Look for cache key headers from various CDNs:
  // - Fastly: surrogate-key
  // - Akamai: x-cache-key, x-true-cache-key
  // - Cloudflare: x-cache-tag (custom header from AEM origin)
  const surrogateKey = headers.get('surrogate-key') || '';
  const cacheKey = headers.get('x-cache-key') || headers.get('x-true-cache-key') || '';
  const cacheTag = headers.get('x-cache-tag') || headers.get('cache-tag') || '';
  const allKeys = `${surrogateKey} ${cacheKey} ${cacheTag}`;

  // Debug: log all headers received
  /* eslint-disable no-console */
  console.group('Origin Discovery Debug - Headers');
  console.log('Headers received:');
  headers.forEach((value, name) => {
    console.log(`  ${name}: ${value}`);
  });
  console.log('surrogate-key:', surrogateKey || '(not found)');
  console.log('x-cache-key:', cacheKey || '(not found)');
  console.log('x-cache-tag:', cacheTag || '(not found)');
  console.log('All keys to search:', allKeys || '(empty)');
  /* eslint-enable no-console */

  // Pattern: branch--site--org (with optional suffix like _head, _metadata)
  // Examples: main--helix-website--adobe, main--helix-website--adobe_head
  const pattern = /([a-z0-9-]+)--([a-z0-9-]+)--([a-z0-9-]+)(?:_[a-z]+)?/gi;
  const matches = allKeys.matchAll(pattern);

  const origins = new Set();
  // eslint-disable-next-line no-restricted-syntax
  for (const match of matches) {
    const [fullMatch, branch, site, org] = match;
    // eslint-disable-next-line no-console
    console.log('Found match:', fullMatch, '→', `${branch}--${site}--${org}`);
    origins.add(`${branch}--${site}--${org}`);
  }

  // eslint-disable-next-line no-console
  console.log('Origins found from headers:', Array.from(origins));
  // eslint-disable-next-line no-console
  console.groupEnd();

  return Array.from(origins);
}

// Fallback: Extract origin from HTML content
function extractOriginFromHtml(html) {
  /* eslint-disable no-console */
  console.group('Origin Discovery Debug - HTML Fallback');

  // Look for URLs matching AEM Edge Delivery patterns
  // Patterns: branch--site--org.aem.live, branch--site--org.aem.page,
  //           branch--site--org.hlx.live, branch--site--org.hlx.page
  const urlPattern = /https?:\/\/([a-z0-9-]+--[a-z0-9-]+--[a-z0-9-]+)\.(aem|hlx)\.(live|page)/gi;
  const matches = html.matchAll(urlPattern);

  const origins = new Set();
  // eslint-disable-next-line no-restricted-syntax
  for (const match of matches) {
    const [fullUrl, origin] = match;
    console.log('Found AEM URL in HTML:', fullUrl, '→', origin);
    origins.add(origin);
  }

  console.log('Origins found from HTML:', Array.from(origins));
  console.groupEnd();
  /* eslint-enable no-console */

  return Array.from(origins);
}

async function discoverOrigin(prodUrl) {
  // Send debug headers to get CDN to include cache keys in response
  const debugHeaders = {
    'Fastly-Debug': '1',
    Pragma: 'akamai-x-cache-on, akamai-x-cache-remote-on, akamai-x-check-cacheable, akamai-x-get-cache-key, akamai-x-get-true-cache-key, akamai-x-get-cache-tags',
  };

  // eslint-disable-next-line no-console
  console.log('Sending request with debug headers:', debugHeaders);

  const resp = await fetch(corsProxy(prodUrl), {
    method: 'GET',
    cache: 'no-store',
    headers: debugHeaders,
  });

  if (!resp.ok) {
    throw new Error(`Failed to fetch: ${resp.status}`);
  }

  // Try to extract origin from CDN headers first
  let origins = extractOriginFromHeaders(resp.headers);

  // Fallback: parse HTML content for AEM URLs
  if (origins.length === 0) {
    // eslint-disable-next-line no-console
    console.log('No origins found in headers, trying HTML fallback...');
    const html = await resp.text();
    origins = extractOriginFromHtml(html);
  }

  if (origins.length === 0) {
    throw new Error('No AEM origin found. The site may not be using AEM Edge Delivery Services, or no .aem.live/.hlx.live references were found in the page.');
  }

  return origins;
}

function setOriginDetectHint(text) {
  const el = document.getElementById('origin-detect-hint');
  if (el) el.textContent = text || '';
}

function showManualAemField() {
  const wrapper = document.getElementById('aem-url-field-wrapper');
  if (wrapper) wrapper.hidden = false;
}

function setupManualAemEntry() {
  const link = document.getElementById('enter-aem-manual-link');
  const wrapper = document.getElementById('aem-url-field-wrapper');
  const aemInput = document.getElementById('url');
  if (!link || !wrapper || !aemInput) return;

  link.addEventListener('click', (e) => {
    e.preventDefault();
    wrapper.hidden = false;
    aemInput.focus();
  });
}

function updateShareableQuery(prodPageUrl, aemPageUrl) {
  const p = new URLSearchParams();
  if (prodPageUrl) p.set('prodPageUrl', prodPageUrl);
  if (aemPageUrl) p.set('url', aemPageUrl);
  const qs = p.toString();
  const path = window.location.pathname;
  window.history.replaceState(null, '', qs ? `${path}?${qs}` : path);
}

async function runChecksWithSubmitUi(pageUrl, prodPageUrl) {
  const submitButton = FORM.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  submitButton.textContent = 'Checking...';
  try {
    await runChecks(pageUrl, prodPageUrl);
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = 'Run CDN Check';
  }
}

function setupFormSubmit() {
  const prodInput = document.getElementById('prod-page-url');
  const aemInput = document.getElementById('url');

  FORM.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideError();
    setOriginDetectHint('');

    const prod = prodInput.value.trim();
    const aemManual = aemInput.value.trim();

    if (aemManual) {
      try {
        parseAemUrl(aemManual);
      } catch (err) {
        showError(err.message);
        return;
      }
      updateShareableQuery(prod || null, aemManual);
      await runChecksWithSubmitUi(aemManual, prod || null);
      return;
    }

    if (!prod) {
      showError('Enter your production page URL, or use “Enter AEM page URL manually” and provide your .aem.live or .aem.page page URL.');
      return;
    }

    try {
      // eslint-disable-next-line no-new
      new URL(prod);
    } catch {
      showError('Enter a valid production page URL.');
      return;
    }

    setOriginDetectHint('Detecting AEM origin…');
    try {
      const origins = await discoverOrigin(prod);
      const aemPageUrl = buildAemLivePageUrl(origins[0], prod);
      if (origins.length > 1) {
        // eslint-disable-next-line no-console
        console.log('Multiple origins found:', origins);
      }
      aemInput.value = aemPageUrl;
      setOriginDetectHint('');
      updateShareableQuery(prod, aemPageUrl);
      await runChecksWithSubmitUi(aemPageUrl, prod);
    } catch (err) {
      setOriginDetectHint('');
      showManualAemField();
      showError(`Could not detect your AEM origin automatically: ${err.message} Enter your AEM page URL above and run the check again.`);
      aemInput.focus();
    }
  });
}

// Event listeners and initialization
function setupEventListeners() {
  setupManualAemEntry();
  setupFormSubmit();

  // Toggle check details on click
  document.querySelectorAll('.check-header').forEach((header) => {
    header.addEventListener('click', () => {
      const item = header.closest('.check-item');
      const details = item.querySelector('.check-details');
      const isHidden = details.getAttribute('aria-hidden') === 'true';
      details.setAttribute('aria-hidden', !isHidden);
      item.classList.toggle('expanded', isHidden);
    });
  });

  // Handle reset button
  FORM.addEventListener('reset', (e) => {
    e.preventDefault();
    // Clear URL and redirect to base page
    window.location.href = window.location.pathname;
  });
}

// Auto-run check if URL query params are present
async function init() {
  setupEventListeners();

  const params = new URLSearchParams(window.location.search);
  const urlParam = params.get('url');
  const prodPageUrlParam = params.get('prodPageUrl');

  const prodPageUrlInput = document.getElementById('prod-page-url');
  const aemInput = document.getElementById('url');

  if (urlParam) {
    aemInput.value = urlParam;
    if (prodPageUrlParam) {
      prodPageUrlInput.value = prodPageUrlParam;
    }
    await runChecksWithSubmitUi(urlParam, prodPageUrlParam || null);
    return;
  }

  if (prodPageUrlParam) {
    prodPageUrlInput.value = prodPageUrlParam;
    setOriginDetectHint('Detecting AEM origin…');
    try {
      const origins = await discoverOrigin(prodPageUrlParam);
      const aemPageUrl = buildAemLivePageUrl(origins[0], prodPageUrlParam);
      if (origins.length > 1) {
        // eslint-disable-next-line no-console
        console.log('Multiple origins found:', origins);
      }
      aemInput.value = aemPageUrl;
      setOriginDetectHint('');
      updateShareableQuery(prodPageUrlParam, aemPageUrl);
      await runChecksWithSubmitUi(aemPageUrl, prodPageUrlParam);
    } catch (err) {
      setOriginDetectHint('');
      showManualAemField();
      showError(`Could not detect your AEM origin automatically: ${err.message} Enter your AEM page URL above and run the check again.`);
    }
  }
}

// Initialize
init();
