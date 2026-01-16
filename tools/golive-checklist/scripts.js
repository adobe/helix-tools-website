/* eslint-disable no-console */
import { ensureLogin } from '../../blocks/profile/profile.js';
import { initConfigField, updateConfig } from '../../utils/config/config.js';

// Form elements
const FORM = document.getElementById('checklist-form');
const ORG_FIELD = document.getElementById('org');
const SITE_FIELD = document.getElementById('site');
const RESULTS = document.getElementById('checklist-results');

// Utility functions
/**
 * Helper function to handle CORS-friendly fetches
 * @param {string} url - URL to fetch
 * @param {object} options - Fetch options
 * @returns {Promise<Response>}
 */
async function corsFetch(url, options = {}) {
  try {
    // Try without credentials first (works with wildcard CORS headers)
    const response = await fetch(url, { ...options, mode: 'cors' });
    return response;
  } catch (error) {
    // If CORS error, provide helpful message
    if (error.message.includes('CORS') || error.name === 'TypeError') {
      throw new Error('CORS restriction - this check requires deploying the tool to a matching domain or using a browser extension to bypass CORS');
    }
    throw error;
  }
}

/**
 * Updates the status of a checklist item
 * @param {string} itemId - ID of the checklist item
 * @param {string} status - Status: 'pass', 'fail', 'warning', 'pending', 'manual'
 * @param {string} message - Message to display
 */
function updateChecklistItem(itemId, status, message) {
  const item = document.getElementById(itemId);
  if (!item) return;

  const statusIcon = item.querySelector('.status-icon');
  const statusBadge = item.querySelector('.status-badge');
  const resultDiv = item.querySelector('.check-result');

  // Update status icon
  const icons = {
    pass: '✅',
    fail: '❌',
    warning: '⚠️',
    pending: '⏳',
    manual: '⚠️',
  };
  statusIcon.textContent = icons[status] || '⏳';

  // Update status badge
  const badges = {
    pass: 'Pass',
    fail: 'Fail',
    warning: 'Warning',
    pending: 'Pending',
    manual: 'Manual Check',
  };
  statusBadge.textContent = badges[status] || 'Pending';
  statusBadge.className = `status-badge ${status}`;

  // Update item status
  item.className = `checklist-item ${status}`;

  // Update result message
  if (resultDiv && message) {
    resultDiv.innerHTML = message;
  }
}

/**
 * Shows loading state for button
 * @param {HTMLButtonElement} button - Button element
 */
function showLoadingButton(button) {
  button.disabled = true;
  const { width, height } = button.getBoundingClientRect();
  button.style.minWidth = `${width}px`;
  button.style.minHeight = `${height}px`;
  button.dataset.label = button.textContent || 'Submit';
  button.innerHTML = '<i class="symbol symbol-loading"></i>';
}

/**
 * Resets button from loading state
 * @param {HTMLButtonElement} button - Button element
 */
function resetLoadingButton(button) {
  button.textContent = button.dataset.label;
  button.removeAttribute('style');
  button.disabled = false;
}

/**
 * Gets form data as an object
 * @param {HTMLFormElement} form - Form element
 * @returns {Object} Form data
 */
function getFormData(form) {
  const data = {};
  [...form.elements].forEach((field) => {
    const { name, value } = field;
    if (name && value) {
      data[name] = value;
    }
  });
  return data;
}

/**
 * Checks if analytics (GTM or Adobe Launch) is configured
 * @param {string} org - Organization name
 * @param {string} site - Site name
 * @param {string} domain - Optional production domain
 * @returns {Promise<{status: string, message: string}>}
 */
