import { registerToolReady } from '../../scripts/scripts.js';

const HTML_WORKER_ORIGIN = 'https://get-html.aem-poc-lab.workers.dev';
const CSP_WORKER_ORIGIN = 'https://get-csp.adobeaem.workers.dev';

/** Substrings in <script src="…"> that indicate OpTel / RUM is present */
const OP_TEL_SCRIPT_SIGNALS = [
  'rum.hlx.page',
  'ot.aem.live',
  'helix-rum-js',
  '/scripts.js',
];

/** Skip POST when a match is from these script-URL patterns (hosted RUM loader). */
const POST_PROBE_EXCLUDE_SIGNALS = new Set(['rum.hlx.page', 'ot.aem.live']);

/**
 * Run POST only if no match was detected via rum.hlx.page or ot.aem.live substring.
 * @param {{ signal: string }[]} matches
 * @returns {boolean}
 */
function shouldRunPostProbe(matches) {
  return !matches.some((m) => POST_PROBE_EXCLUDE_SIGNALS.has(m.signal));
}

const form = document.getElementById('check-form');
const urlInput = document.getElementById('url-input');
const submitBtn = document.getElementById('submit-btn');
const toolOutput = document.getElementById('tool-output');
const opelStatus = document.getElementById('opel-status');
const opelMatched = document.getElementById('opel-matched');
const cspSection = document.getElementById('csp-section');
const cspResult = document.getElementById('csp-result');
const rumProbeSection = document.getElementById('rum-probe-section');
const rumProbeResult = document.getElementById('rum-probe-result');
const rumProbeFailHint = document.getElementById('rum-probe-fail-hint');

/**
 * If the value does not already start with https://, prepend it (or upgrade http://).
 * The URL field uses type="text" so hostnames without a scheme still submit; browser
 * validation on type="url" would block submit before this runs.
 * @param {string} raw
 * @returns {string}
 */
function normalizeUrlInputToHttps(raw) {
  const trimmed = raw.trim();
  if (!trimmed) {
    return trimmed;
  }
  if (/^https:\/\//i.test(trimmed)) {
    return trimmed;
  }
  if (/^http:\/\//i.test(trimmed)) {
    return `https://${trimmed.replace(/^http:\/\//i, '')}`;
  }
  return `https://${trimmed}`;
}

/**
 * Parses user input into an absolute URL (adds https:// when scheme is omitted).
 * @param {string} raw
 * @returns {URL}
 */
function parseUrl(raw) {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error('Enter a URL.');
  }
  try {
    return new URL(trimmed);
  } catch {
    try {
      return new URL(`https://${trimmed}`);
    } catch {
      throw new Error('Invalid URL.');
    }
  }
}

/**
 * @param {'idle'|'loading'|'opel-disabled'|'opel-error'|'done'} state
 */
function setOutputState(state) {
  toolOutput.dataset.state = state;
}

function setLoading(isLoading) {
  submitBtn.disabled = isLoading;
  urlInput.readOnly = isLoading;
}

/** Boolean-like script attributes; always shown as name="name" (e.g. defer="defer"). */
const BOOLEAN_SCRIPT_ATTRS = new Set(['async', 'defer', 'nomodule']);

/** Always shown as name="value" with & / " escaped (same style as defer="defer"). */
const CANONICAL_DOUBLE_QUOTE_ATTRS = new Set([
  'type',
  'src',
  'data-routing',
  'nonce',
]);

/**
 * Decodes common HTML entities in attribute values (may appear literally from upstream HTML).
 * @param {string} s
 * @returns {string}
 */
