import { logMessage } from '../../blocks/console/console.js';

/**
 * Strips version-note suffixes from a raw caniuse support code string.
 * @param {string} code - Raw support string, e.g. "y #1" or "a#2"
 * @returns {string} Clean code: "y", "n", "a", "p", "d", or ""
 */
function supportCode(code) {
  return code ? code.split(' ')[0].split('#')[0] : '';
}

/**
 * Resolves a support code for a browser version from feature stats.
 * Falls back to the nearest older recorded version when an exact match is absent.
 * Version "0" is the caniuse convention for the current release.
 * @param {Object|null} agentStats - Feature stats for a single agent, keyed by version string
 * @param {string} version - Browser version to look up, or "0" for current
 * @returns {string} Raw support code for that version, or "" if unknown
 */
function lookupAgentSupport(agentStats, version) {
  if (!agentStats) return '';
  if (agentStats[version] !== undefined) return agentStats[version];
  const nums = Object.keys(agentStats)
    .filter((v) => v !== 'all' && Number.isFinite(parseFloat(v)));
  if (!nums.length) return '';
  const target = version === '0' ? Infinity : parseFloat(version);
  const candidates = nums.filter((v) => parseFloat(v) <= target);
  if (!candidates.length) return '';
  return agentStats[candidates.reduce((a, b) => (parseFloat(a) > parseFloat(b) ? a : b))];
}

/**
 * Whether any in-use version has ES6 modules (baseline) but not the feature — strict parity.
 * @param {Object} regionVersions - per-version usage for one agent (caniuse region row)
 * @param {(version: string) => string} baselineRaw - raw caniuse code for ES6 modules at version
 * @param {(version: string) => string} featureRaw - raw caniuse code or synthetic y/n per version
 * @returns {{strictGap: boolean, hasBaselineUsage: boolean}}
 */
function strictBaselineCompareAgent(regionVersions, baselineRaw, featureRaw) {
  let strictGap = false;
  let hasBaselineUsage = false;
  Object.entries(regionVersions).forEach(([version, usage]) => {
    if (!usage || version === 'all') return;
    const bCode = supportCode(baselineRaw(version));
    const bOk = bCode === 'y' || bCode === 'a';
    if (!bOk) return;
    hasBaselineUsage = true;
    const fCode = supportCode(featureRaw(version));
    const fOk = fCode === 'y' || fCode === 'a';
    if (!fOk) strictGap = true;
  });
  return { strictGap, hasBaselineUsage };
}

/**
 * Maps a caniuse region agent id to a BCD {@code support} engine key when one exists.
 * @param {string} agent - key from caniuse region data (e.g. {@code and_chr})
 * @returns {string|null} BCD engine id, or null if BCD does not model this agent
 */
function caniuseAgentToBcdEngine(agent) {
  switch (agent) {
    case 'chrome':
      return 'chrome';
    case 'and_chr':
      return 'chrome_android';
    case 'edge':
      return 'edge';
    case 'firefox':
      return 'firefox';
    case 'and_ff':
      return 'firefox_android';
    case 'safari':
      return 'safari';
    case 'ios_saf':
      return 'safari_ios';
    case 'samsung':
      return 'samsunginternet_android';
    case 'opera':
      return 'opera';
    case 'op_mob':
      return 'opera_android';
    case 'ie':
      return 'ie';
    case 'ie_mob':
      return 'ie';
    case 'android':
      return 'webview_android';
    default:
      return null;
  }
}

/**
 * Normalizes a BCD support field to a list of simple support objects.
 * @param {*} entry - raw {@code __compat.support[engine]} value
 * @returns {Array<Object>}
 */
function bcdSupportStatements(entry) {
  if (entry === undefined || entry === null) return [];
  if (Array.isArray(entry)) {
    return entry.filter((x) => x && typeof x === 'object');
  }
  if (typeof entry === 'object') {
    return [entry];
  }
  return [];
}

/**
 * Whether a single BCD simple support statement applies at {@code version}.
 * @param {Object|null} st - BCD support statement
 * @param {string} version - browser version string, or {@code "0"} for current / latest
 * @returns {boolean}
 */
function bcdStatementSupportsVersion(st, version) {
  if (!st || typeof st !== 'object') return false;
  if (st.version_added === false || st.version_added === null) return false;
  if (st.version_added === true) return true;
  const target = version === '0' ? Infinity : parseFloat(version);
  const added = parseFloat(String(st.version_added));
  if (!Number.isFinite(added)) {
    return version === '0';
  }
  if (target < added) return false;
  if (
    st.version_removed !== undefined
    && st.version_removed !== null
    && st.version_removed !== false
  ) {
    const rem = parseFloat(String(st.version_removed));
    if (Number.isFinite(rem) && target >= rem) return false;
  }
  return true;
}