async function checkAnalytics(org, site, domain) {
  try {
    const baseUrl = domain || `main--${site}--${org}.aem.live`;
    const testUrl = `https://${baseUrl}/`;
    const response = await corsFetch(testUrl);
    const html = await response.text();

    // Also check delayed.js for analytics loaded after page load
    let delayedJs = '';
    try {
      const delayedUrl = `https://${baseUrl}/scripts/delayed.js`;
      const delayedResponse = await corsFetch(delayedUrl);
      if (delayedResponse.ok) {
        delayedJs = await delayedResponse.text();
      }
    } catch {
      // Delayed.js might not exist, continue without it
    }

    // Also check scripts.js which might load analytics
    let scriptsJs = '';
    try {
      const scriptsUrl = `https://${baseUrl}/scripts/scripts.js`;
      const scriptsResponse = await corsFetch(scriptsUrl);
      if (scriptsResponse.ok) {
        scriptsJs = await scriptsResponse.text();
      }
    } catch {
      // Scripts.js might not have analytics, continue
    }

    // Combine all content for checking
    const allContent = html + delayedJs + scriptsJs;

    // Check for Google Tag Manager
    const hasGTM = allContent.includes('googletagmanager.com/gtag/js')
      || allContent.includes('googletagmanager.com/gtm.js')
      || allContent.includes('www.googletagmanager.com')
      || allContent.includes('GTM-');

    // Check for Google Analytics (direct implementation)
    const hasGA = allContent.includes('google-analytics.com/analytics.js')
      || allContent.includes('www.google-analytics.com')
      || allContent.includes('analytics.js')
      || (allContent.includes('gtag(') && allContent.includes("'config'"))
      || (allContent.includes('ga(') && allContent.includes("'create'"))
      || allContent.includes('GA_MEASUREMENT_ID')
      || allContent.includes('G-');

    // Check for Adobe Launch
    const hasAdobeLaunch = allContent.includes('launch.min.js')
      || allContent.includes('assets.adobedtm.com')
      || allContent.includes('//assets.adobedtm.com');

    // Check for Adobe Analytics (direct implementation)
    const hasAdobeAnalytics = allContent.includes('omniture.com')
      || allContent.includes('adobedc.net')
      || allContent.includes('sc.omtrdc.net')
      || allContent.includes('AppMeasurement')
      || allContent.includes('s_code.js')
      || (allContent.includes('s.t()') || allContent.includes('s.tl('));

    const messages = [];

    // Check for Google Analytics (GTM or direct implementation)
    if (hasGTM || hasGA) {
      messages.push('<p>✅ Google Analytics detected.</p>');
    }

    // Check for Adobe Analytics (Launch or direct implementation)
    if (hasAdobeLaunch || hasAdobeAnalytics) {
      messages.push('<p>✅ Adobe Analytics detected.</p>');
    }

    if (hasGTM || hasGA || hasAdobeLaunch || hasAdobeAnalytics) {
      messages.push('<p><strong>Note:</strong> Verify analytics are firing correctly:</p>');
      messages.push('<ul>');
      messages.push('<li>Check analytics dashboards for visitor data</li>');
      messages.push('<li>Expect baseline metrics to change after launch</li>');
      messages.push('<li>Coordinate with analysts about metric adjustments</li>');
      messages.push('</ul>');

      return {
        status: 'pass',
        message: messages.join(''),
      };
    }

    return {
      status: 'warning',
      message: `<p>⚠️ No analytics platform detected.</p>
        <p>Looking for: Google Analytics or Adobe Analytics.</p>
        <p>If you're using a different analytics solution, verify it's properly implemented.</p>`,
    };
  } catch (error) {
    const baseUrl = domain || `main--${site}--${org}.aem.live`;
    const testUrl = `https://${baseUrl}/`;
    return {
      status: 'warning',
      message: `<p>⚠️ Unable to verify analytics setup: ${error.message}</p>
        <p>💡 Tip: Check manually at <a href="${testUrl}" target="_blank">${testUrl}</a></p>`,
    };
  }
}

/**
 * Checks if RUM is enabled for the site
 * @param {string} org - Organization name
 * @param {string} site - Site name
 * @returns {Promise<{status: string, message: string}>}
 */
async function checkRUM(org, site) {
  try {
    // Check if RUM script is present on the site
    const liveUrl = `https://main--${site}--${org}.aem.live/`;
    const response = await corsFetch(liveUrl);
    const html = await response.text();

    const hasRUM = html.includes('/.rum/') || html.includes('rum.js');

    if (hasRUM) {
      return {
        status: 'pass',
        message: `<p>✅ RUM is instrumented on the site.</p>
          <p><a href="/tools/rum/explorer.html?domainkey=${org}--${site}" target="_blank">View RUM Dashboard</a></p>`,
      };
    }
    return {
      status: 'warning',
      message: '<p>⚠️ RUM instrumentation not detected. Consider adding RUM to track performance metrics.</p>',
    };
  } catch (error) {
    return {
      status: 'warning',
      message: `<p>⚠️ Unable to verify RUM instrumentation: ${error.message}</p>
        <p>💡 Tip: Check manually at <a href="https://main--${site}--${org}.aem.live/" target="_blank">https://main--${site}--${org}.aem.live/</a></p>`,
    };
  }
}

