/* eslint-disable no-await-in-loop */
import { LitElement, html, nothing } from 'lit';
import { fetchAggregatedConfig } from '../../services/adminApi.js';
import '../../blocks/eds-button/eds-button.js';
import { edsIcon } from '../../utils/icons.js';

import getSheet from '../../utils/sheet.js';
import { sharedSheet } from '../../styles/page-sheets.js';
const sheet = await getSheet(new URL('./cdn-health-check.css', import.meta.url).pathname);

const CORS_PROXY_URL = 'https://www.fcors.org';
const CORS_PROXY_KEY = 'iyIjewSFgBzbPVG3';
const PURGE_SERVICE_URL = 'https://helix-pages.anywhere.run/helix-services/byocdn-push-invalidation/v1';

function corsProxy(url, options = {}) {
  let proxyUrl = `${CORS_PROXY_URL}?url=${encodeURIComponent(url)}&key=${CORS_PROXY_KEY}`;
  if (options.revealHeaders) proxyUrl += '&reveal=headers';
  return proxyUrl;
}

function getProxyHeader(headers, name) {
  if (Array.isArray(headers)) {
    const h = headers.find((hdr) => hdr.name.toLowerCase() === name.toLowerCase());
    return h?.value || '';
  }
  return '';
}

function getCacheStatus(headers) {
  const xCache = getProxyHeader(headers, 'x-cache');
  const cfCacheStatus = getProxyHeader(headers, 'cf-cache-status');
  const age = parseInt(getProxyHeader(headers, 'age') || '0', 10);
  const xCacheHits = getProxyHeader(headers, 'x-cache-hits');

  let isHit = false;
  let reason = '';

  if (cfCacheStatus) {
    isHit = cfCacheStatus.toUpperCase() === 'HIT';
    reason = `cf-cache-status: ${cfCacheStatus}`;
  } else if (xCache) {
    const cacheValues = xCache.split(',').map((v) => v.trim().toUpperCase());
    const allHits = cacheValues.every(
      (v) => v.includes('HIT') || v.includes('TCP_HIT')
        || v.includes('TCP_MEM_HIT') || v.includes('TCP_REFRESH_HIT'),
    );
    const anyHit = cacheValues.some((v) => v.includes('HIT'));
    isHit = allHits || (anyHit && age > 0);
    reason = `x-cache: ${xCache}`;
  } else if (age > 0) {
    isHit = true;
    reason = `age: ${age}`;
  }

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

const CDN_NAMES = {
  cloudflare: 'Cloudflare',
  fastly: 'Fastly',
  akamai: 'Akamai',
  cloudfront: 'CloudFront',
  managed: 'Managed (Fastly)',
};

const CHECKS = [
  {
    id: 'config', label: 'CDN Production Config', desc: 'Checks if cdn.prod.* configuration is set for your site.', weight: 20,
  },
  {
    id: 'purge', label: 'Push Invalidation', desc: 'Validates that CDN purge/invalidation credentials are working.', weight: 20,
  },
  {
    id: 'caching', label: 'Caching Behavior', desc: 'Verifies cache headers and CDN caching via repeated requests.', weight: 15,
  },
  {
    id: '404-caching', label: '404 Caching', desc: 'Verifies that 404 responses are being cached by the CDN.', weight: 15,
  },
  {
    id: 'images', label: 'Image Delivery', desc: 'Compares images served from .aem.live and the production domain.', weight: 15,
  },
  {
    id: 'redirects', label: 'Redirect Query Params', desc: 'Tests that redirects preserve query parameters correctly.', weight: 15,
  },
];

export class CdnHealthCheck extends LitElement {
  static properties = {
    org: { type: String },
    site: { type: String },
    _running: { state: true },
    _checks: { state: true },
    _score: { state: true },
    _detectedCdn: { state: true },
    _hasRun: { state: true },
  };

  constructor() {
    super();
    this.org = '';
    this.site = '';
    this._running = false;
    this._checks = {};
    this._score = 0;
    this._detectedCdn = '';
    this._hasRun = false;
  }

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [sharedSheet, sheet];
  }

  get _aemHost() {
    return `main--${this.site}--${this.org}.aem.live`;
  }

  get _aemBaseUrl() {
    return `https://${this._aemHost}`;
  }

  // ── Runner ────────────────────────────────────────────
  async _runChecks() {
    if (!this.org || !this.site) return;

    this._running = true;
    this._checks = {};
    this._score = 0;
    this._detectedCdn = '';
    this._hasRun = true;

    const scores = {};

    // 1. CDN Config
    const cfgResult = await this._checkConfig();
    scores.config = cfgResult.score;
    this._score = this._calc(scores);
    const { cdnConfig } = cfgResult;

    if (cfgResult.authError) {
      ['purge', 'caching', '404-caching', 'images', 'redirects'].forEach((id) => {
        this._set(id, 'skip', 'Skipped', ['Skipped due to authentication error']);
      });
      this._score = 0;
      this._running = false;
      return;
    }

    // 2. Push Invalidation
    scores.purge = (await this._checkPurge(cdnConfig)).score;
    this._score = this._calc(scores);

    const prodHost = cdnConfig?.host || this._aemHost;

    // 3. Caching
    scores.caching = (await this._checkCaching(cdnConfig, prodHost)).score;
    this._score = this._calc(scores);

    // 4. 404 Caching
    scores['404-caching'] = (await this._check404(cdnConfig, prodHost)).score;
    this._score = this._calc(scores);

    // 5. Image Delivery
    scores.images = (await this._checkImages(cdnConfig)).score;
    this._score = this._calc(scores);

    // 6. Redirects
    scores.redirects = (await this._checkRedirects(cdnConfig)).score;

    // Final score — remove in-progress state
    this._score = this._calc(scores);
    this._running = false;
  }

  _calc(scores) {
    let totalScore = 0;
    let totalWeight = 0;
    CHECKS.forEach((c) => {
      if (scores[c.id] !== undefined) {
        totalScore += scores[c.id] * c.weight;
        totalWeight += c.weight;
      }
    });
    return totalWeight > 0 ? Math.round(totalScore / totalWeight) : 0;
  }

  _set(id, state, status, logs = []) {
    this._checks = {
      ...this._checks,
      [id]: { state, status, logs: [...(this._checks[id]?.logs || []), ...logs] },
    };
  }

  _log(id, msg) {
    const c = this._checks[id] || { state: 'running', status: 'Running', logs: [] };
    this._checks = { ...this._checks, [id]: { ...c, logs: [...c.logs, msg] } };
  }

  // ── 1. Config ─────────────────────────────────────────
  async _checkConfig() {
    this._set('config', 'running', 'Checking...');
    try {
      const { data, status } = await fetchAggregatedConfig(this.org, this.site);
      if (status === 401) {
        this._set('config', 'fail', 'Sign In Required', ['You need to sign in.']);
        return { score: 0, cdnConfig: null, authError: true };
      }
      if (status === 403) {
        this._set('config', 'fail', 'Not Authorized', ['Not authorized.']);
        return { score: 0, cdnConfig: null, authError: true };
      }
      if (status !== 200 || !data) {
        this._set('config', 'fail', 'Failed', [`Config fetch: ${status}`]);
        return { score: 0, cdnConfig: null };
      }

      const cdnConfig = data.cdn?.prod;

      if (!cdnConfig) {
        this._set('config', 'pass', 'Managed', [
          'Using AEM managed CDN (Fastly)',
          'No custom cdn.prod configuration — site served directly from .aem.live',
        ]);
        this._detectedCdn = 'managed';
        return { score: 100, cdnConfig: { type: 'managed', host: null } };
      }

      if (!cdnConfig.type) {
        this._set('config', 'warning', 'Partial Config', [
          'CDN type is not set',
          `Production host: ${cdnConfig.host || 'not set'}`,
        ]);
        return { score: 50, cdnConfig };
      }
      if (!cdnConfig.host) {
        this._set('config', 'warning', 'Partial Config', [
          `CDN type: ${cdnConfig.type}`,
          'Production host is not set',
        ]);
        return { score: 50, cdnConfig };
      }

      this._detectedCdn = cdnConfig.type;
      const logs = [`CDN type: ${cdnConfig.type}`, `Production host: ${cdnConfig.host}`];
      if (cdnConfig.route) {
        logs.push(`Routes: ${Array.isArray(cdnConfig.route) ? cdnConfig.route.join(', ') : cdnConfig.route}`);
      }
      this._set('config', 'pass', 'Configured', logs);
      return { score: 100, cdnConfig };
    } catch (e) {
      this._set('config', 'fail', 'Error', [e.message]);
      return { score: 0, cdnConfig: null };
    }
  }

  // ── 2. Push Invalidation ──────────────────────────────
  async _checkPurge(cdnConfig) {
    if (cdnConfig?.type === 'managed' || !cdnConfig?.host) {
      this._set('purge', 'skip', 'N/A', ['Managed CDN: Push invalidation handled automatically']);
      return { score: 100 };
    }
    if (!cdnConfig.type) {
      this._set('purge', 'skip', 'Skipped', ['CDN type not configured']);
      return { score: 0 };
    }

    this._set('purge', 'running', 'Testing...');
    try {
      const fd = new URLSearchParams();
      fd.append('type', cdnConfig.type);
      fd.append('host', cdnConfig.host);
      const creds = {
        fastly: ['serviceId', 'authToken'],
        cloudflare: ['zoneId', 'apiToken'],
        akamai: ['endpoint', 'clientSecret', 'clientToken', 'accessToken'],
        cloudfront: ['distributionId', 'accessKeyId', 'secretAccessKey'],
      };
      (creds[cdnConfig.type] || []).forEach((k) => {
        if (cdnConfig[k]) fd.append(k, cdnConfig[k]);
      });

      const resp = await fetch(PURGE_SERVICE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: fd.toString(),
      });
      let result;
      try {
        result = await resp.json();
      } catch {
        throw new Error(`Purge service returned non-JSON response (HTTP ${resp.status})`);
      }
      const ok = (s) => ['ok', 'succeeded', 200].includes(s);
      const urlOk = ok(result.urlPurge?.status);
      const keyOk = ok(result.keyPurge?.status);
      const logs = [];
      if (result.urlPurge) logs.push(`URL purge: ${urlOk ? 'Working' : (result.urlPurge.status || 'Failed')}`);
      if (result.keyPurge) logs.push(`Key purge: ${keyOk ? 'Working' : (result.keyPurge.status || 'Failed')}`);

      if (urlOk && keyOk) {
        this._set('purge', 'pass', 'Working', logs);
        return { score: 100 };
      }
      if (urlOk || keyOk) {
        this._set('purge', 'warning', 'Partial', logs);
        return { score: 75 };
      }
      this._set('purge', 'fail', 'Failed', [...logs, 'Push invalidation credentials may be invalid or expired']);
      return { score: 0 };
    } catch (e) {
      this._set('purge', 'fail', 'Error', [e.message]);
      return { score: 0 };
    }
  }

  // ── 3. Caching ────────────────────────────────────────
  async _checkCaching(cdnConfig, prodHost) {
    const urlToTest = `https://${prodHost}/`;
    this._set('caching', 'running', 'Testing...');
    try {
      this._log('caching', `Testing: ${urlToTest}`);

      const resp1 = await fetch(corsProxy(urlToTest, { revealHeaders: true }), { method: 'GET' });
      if (!resp1.ok) throw new Error(`Proxy request failed: ${resp1.status}`);
      const data1 = await resp1.json();
      const s1 = parseInt(data1.status, 10);
      const h1 = data1.headers || [];

      if (s1 >= 400) {
        this._set('caching', 'fail', 'Unreachable', [`Production URL returned ${s1}`]);
        return { score: 0 };
      }

      const det = cdnConfig?.type || 'managed';
      const hdrNames = ['cache-control', 'x-cache', 'x-cache-hits', 'cf-cache-status', 'age', 'x-served-by', 'x-check-cacheable'];
      this._log('caching', 'Cache headers:');
      let any = false;
      hdrNames.forEach((n) => {
        const v = getProxyHeader(h1, n);
        if (v) { this._log('caching', `  ${n}: ${v}`); any = true; }
      });
      if (!any) this._log('caching', '  (no cache headers found)');

      await new Promise((r) => { setTimeout(r, 1000); });

      const resp2 = await fetch(corsProxy(urlToTest, { revealHeaders: true }), { method: 'GET' });
      if (!resp2.ok) throw new Error(`Second proxy request failed: ${resp2.status}`);
      const data2 = await resp2.json();
      const h2 = data2.headers || [];
      const c1 = getCacheStatus(h1);
      const c2 = getCacheStatus(h2);

      if (det === 'cloudflare') {
        this._log('caching', `Second request - cf-cache-status: ${c2.cfCacheStatus || 'none'}, Age: ${c2.age}`);
      } else {
        this._log('caching', `Second request - x-cache: ${c2.xCache || 'none'}, Age: ${c2.age}`);
      }

      if (c2.isHit || c2.age > c1.age) {
        this._set('caching', 'pass', 'Caching Active', ['Content is being cached by CDN']);
        return { score: 100 };
      }
      const cc = getProxyHeader(h1, 'cache-control');
      if (cc.includes('no-cache') || cc.includes('no-store') || cc.includes('private')) {
        this._set('caching', 'warning', 'Not Cacheable', ['Content may not be cacheable due to Cache-Control header']);
        return { score: 50 };
      }
      this._set('caching', 'warning', 'Not Cached', ['Content does not appear to be cached']);
      return { score: 25 };
    } catch (e) {
      this._set('caching', 'fail', 'Error', [e.message]);
      return { score: 0 };
    }
  }

  // ── 4. 404 Caching ────────────────────────────────────
  async _check404(cdnConfig, prodHost) {
    const basePath = '/';
    const notFoundPath = `${basePath}404-check-doesnt-exist-${Math.random().toString(36).substring(7)}`;
    const testUrl = `https://${prodHost}${notFoundPath}`;
    this._set('404-caching', 'running', 'Testing...');
    try {
      this._log('404-caching', `Testing: ${testUrl}`);
      const resp1 = await fetch(corsProxy(testUrl, { revealHeaders: true }), { method: 'GET' });
      if (!resp1.ok) throw new Error(`Proxy: ${resp1.status}`);
      let d1 = await resp1.json();
      let s1 = parseInt(d1.status, 10);
      let h1 = d1.headers || [];
      let url2 = testUrl;
      const det = cdnConfig?.type || 'managed';

      if (s1 === 301) {
        const loc = getProxyHeader(h1, 'location');
        if (loc) {
          const target = new URL(loc, testUrl).href;
          this._log('404-caching', `Received 301, following to: ${target}`);
          const tr = await fetch(corsProxy(target, { revealHeaders: true }), { method: 'GET' });
          if (!tr.ok) throw new Error(`Redirect target: ${tr.status}`);
          d1 = await tr.json();
          s1 = parseInt(d1.status, 10);
          h1 = d1.headers || [];
          url2 = target;
        } else {
          this._log('404-caching', '301 without Location header');
        }
      } else if (s1 === 404) {
        this._log('404-caching', 'First request: 404 response received');
      } else {
        this._log('404-caching', `Unexpected status: ${s1} (expected 404)`);
      }

      const c1 = getCacheStatus(h1);
      const cDisp = (cache, label) => {
        if (det === 'cloudflare') {
          this._log('404-caching', `${label} - cf-cache-status: ${cache.cfCacheStatus || 'none'}, Age: ${cache.age}`);
        } else {
          this._log('404-caching', `${label} - x-cache: ${cache.xCache || 'none'}, Age: ${cache.age}`);
        }
      };
      cDisp(c1, 'First request');

      await new Promise((r) => { setTimeout(r, 1500); });

      const resp2 = await fetch(corsProxy(url2, { revealHeaders: true }), { method: 'GET' });
      if (!resp2.ok) throw new Error(`Second: ${resp2.status}`);
      const d2 = await resp2.json();
      const c2 = getCacheStatus(d2.headers || []);
      cDisp(c2, 'Second request');

      const isRedir = url2 !== testUrl;
      const lbl = isRedir ? 'Redirect target' : '404 responses';

      if (c2.isHit || c2.age > c1.age) {
        this._set('404-caching', 'pass', isRedir ? 'Redirect Cached' : '404s Cached', [`${lbl} are cached (${c2.reason})`]);
        return { score: 100 };
      }
      const cc = getProxyHeader(h1, 'cache-control');
      if (cc.includes('no-cache') || cc.includes('no-store') || cc.includes('private')) {
        this._set('404-caching', 'warning', 'Not Cacheable', [`Cache-Control: ${cc}`, `${lbl} may not be cacheable`]);
        return { score: 50 };
      }
      this._set('404-caching', 'warning', 'Not Cached', [`${lbl} do not appear to be cached`]);
      return { score: 25 };
    } catch (e) {
      this._set('404-caching', 'fail', 'Error', [e.message]);
      return { score: 0 };
    }
  }

  // ── 5. Images ─────────────────────────────────────────
  async _checkImages(cdnConfig) {
    if (!cdnConfig?.host) {
      this._set('images', 'skip', 'N/A', ['Managed CDN: Images served from same origin']);
      return { score: 100 };
    }
    this._set('images', 'running', 'Analyzing...');
    try {
      const aemPage = `${this._aemBaseUrl}/`;
      const prodOrigin = `https://${cdnConfig.host}`;
      const pageResp = await fetch(corsProxy(aemPage));
      if (!pageResp.ok) {
        this._set('images', 'fail', 'Page Error', [`Could not fetch: ${pageResp.status}`]);
        return { score: 0 };
      }
      const pageHtml = await pageResp.text();
      const doc = new DOMParser().parseFromString(pageHtml, 'text/html');
      const imgs = doc.querySelectorAll('img[src]');
      if (imgs.length === 0) {
        this._set('images', 'pass', 'No Images', ['No images found on this page']);
        return { score: 100 };
      }

      let pass = 0;
      let fail = 0;
      for (const img of Array.from(imgs).slice(0, 3)) {
        const src = img.getAttribute('src');
        if (!src || src.startsWith('data:')) continue;
        let aemUrl;
        let prodUrl;
        if (src.startsWith('http')) {
          aemUrl = new URL(src).href;
          prodUrl = aemUrl.replace(
            new RegExp(`^https?://main--${this.site}--${this.org}\\.aem\\.(live|page)`),
            prodOrigin,
          );
        } else {
          aemUrl = new URL(src, aemPage).href;
          prodUrl = new URL(src, `${prodOrigin}/`).href;
        }
        try {
          const [ar, pr] = await Promise.all([
            fetch(corsProxy(aemUrl)),
            fetch(corsProxy(prodUrl)),
          ]);
          const short = src.length > 50 ? `...${src.slice(-47)}` : src;
          if (ar.ok && pr.ok) {
            const sm = ar.headers.get('content-length') === pr.headers.get('content-length');
            const tm = ar.headers.get('content-type') === pr.headers.get('content-type');
            if (sm && tm) {
              this._log('images', `✓ ${short}`);
              pass += 1;
            } else {
              this._log('images', `! ${short}`);
              if (!sm) this._log('images', '  Size differs');
              if (!tm) this._log('images', '  Type differs');
              fail += 1;
            }
          } else {
            this._log('images', `✗ ${short}: Not found on production`);
            fail += 1;
          }
        } catch {
          this._log('images', `? ${src}: Could not compare`);
        }
      }
      const tot = pass + fail;
      if (tot === 0) {
        this._set('images', 'pass', 'No Images');
        return { score: 100 };
      }
      const sc = Math.round((pass / tot) * 100);
      if (sc === 100) this._set('images', 'pass', 'Matching', [`All ${pass} images match between AEM and production`]);
      else if (sc >= 50) this._set('images', 'warning', 'Partial Match');
      else this._set('images', 'fail', 'Mismatch');
      return { score: sc };
    } catch (e) {
      this._set('images', 'fail', 'Error', [e.message]);
      return { score: 0 };
    }
  }

  // ── 6. Redirects ──────────────────────────────────────
  async _checkRedirects(cdnConfig) {
    this._set('redirects', 'running', 'Testing...');
    try {
      const rUrl = `${this._aemBaseUrl}/redirects.json`;
      const resp = await fetch(corsProxy(rUrl));
      if (!resp.ok) {
        if (resp.status === 404) {
          this._set('redirects', 'pass', 'No Redirects', ['No redirects.json found — nothing to test']);
          return { score: 100 };
        }
        this._set('redirects', 'fail', 'Fetch Error', [`Could not fetch redirects.json: ${resp.status}`]);
        return { score: 0 };
      }
      const data = await resp.json();
      const rds = data.data || [];
      if (!Array.isArray(rds) || rds.length === 0) {
        this._set('redirects', 'pass', 'No Redirects', ['No redirects defined']);
        return { score: 100 };
      }
      const first = rds[0];
      const source = first.source || first.Source || first.from;
      const dest = first.destination || first.Destination || first.to;
      if (!source) {
        this._set('redirects', 'warning', 'Invalid Format', ['Could not parse redirect source']);
        return { score: 50 };
      }
      this._log('redirects', `Testing redirect: ${source} → ${dest || '(dynamic)'}`);

      const rp = `_cdncheck=${Math.random().toString(36).substring(7)}`;
      const aemTestUrl = `${this._aemBaseUrl}${source}${source.includes('?') ? '&' : '?'}${rp}`;
      this._log('redirects', `Request: ${aemTestUrl}`);

      const tr = await fetch(corsProxy(aemTestUrl, { revealHeaders: true }), { method: 'GET' });
      if (!tr.ok) throw new Error(`Proxy: ${tr.status}`);
      const pd = await tr.json();
      const st = parseInt(pd.status, 10);
      this._log('redirects', `Response status: ${st}`);

      if (st >= 300 && st < 400) {
        const loc = (pd.headers || []).find((h) => h.name.toLowerCase() === 'location');
        if (loc) {
          this._log('redirects', `Location: ${loc.value}`);
          if (loc.value.includes(rp)) {
            this._set('redirects', 'pass', 'Params Preserved', ['Query parameters correctly preserved in redirect']);
            return { score: 100 };
          }
          this._set('redirects', 'fail', 'Params Lost', [
            'Query parameters NOT preserved in redirect',
            `Expected ${rp} in Location header`,
          ]);
          return { score: 0 };
        }
        this._set('redirects', 'warning', 'No Location', ['Redirect response missing Location header']);
        return { score: 50 };
      }
      if (st === 200) {
        this._set('redirects', 'warning', 'No Redirect', [
          'URL did not redirect (200 response)',
          'The configured redirect may not be active',
        ]);
        return { score: 50 };
      }
      if (st === 404) {
        this._set('redirects', 'warning', 'Not Found', ['Redirect source returned 404']);
        return { score: 50 };
      }
      this._set('redirects', 'warning', 'Unexpected', [`Unexpected status: ${st}`]);
      return { score: 50 };
    } catch (e) {
      this._set('redirects', 'fail', 'Error', [e.message]);
      return { score: 0 };
    }
  }

  // ── Rendering helpers ─────────────────────────────────
  /* eslint-disable indent */
  _renderCheckIcon(state) {
    switch (state) {
      case 'pass':
        return html`<span class="check-icon pass">${edsIcon('checkmark', { size: 16 })}</span>`;
      case 'fail':
        return html`<span class="check-icon fail">${edsIcon('close', { size: 16 })}</span>`;
      case 'warning':
        return html`<span class="check-icon warning">${edsIcon('alert', { size: 16 })}</span>`;
      case 'skip':
        return html`<span class="check-icon skip">—</span>`;
      case 'running':
        return html`<span class="check-icon running"><span class="spinner s"></span></span>`;
      default:
        return html`<span class="check-icon pending">?</span>`;
    }
  }
  /* eslint-enable indent */

  render() {
    const { _score: score } = this;
    const circumference = 2 * Math.PI * 54;
    const dashOff = circumference - (score / 100) * circumference;
    const has = this._hasRun;
    const cdn = this._detectedCdn;
    const cdnLabel = CDN_NAMES[cdn] || cdn;
    let scoreClass;
    if (this._running) scoreClass = 'in-progress';
    else if (score < 50) scoreClass = 'poor';
    else if (score < 90) scoreClass = 'average';
    else scoreClass = 'good';

    return html`
      <div class="health-check">
        <div class="score-section" ?hidden=${!has}>
          ${cdn ? html`
            <div class="detected-cdn">
              <span class="cdn-label">CDN:</span>
              <span class="cdn-value ${cdn}">${cdnLabel}</span>
            </div>
          ` : nothing}
          <div class="score-gauge">
            <svg viewBox="0 0 120 120" class="score-svg">
              <circle class="score-bg" cx="60" cy="60" r="54" />
              <circle class="score-ring ${scoreClass}" cx="60" cy="60" r="54"
                style="stroke-dashoffset: ${this._running ? circumference : dashOff}" />
            </svg>
            <div class="score-value-wrap">
              <span class="score-number ${scoreClass}">${this._running ? '...' : score}</span>
            </div>
          </div>
          <div class="score-label ${this._running ? 'in-progress' : ''}">CDN Health Score</div>
          ${!this._running ? html`
            <div class="score-legend">
              <span class="legend-item poor">0–49 Poor</span>
              <span class="legend-item average">50–89 Needs Work</span>
              <span class="legend-item good">90–100 Good</span>
            </div>
          ` : nothing}
        </div>

        <div class="actions">
          <eds-button variant="accent" ?disabled=${this._running} @click=${this._runChecks}>
            ${this._running
              ? html`<span slot="icon"><span class="spinner s"></span></span> Running...`
              : 'Run Health Check'}
          </eds-button>
        </div>

        ${has ? html`
          <div class="check-results">
            <h3 class="results-title">Check Results</h3>
            <ul class="check-list">
              ${CHECKS.map((c) => {
                const s = this._checks[c.id];
                const state = s?.state || 'pending';
                const expanded = s?.logs?.length > 0;
                const variant = state === 'pass' ? 'positive'
                  : state === 'fail' ? 'negative'
                  : state === 'warning' ? 'notice'
                  : state === 'running' ? 'informative'
                  : 'neutral';
                return html`
                  <li class="check-item ${state} ${expanded ? 'expanded' : ''}">
                    <div class="check-header">
                      ${this._renderCheckIcon(state)}
                      <span class="check-title">${c.label}</span>
                      <span class="status-light ${variant}">${s?.status || 'Pending'}</span>
                    </div>
                    <div class="check-details" aria-hidden=${!expanded}>
                      <p class="check-description">${c.desc}</p>
                      ${s?.logs?.length ? html`
                        <div class="check-result">
                          ${s.logs.map((l) => html`<div class="result-line">${l}</div>`)}
                        </div>
                      ` : nothing}
                    </div>
                  </li>`;
              })}
            </ul>
          </div>
        ` : html`<p class="empty">Click "Run Health Check" to validate your CDN configuration.</p>`}
      </div>
    `;
  }

}

customElements.define('cdn-health-check', CdnHealthCheck);
