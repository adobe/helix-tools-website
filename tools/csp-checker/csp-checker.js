import { registerToolReady } from '../../scripts/scripts.js';

/**
 * Parses a Content-Security-Policy header value into a map of directive names to source lists.
 * @param {string} csp - Raw CSP header value
 * @returns {Map<string, string[]>} Map of directive name (lowercase) -> array of source tokens
 */
function parseCsp(csp) {
  const directives = new Map();
  if (!csp || typeof csp !== 'string') {
    return directives;
  }
  const parts = csp.split(';').map((p) => p.trim()).filter(Boolean);
  parts.forEach((part) => {
    const spaceIndex = part.indexOf(' ');
    const name = (spaceIndex === -1 ? part : part.slice(0, spaceIndex)).trim().toLowerCase();
    const value = spaceIndex === -1 ? '' : part.slice(spaceIndex + 1).trim();
    const sources = value ? value.split(/\s+/).map((s) => s.trim()).filter(Boolean) : [];
    if (name) {
      directives.set(name, sources);
    }
  });
  return directives;
}

/**
 * Returns the effective source list for a directive, falling back to default-src if absent.
 * @param {Map<string, string[]>} directives - Parsed CSP directives
 * @param {string} directiveName - e.g. 'script-src', 'connect-src'
 * @returns {string[]|null} Source list or null if neither the directive nor default-src exists
 */
function getEffectiveSourceList(directives, directiveName) {
  const list = directives.get(directiveName);
  if (list !== undefined) return list;
  return directives.get('default-src') ?? null;
}

/**
 * Returns { allowed: true, matchedBy } if the given source allows the URL, else null.
 * @param {string} source - One CSP source token
 * @param {URL} parsedUrl - Parsed URL to check
 * @param {string} scheme - URL scheme (e.g. 'https')
 * @param {string} host - URL hostname
 * @returns {{ allowed: boolean, matchedBy: string }|null}
 */
function sourceAllowsUrl(source, parsedUrl, scheme, host) {
  const normalized = source.trim();
  if (!normalized) return null;
  if (normalized === '*') return { allowed: true, matchedBy: '*' };
  if (normalized === "'self'" || normalized === "'none'") return null;
  if (normalized.endsWith(':')) {
    const srcScheme = normalized.slice(0, -1).toLowerCase();
    return srcScheme === scheme ? { allowed: true, matchedBy: source } : null;
  }
  if (normalized.includes('://')) {
    try {
      const srcUrl = new URL(normalized.replace(/\*$/, '/'));
      if (srcUrl.origin === parsedUrl.origin) return { allowed: true, matchedBy: source };
      if (srcUrl.hostname.startsWith('*.')) {
        const suffix = srcUrl.hostname.slice(1);
        const hostMatch = host === suffix || host.endsWith(`.${suffix}`);
        const schemeMatch = !srcUrl.protocol || srcUrl.protocol.replace(':', '') === scheme;
        if (hostMatch && schemeMatch) return { allowed: true, matchedBy: source };
      }
    } catch {
      // ignore invalid source
    }
    return null;
  }
  if (normalized.startsWith('*.')) {
    const suffix = normalized.slice(1);
    return (host === suffix || host.endsWith(`.${suffix}`))
      ? { allowed: true, matchedBy: source } : null;
  }
  if (normalized === host || normalized === parsedUrl.origin || normalized === `${scheme}://${host}`) {
    return { allowed: true, matchedBy: source };
  }
  return null;
}

/**
 * Checks if a URL is allowed by a CSP source list (handles 'none', '*', scheme:, host, etc.).
 * @param {string} url - Absolute URL to check (e.g. https://rum.hlx.page)
 * @param {string[]} sources - CSP source list
 * @returns {{ allowed: boolean, matchedBy?: string }}
 */
function urlMatchesSourceList(url, sources) {
  if (!sources || sources.length === 0) return { allowed: false };
  if (sources.length === 1 && sources[0].toLowerCase() === "'none'") return { allowed: false };
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    return { allowed: false };
  }
  const scheme = `${parsedUrl.protocol}`.replace(':', '');
  const host = parsedUrl.hostname;
  const match = sources.find((source) => sourceAllowsUrl(source, parsedUrl, scheme, host));
  return match ? { allowed: true, matchedBy: match } : { allowed: false };
}