/**
 * Checks for redirects configuration
 * @param {string} org - Organization name
 * @param {string} site - Site name
 * @returns {Promise<{status: string, message: string}>}
 */
async function checkRedirects(org, site) {
  try {
    // Check if redirects are configured via admin API
    const url = `https://admin.hlx.page/config/${org}/sites/${site}.json`;
    const response = await corsFetch(url);

    if (!response.ok) {
      return {
        status: 'warning',
        message: '<p>⚠️ Unable to verify redirects configuration via admin API.</p>',
      };
    }

    const config = await response.json();
    const hasRedirects = config.redirects || (config.data && config.data.redirects);

    if (hasRedirects) {
      return {
        status: 'pass',
        message: '<p>✅ Redirects configuration found.</p><p>See <a href="https://www.aem.live/docs/redirects" target="_blank">Redirects documentation</a> for more information.</p>',
      };
    }

    return {
      status: 'warning',
      message: '<p>⚠️ No redirects configuration found. Consider creating a redirects.xlsx file if you have legacy URLs to redirect.</p>',
    };
  } catch (error) {
    return {
      status: 'warning',
      message: `<p>⚠️ Unable to verify redirects configuration: ${error.message}</p>
        <p>💡 Tip: Check manually at <a href="https://admin.hlx.page/config/${org}/sites/${site}.json" target="_blank">admin API</a></p>`,
    };
  }
}

/**
 * Checks for sitemap
 * @param {string} org - Organization name
 * @param {string} site - Site name
 * @param {string} domain - Optional production domain
 * @returns {Promise<{status: string, message: string}>}
 */
async function checkSitemap(org, site, domain) {
  try {
    const baseUrl = domain || `main--${site}--${org}.aem.live`;
    const sitemapUrl = `https://${baseUrl}/sitemap.xml`;

    const response = await corsFetch(sitemapUrl);

    if (response.ok) {
      const text = await response.text();
      const isValidSitemap = text.includes('<?xml') && text.includes('urlset');

      if (isValidSitemap) {
        return {
          status: 'pass',
          message: `<p>✅ Sitemap is accessible at <a href="${sitemapUrl}" target="_blank">${sitemapUrl}</a></p>`,
        };
      }
    }

    return {
      status: 'warning',
      message: `<p>⚠️ Sitemap not found at <a href="${sitemapUrl}" target="_blank">${sitemapUrl}</a></p>
        <p>See <a href="https://www.aem.live/docs/sitemap" target="_blank">Sitemap documentation</a> for setup instructions.</p>`,
    };
  } catch (error) {
    const baseUrl = domain || `main--${site}--${org}.aem.live`;
    const sitemapUrl = `https://${baseUrl}/sitemap.xml`;
    return {
      status: 'warning',
      message: `<p>⚠️ Unable to verify sitemap: ${error.message}</p>
        <p>💡 Tip: Check manually at <a href="${sitemapUrl}" target="_blank">${sitemapUrl}</a></p>`,
    };
  }
}

/**
 * Checks robots.txt
 * @param {string} org - Organization name
 * @param {string} site - Site name
 * @param {string} domain - Optional production domain
 * @returns {Promise<{status: string, message: string}>}
 */