function decodeHtmlEntitiesOnce(s) {
  return s
    .replace(/&quot;/gi, '"')
    .replace(/&#34;/g, '"')
    .replace(/&#x22;/gi, '"')
    .replace(/&amp;/g, '&');
}

/**
 * Normalizes src/type/data-routing/nonce values so we do not double-encode &quot; or \\".
 * @param {string} value
 * @returns {string}
 */
function normalizeCanonicalAttrValue(value) {
  let s = String(value);
  for (let i = 0; i < 4; i += 1) {
    const next = decodeHtmlEntitiesOnce(s);
    if (next === s) break;
    s = next;
  }
  s = s.replace(/\\"/g, '"');
  while (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    s = s.slice(1, -1);
  }
  return s;
}

/**
 * Escapes a value for use inside double-quoted HTML attributes.
 * @param {string} value
 * @returns {string}
 */
function escapeAttrValueInsideDoubleQuotes(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;');
}

/**
 * Quotes an attribute value for plain-text display (prefers ", then ', then &quot;).
 * @param {string} value
 * @returns {string}
 */
function quoteAttrValueForDisplay(value) {
  if (!value.includes('"')) {
    return `"${value}"`;
  }
  if (!value.includes("'")) {
    return `'${value}'`;
  }
  return `"${value.replace(/"/g, '&quot;')}"`;
}

/**
 * Serializes every attribute on the script element (src, data-routing, nonce, etc.).
 * Avoids outerHTML entity quirks; order matches the parsed document.
 * @param {HTMLScriptElement} script
 * @returns {string}
 */
function formatScriptElementForDisplay(script) {
  const parts = ['<script'];
  const { attributes } = script;
  for (let i = 0; i < attributes.length; i += 1) {
    const { name, value } = attributes[i];
    if (BOOLEAN_SCRIPT_ATTRS.has(name)) {
      parts.push(` ${name}="${name}"`);
    } else if (CANONICAL_DOUBLE_QUOTE_ATTRS.has(name)) {
      const normalized = normalizeCanonicalAttrValue(value);
      parts.push(` ${name}="${escapeAttrValueInsideDoubleQuotes(normalized)}"`);
    } else {
      parts.push(` ${name}=${quoteAttrValueForDisplay(value)}`);
    }
  }
  parts.push('></script>');
  return parts.join('');
}

/**
 * Finds script tags whose `src` contains an OpTel signal substring.
 * @param {string} htmlMarkup
 * @returns {{ signal: string, tag: string, script: HTMLScriptElement }[]}
 */
function findOptelScriptMatches(htmlMarkup) {
  const doc = new DOMParser().parseFromString(htmlMarkup, 'text/html');
  const scripts = doc.querySelectorAll('script[src]');
  /** @type {{ signal: string, tag: string, script: HTMLScriptElement }[]} */
  const matches = [];
  const seen = new Set();

  scripts.forEach((script) => {
    const src = script.getAttribute('src') || '';
    const signal = OP_TEL_SCRIPT_SIGNALS.find((s) => src.includes(s));
    if (!signal) return;
    const tag = formatScriptElementForDisplay(script);
    if (seen.has(tag)) return;
    seen.add(tag);
    matches.push({ signal, tag, script });
  });

  return matches;
}

/**
 * Pulls HTML document string from get-html worker JSON (`{"html":"..."}`) or returns raw markup.
 * @param {string} raw
 * @returns {string}
 */
function extractHtmlFromWorkerResponse(raw) {
  const t = raw.trim();
  if (!t) return '';
  if (t.startsWith('{')) {
    try {
      const j = JSON.parse(t);
      if (typeof j.html === 'string') return j.html;
      return '';
    } catch {
      /* leading { but not JSON — unusual; avoid parsing JSON as HTML */
      return t;
    }
  }
  return t;
}

/**
 * Pulls a CSP header value from worker JSON or raw text.
 * @param {string} raw
 * @returns {string}
 */
function extractCspPolicyString(raw) {
  const t = raw.trim();
  if (!t || t === 'null') return '';
  if (t.startsWith('{')) {
    try {
      const j = JSON.parse(t);
      const pick = [j['content-security-policy'], j.csp, j.policy].find(
        (v) => typeof v === 'string' && v.trim(),
      );
      if (pick) {
        return pick.trim();
      }
      /* JSON with null / missing CSP — do not fall back to the raw JSON string. */
      return '';
    } catch {
      /* use raw */
    }
  }
  return t;
}

/**
 * @param {string} cspString
 * @returns {Record<string, string[]>}
 */
function parseCspDirectives(cspString) {
  /** @type Record<string, string[]> */
  const out = {};
  const s = cspString.replace(/\s+/g, ' ').trim();
  if (!s) return out;
  s.split(';').forEach((part) => {
    const trimmed = part.trim();
    if (!trimmed) return;
    const tokens = trimmed.split(/\s+/).filter(Boolean);
    if (!tokens.length) return;
    const [name, ...values] = tokens;
    const key = name.toLowerCase();
    if (!out[key]) out[key] = [];
    out[key].push(...values);
  });
  return out;
}

/**
 * script-src-elem → script-src → default-src (CSP3 for classic &lt;script&gt;).
 * @param {Record<string, string[]>} directives
 * @returns {{ label: string, tokens: string[] }}
 */
function getEffectiveScriptTokens(directives) {
  const order = [
    ['script-src-elem', 'script-src-elem'],
    ['script-src', 'script-src'],
    ['default-src', 'default-src'],
  ];
  const found = order.find(([key]) => {
    const t = directives[key];
    return t && t.length > 0;
  });
  if (found) {
    const [key, label] = found;
    return { label, tokens: directives[key] };
  }
  return { label: '', tokens: [] };
}

/**
 * connect-src when set; otherwise default-src (CSP fallback for fetch/XHR/WebSocket).
 * @param {Record<string, string[]>} directives
 * @returns {{ label: string, tokens: string[] }}
 */
function getEffectiveConnectTokens(directives) {
  const connect = directives['connect-src'];
  if (connect && connect.length > 0) {
    return { label: 'connect-src', tokens: connect };
  }
  const def = directives['default-src'];
  if (def && def.length > 0) {
    return { label: 'default-src', tokens: def };
  }
  return { label: '', tokens: [] };
}

/**
 * @param {string} patternHost e.g. *.cdn.example.com
 * @param {string} actualHost
 * @returns {boolean}
 */
function hostMatchesSource(patternHost, actualHost) {
  if (patternHost === actualHost) return true;
  if (patternHost.startsWith('*.')) {
    const suffix = patternHost.slice(2);
    return actualHost === suffix || actualHost.endsWith(`.${suffix}`);
  }
  return false;
}

/**
 * Strips CSP source-list outer quotes (ASCII ' " or common Unicode smart quotes).
 * @param {string} token
 * @returns {string}
 */
function normalizeCspToken(token) {
  const s = token.trim();
  if (s.length < 2) return s;
  const a = s[0];
  const b = s[s.length - 1];
  if ((a === "'" && b === "'") || (a === '"' && b === '"')) {
    return s.slice(1, -1);
  }
  if ((a === '\u2018' && b === '\u2019') || (a === '\u201C' && b === '\u201D')) {
    return s.slice(1, -1);
  }
  return s;
}

/**
 * @param {string} expr CSP source expression
 * @param {URL} resourceUrl
 * @param {URL} documentUrl
 * @returns {boolean}
 */
function sourceExpressionMatchesUrl(expr, resourceUrl, documentUrl) {
  const raw = normalizeCspToken(expr.trim());

  if (raw === 'self') {
    return resourceUrl.origin === documentUrl.origin;
  }
  if (raw === '*') return true;

  const schemeMatch = raw.match(/^([a-z][a-z0-9+.-]*):$/i);
  if (schemeMatch) {
    const p = `${schemeMatch[1].toLowerCase()}:`;
    return resourceUrl.protocol.toLowerCase() === p;
  }

  const urlLike = raw.match(/^(https?:)\/\/([^/]*)([^\s?#]*)/i);
  if (urlLike) {
    const scheme = `${urlLike[1].toLowerCase()}:`;
    if (resourceUrl.protocol.toLowerCase() !== scheme) return false;
    const hostPart = urlLike[2];
    const pathPart = urlLike[3] || '';
    if (!hostMatchesSource(hostPart, resourceUrl.hostname)) return false;
    if (pathPart && pathPart !== '/') {
      const prefix = pathPart.endsWith('/') ? pathPart.slice(0, -1) : pathPart;
      return resourceUrl.pathname === pathPart
        || resourceUrl.pathname.startsWith(`${prefix}/`)
        || resourceUrl.pathname.startsWith(pathPart);
    }
    return true;
  }

  if (!raw.includes('/') && !raw.includes(':')) {
    return hostMatchesSource(raw, resourceUrl.hostname);
  }

  try {
    const u = new URL(raw);
    if (resourceUrl.protocol !== u.protocol) return false;
    if (!hostMatchesSource(u.hostname, resourceUrl.hostname)) return false;
    if (u.pathname && u.pathname !== '/') {
      return resourceUrl.pathname.startsWith(u.pathname);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {string[]} tokens
 * @returns {boolean}
 */
function tokensIncludeStrictDynamic(tokens) {
  return tokens.some((t) => normalizeCspToken(t) === 'strict-dynamic');
}

/**
 * @param {string[]} tokens
 * @param {string | null} nonceVal
 * @returns {{ hasNonceAttr: boolean, nonceInPolicy: boolean, expectedToken: string }}
 */
function checkNonceInPolicy(tokens, nonceVal) {
  const trimmed = nonceVal ? nonceVal.trim() : '';
  const hasNonceAttr = Boolean(trimmed.length > 0);
  if (!hasNonceAttr) {
    return { hasNonceAttr: false, nonceInPolicy: true, expectedToken: '' };
  }
  const needle = `nonce-${trimmed}`;
  const nonceInPolicy = tokens.some((t) => normalizeCspToken(t) === needle);
  const expectedToken = `'nonce-${trimmed}'`;
  return { hasNonceAttr: true, nonceInPolicy, expectedToken };
}

/**
 * @param {URL} scriptUrl
 * @param {URL} pageUrl
 * @param {string[]} tokens
 * @returns {boolean}
 */
function isUrlSourceToken(token) {
  const n = normalizeCspToken(token);
  if (n === 'unsafe-inline' || n === 'unsafe-eval' || n === 'wasm-unsafe-eval'
    || n === 'strict-dynamic') {
    return false;
  }
  if (n.startsWith('nonce-') || n.startsWith('sha256-')
    || n.startsWith('sha384-') || n.startsWith('sha512-')) {
    return false;
  }
  return true;
}

function urlMatchesScriptPolicy(scriptUrl, pageUrl, tokens) {
  if (!tokens.length) return true;
  if (tokens.some((t) => normalizeCspToken(t) === 'none')) return false;
  return tokens.some((token) => isUrlSourceToken(token)
    && sourceExpressionMatchesUrl(token, scriptUrl, pageUrl));
}

/**
 * Whether a URL is allowed by connect-src (or default-src) for fetch/XHR.
 * Reuses the same source-list matching as script-src.
 * @param {URL} resourceUrl
 * @param {URL} pageUrl
 * @param {string[]} tokens
 * @returns {boolean}
 */
function urlMatchesConnectPolicy(resourceUrl, pageUrl, tokens) {
  return urlMatchesScriptPolicy(resourceUrl, pageUrl, tokens);
}

/**
 * Checks RUM / OpTel beacon hosts against connect-src (or default-src).
 * @param {URL} pageUrl
 * @param {Record<string, string[]>} directives
 * @returns {{ allowed: boolean, lines: string[] }}
 */
function evaluateRumConnectDestinations(pageUrl, directives) {
  const { label, tokens } = getEffectiveConnectTokens(directives);
  /** @type {{ href: string, note: string }[]} */
  const destinations = [
    { href: 'https://rum.hlx.page/', note: 'rum.hlx.page (RUM beacon / ingestion)' },
    { href: 'https://ot.aem.live/', note: 'ot.aem.live (Operational Telemetry API)' },
  ];

  const lines = [];

  if (!label) {
    lines.push('No connect-src or default-src in the policy — fetch/XHR to RUM hosts are not restricted by those directives.');
    lines.push('(Other directives or browser rules may still apply.)');
    return { allowed: true, lines };
  }

  lines.push(`Effective for connect: ${label}`);
  lines.push(`${label}: ${tokens.join(' ')}`);
  lines.push('');

  let allOk = true;
  destinations.forEach(({ href, note }) => {
    let destUrl;
    try {
      destUrl = new URL(href);
    } catch {
      lines.push(`${note}: invalid check URL.`);
      allOk = false;
      return;
    }
    const ok = urlMatchesConnectPolicy(destUrl, pageUrl, tokens);
    if (!ok) allOk = false;
    lines.push(`${note}: ${ok ? 'allowed' : 'NOT allowed (would block fetch/XHR to this host)'}`);
  });

  lines.push('');
  lines.push(allOk
    ? 'Verdict: these RUM endpoints match the connect policy (or its default-src fallback).'
    : 'Verdict: The connect-src directive in the Content-Security-Policy partially blocks OpTel collection.');

  return { allowed: allOk, lines };
}

/**
 * When to evaluate RUM hosts against connect-src / default-src:
 * - Script loads from rum.hlx.page or ot.aem.live (always), or
 * - OpTel matched via `/scripts.js`, unless the tag has a nonce that appears in script-src
 *   (script-src-elem / script-src / default-src) — nonce-guarded /scripts.js is exempt.
 * @param {{ signal: string, script: HTMLScriptElement }[]} matches
 * @param {URL} pageUrl
 * @param {Record<string, string[]>} directives
 * @returns {boolean}
 */
function shouldCheckConnectSrcForOptel(matches, pageUrl, directives) {
  const { tokens: scriptTokens } = getEffectiveScriptTokens(directives);

  return matches.some((m) => {
    try {
      const src = normalizeCanonicalAttrValue(m.script.getAttribute('src') || '');
      const { href } = new URL(src, pageUrl.href);
      if (href.includes('rum.hlx.page') || href.includes('ot.aem.live')) {
        return true;
      }
      if (m.signal === '/scripts.js') {
        const nonceVal = m.script.getAttribute('nonce')?.trim() ?? null;
        const nonceCheck = checkNonceInPolicy(scriptTokens, nonceVal);
        if (nonceCheck.hasNonceAttr && nonceCheck.nonceInPolicy) {
          return false;
        }
        return true;
      }
      return false;
    } catch {
      return false;
    }
  });
}

/**
 * @param {HTMLScriptElement} script
 * @param {URL} pageUrl
 * @param {string[]} tokens
 * @param {string} policyLabel
 * @returns {{ allowed: boolean, lines: string[] }}
 */
function evaluateScriptAgainstCsp(script, pageUrl, tokens, policyLabel) {
  const lines = [];
  const rawSrc = script.getAttribute('src');
  const src = normalizeCanonicalAttrValue(rawSrc || '');
  let scriptUrl;
  try {
    scriptUrl = new URL(src, pageUrl.href);
  } catch {
    return {
      allowed: false,
      lines: [`Could not resolve src relative to page: ${src}`],
    };
  }

  lines.push(`Resolved URL: ${scriptUrl.href}`);
  lines.push(`Policy used: ${policyLabel}`);

  const nonceVal = script.getAttribute('nonce');
  const nonceCheck = checkNonceInPolicy(tokens, nonceVal?.trim() ?? null);
  if (nonceCheck.hasNonceAttr) {
    lines.push('Nonce attribute: present');
    lines.push(`Expect policy token: ${nonceCheck.expectedToken}`);
    lines.push(nonceCheck.nonceInPolicy
      ? 'Nonce: matches a token in the policy.'
      : 'Nonce: no matching \'nonce-…\' token in the policy.');
  } else {
    lines.push('Nonce attribute: absent');
  }

  const strict = tokensIncludeStrictDynamic(tokens);
  const urlOk = urlMatchesScriptPolicy(scriptUrl, pageUrl, tokens);

  if (nonceCheck.hasNonceAttr && !nonceCheck.nonceInPolicy) {
    return {
      allowed: false,
      lines: [...lines, 'Verdict: blocked (nonce required by the script but not allowed by the policy).'],
    };
  }

  if (strict && nonceCheck.hasNonceAttr && nonceCheck.nonceInPolicy) {
    return {
      allowed: true,
      lines: [
        ...lines,
        'strict-dynamic is present with a valid nonce — browsers ignore host allowlists for this nonce-guarded script (CSP3).',
        'Verdict: allowed (under typical CSP3 strict-dynamic rules).',
      ],
    };
  }

  if (urlOk) {
    return {
      allowed: true,
      lines: [...lines, 'URL matches script-src / default-src source list.',
        'Verdict: allowed (host / scheme / self).'],
    };
  }

  return {
    allowed: false,
    lines: [...lines, 'URL does not match any host, scheme, or self source in the policy.',
      'Verdict: likely blocked by Content-Security-Policy.'],
  };
}

/**
 * @param {{ script: HTMLScriptElement }[]} matches
 * @param {string[]} scriptTokens
 * @returns {boolean}
 */
function anyOpTelScriptNonceMatchesPolicy(matches, scriptTokens) {
  return matches.some((m) => {
    const n = m.script.getAttribute('nonce')?.trim();
    if (!n) return false;
    return checkNonceInPolicy(scriptTokens, n).nonceInPolicy;
  });
}

/**
 * @param {{ allowed: boolean, lines: string[] }} result
 * @returns {string}
 */
function summarizeScriptCspFailure(result) {
  const verdict = result.lines.find((l) => l.startsWith('Verdict:'));
  if (verdict) {
    return verdict.replace(/^Verdict:\s*/i, '').trim();
  }
  const first = result.lines[0];
  if (first) return first;
  return 'CSP blocked the OpTel script.';
}

/**
 * @param {string[]} lines
 * @returns {string}
 */
function summarizeConnectCspFailure(lines) {
  const verdict = lines.find((l) => l.startsWith('Verdict:'));
  if (verdict) {
    return verdict.replace(/^Verdict:\s*/i, '').trim();
  }
  const detail = lines.find((l) => l.includes('NOT allowed'));
  if (detail) return detail;
  return 'CSP connect-src blocked RUM or telemetry requests.';
}

/**
 * Short CSP summary for the UI; keeps the same pass/fail rules as the full evaluators.
 * @param {{ signal: string, tag: string, script: HTMLScriptElement }[]} matches
 * @param {URL} pageUrl
 * @param {string} cspRaw
 * @returns {{ text: string, cspFullyPasses: boolean }}
 */
function buildCspScriptAnalysis(matches, pageUrl, cspRaw) {
  const policyStr = extractCspPolicyString(cspRaw);
  if (!policyStr.trim()) {
    return {
      text: 'No CSP restrictions.',
      cspFullyPasses: matches.length > 0,
    };
  }

  const directives = parseCspDirectives(policyStr);
  const checkConnect = shouldCheckConnectSrcForOptel(matches, pageUrl, directives);
  const { label: scriptLabel, tokens: scriptTokens } = getEffectiveScriptTokens(directives);

  /** @type {{ allowed: boolean, lines: string[] }[]} */
  const scriptResults = [];
  if (scriptLabel) {
    matches.forEach((m) => {
      scriptResults.push(
        evaluateScriptAgainstCsp(m.script, pageUrl, scriptTokens, scriptLabel),
      );
    });
  }

  const connectEval = checkConnect
    ? evaluateRumConnectDestinations(pageUrl, directives)
    : { allowed: true, lines: [] };

  const scriptsOkForProbe = !scriptLabel
    ? matches.length > 0
    : scriptResults.length === matches.length
      && scriptResults.length > 0
      && scriptResults.every((r) => r.allowed);

  const cspFullyPasses = scriptsOkForProbe && connectEval.allowed;

  if (!cspFullyPasses) {
    const failedScript = scriptResults.find((r) => !r.allowed);
    if (failedScript) {
      return { text: summarizeScriptCspFailure(failedScript), cspFullyPasses: false };
    }
    if (!connectEval.allowed) {
      return {
        text: summarizeConnectCspFailure(connectEval.lines),
        cspFullyPasses: false,
      };
    }
    return { text: 'CSP did not pass for this page.', cspFullyPasses: false };
  }

  /** @type {string[]} */
  const linesOut = [];
  if (anyOpTelScriptNonceMatchesPolicy(matches, scriptTokens)) {
    linesOut.push('CSP nonce match.');
  }
  if (scriptsOkForProbe) {
    linesOut.push('CSP script-src match.');
  }
  if (checkConnect && connectEval.allowed) {
    linesOut.push('CSP connect-src match.');
  }

  return {
    text: linesOut.join('\n'),
    cspFullyPasses: true,
  };
}

/** Hostnames for scripts that POST to Adobe’s RUM ingest on the same origin. */
const ADOBE_RUM_SCRIPT_HOSTS = ['rum.hlx.page', 'ot.aem.live'];

/**
 * @param {HTMLScriptElement} script
 * @param {URL} checkedPageUrl
 * @returns {URL}
 */
function resolvedScriptUrl(script, checkedPageUrl) {
  const src = normalizeCanonicalAttrValue(script.getAttribute('src') || '');
  return new URL(src, checkedPageUrl.href);
}

/**
 * POST to /.rum/1 on the script origin for Adobe RUM scripts; else on the checked page origin.
 * @param {URL} checkedPageUrl
 * @param {{ script: HTMLScriptElement }[]} matches
 * @returns {URL}
 */
function getOpTelRumProbeEndpoint(checkedPageUrl, matches) {
  const hit = matches.find(({ script }) => {
    try {
      return ADOBE_RUM_SCRIPT_HOSTS.includes(resolvedScriptUrl(script, checkedPageUrl).hostname);
    } catch {
      return false;
    }
  });
  if (hit) {
    return new URL('/.rum/1', resolvedScriptUrl(hit.script, checkedPageUrl).origin);
  }
  return new URL('/.rum/1', checkedPageUrl.origin);
}

/** Proxies the OpTel POST to the target `url` (avoids browser CORS to rum / site origins). */
const POST_OPTEL_WORKER_ORIGIN = 'https://post-optel.aem-poc-lab.workers.dev';

/**
 * @param {URL} targetPostUrl URL that receives the probe POST (e.g. …/.rum/1).
 * @returns {string}
 */
function buildPostOptelProxyUrl(targetPostUrl) {
  const proxyUrl = new URL('/', POST_OPTEL_WORKER_ORIGIN);
  proxyUrl.searchParams.set('url', targetPostUrl.href);
  return proxyUrl.href;
}

/**
 * GETs the Cloudflare worker (?url= target POST URL). Any 2xx status counts as success.
 * @param {URL} endpoint
 * @returns {Promise<{ ok: true, status: number } | { ok: false, status: number, message: string }>}
 */
async function postOpTelProbe(endpoint) {
  let response;
  try {
    response = await fetch(buildPostOptelProxyUrl(endpoint), {
      method: 'GET',
      mode: 'cors',
      cache: 'no-store',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      status: 0,
      message: `Network error (worker or CORS): ${msg}`,
    };
  }

  if (response.ok) {
    return { ok: true, status: response.status };
  }

  let bodySnippet = '';
  try {
    bodySnippet = (await response.text()).trim().slice(0, 500);
  } catch {
    bodySnippet = '';
  }
  const statusBits = [response.status, response.statusText].filter(Boolean).join(' ');
  const xErr = response.headers.get('x-error');
  const lines = [`HTTP ${statusBits} ${xErr}`];
  if (bodySnippet) {
    lines.push(bodySnippet);
  }
  return {
    ok: false,
    status: response.status,
    message: lines.join('\n'),
  };
}

/**
 * @param {URL} target
 * @returns {Promise<string>}
 */
async function fetchPageHtml(target) {
  const workerUrl = new URL('/', HTML_WORKER_ORIGIN);
  workerUrl.searchParams.set('url', target.href);
  const response = await fetch(workerUrl.href, {
    method: 'GET',
    cache: 'no-store',
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`HTML fetch failed (${response.status}). ${text.slice(0, 200)}`);
  }
  return extractHtmlFromWorkerResponse(text);
}

/**
 * @param {URL} target
 * @returns {Promise<string>}
 */
async function fetchCspReport(target) {
  const workerUrl = new URL('/', CSP_WORKER_ORIGIN);
  workerUrl.searchParams.set('url', target.href);
  const response = await fetch(workerUrl.href, {
    method: 'GET',
    cache: 'no-store',
  });
  return response.text();
}

function clearPanels() {
  opelStatus.textContent = '';
  opelMatched.textContent = '';
  opelMatched.hidden = true;
  cspResult.textContent = '';
  cspSection.hidden = true;
  cspSection.removeAttribute('data-csp-result');
  rumProbeResult.textContent = '';
  rumProbeFailHint.hidden = true;
  rumProbeSection.hidden = true;
  rumProbeSection.removeAttribute('data-rum-probe-result');
}

/**
 * Puts `?url=` on the current tool page (no reload) so the check is shareable.
 * @param {string} urlValue normalized URL string
 */
function syncUrlQueryParam(urlValue) {
  const pageUrl = new URL(window.location.href);
  pageUrl.searchParams.set('url', urlValue);
  window.history.replaceState(null, '', `${pageUrl.pathname}${pageUrl.search}${pageUrl.hash}`);
}

function init() {
  try {
    const fromQuery = new URL(window.location.href).searchParams.get('url');
    if (fromQuery) {
      urlInput.value = fromQuery;
    }
  } catch {
    /* ignore malformed window.location */
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearPanels();
    urlInput.value = normalizeUrlInputToHttps(urlInput.value);
    syncUrlQueryParam(urlInput.value);

    let target;
    try {
      target = parseUrl(urlInput.value);
    } catch (err) {
      setOutputState('opel-error');
      opelStatus.textContent = err instanceof Error ? err.message : String(err);
      return;
    }

    setLoading(true);
    setOutputState('loading');
    opelStatus.textContent = 'Loading page HTML…';

    try {
      const html = await fetchPageHtml(target);
      const matches = findOptelScriptMatches(html);

      if (matches.length === 0) {
        setOutputState('opel-disabled');
        opelStatus.innerHTML = `
The OpTel script is not included.
<ul>
<li>If AEM CS, <a target="_blank" href="https://www.aem.live/docs/operational-telemetry#disabling-operational-telemetry">OpTel might be disabled</a>.</li>
<li>If headless or not AEM, <a target="_blank" href="https://www.aem.live/developer/operational-telemetry#how-to-add-operational-telemetry-instrumentation-to-your-site">the script might need to be added manually</a>.</li>
</ul>`.trim();
        opelMatched.hidden = true;
        cspSection.hidden = true;
        return;
      }

      setOutputState('done');
      opelStatus.textContent = 'OpTel script is included.';
      const lines = matches.map(
        ({ tag }) => `${tag}`,
      );
      // Do not run normalizeDisplayText here: it strips \" and merges "" in ways that
      // corrupt data-* attributes (e.g. data-routing JSON).
      opelMatched.textContent = lines.join('\n\n');
      opelMatched.hidden = false;

      cspSection.hidden = false;
      cspSection.dataset.cspResult = 'pending';
      cspResult.textContent = 'Loading Content-Security-Policy…';
      try {
        const cspText = await fetchCspReport(target);
        const cspAnalysis = buildCspScriptAnalysis(matches, target, cspText);
        cspResult.textContent = cspAnalysis.text;
        cspSection.dataset.cspResult = cspAnalysis.cspFullyPasses ? 'pass' : 'fail';

        if (cspAnalysis.cspFullyPasses && shouldRunPostProbe(matches)) {
          rumProbeSection.hidden = false;
          const probeEndpoint = getOpTelRumProbeEndpoint(target, matches);
          rumProbeSection.dataset.rumProbeResult = 'pending';
          rumProbeFailHint.hidden = true;
          rumProbeResult.textContent = 'Running POST probe…';
          const probe = await postOpTelProbe(probeEndpoint);
          rumProbeSection.dataset.rumProbeResult = probe.ok ? 'pass' : 'fail';
          if (probe.ok) {
            rumProbeFailHint.hidden = true;
            rumProbeResult.textContent = [
              `POST: ${probeEndpoint.href}`,
              `Success: HTTP ${probe.status} OK`,
            ].join('\n');
          } else {
            rumProbeResult.textContent = [
              `POST: ${probeEndpoint.href}`,
              `Error: ${probe.message}`,
            ].join('\n');
            rumProbeFailHint.hidden = false;
          }
        } else {
          rumProbeFailHint.hidden = true;
          rumProbeResult.textContent = '';
          rumProbeSection.hidden = true;
          rumProbeSection.removeAttribute('data-rum-probe-result');
        }
      } catch (cspErr) {
        rumProbeFailHint.hidden = true;
        rumProbeSection.hidden = true;
        rumProbeSection.removeAttribute('data-rum-probe-result');
        cspSection.dataset.cspResult = 'fail';
        const msg = cspErr instanceof Error ? cspErr.message : String(cspErr);
        cspResult.textContent = `Could not load Content-Security-Policy: ${msg}`;
      }
    } catch (err) {
      setOutputState('opel-error');
      const msg = err instanceof Error ? err.message : String(err);
      opelStatus.textContent = `Could not complete the check: ${msg}`;
      opelMatched.hidden = true;
      cspSection.hidden = true;
    } finally {
      setLoading(false);
    }
  });
}

registerToolReady(init());