/**
 * Whether BCD records support for this engine at the given version.
 * @param {*} entry - raw {@code __compat.support[engine]} value
 * @param {string} version - browser version string, or {@code "0"} for current
 * @returns {boolean}
 */
function bcdSupportsAtVersion(entry, version) {
  const list = bcdSupportStatements(entry);
  for (let i = 0; i < list.length; i += 1) {
    if (bcdStatementSupportsVersion(list[i], version)) return true;
  }
  return false;
}

/**
 * Resolves a BCD path segment to the actual key on {@code node} (PascalCase vs lowercase).
 * @param {Object} node - parent object
 * @param {string} segment - one path segment from user input
 * @returns {string|null} matching key or null
 */
function findBcdChildKey(node, segment) {
  if (!node || typeof node !== 'object') return null;
  if (Object.prototype.hasOwnProperty.call(node, segment)) return segment;
  const needle = segment.toLowerCase();
  const keys = Object.keys(node);
  for (let k = 0; k < keys.length; k += 1) {
    const key = keys[k];
    if (key !== '__compat' && key.toLowerCase() === needle) return key;
  }
  return null;
}

/**
 * Splits a user-entered BCD dotted path into segments (preserves casing for resolution).
 * @param {string} raw - e.g. {@code api.Headers.has}
 * @returns {string[]}
 */