async function checkRobots(org, site, domain) {
  try {
    const baseUrl = domain || `main--${site}--${org}.aem.live`;
    const robotsUrl = `https://${baseUrl}/robots.txt`;

    const response = await corsFetch(robotsUrl);

    if (response.ok) {
      const text = await response.text();
      const allowsCrawlers = text.includes('User-agent:') && text.includes('Allow:');
      const hasSitemap = text.toLowerCase().includes('sitemap:');

      let status = 'pass';
      const messages = ['<p>✅ robots.txt is accessible.</p>'];

      if (!allowsCrawlers) {
        status = 'warning';
        messages.push('<p>⚠️ robots.txt may not be properly configured to allow crawlers.</p>');
      }

      if (!hasSitemap) {
        status = 'warning';
        messages.push('<p>⚠️ robots.txt does not reference sitemap.xml</p>');
      }

      messages.push(`<p><a href="${robotsUrl}" target="_blank">View robots.txt</a></p>`);

      return {
        status,
        message: messages.join(''),
      };
    }

    return {
      status: 'warning',
      message: `<p>⚠️ robots.txt not found at <a href="${robotsUrl}" target="_blank">${robotsUrl}</a></p>
        <p>See <a href="https://www.aem.live/docs/indexing#robots-txt" target="_blank">robots.txt documentation</a>.</p>`,
    };
  } catch (error) {
    const baseUrl = domain || `main--${site}--${org}.aem.live`;
    const robotsUrl = `https://${baseUrl}/robots.txt`;
    return {
      status: 'warning',
      message: `<p>⚠️ Unable to verify robots.txt: ${error.message}</p>
        <p>💡 Tip: Check manually at <a href="${robotsUrl}" target="_blank">${robotsUrl}</a></p>`,
    };
  }
}

/**
 * Checks canonical URLs
 * @param {string} org - Organization name
 * @param {string} site - Site name
 * @param {string} domain - Optional production domain
 * @returns {Promise<{status: string, message: string}>}
 */
async function checkCanonical(org, site, domain) {
  try {
    const baseUrl = domain || `main--${site}--${org}.aem.live`;
    const testUrl = `https://${baseUrl}/`;

    const response = await corsFetch(testUrl);

    if (response.ok && response.status >= 200 && response.status < 300) {
      const html = await response.text();
      const hasCanonical = html.includes('<link rel="canonical"');

      if (hasCanonical) {
        return {
          status: 'pass',
          message: '<p>✅ Canonical URL found and homepage returns 2xx status.</p><p>Verify all pages have proper canonical tags.</p>',
        };
      }

      return {
        status: 'warning',
        message: '<p>⚠️ No canonical tag found on homepage. Ensure canonical URLs are properly implemented.</p>',
      };
    }

    return {
      status: 'fail',
      message: `<p>❌ Homepage returned non-2xx status: ${response.status}</p>`,
    };
  } catch (error) {
    const baseUrl = domain || `main--${site}--${org}.aem.live`;
    const testUrl = `https://${baseUrl}/`;
    return {
      status: 'warning',
      message: `<p>⚠️ Unable to verify canonical URLs: ${error.message}</p>
        <p>💡 Tip: Check manually at <a href="${testUrl}" target="_blank">${testUrl}</a></p>`,
    };
  }
}

/**
 * Checks for favicon
 * @param {string} org - Organization name
 * @param {string} site - Site name
 * @param {string} domain - Optional production domain
 * @returns {Promise<{status: string, message: string}>}
 */
async function checkFavicon(org, site, domain) {
  try {
    const baseUrl = domain || `main--${site}--${org}.aem.live`;
    const faviconUrl = `https://${baseUrl}/favicon.ico`;

    const response = await corsFetch(faviconUrl, { method: 'HEAD' });

    if (response.ok) {
      return {
        status: 'pass',
        message: `<p>✅ Favicon is configured at <a href="${faviconUrl}" target="_blank">${faviconUrl}</a></p>`,
      };
    }

    return {
      status: 'warning',
      message: `<p>⚠️ Favicon not found at ${faviconUrl}</p>
        <p>See <a href="https://www.aem.live/docs/favicon" target="_blank">Favicon documentation</a>.</p>`,
    };
  } catch (error) {
    const baseUrl = domain || `main--${site}--${org}.aem.live`;
    const faviconUrl = `https://${baseUrl}/favicon.ico`;
    return {
      status: 'warning',
      message: `<p>⚠️ Unable to verify favicon: ${error.message}</p>
        <p>💡 Tip: Check manually at <a href="${faviconUrl}" target="_blank">${faviconUrl}</a></p>`,
    };
  }
}

/**
 * Checks CORS headers configuration
 * @param {string} org - Organization name
 * @param {string} site - Site name
 * @param {string} domain - Optional production domain
 * @returns {Promise<{status: string, message: string}>}
 */
