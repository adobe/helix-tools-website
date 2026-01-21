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

// DOM Elements
const FORM = document.getElementById('cdn-check-form');
const SCORE_SECTION = document.getElementById('score-section');
const RESULTS_SECTION = document.getElementById('results-section');
const ERROR_SECTION = document.getElementById('error-section');
const SCORE_RING = document.querySelector('.score-ring');
const SCORE_NUMBER = document.querySelector('.score-number');

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
      updateCheckState(checkId, 'fail', 'Not Configured');
      addResultLine(checkId, 'No cdn.prod configuration found', 'error');
      addResultLine(checkId, 'Configure CDN settings in your site config or via Config Service', 'info');
      return { score: 0, cdnConfig: null };
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

  if (!cdnConfig || !cdnConfig.type || !cdnConfig.host) {
    updateCheckState(checkId, 'skip', 'Skipped');
    addResultLine(checkId, 'Skipped: CDN config not available', 'warning');
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

async function checkCaching(cdnConfig, aemUrl) {
  const checkId = 'check-caching';

  if (!cdnConfig || !cdnConfig.host) {
    updateCheckState(checkId, 'skip', 'Skipped');
    addResultLine(checkId, 'Skipped: Production host not configured', 'warning');
    return { score: 0 };
  }

  updateCheckState(checkId, 'running', 'Testing...');

  try {
    const prodUrl = `https://${cdnConfig.host}${aemUrl.pathname}`;

    // Build request headers - include Akamai debug Pragma if using Akamai
    const requestHeaders = {};
    if (cdnConfig.type === 'akamai') {
      requestHeaders.Pragma = 'akamai-x-cache-on, akamai-x-cache-remote-on, akamai-x-check-cacheable, akamai-x-get-cache-key, akamai-x-get-true-cache-key, akamai-x-get-cache-tags';
    }

    // Make first request (via CORS proxy)
    const resp1 = await fetch(corsProxy(prodUrl), {
      method: 'GET', // Use GET since proxy may not support HEAD
      cache: 'no-store',
      headers: requestHeaders,
    });

    if (!resp1.ok) {
      updateCheckState(checkId, 'fail', 'Unreachable');
      addResultLine(checkId, `Production URL returned ${resp1.status}`, 'error');
      return { score: 0 };
    }

    // Collect cache headers
    const cacheHeaders = {};
    const headerNames = [
      'cache-control',
      'x-cache',
      'x-cache-hits',
      'cf-cache-status',
      'x-fastly-request-id',
      'x-served-by',
      'age',
      'via',
      // Akamai headers
      'x-akamai-transformed',
      'x-akamai-session-info',
      'x-check-cacheable',
      'x-cache-key',
      'x-true-cache-key',
      'x-cache-tags',
      // CloudFront headers
      'x-amz-cf-id',
      'x-amz-cf-pop',
    ];

    headerNames.forEach((name) => {
      const value = resp1.headers.get(name);
      if (value) {
        cacheHeaders[name] = value;
      }
    });

    // Display found headers
    const foundHeaders = Object.keys(cacheHeaders);
    if (foundHeaders.length > 0) {
      addResultLine(checkId, 'Cache headers found:', 'info');
      foundHeaders.forEach((name) => {
        addResultLine(checkId, `  ${name}: ${cacheHeaders[name]}`, 'info');
      });
    } else {
      addResultLine(checkId, 'No CDN cache headers detected', 'warning');
    }

    // Make second request to check if caching is working
    await new Promise((resolve) => { setTimeout(resolve, 500); });

    const resp2 = await fetch(corsProxy(prodUrl), {
      method: 'GET',
      cache: 'no-store',
      headers: requestHeaders,
    });

    // Compare age headers or cache status
    const age1 = parseInt(resp1.headers.get('age') || '0', 10);
    const age2 = parseInt(resp2.headers.get('age') || '0', 10);

    const cacheStatus2 = resp2.headers.get('x-cache')
      || resp2.headers.get('cf-cache-status')
      || '';

    // Determine CDN type from headers
    let detectedCdn = 'Unknown';
    if (resp1.headers.get('cf-cache-status')) detectedCdn = 'Cloudflare';
    else if (resp1.headers.get('x-fastly-request-id')) detectedCdn = 'Fastly';
    else if (resp1.headers.get('x-akamai-transformed')
      || resp1.headers.get('x-akamai-session-info')
      || resp1.headers.get('x-check-cacheable')
      || resp1.headers.get('x-cache-key')) detectedCdn = 'Akamai';
    else if (resp1.headers.get('x-amz-cf-id')) detectedCdn = 'CloudFront';

    addResultLine(checkId, `Detected CDN: ${detectedCdn}`, 'info');

    // Check if content is being cached
    // Different CDNs use different values:
    // - Cloudflare: HIT, MISS, DYNAMIC, etc.
    // - Fastly: HIT, MISS
    // - Akamai: TCP_HIT, TCP_MISS, TCP_REFRESH_HIT, TCP_REFRESH_MISS, etc.
    // - CloudFront: Hit from cloudfront, Miss from cloudfront
    const isCached = cacheStatus2.toLowerCase().includes('hit')
      || cacheStatus2.includes('TCP_HIT')
      || cacheStatus2.includes('TCP_REFRESH_HIT')
      || cacheStatus2.includes('TCP_MEM_HIT')
      || cacheStatus2.includes('TCP_IMS_HIT')
      || age2 > age1
      || (age2 > 0);

    if (isCached) {
      updateCheckState(checkId, 'pass', 'Caching Active');
      addResultLine(checkId, 'Content is being cached by CDN', 'success');
      return { score: 100 };
    }

    // Check cache-control header
    const cacheControl = resp1.headers.get('cache-control') || '';
    if (cacheControl.includes('no-cache') || cacheControl.includes('no-store') || cacheControl.includes('private')) {
      updateCheckState(checkId, 'warning', 'Not Cacheable');
      addResultLine(checkId, `Cache-Control: ${cacheControl}`, 'warning');
      addResultLine(checkId, 'Content may not be cacheable due to headers', 'warning');
      return { score: 50 };
    }

    updateCheckState(checkId, 'warning', 'Uncertain');
    addResultLine(checkId, 'Could not confirm caching is active', 'warning');
    return { score: 50 };
  } catch (e) {
    updateCheckState(checkId, 'fail', 'Error');
    addResultLine(checkId, `Error: ${e.message}`, 'error');
    return { score: 0 };
  }
}

async function check404Caching(cdnConfig, aemUrl) {
  const checkId = 'check-404-caching';

  if (!cdnConfig || !cdnConfig.host) {
    updateCheckState(checkId, 'skip', 'Skipped');
    addResultLine(checkId, 'Skipped: Production host not configured', 'warning');
    return { score: 0 };
  }

  updateCheckState(checkId, 'running', 'Testing...');

  try {
    // Create a URL that is very unlikely to exist, appended to the original pathname
    const basePath = aemUrl.pathname.endsWith('/') ? aemUrl.pathname : `${aemUrl.pathname}/`;
    const notFoundPath = `${basePath}404-check-doesnt-exist-${Math.random().toString(36).substring(7)}`;
    const prodUrl = `https://${cdnConfig.host}${notFoundPath}`;

    addResultLine(checkId, `Testing 404 caching at: ${notFoundPath}`, 'info');

    // Build request headers for CDN debug info
    const requestHeaders = {};
    if (cdnConfig.type === 'akamai') {
      requestHeaders.Pragma = 'akamai-x-cache-on, akamai-x-cache-remote-on, akamai-x-check-cacheable, akamai-x-get-cache-key, akamai-x-get-true-cache-key, akamai-x-get-cache-tags';
    }
    if (cdnConfig.type === 'fastly') {
      requestHeaders['Fastly-Debug'] = '1';
    }

    // First request - should be a cache MISS
    const resp1 = await fetch(corsProxy(prodUrl), {
      method: 'GET',
      cache: 'no-store',
      headers: requestHeaders,
    });

    // Check it's actually a 404
    if (resp1.status !== 404) {
      addResultLine(checkId, `Unexpected status: ${resp1.status} (expected 404)`, 'warning');
      // Continue anyway to check caching behavior
    } else {
      addResultLine(checkId, 'First request: 404 response received', 'info');
    }

    const age1 = parseInt(resp1.headers.get('age') || '0', 10);
    const cacheStatus1 = resp1.headers.get('x-cache')
      || resp1.headers.get('cf-cache-status')
      || '';

    addResultLine(checkId, `First request - Age: ${age1}, Cache: ${cacheStatus1 || 'unknown'}`, 'info');

    // Wait a moment
    await new Promise((resolve) => { setTimeout(resolve, 1000); });

    // Second request - should be a cache HIT if 404s are cached
    const resp2 = await fetch(corsProxy(prodUrl), {
      method: 'GET',
      cache: 'no-store',
      headers: requestHeaders,
    });

    const age2 = parseInt(resp2.headers.get('age') || '0', 10);
    const cacheStatus2 = resp2.headers.get('x-cache')
      || resp2.headers.get('cf-cache-status')
      || '';

    addResultLine(checkId, `Second request - Age: ${age2}, Cache: ${cacheStatus2 || 'unknown'}`, 'info');

    // Check if 404 is being cached
    const isCached = cacheStatus2.toLowerCase().includes('hit')
      || cacheStatus2.includes('TCP_HIT')
      || cacheStatus2.includes('TCP_REFRESH_HIT')
      || cacheStatus2.includes('TCP_MEM_HIT')
      || age2 > age1
      || (age2 > 0);

    if (isCached) {
      updateCheckState(checkId, 'pass', '404s Cached');
      addResultLine(checkId, '404 responses are being cached by CDN', 'success');
      return { score: 100 };
    }

    // Check if cache-control prevents caching
    const cacheControl = resp1.headers.get('cache-control') || '';
    if (cacheControl.includes('no-cache') || cacheControl.includes('no-store') || cacheControl.includes('private')) {
      updateCheckState(checkId, 'warning', 'Not Cacheable');
      addResultLine(checkId, `Cache-Control: ${cacheControl}`, 'warning');
      addResultLine(checkId, '404 responses may not be cacheable due to headers', 'warning');
      return { score: 50 };
    }

    updateCheckState(checkId, 'warning', 'Uncertain');
    addResultLine(checkId, 'Could not confirm 404 caching is active', 'warning');
    return { score: 50 };
  } catch (e) {
    updateCheckState(checkId, 'fail', 'Error');
    addResultLine(checkId, `Error: ${e.message}`, 'error');
    return { score: 0 };
  }
}

async function checkImages(cdnConfig, aemUrl, org, site, branch) {
  const checkId = 'check-images';

  if (!cdnConfig || !cdnConfig.host) {
    updateCheckState(checkId, 'skip', 'Skipped');
    addResultLine(checkId, 'Skipped: Production host not configured', 'warning');
    return { score: 0 };
  }

  updateCheckState(checkId, 'running', 'Analyzing...');

  try {
    // Fetch the page content from .aem.live to find images
    const aemLiveUrl = `https://${branch}--${site}--${org}.aem.live${aemUrl.pathname}`;

    const pageResp = await fetch(corsProxy(aemLiveUrl));
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

      // Construct absolute URLs
      let aemImgUrl;
      let prodImgUrl;

      if (imgSrc.startsWith('http')) {
        aemImgUrl = imgSrc;
        prodImgUrl = imgSrc.replace(
          new RegExp(`https?://${branch}--${site}--${org}\\.aem\\.(live|page)`),
          `https://${cdnConfig.host}`,
        );
      } else {
        aemImgUrl = `https://${branch}--${site}--${org}.aem.live${imgSrc.startsWith('/') ? '' : '/'}${imgSrc}`;
        prodImgUrl = `https://${cdnConfig.host}${imgSrc.startsWith('/') ? '' : '/'}${imgSrc}`;
      }

      try {
        // Fetch both images with HEAD to compare size and type (via CORS proxy)
        const [aemResp, prodResp] = await Promise.all([
          fetch(corsProxy(aemImgUrl), { method: 'GET' }),
          fetch(corsProxy(prodImgUrl), { method: 'GET' }),
        ]);

        const aemSize = aemResp.headers.get('content-length');
        const prodSize = prodResp.headers.get('content-length');
        const aemType = aemResp.headers.get('content-type');
        const prodType = prodResp.headers.get('content-type');

        const shortSrc = imgSrc.length > 50 ? `...${imgSrc.slice(-47)}` : imgSrc;

        if (aemResp.ok && prodResp.ok) {
          const sizeMatch = aemSize === prodSize;
          const typeMatch = aemType === prodType;

          if (sizeMatch && typeMatch) {
            addResultLine(checkId, `✓ ${shortSrc}`, 'success');
            passCount += 1;
          } else {
            addResultLine(checkId, `! ${shortSrc}`, 'warning');
            if (!sizeMatch) {
              addResultLine(checkId, `  Size: AEM=${aemSize}, Prod=${prodSize}`, 'warning');
            }
            if (!typeMatch) {
              addResultLine(checkId, `  Type: AEM=${aemType}, Prod=${prodType}`, 'warning');
            }
            failCount += 1;
          }
        } else {
          addResultLine(checkId, `✗ ${shortSrc}: Not found on production`, 'error');
          failCount += 1;
        }
      } catch (imgError) {
        addResultLine(checkId, `? ${imgSrc}: Could not compare`, 'warning');
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
async function runChecks(pageUrl) {
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
        runChecks(pageUrl);
      }
    }, { once: true });
    return;
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
  const cachingResult = await checkCaching(cdnConfig, aemUrl);
  scores['check-caching'] = cachingResult.score;
  updateScore(calculateCurrentScore(scores), true);

  // Check 4: 404 Caching
  const caching404Result = await check404Caching(cdnConfig, aemUrl);
  scores['check-404-caching'] = caching404Result.score;
  updateScore(calculateCurrentScore(scores), true);

  // Check 5: Image Delivery
  const imagesResult = await checkImages(cdnConfig, aemUrl, org, site, branch);
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

function setupOriginDiscovery() {
  const discoverLink = document.getElementById('discover-origin-link');
  const modal = document.getElementById('discover-origin-modal');
  const discoverForm = document.getElementById('discover-origin-form');
  const discoverResult = document.getElementById('discover-result');
  const discoverError = document.getElementById('discover-error');
  const closeBtn = document.getElementById('close-discover-modal');
  const cancelBtn = document.getElementById('cancel-discover');
  const useOriginBtn = document.getElementById('use-origin-btn');
  const urlInput = document.getElementById('url');

  let discoveredOrigin = null;

  function resetModal() {
    discoverForm.reset();
    discoverResult.setAttribute('aria-hidden', 'true');
    discoverError.setAttribute('aria-hidden', 'true');
    discoveredOrigin = null;
  }

  discoverLink.addEventListener('click', (e) => {
    e.preventDefault();
    resetModal();
    modal.showModal();
  });

  closeBtn.addEventListener('click', () => modal.close());
  cancelBtn.addEventListener('click', () => modal.close());

  modal.addEventListener('close', resetModal);

  discoverForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const prodUrlInput = document.getElementById('prod-url');
    const prodUrl = prodUrlInput.value;
    const discoverBtn = document.getElementById('discover-btn');

    discoverBtn.disabled = true;
    discoverBtn.textContent = 'Discovering...';
    discoverResult.setAttribute('aria-hidden', 'true');
    discoverError.setAttribute('aria-hidden', 'true');

    try {
      const origins = await discoverOrigin(prodUrl);
      [discoveredOrigin] = origins; // Use first found origin

      // Build the .aem.live URL using the path from the production URL
      const prodUrlObj = new URL(prodUrl);
      const aemLiveUrl = `https://${discoveredOrigin}.aem.live${prodUrlObj.pathname}`;

      discoverResult.querySelector('.discover-origin-value').textContent = aemLiveUrl;
      discoverResult.setAttribute('aria-hidden', 'false');

      if (origins.length > 1) {
        // eslint-disable-next-line no-console
        console.log('Multiple origins found:', origins);
      }
    } catch (err) {
      discoverError.querySelector('.error-message').textContent = err.message;
      discoverError.setAttribute('aria-hidden', 'false');
    } finally {
      discoverBtn.disabled = false;
      discoverBtn.textContent = 'Discover Origin';
    }
  });

  useOriginBtn.addEventListener('click', () => {
    if (discoveredOrigin) {
      const prodUrlInput = document.getElementById('prod-url');
      const prodUrlObj = new URL(prodUrlInput.value);
      const aemLiveUrl = `https://${discoveredOrigin}.aem.live${prodUrlObj.pathname}`;

      urlInput.value = aemLiveUrl;
      modal.close();
    }
  });
}

// Event listeners and initialization
function setupEventListeners() {
  // Setup origin discovery modal
  setupOriginDiscovery();

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

// Auto-run check if URL param is present
async function init() {
  setupEventListeners();

  const params = new URLSearchParams(window.location.search);
  const urlParam = params.get('url');

  if (urlParam) {
    // Populate the input field
    document.getElementById('url').value = urlParam;

    // Auto-run the check
    const submitButton = FORM.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    submitButton.textContent = 'Checking...';

    try {
      await runChecks(urlParam);
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = 'Run CDN Check';
    }
  }
}

// Initialize
init();