function splitBcdQuerySegments(raw) {
  return raw
    .trim()
    .split('.')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Looks up a nested BCD feature by dot path (e.g. javascript.operators.optional_chaining).
 * @param {Object} root - parsed browser-compat-data.json root
 * @param {string[]} segments - path segments
 * @returns {Object|null} feature node with __compat, or null
 */
function getBcdFeatureNode(root, segments) {
  let cur = root;
  for (let i = 0; i < segments.length; i += 1) {
    const resolved = findBcdChildKey(cur, segments[i]);
    if (resolved === null) return null;
    cur = cur[resolved];
  }
  // eslint-disable-next-line no-underscore-dangle -- BCD feature leaf uses __compat
  if (!cur || typeof cur !== 'object' || !cur.__compat) return null;
  return cur;
}

/**
 * Strips simple HTML tags from BCD description strings for plain-text UI.
 * @param {string} html - string that may contain tags such as &lt;code&gt;
 * @returns {string}
 */
function stripHtmlDescription(html) {
  if (!html || typeof html !== 'string') return '';
  return html.replace(/<[^>]*>/g, '');
}

/**
 * Same as {@link buildBrowserData} but uses a BCD {@code __compat} for the feature side.
 * @param {Object} bcdCompat - BCD __compat object
 * @param {Object} baselineJson - caniuse data for es6-module
 * @param {Object} regionJson - regional usage data from the caniuse alt-ww dataset
 * @returns {Array<{agent: string, name: string, usage: number, status: string}>}
 *   Same {@link buildBrowserData} {@code status} meanings.
 */
function buildBrowserDataFromBcd(bcdCompat, baselineJson, regionJson) {
  const browserNames = {
    chrome: 'Chrome',
    firefox: 'Firefox',
    safari: 'Safari',
    edge: 'Edge',
    and_chr: 'Chrome Android',
    ios_saf: 'Safari iOS',
    samsung: 'Samsung Internet',
    and_ff: 'Firefox Android',
    opera: 'Opera',
    ie: 'IE',
    ie_mob: 'IE Mobile',
    and_uc: 'UC Browser',
    android: 'Android Browser',
    op_mob: 'Opera Mobile',
    op_mini: 'Opera Mini',
    kaios: 'KaiOS',
  };
  const bcdSupport = bcdCompat.support || {};
  return Object.entries(regionJson.data)
    .map(([agent, versions]) => {
      const usage = Object.values(versions).reduce((sum, u) => sum + (u || 0), 0);
      if (usage < 0.05) return null;
      const name = browserNames[agent] || agent;
      const bStats = baselineJson.stats ? baselineJson.stats[agent] : null;
      const engine = caniuseAgentToBcdEngine(agent);
      const bcdEntry = engine ? bcdSupport[engine] : undefined;
      const { strictGap, hasBaselineUsage } = strictBaselineCompareAgent(
        versions,
        (v) => lookupAgentSupport(bStats, v),
        (v) => {
          if (!engine || bcdEntry === undefined) return 'y';
          return bcdSupportsAtVersion(bcdEntry, v) ? 'y' : 'n';
        },
      );
      let status;
      if (strictGap) {
        status = 'unsupported';
      } else if (hasBaselineUsage) {
        status = 'supported';
      } else {
        status = 'neither';
      }
      return {
        agent, name, usage, status,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.usage - a.usage);
}

/**
 * Same coverage semantics as {@link computeCoverage}, with feature support from BCD.
 * @param {Object} bcdCompat - BCD __compat object
 * @param {Object} baselineJson - caniuse data for es6-module
 * @param {Object} regionJson - regional usage data from the caniuse alt-ww dataset
 * @returns {{baselineCoverage: number, featureCoverage: number}}
 */
function computeCoverageFromBcd(bcdCompat, baselineJson, regionJson) {
  let baselineCoverage = 0;
  let featureCoverage = 0;
  const bcdSupport = bcdCompat.support || {};
  Object.entries(regionJson.data).forEach(([agent, versions]) => {
    const bStats = baselineJson.stats ? baselineJson.stats[agent] : null;
    Object.entries(versions).forEach(([version, usage]) => {
      if (!usage || version === 'all') return;
      const bCode = supportCode(lookupAgentSupport(bStats, version));
      const engine = caniuseAgentToBcdEngine(agent);
      let fCode;
      if (!engine || bcdSupport[engine] === undefined) {
        fCode = 'y';
      } else {
        fCode = bcdSupportsAtVersion(bcdSupport[engine], version) ? 'y' : 'n';
      }
      if (bCode === 'y' || bCode === 'a') {
        baselineCoverage += usage;
        if (fCode === 'y' || fCode === 'a') featureCoverage += usage;
      }
    });
  });
  return { baselineCoverage, featureCoverage };
}

/**
 * Categorizes browsers using strict baseline parity: every version with regional usage that
 * supports ES6 modules must also support the feature. Browsers under 0.05% total usage are omitted.
 * @param {Object} featureJson - caniuse data for the feature being tested
 * @param {Object} baselineJson - caniuse data for es6-module
 * @param {Object} regionJson - regional usage data from the caniuse alt-ww dataset
 * @returns {Array<{agent: string, name: string, usage: number, status: string}>}
 *   status: "supported" = no strict gap and some in-use versions have ES6 modules,
 *   "unsupported" = baseline (y/a) on some in-use version but feature not on that version,
 *   "neither" = no in-use version in the data has ES6 modules (y/a) for this agent.
 */
function buildBrowserData(featureJson, baselineJson, regionJson) {
  const browserNames = {
    chrome: 'Chrome',
    firefox: 'Firefox',
    safari: 'Safari',
    edge: 'Edge',
    and_chr: 'Chrome Android',
    ios_saf: 'Safari iOS',
    samsung: 'Samsung Internet',
    and_ff: 'Firefox Android',
    opera: 'Opera',
    ie: 'IE',
    ie_mob: 'IE Mobile',
    and_uc: 'UC Browser',
    android: 'Android Browser',
    op_mob: 'Opera Mobile',
    op_mini: 'Opera Mini',
    kaios: 'KaiOS',
  };

  return Object.entries(regionJson.data)
    .map(([agent, versions]) => {
      const usage = Object.values(versions).reduce((sum, u) => sum + (u || 0), 0);
      if (usage < 0.05) return null;
      const name = browserNames[agent] || agent;
      const fStats = featureJson.stats ? featureJson.stats[agent] : null;
      const bStats = baselineJson.stats ? baselineJson.stats[agent] : null;
      const { strictGap, hasBaselineUsage } = strictBaselineCompareAgent(
        versions,
        (v) => lookupAgentSupport(bStats, v),
        (v) => lookupAgentSupport(fStats, v),
      );
      let status;
      if (strictGap) {
        status = 'unsupported';
      } else if (hasBaselineUsage) {
        status = 'supported';
      } else {
        status = 'neither';
      }
      return {
        agent, name, usage, status,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.usage - a.usage);
}

/**
 * Derives the pass/fail verdict from the set of gap browsers.
 * @param {Array<{agent: string, usage: number}>} gaps
 *   Browsers where the ES6 module baseline is supported but the feature is not
 * @returns {{label: string, cssClass: string, explanation: string}}
 */
function verdict(gaps) {
  if (gaps.length === 0) {
    return {
      label: 'Meets baseline',
      cssClass: 'pass',
      explanation: 'This feature works in the same browser versions as ES6 modules.',
    };
  }
  const count = gaps.length;
  return {
    label: 'Use with caution',
    cssClass: 'fail',
    explanation: `Falls short in ${count} browser${count > 1 ? 's' : ''}.`,
  };
}

/**
 * Global coverage: sums regional usage at version granularity. Baseline is all usage on versions
 * with ES6 modules (y/a). Feature is usage on those same versions where the feature is also y/a
 * — equal to baseline only under strict parity.
 * @param {Object} featureJson - caniuse data for the feature being tested
 * @param {Object} baselineJson - caniuse data for es6-module
 * @param {Object} regionJson - regional usage data from the caniuse alt-ww dataset
 * @returns {{baselineCoverage: number, featureCoverage: number}}
 */
function computeCoverage(featureJson, baselineJson, regionJson) {
  let baselineCoverage = 0;
  let featureCoverage = 0;
  Object.entries(regionJson.data).forEach(([agent, versions]) => {
    const fStats = featureJson.stats ? featureJson.stats[agent] : null;
    const bStats = baselineJson.stats ? baselineJson.stats[agent] : null;
    Object.entries(versions).forEach(([version, usage]) => {
      if (!usage || version === 'all') return;
      const fCode = supportCode(lookupAgentSupport(fStats, version));
      const bCode = supportCode(lookupAgentSupport(bStats, version));
      if (bCode === 'y' || bCode === 'a') {
        baselineCoverage += usage;
        if (fCode === 'y' || fCode === 'a') featureCoverage += usage;
      }
    });
  });
  return { baselineCoverage, featureCoverage };
}

/**
 * Puts a button into a loading state, replacing its label with a spinner.
 * @param {HTMLButtonElement} btn - The button to update
 */
function showLoadingButton(btn) {
  const { width, height } = btn.getBoundingClientRect();
  btn.dataset.label = btn.textContent;
  btn.style.minWidth = `${width}px`;
  btn.style.minHeight = `${height}px`;
  btn.innerHTML = '<i class="symbol symbol-loading"></i>';
  btn.disabled = true;
}

/**
 * Restores a button from its loading state back to its original label.
 * @param {HTMLButtonElement} btn - The button to reset
 */
function resetLoadingButton(btn) {
  btn.textContent = btn.dataset.label;
  btn.removeAttribute('style');
  btn.disabled = false;
}

/**
 * Fetches and caches JSON from a URL, falling back to a CORS proxy on network failure.
 * @param {Map} cache - Request cache keyed by URL
 * @param {string} url - URL to fetch
 * @returns {Promise<Object>} Parsed JSON response
 */
async function fetchJson(cache, url) {
  if (cache.has(url)) return cache.get(url);
  let data;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    data = await res.json();
  } catch {
    const proxy = `https://fcors.org/?url=${encodeURIComponent(url)}`;
    const res = await fetch(proxy);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    data = await res.json();
  }
  cache.set(url, data);
  return data;
}

/**
 * Populates a browser grid list with one item per browser.
 * @param {HTMLElement} ul - The <ul> element to populate
 * @param {Array<{name: string, status: string}>} browsers - Browser entries to render
 */
function populateGrid(ul, browsers) {
  ul.innerHTML = '';
  browsers.forEach(({ name, status }) => {
    const li = document.createElement('li');
    li.className = status;
    li.textContent = name;
    ul.appendChild(li);
  });
}

/**
 * Builds a coverage table row with a progress bar and percentage label.
 * @param {string} label - Row header text
 * @param {number} pct - Coverage percentage (0–100)
 * @param {string|null} fillClass - Additional class for the fill bar, or null for default
 * @returns {{row: HTMLElement, pctEl: HTMLElement}} The <tr> and its percentage <td>
 */
function coverageRow(label, pct, fillClass) {
  const row = document.createElement('tr');
  const th = document.createElement('th');
  th.scope = 'row';
  th.className = 'coverage-label';
  th.textContent = label;
  const barCell = document.createElement('td');
  barCell.className = 'coverage-bar';
  const track = document.createElement('div');
  track.className = 'coverage-track';
  const fill = document.createElement('div');
  fill.className = fillClass ? `coverage-fill ${fillClass}` : 'coverage-fill';
  fill.style.width = `${pct.toFixed(1)}%`;
  track.appendChild(fill);
  barCell.appendChild(track);
  const pctEl = document.createElement('td');
  pctEl.className = 'coverage-pct';
  pctEl.textContent = `${pct.toFixed(1)}%`;
  row.appendChild(th);
  row.appendChild(barCell);
  row.appendChild(pctEl);
  return { row, pctEl };
}

const BCD_ROOT_SKIP = new Set(['browsers', '__meta']);

/**
 * Trims and lowercases a user feature query.
 * @param {string} raw - raw input string
 * @returns {string}
 */
function normalizeFeatureQuery(raw) {
  return raw.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Splits a normalized query into search tokens (letters/digits, min length 2).
 * @param {string} qNorm - normalized query
 * @returns {string[]}
 */
function tokenizeFeatureQuery(qNorm) {
  return qNorm.split(/[^a-z0-9]+/).filter((t) => t.length >= 2);
}

/**
 * Normalizes text for matching: lowercase, strips tags; non-alphanumerics become spaces.
 * @param {string} s - title, description, keywords, etc.
 * @returns {string}
 */
function normalizeFeatureHaystack(s) {
  if (!s || typeof s !== 'string') return '';
  const noTags = s.replace(/<[^>]*>/g, ' ');
  return noTags.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Scores how well tokens match a haystack; awards a large bonus when the query equals an exact id.
 * @param {string[]} tokens - query tokens
 * @param {string} qNorm - normalized full query
 * @param {string} hayNorm - normalized haystack
 * @param {string[]} exactIds - ids to treat as exact matches (slug, dotted path)
 * @returns {number}
 */
function scoreFeatureMatch(tokens, qNorm, hayNorm, exactIds) {
  if (exactIds && exactIds.length) {
    for (let i = 0; i < exactIds.length; i += 1) {
      if (qNorm === exactIds[i]) return 100000;
    }
  }
  let score = 0;
  if (qNorm.length >= 4 && hayNorm.indexOf(qNorm) !== -1) score += 22;
  const expanded = hayNorm.replace(/\./g, ' ');
  const hayWords = new Set(tokenizeFeatureQuery(expanded));
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i];
    if (hayWords.has(t)) score += 14;
    else if (t.length >= 4 && hayNorm.indexOf(t) !== -1) score += 6;
  }
  return score;
}

/**
 * Depth-first collect of BCD feature leaves ({@code __compat}) with dotted paths.
 * @param {*} node - current BCD subtree
 * @param {string[]} segments - path segments from root
 * @param {Array<{path: string, compat: Object}>} out - mutable result list
 */
function flattenBcdSubtree(node, segments, out) {
  if (!node || typeof node !== 'object') return;
  /* eslint-disable no-underscore-dangle -- BCD schema */
  if (node.__compat && segments.length > 0) {
    out.push({
      path: segments.join('.'),
      compat: node.__compat,
    });
  }
  /* eslint-enable no-underscore-dangle */
  const keys = Object.keys(node);
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    if (key !== '__compat') {
      flattenBcdSubtree(node[key], segments.concat(key), out);
    }
  }
}

/**
 * Builds a flat list of all BCD features under api/css/html/javascript/etc.
 * @param {Object} bcdRoot - parsed browser-compat-data root
 * @returns {Array<{path: string, compat: Object}>}
 */
function flattenBcdRoot(bcdRoot) {
  const out = [];
  const keys = Object.keys(bcdRoot);
  for (let i = 0; i < keys.length; i += 1) {
    const k = keys[i];
    if (!BCD_ROOT_SKIP.has(k)) {
      flattenBcdSubtree(bcdRoot[k], [k], out);
    }
  }
  return out;
}

/**
 * Resolves a caniuse key when the user typed the literal slug (with spaces or different casing).
 * @param {string} raw - user input
 * @param {Object} dataMap - fullData.data
 * @returns {string|null} slug key in dataMap
 */
function resolveCaniuseSlugDirect(raw, dataMap) {
  const s = raw.trim();
  if (!s) return null;
  const lower = s.toLowerCase();
  if (dataMap[lower]) return lower;
  const hyphen = lower.replace(/\s+/g, '-');
  if (dataMap[hyphen]) return hyphen;
  return null;
}

/**
 * Scores all caniuse features against a free-text query.
 * @param {Object} dataMap - fullData.data
 * @param {string} rawQuery - user input
 * @returns {Array<{kind: string, slug: string, score: number, label: string}>}
 */
function rankCaniuseFeatureMatches(dataMap, rawQuery) {
  const qNorm = normalizeFeatureQuery(rawQuery);
  if (!qNorm) return [];
  const tokens = tokenizeFeatureQuery(qNorm.replace(/\./g, ' '));
  const out = [];
  const slugs = Object.keys(dataMap);
  for (let i = 0; i < slugs.length; i += 1) {
    const slug = slugs[i];
    const f = dataMap[slug];
    const title = f.title || '';
    const kw = f.keywords || '';
    // Omit description: prose repeats common words ("has", "can", …) and adds noise.
    const hayRaw = `${slug} ${title} ${kw}`;
    const hayNorm = normalizeFeatureHaystack(hayRaw);
    const exactIds = [slug, slug.replace(/-/g, ' ')];
    const score = scoreFeatureMatch(tokens, qNorm, hayNorm, exactIds);
    if (score > 0) {
      out.push({
        kind: 'caniuse',
        slug,
        score,
        label: title || slug,
      });
    }
  }
  out.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.slug.length - b.slug.length;
  });
  return out;
}

/**
 * Scores flattened BCD features against a free-text query.
 * @param {Array<{path: string, compat: Object}>} flat - from {@link flattenBcdRoot}
 * @param {string} rawQuery - user input
 * @returns {Array<{kind: string, path: string, score: number, label: string, compat: Object}>}
 */
function rankBcdFeatureMatches(flat, rawQuery) {
  const qNorm = normalizeFeatureQuery(rawQuery);
  if (!qNorm) return [];
  const tokens = tokenizeFeatureQuery(qNorm.replace(/\./g, ' '));
  const useDesc = tokens.length >= 2 || qNorm.length >= 8;
  const out = [];
  for (let i = 0; i < flat.length; i += 1) {
    const { path, compat } = flat[i];
    const desc = compat.description ? stripHtmlDescription(compat.description) : '';
    const hayRaw = useDesc ? `${path} ${desc}` : path;
    const hayNorm = normalizeFeatureHaystack(hayRaw);
    const pathSpaces = path.replace(/\./g, ' ');
    const dotted = qNorm.indexOf('.') !== -1 ? qNorm : '';
    const exactIds = [path, path.toLowerCase(), pathSpaces, dotted];
    const filteredExact = exactIds.filter((x) => x && x.length > 0);
    const score = scoreFeatureMatch(tokens, qNorm, hayNorm, filteredExact);
    if (score > 0) {
      const label = desc || path;
      out.push({
        kind: 'bcd',
        path,
        score,
        label,
        compat,
      });
    }
  }
  out.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.path.length - b.path.length;
  });
  return out;
}