async function checkCORS(org, site, domain) {
  try {
    const baseUrl = domain || `main--${site}--${org}.aem.live`;
    const testUrl = `https://${baseUrl}/`;

    const response = await corsFetch(testUrl, { method: 'HEAD' });

    // Check for CORS headers
    const corsHeader = response.headers.get('Access-Control-Allow-Origin');
    const corsCredentials = response.headers.get('Access-Control-Allow-Credentials');
    const corsMethods = response.headers.get('Access-Control-Allow-Methods');

    const messages = [];

    if (corsHeader) {
      messages.push('<p>✅ CORS headers are configured.</p>');
      messages.push(`<p><strong>Access-Control-Allow-Origin:</strong> <code>${corsHeader}</code></p>`);

      if (corsCredentials) {
        messages.push(`<p><strong>Access-Control-Allow-Credentials:</strong> <code>${corsCredentials}</code></p>`);
      }

      if (corsMethods) {
        messages.push(`<p><strong>Access-Control-Allow-Methods:</strong> <code>${corsMethods}</code></p>`);
      }

      // Check for potential issues
      if (corsHeader === '*' && corsCredentials === 'true') {
        messages.push('<p>⚠️ Warning: Wildcard origin (*) cannot be used with credentials.</p>');
        return {
          status: 'warning',
          message: messages.join(''),
        };
      }

      return {
        status: 'pass',
        message: messages.join(''),
      };
    }

    return {
      status: 'warning',
      message: `<p>⚠️ No CORS headers detected. This is fine if cross-origin requests are not needed.</p>
        <p>If you need CORS support, see <a href="https://www.aem.live/docs/setup-byo-cdn-push-invalidation#cors" target="_blank">CORS configuration</a>.</p>`,
    };
  } catch (error) {
    const baseUrl = domain || `main--${site}--${org}.aem.live`;
    const testUrl = `https://${baseUrl}/`;
    return {
      status: 'warning',
      message: `<p>⚠️ Unable to verify CORS headers: ${error.message}</p>
        <p>💡 Tip: Check manually at <a href="${testUrl}" target="_blank">${testUrl}</a></p>`,
    };
  }
}

/**
 * Checks Lighthouse score via PageSpeed Insights API
 * @param {string} org - Organization name
 * @param {string} site - Site name
 * @param {string} domain - Optional production domain
 * @param {string} apiKey - Optional Google API key
 * @returns {Promise<{status: string, message: string}>}
 */
async function checkLighthouse(org, site, domain, apiKey) {
  try {
    const baseUrl = domain || `main--${site}--${org}.aem.live`;
    const testUrl = `https://${baseUrl}/`;

    // Call PageSpeed Insights API
    const apiEndpoint = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';
    const url = new URL(apiEndpoint);
    url.searchParams.set('url', testUrl);
    url.searchParams.set('category', 'performance');
    url.searchParams.set('strategy', 'mobile');

    // Add API key if provided
    if (apiKey) {
      url.searchParams.set('key', apiKey);
    }

    const response = await fetch(url);

    if (!response.ok) {
      const psiUrl = `https://pagespeed.web.dev/analysis?url=${encodeURIComponent(testUrl)}`;

      // Handle rate limiting specifically
      if (response.status === 429) {
        return {
          status: 'warning',
          message: `<p>⚠️ PageSpeed Insights API rate limit reached.</p>
            <p>The free API has usage limits. To check your Lighthouse score:</p>
            <ul>
              <li>Test manually at <a href="${psiUrl}" target="_blank">Google PageSpeed Insights</a></li>
              <li>Or add a Google API key to increase rate limits (see <a href="https://developers.google.com/speed/docs/insights/v5/get-started" target="_blank">API docs</a>)</li>
            </ul>
            <p>Target: Score of 90+ (ideally 100)</p>`,
        };
      }

      return {
        status: 'warning',
        message: `<p>⚠️ Unable to fetch Lighthouse score via API (${response.status}).</p>
          <p>Test manually at <a href="${psiUrl}" target="_blank">Google PageSpeed Insights</a></p>
          <p>Target: Score of 90+ (ideally 100)</p>`,
      };
    }

    const json = await response.json();
    const lighthouse = json.lighthouseResult;
    const performanceScore = lighthouse.categories.performance.score * 100;

    const messages = [];
    const psiUrl = `https://pagespeed.web.dev/analysis?url=${encodeURIComponent(testUrl)}`;

    if (performanceScore >= 90) {
      messages.push(`<p>✅ Lighthouse performance score: <strong>${performanceScore}</strong></p>`);
      messages.push('<p>Excellent! Your site meets the performance target.</p>');
    } else if (performanceScore >= 50) {
      messages.push(`<p>⚠️ Lighthouse performance score: <strong>${performanceScore}</strong></p>`);
      messages.push('<p>Good, but could be improved. Target: 90+ (ideally 100)</p>');
    } else {
      messages.push(`<p>❌ Lighthouse performance score: <strong>${performanceScore}</strong></p>`);
      messages.push('<p>Needs improvement. Target: 90+ (ideally 100)</p>');
    }

    messages.push(`<p><a href="${psiUrl}" target="_blank">View detailed report</a></p>`);

    // Determine status
    let status = 'pass';
    if (performanceScore < 90) {
      status = performanceScore >= 50 ? 'warning' : 'fail';
    }

    return {
      status,
      message: messages.join(''),
    };
  } catch (error) {
    const baseUrl = domain || `main--${site}--${org}.aem.live`;
    const testUrl = `https://${baseUrl}/`;
    const psiUrl = `https://pagespeed.web.dev/analysis?url=${encodeURIComponent(testUrl)}`;
    return {
      status: 'warning',
      message: `<p>⚠️ Unable to fetch Lighthouse score: ${error.message}</p>
        <p>💡 Tip: Test manually at <a href="${psiUrl}" target="_blank">Google PageSpeed Insights</a></p>
        <p>Target: Score of 90+ (ideally 100)</p>`,
    };
  }
}