/**
 * Runs the RUM compatibility check for script-src only.
 * @param {string} csp - Raw CSP header value
 * @param {string} rumOrigin - Full origin to check (e.g. 'https://rum.hlx.page')
 * @returns {Object} scriptSrc: { allowed, effective, matchedBy? }
 */
function checkRumCompatibility(csp, rumOrigin) {
  const directives = parseCsp(csp);
  const scriptSrcList = getEffectiveSourceList(directives, 'script-src');
  const scriptResult = scriptSrcList
    ? { ...urlMatchesSourceList(rumOrigin, scriptSrcList), effective: scriptSrcList }
    : { allowed: false, effective: [] };
  return { scriptSrc: scriptResult };
}

/**
 * Escapes text for safe use in HTML text content (not for attributes).
 * @param {string} text - Raw text
 * @returns {string} Escaped text
 */
function escapeHtml(text) {
  if (typeof text !== 'string') return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Renders the result UI.
 * @param {HTMLElement} container - Element to render into
 * @param {ReturnType<checkRumCompatibility>} result - Result from checkRumCompatibility
 * @param {string} rumOrigin - Full origin that was checked (e.g. 'https://rum.hlx.page')
 */
function renderResult(container, result, rumOrigin) {
  const { scriptSrc } = result;
  const { allowed } = scriptSrc;

  const fragment = document.createDocumentFragment();

  const summary = document.createElement('p');
  summary.className = `csp-summary csp-summary-${allowed ? 'allowed' : 'blocked'}`;
  summary.setAttribute('role', 'status');
  summary.textContent = allowed
    ? `Loading the RUM script from ${rumOrigin} would be allowed.`
    : `Loading the RUM script from ${rumOrigin} would be blocked.`;
  fragment.appendChild(summary);

  const noneHint = '(none; uses default-src if present)';
  const scriptSourcesText = scriptSrc.effective.length
    ? escapeHtml(scriptSrc.effective.join(' '))
    : noneHint;

  const scriptResultCell = scriptSrc.allowed
    ? '<span class="csp-allowed">Allowed</span>'
    : '<span class="csp-blocked">Blocked</span>';

  const recommendedOrigin = escapeHtml(rumOrigin);
  const sourcesCellContent = allowed
    ? `<code>${scriptSourcesText}</code>`
    : `<code>${scriptSourcesText}</code>
       <hr class="csp-recommendation-hr">
       <div class="csp-recommendation-inline"><span class="csp-recommendation-label">Recommended change:</span> ${scriptSourcesText} <span class="csp-add-source">${recommendedOrigin}</span></div>`;

  const table = document.createElement('table');
  table.className = 'csp-result-table';
  table.setAttribute('aria-label', 'RUM script-src compatibility');
  table.innerHTML = `
    <thead>
      <tr>
        <th scope="col">Directive</th>
        <th scope="col">Result</th>
        <th scope="col">Effective source list</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td><code>script-src</code></td>
        <td class="csp-cell-result">${scriptResultCell}</td>
        <td class="csp-cell-sources">${sourcesCellContent}</td>
      </tr>
    </tbody>
  `;
  fragment.appendChild(table);

  const hint = document.createElement('p');
  hint.className = 'csp-hint';
  hint.textContent = allowed
    ? `Your policy allows the RUM script (${rumOrigin}).`
    : `To allow RUM, add ${rumOrigin} to script-src (or default-src).`;
  fragment.appendChild(hint);

  container.innerHTML = '';
  container.appendChild(fragment);
}

function init() {
  const input = document.getElementById('csp-input');
  const rumHostSelect = document.getElementById('rum-host');
  const checkBtn = document.getElementById('check-csp');
  const resultSection = document.getElementById('csp-result');
  const resultHeadingUrl = document.getElementById('csp-result-url');
  const resultBody = document.getElementById('csp-result-body');

  checkBtn.addEventListener('click', () => {
    const csp = input.value.trim();
    if (!csp) {
      resultSection.hidden = true;
      return;
    }
    const host = rumHostSelect.value;
    const rumOrigin = `https://${host}`;
    resultHeadingUrl.textContent = rumOrigin;
    const result = checkRumCompatibility(csp, rumOrigin);
    renderResult(resultBody, result, rumOrigin);
    resultSection.hidden = false;
  });
}

registerToolReady(init());