/**
 * Merges caniuse and BCD ranked lists (both must be sorted descending by score).
 * @param {Array<Object>} caniuseRanked - from {@link rankCaniuseFeatureMatches}
 * @param {Array<Object>} bcdRanked - from {@link rankBcdFeatureMatches}
 * @returns {Array<Object>} combined sorted list
 */
function mergeRankedFeatureMatches(caniuseRanked, bcdRanked) {
  const all = caniuseRanked.concat(bcdRanked);
  all.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.kind !== b.kind) return a.kind === 'caniuse' ? -1 : 1;
    return 0;
  });
  return all;
}

/**
 * Returns the sole winner only when score is high enough and clearly ahead of the runner-up.
 * @param {Array<Object>} sorted - merged candidates, best first
 * @param {number} minScore - minimum score for auto-pick
 * @param {number} ratio - winner must be at least this multiple of second place
 * @returns {Object|null} winning candidate or null
 */
function pickConfidentFeatureMatch(sorted, minScore, ratio) {
  if (!sorted.length) return null;
  const top = sorted[0];
  if (top.score < minScore) return null;
  const second = sorted[1];
  if (!second) return top;
  if (top.score >= second.score * ratio) return top;
  return null;
}

/**
 * Returns suggestions worth showing (drops weak substring-only hits).
 * @param {Array<Object>} merged - candidates sorted by score descending
 * @param {number} minScore - minimum score to include
 * @param {number} maxCount - cap on number of buttons
 * @returns {Array<Object>}
 */