/**
 * Checks push invalidation configuration
 * @param {string} org - Organization name
 * @param {string} site - Site name
 * @returns {Promise<{status: string, message: string}>}
 */
async function checkPushInvalidation(org, site) {
  try {
    // Check CDN configuration via admin API
    const url = `https://admin.hlx.page/config/${org}/sites/${site}.json`;
    const response = await corsFetch(url);

    if (!response.ok) {
      return {
        status: 'warning',
        message: '<p>⚠️ Unable to verify push invalidation configuration via admin API.</p>',
      };
    }

    const config = await response.json();
    const messages = [];

    // Check for CDN configuration
    const cdnConfig = config.cdn || (config.data && config.data.cdn);

    // Check for push invalidation CDN type
    const supportedCDNTypes = ['fastly', 'akamai', 'cloudflare', 'cloudfront', 'managed'];
    const cdnProdType = cdnConfig?.prod?.type;
    const hasCDNType = cdnProdType && supportedCDNTypes.includes(cdnProdType);

    if (hasCDNType) {
      messages.push('<p>✅ Push invalidation is supported for your CDN type.</p>');
      messages.push(`<p><strong>CDN Type:</strong> <code>${cdnProdType}</code></p>`);

      // For Fastly, check if authToken is configured
      if (cdnProdType === 'fastly') {
        const hasAuthToken = cdnConfig?.prod?.authToken;
        if (hasAuthToken) {
          messages.push('<p>✅ Fastly auth token is configured.</p>');
        } else {
          messages.push('<p>⚠️ Warning: Fastly auth token is not configured. Push invalidation requires an auth token.</p>');
          messages.push('<p>See <a href="https://www.aem.live/docs/byo-cdn-push-invalidation#fastly" target="_blank">Fastly Push Invalidation setup</a>.</p>');
          return {
            status: 'warning',
            message: messages.join(''),
          };
        }
      }

      // For Akamai, check if accessToken is configured
      if (cdnProdType === 'akamai') {
        const hasAccessToken = cdnConfig?.prod?.accessToken;
        if (hasAccessToken) {
          messages.push('<p>✅ Akamai access token is configured.</p>');
        } else {
          messages.push('<p>⚠️ Warning: Akamai access token is not configured. Push invalidation requires an access token.</p>');
          messages.push('<p>See <a href="https://www.aem.live/docs/byo-cdn-push-invalidation#akamai" target="_blank">Akamai Push Invalidation setup</a>.</p>');
          return {
            status: 'warning',
            message: messages.join(''),
          };
        }
      }

      // For Cloudflare, check if apiToken is configured
      if (cdnProdType === 'cloudflare') {
        const hasApiToken = cdnConfig?.prod?.apiToken;
        if (hasApiToken) {
          messages.push('<p>✅ Cloudflare API token is configured.</p>');
        } else {
          messages.push('<p>⚠️ Warning: Cloudflare API token is not configured. Push invalidation requires an API token.</p>');
          messages.push('<p>See <a href="https://www.aem.live/docs/byo-cdn-push-invalidation#cloudflare" target="_blank">Cloudflare Push Invalidation setup</a>.</p>');
          return {
            status: 'warning',
            message: messages.join(''),
          };
        }
      }

      // For CloudFront, check if secretAccessKey is configured
      if (cdnProdType === 'cloudfront') {
        const hasSecretAccessKey = cdnConfig?.prod?.secretAccessKey;
        if (hasSecretAccessKey) {
          messages.push('<p>✅ CloudFront secret access key is configured.</p>');
        } else {
          messages.push('<p>⚠️ Warning: CloudFront secret access key is not configured. Push invalidation requires a secret access key.</p>');
          messages.push('<p>See <a href="https://www.aem.live/docs/byo-cdn-push-invalidation#cloudfront" target="_blank">CloudFront Push Invalidation setup</a>.</p>');
          return {
            status: 'warning',
            message: messages.join(''),
          };
        }
      }

      messages.push('<p>Use the <a href="/tools/push-invalidation">Push Invalidation tool</a> to test your setup.</p>');

      return {
        status: 'pass',
        message: messages.join(''),
      };
    }

    if (cdnProdType) {
      messages.push(`<p>⚠️ CDN type <code>${cdnProdType}</code> may not support push invalidation.</p>`);
      messages.push(`<p><strong>Supported types:</strong> ${supportedCDNTypes.map((t) => `<code>${t}</code>`).join(', ')}</p>`);
      messages.push('<p>See <a href="https://www.aem.live/docs/byo-cdn-push-invalidation" target="_blank">Push Invalidation documentation</a>.</p>');

      return {
        status: 'warning',
        message: messages.join(''),
      };
    }

    return {
      status: 'warning',
      message: `<p>⚠️ No CDN configuration found in admin API.</p>
        <p>Push invalidation requires a supported CDN type: ${supportedCDNTypes.map((t) => `<code>${t}</code>`).join(', ')}</p>
        <p>See <a href="https://www.aem.live/docs/byo-cdn-push-invalidation" target="_blank">Push Invalidation documentation</a>.</p>`,
    };
  } catch (error) {
    return {
      status: 'warning',
      message: `<p>⚠️ Unable to verify push invalidation: ${error.message}</p>
        <p>💡 Tip: Check manually at <a href="https://admin.hlx.page/config/${org}/sites/${site}.json" target="_blank">admin API</a></p>`,
    };
  }
}

/**
 * Checks CDN configuration
 * @param {string} org - Organization name
 * @param {string} site - Site name
 * @param {string} domain - Optional production domain
 * @returns {Promise<{status: string, message: string}>}
 */
async function checkCDN(org, site, domain) {
  try {
    // Check CDN configuration via admin API
    const url = `https://admin.hlx.page/config/${org}/sites/${site}.json`;
    const response = await corsFetch(url);

    if (!response.ok) {
      return {
        status: 'warning',
        message: '<p>⚠️ Unable to verify CDN configuration via admin API.</p>',
      };
    }

    const config = await response.json();
    const messages = [];

    // Check for CDN-related configuration
    const cdnConfig = config.cdn || (config.data && config.data.cdn);
    const hasHost = config.host || (config.data && config.data.host);

    if (cdnConfig || hasHost) {
      messages.push('<p>✅ CDN configuration found in admin API.</p>');

      const cdnProdType = cdnConfig?.prod?.type;
      if (cdnProdType) {
        messages.push(`<p><strong>CDN Type:</strong> <code>${cdnProdType}</code></p>`);
      }

      if (hasHost) {
        const hosts = Array.isArray(hasHost) ? hasHost : [hasHost];
        messages.push(`<p><strong>Configured hosts:</strong> ${hosts.map((h) => `<code>${h}</code>`).join(', ')}</p>`);
      }

      // If domain provided, check if it's accessible
      if (domain) {
        try {
          const domainResponse = await corsFetch(`https://${domain}/`, { method: 'HEAD' });
          if (domainResponse.ok) {
            messages.push(`<p>✅ Production domain <code>${domain}</code> is accessible.</p>`);
          } else {
            messages.push(`<p>⚠️ Production domain <code>${domain}</code> returned status ${domainResponse.status}</p>`);
          }
        } catch {
          messages.push(`<p>⚠️ Unable to verify production domain <code>${domain}</code> accessibility.</p>`);
        }
      }

      messages.push('<p>See <a href="https://www.aem.live/docs/byo-cdn-setup" target="_blank">BYO CDN Setup</a> documentation.</p>');

      return {
        status: 'pass',
        message: messages.join(''),
      };
    }

    return {
      status: 'warning',
      message: `<p>⚠️ No CDN configuration found in admin API.</p>
        <p>If you're using a custom CDN, configure it via the admin API or headers.xlsx.</p>
        <p>See <a href="https://www.aem.live/docs/byo-cdn-setup" target="_blank">BYO CDN Setup</a> documentation.</p>`,
    };
  } catch (error) {
    return {
      status: 'warning',
      message: `<p>⚠️ Unable to verify CDN configuration: ${error.message}</p>
        <p>💡 Tip: Check manually at <a href="https://admin.hlx.page/config/${org}/sites/${site}.json" target="_blank">admin API</a></p>`,
    };
  }
}