function narrowFeatureSuggestions(merged, minScore, maxCount) {
  const strong = merged.filter((c) => c.score >= minScore);
  return strong.slice(0, maxCount);
}

/**
 * Fills the error region with ranked picks for the user to disambiguate.
 * @param {HTMLElement} resultError - error container
 * @param {Array<Object>} candidates - top suggestions
 * @param {function(Object): void} onPick - receives the chosen list item (slug/path + compat)
 */
function showFeatureMatchSuggestions(resultError, candidates, onPick) {
  resultError.innerHTML = '';
  const msg = document.createElement('p');
  msg.textContent = 'Did you mean:';
  resultError.append(msg);
  const wrap = document.createElement('p');
  wrap.className = 'button-wrapper';
  for (let i = 0; i < candidates.length; i += 1) {
    const item = candidates[i];
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'button outline';
    btn.textContent = item.label;
    btn.addEventListener('click', () => onPick(item));
    wrap.append(btn);
  }
  resultError.append(wrap);
  resultError.hidden = false;
}

/**
 * Wires up the form and manages fetch state for the tool.
 */
function init() {
  const cache = new Map();
  const caniuseBase = 'https://raw.githubusercontent.com/Fyrd/caniuse/main';
  let bcdDataPromise = null;
  /** @type {Array<{path: string, compat: Object}>|null} */
  let bcdFlatCache = null;

  /**
   * Loads the published MDN browser-compat-data bundle once (large JSON, mirrors resolved).
   * @returns {Promise<Object>}
   */
  function loadBcdData() {
    if (!bcdDataPromise) {
      bcdDataPromise = fetchJson(
        cache,
        'https://unpkg.com/@mdn/browser-compat-data@7.3.8/data.json',
      );
    }
    return bcdDataPromise;
  }

  /**
   * Returns a flat list of BCD features (lazy parse once per visit).
   * @returns {Promise<Array<{path: string, compat: Object}>>}
   */
  async function getBcdFlatFeatures() {
    if (bcdFlatCache) return bcdFlatCache;
    const root = await loadBcdData();
    bcdFlatCache = flattenBcdRoot(root);
    return bcdFlatCache;
  }

  const consoleEl = document.querySelector('.console');
  const form = document.getElementById('compare-form');
  const btn = document.getElementById('compare-btn');
  const resultCard = document.getElementById('result-card');
  const resultError = document.getElementById('result-error');
  const resultDocLinkEl = document.querySelector('#result-card h2 a');
  const badgeEl = document.getElementById('verdict-badge');
  const explanationEl = document.querySelector('.verdict p');
  const noGapsEl = document.getElementById('no-gaps');
  const gapGridEl = document.getElementById('gap-grid');
  const coverageBarsEl = document.querySelector('.coverage-bars');
  const coverageFootnoteEl = document.getElementById('coverage-footnote');
  const fullGridEl = document.getElementById('full-grid');

  const minConfidentScore = 20;
  const confidentRatio = 1.22;
  const minSuggestionScore = 14;

  /**
   * Loads data, resolves feature (or applies a list pick), renders results.
   * @param {string} rawQuery - form input when searching; empty if {@code forcedPick} is set
   * @param {Object|null} forcedPick - picked row ({@code kind}, slug/path, compat for BCD)
   */
  async function runFeatureCheck(rawQuery, forcedPick) {
    if (!forcedPick && !String(rawQuery).trim()) return;

    showLoadingButton(btn);
    resultCard.hidden = true;
    resultError.hidden = true;
    if (coverageFootnoteEl) coverageFootnoteEl.hidden = true;

    try {
      const [fullData, regionJson] = await Promise.all([
        fetchJson(cache, `${caniuseBase}/fulldata-json/data-2.0.json`),
        fetchJson(cache, `${caniuseBase}/region-usage-json/alt-ww.json`),
      ]);

      const baselineJson = fullData.data['es6-module'];
      const caniuseData = fullData.data;

      let featureJson = null;
      let caniuseSlug = '';
      let bcdCompat = null;
      let resultTitle = '';
      let resultDocsHref = '';

      if (forcedPick) {
        if (forcedPick.kind === 'caniuse') {
          caniuseSlug = forcedPick.slug;
          featureJson = caniuseData[caniuseSlug];
        } else {
          bcdCompat = forcedPick.compat;
          resultTitle = stripHtmlDescription(forcedPick.label || forcedPick.path);
          const mdnUrl = bcdCompat.mdn_url;
          resultDocsHref = mdnUrl
            || `https://developer.mozilla.org/en-US/search?q=${encodeURIComponent(forcedPick.path)}`;
        }
      } else {
        const directSlug = resolveCaniuseSlugDirect(rawQuery, caniuseData);
        if (directSlug) {
          caniuseSlug = directSlug;
          featureJson = caniuseData[directSlug];
        }

        if (!featureJson && !bcdCompat && rawQuery.indexOf('.') !== -1) {
          const bcdRoot = await loadBcdData();
          const segments = splitBcdQuerySegments(rawQuery);
          const node = getBcdFeatureNode(bcdRoot, segments);
          /* eslint-disable no-underscore-dangle */
          if (node && node.__compat) {
            bcdCompat = node.__compat;
            resultTitle = stripHtmlDescription(bcdCompat.description || rawQuery);
            const mdnUrl = bcdCompat.mdn_url;
            resultDocsHref = mdnUrl
              || `https://developer.mozilla.org/en-US/search?q=${encodeURIComponent(rawQuery)}`;
          }
          /* eslint-enable no-underscore-dangle */
        }

        if (!featureJson && !bcdCompat) {
          const rankedC = rankCaniuseFeatureMatches(caniuseData, rawQuery);
          let winner = pickConfidentFeatureMatch(rankedC, minConfidentScore, confidentRatio);

          if (!winner) {
            const flat = await getBcdFlatFeatures();
            const rankedB = rankBcdFeatureMatches(flat, rawQuery);
            const merged = mergeRankedFeatureMatches(rankedC, rankedB);
            winner = pickConfidentFeatureMatch(merged, minConfidentScore, confidentRatio);
            if (!winner && merged.length) {
              const suggestions = narrowFeatureSuggestions(
                merged,
                minSuggestionScore,
                10,
              );
              if (suggestions.length) {
                showFeatureMatchSuggestions(
                  resultError,
                  suggestions,
                  (item) => runFeatureCheck('', item),
                );
              } else {
                resultError.innerHTML = '';
                const msg = document.createElement('p');
                msg.textContent = `No close matches for "${rawQuery}".`;
                resultError.append(msg);
                resultError.hidden = false;
              }
              return;
            }
            if (winner && winner.kind === 'bcd') {
              bcdCompat = winner.compat;
              resultTitle = stripHtmlDescription(winner.label || winner.path);
              const mdnUrl = bcdCompat.mdn_url;
              resultDocsHref = mdnUrl
                || `https://developer.mozilla.org/en-US/search?q=${encodeURIComponent(winner.path)}`;
            } else if (winner && winner.kind === 'caniuse') {
              caniuseSlug = winner.slug;
              featureJson = caniuseData[winner.slug];
            }
          } else if (winner.kind === 'caniuse') {
            caniuseSlug = winner.slug;
            featureJson = caniuseData[winner.slug];
          }
        }
      }

      if (!featureJson && !bcdCompat) {
        resultError.innerHTML = '';
        const msg = document.createElement('p');
        msg.textContent = forcedPick
          ? 'That feature could not be loaded. Try another suggestion or search again.'
          : `No feature found for "${rawQuery}".`;
        resultError.append(msg);
        resultError.hidden = false;
        return;
      }

      const browsers = bcdCompat
        ? buildBrowserDataFromBcd(bcdCompat, baselineJson, regionJson)
        : buildBrowserData(featureJson, baselineJson, regionJson);
      const gaps = browsers.filter((b) => b.status === 'unsupported');
      const v = verdict(gaps);
      const { baselineCoverage, featureCoverage } = bcdCompat
        ? computeCoverageFromBcd(bcdCompat, baselineJson, regionJson)
        : computeCoverage(featureJson, baselineJson, regionJson);
      const delta = featureCoverage - baselineCoverage;

      const displayTitle = bcdCompat ? resultTitle : featureJson.title;
      if (resultDocLinkEl) {
        if (bcdCompat) {
          resultDocLinkEl.href = resultDocsHref;
        } else {
          resultDocLinkEl.href = `https://caniuse.com/${encodeURIComponent(caniuseSlug)}`;
        }
        resultDocLinkEl.textContent = displayTitle;
        resultDocLinkEl.setAttribute(
          'aria-label',
          `${displayTitle}, opens in a new tab`,
        );
      }
      badgeEl.textContent = v.label;
      badgeEl.className = `verdict-badge ${v.cssClass}`;
      explanationEl.textContent = v.explanation;

      noGapsEl.hidden = gaps.length > 0;
      gapGridEl.hidden = gaps.length === 0;
      populateGrid(gapGridEl, gaps);

      const deltaClass = delta >= 0 ? 'coverage-delta positive' : 'coverage-delta';
      coverageBarsEl.innerHTML = '';
      coverageBarsEl.appendChild(coverageRow('ES6 modules', baselineCoverage, null).row);
      const featureRow = coverageRow('This feature', featureCoverage, v.cssClass);
      const deltaEl = document.createElement('span');
      deltaEl.className = deltaClass;
      deltaEl.textContent = `(${delta.toFixed(1)}%)`;
      featureRow.pctEl.appendChild(deltaEl);
      coverageBarsEl.appendChild(featureRow.row);

      populateGrid(fullGridEl, browsers);

      const levelMap = { pass: 'success', fail: 'error' };
      if (consoleEl) {
        logMessage(consoleEl, levelMap[v.cssClass], [displayTitle]);
      }

      if (forcedPick) {
        const inputEl = document.getElementById('feature');
        if (forcedPick.kind === 'caniuse') inputEl.value = forcedPick.slug;
        else inputEl.value = forcedPick.path;
      }

      if (coverageFootnoteEl) coverageFootnoteEl.hidden = false;
      resultCard.hidden = false;
    } catch {
      resultError.innerHTML = '';
      const msg = document.createElement('p');
      msg.textContent = 'Could not load compatibility data. Check your connection and try again.';
      resultError.append(msg);
      resultError.hidden = false;
    } finally {
      resetLoadingButton(btn);
    }
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const rawQuery = document.getElementById('feature').value.trim();
    if (!rawQuery) return;
    await runFeatureCheck(rawQuery, null);
  });
}

init();