/**
 * Runs all automated checks
 * @param {string} org - Organization name
 * @param {string} site - Site name
 * @param {string} domain - Optional production domain
 * @param {string} apiKey - Optional Google API key
 */
async function runChecklist(org, site, domain, apiKey) {
  // Show results section
  RESULTS.setAttribute('aria-hidden', false);

  // Reset all automated checks to pending
  const automatedChecks = [
    'check-lighthouse',
    'check-analytics',
    'check-rum',
    'check-redirects',
    'check-sitemap',
    'check-robots',
    'check-canonical',
    'check-favicon',
    'check-cors',
    'check-cdn',
    'check-push-invalidation',
  ];

  automatedChecks.forEach((checkId) => {
    updateChecklistItem(checkId, 'pending', '<p>Checking...</p>');
  });

  // Run checks
  const checks = [
    { id: 'check-lighthouse', fn: checkLighthouse },
    { id: 'check-analytics', fn: checkAnalytics },
    { id: 'check-rum', fn: checkRUM },
    { id: 'check-redirects', fn: checkRedirects },
    { id: 'check-sitemap', fn: checkSitemap },
    { id: 'check-robots', fn: checkRobots },
    { id: 'check-canonical', fn: checkCanonical },
    { id: 'check-favicon', fn: checkFavicon },
    { id: 'check-cors', fn: checkCORS },
    { id: 'check-cdn', fn: checkCDN },
    { id: 'check-push-invalidation', fn: checkPushInvalidation },
  ];

  // Run all checks in parallel
  await Promise.all(
    checks.map(async ({ id, fn }) => {
      try {
        // Pass apiKey to checkLighthouse, but not to other functions that don't need it
        const result = id === 'check-lighthouse'
          ? await fn(org, site, domain, apiKey)
          : await fn(org, site, domain);
        updateChecklistItem(id, result.status, result.message);
      } catch (error) {
        updateChecklistItem(id, 'fail', `<p>❌ Error: ${error.message}</p>`);
      }
    }),
  );
}

/**
 * Checks if user is logged in
 * @returns {Promise<boolean>}
 */
async function isLoggedIn() {
  const org = ORG_FIELD.value;
  const site = SITE_FIELD.value;
  if (org && site) {
    return ensureLogin(org, site);
  }
  return false;
}

/**
 * Registers event listeners
 */
async function registerListeners() {
  // Handle form submission
  FORM.addEventListener('submit', async (e) => {
    e.preventDefault();

    if (!await isLoggedIn()) {
      window.addEventListener('profile-update', ({ detail: loginInfo }) => {
        if (loginInfo.includes(ORG_FIELD.value)) {
          FORM.querySelector('button[type="submit"]').click();
        }
      }, { once: true });
      return;
    }

    const { target, submitter } = e;
    showLoadingButton(submitter);

    const data = getFormData(target);
    const {
      org, site, domain, apiKey,
    } = data;

    if (org && site) {
      await runChecklist(org, site, domain, apiKey);
      updateConfig();
    }

    resetLoadingButton(submitter);
  });

  // Handle form reset
  FORM.addEventListener('reset', () => {
    RESULTS.setAttribute('aria-hidden', true);
  });

  // Initialize config field (for org/site autocomplete)
  await initConfigField();
}

// Initialize
registerListeners();
