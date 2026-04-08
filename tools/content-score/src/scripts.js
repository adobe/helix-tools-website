import {
  categoryIdToDetailsKey,
  getBadgeCopy,
  getCountText,
  getBase,
} from './utils.js';
import './tray/tray.js'; // register <content-score-tray> custom element

/**
 * Loads the content-score rules config.
 * @returns {Promise<Object>} Parsed config with rules array
 */
async function loadConfig() {
  if (!loadConfig.cache) {
    const resp = await fetch(new URL('config.json', getBase()));
    loadConfig.cache = resp.ok ? await resp.json() : { rules: [] };
  }
  return loadConfig.cache;
}

/**
 * Loads a CSS file.
 * @param {string} href URL to the CSS file
 */
async function loadCSS(href) {
  return new Promise((resolve, reject) => {
    if (!document.querySelector(`head > link[href="${href}"]`)) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      link.onload = resolve;
      link.onerror = reject;
      document.head.append(link);
    } else {
      resolve();
    }
  });
}

/**
 * Gets a rule by id from config.
 * @param {Object} config - Config from loadConfig()
 * @param {string} id - Rule id
 * @returns {Object|undefined}
 */
function getRule(config, id) {
  return (config.rules || []).find((r) => r.id === id);
}

/**
 * Gets all rules for a category.
 * @param {Object} config - Config from loadConfig()
 * @param {string} category - Rule category (alt, heading, link, etc.)
 * @returns {Array}
 */
function getRulesByCategory(config, category) {
  return (config.rules || []).filter((r) => r.category === category);
}

/**
 * Returns outcome (error | warning) from a numeric value and rule thresholds.
 * @param {number} value - Value to compare (e.g. count, spanCount)
 * @param {Object} rule - Rule with thresholds: { warning?, error?, recommended? }
 * @returns {string} 'error' | 'warning'
 */
function getOutcomeFromThresholds(value, rule) {
  const t = rule.thresholds || {};
  const err = t.error;
  const warn = t.warning;
  if (typeof err === 'number' && value >= err) return 'error';
  if (typeof warn === 'number' && value >= warn) return 'warning';
  return 'warning';
}

/**
 * Replaces {key} placeholders in a template with values from an object.
 * @param {string} template - Message template
 * @param {Object} values - Key-value pairs for substitution
 * @returns {string}
 */
function formatMessage(template, values) {
  return template.replace(/\{(\w+)\}/g, (_, key) => {
    const value = values[key];
    if (value === undefined || value === null) return '';
    return value.toString();
  });
}

/**
 * Builds base issue fields from a rule so every issue has type, label, fixableBy from config.
 * @param {Object} rule - Rule from getRule()
 * @param {string} issue - Message string
 * @param {string|null} outcome - 'error' | 'warning' | 'info'
 * @param {Element|null} element - Optional element to highlight
 * @param {Object} [extra] - Optional extra fields (tag, src, alt, elements, etc.)
 * @returns {Object} Issue object
 */
function issueFromRule(rule, issue, outcome, element = null, extra = {}) {
  const recTemplate = rule.messages && rule.messages.recommendation;
  let recommendation = recTemplate;
  if (recTemplate && extra.recommendationContext && typeof extra.recommendationContext === 'object') {
    recommendation = formatMessage(recTemplate, extra.recommendationContext);
  }
  const { recommendationContext, ...rest } = extra;
  return {
    category: rule.category || 'unknown',
    ruleId: rule.id,
    label: rule.label || rule.id,
    issue,
    outcome,
    fixableBy: rule.fixableBy,
    element: element ?? null,
    recommendation,
    ...rest,
  };
}

/**
 * Returns a CSS selector from a rule's target, or null.
 * @param {Object|undefined} rule - Rule from getRule()
 * @returns {string|null} Selector or null
 */
function getSelectorFromRule(rule) {
  if (!rule || typeof rule.target !== 'string') return null;
  const raw = rule.target.trim();
  const idx = raw.indexOf(' (');
  const selector = idx >= 0 ? raw.slice(0, idx).trim() : raw;
  return selector.length > 0 ? selector : null;
}

/**
 * Returns the problem message template from a rule (messages.problem).
 * @param {Object} rule - Rule from getRule()
 * @returns {string|undefined}
 */
function getProblemMessage(rule) {
  return rule && rule.messages && rule.messages.problem;
}

/**
 * Runs a selector-based detector.
 * @param {Object} config - Config from loadConfig()
 * @param {string} ruleId - Rule id (e.g. 'alt-not-needed-with-surrounding-text')
 * @param {Document} doc - Document to query
 * @param {string} outcome - 'error' | 'warning'
 * @param {Function} check - (el) => null | { element?, extra?, messageContext? }
 * @returns {Array} Issues found
 */
function runSelectorDetector(config, ruleId, doc, outcome, check) {
  const rule = getRule(config, ruleId);
  if (!rule) return [];
  const selector = getSelectorFromRule(rule);
  if (!selector) return [];
  const problemMsg = getProblemMessage(rule);
  if (!problemMsg) return [];
  const issues = [];
  doc.querySelectorAll(selector).forEach((el) => {
    const result = check(el);
    if (!result) return;
    const element = result.element !== undefined ? result.element : el;
    const extra = result.extra || {};
    const msg = result.messageContext
      ? formatMessage(problemMsg, result.messageContext)
      : problemMsg;
    issues.push(issueFromRule(rule, msg, outcome, element, extra));
  });
  return issues;
}

/**
 * Normalizes text for comparison.
 * @param {string} text - Text to normalize
 * @returns {string} Lowercase, whitespace-collapsed, punctuation-stripped text
 */
function normalizeText(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Resolves the `.plain.html` URL for the current page path.
 * @returns {string} Absolute path (same origin) to fetch
 */
function getPlainHtmlPath() {
  const plain = 'plain.html';
  const { pathname } = window.location;
  if (pathname.endsWith('/')) {
    const dir = pathname.replace(/\/+$/, '') || '/';
    if (dir === '/') {
      return `/index.${plain}`;
    }
    return `${dir}/index.${plain}`;
  }
  return `${pathname}.${plain}`;
}

/**
 * Fetches and parses `.plain.html` for the current URL.
 * @returns {Promise<Document|null>} Parsed plain DOM or `null` if fetch fails
 */
async function fetchPlainDom() {
  try {
    const plainUrl = getPlainHtmlPath();
    const resp = await fetch(plainUrl);
    if (!resp.ok) return null;

    const html = await resp.text();
    const parser = new DOMParser();
    return parser.parseFromString(html, 'text/html');
  } catch (error) {
    return null;
  }
}

/**
 * Finds the `.plain.html` block root for the same section index and block index as `block`.
 * @param {Element} block - Decorated block (`data-block-name` set)
 * @param {Document} doc - Live document
 * @param {Document} plainDom - Parsed `.plain.html`
 * @param {Set<string>} skip - Block names to skip (must match live and plain lists)
 * @returns {Element|null}
 */
function plainBlockEquivalent(block, doc, plainDom, skip) {
  const main = doc.querySelector('main') || doc.body;
  const section = block.closest('.section');
  if (!main || !section) return null;

  const sections = [...main.children].filter((el) => el.classList.contains('section'));
  const si = sections.indexOf(section);
  if (si < 0) return null;

  const plainSection = plainDom.body.children[si];
  if (!plainSection) return null;

  const liveOrder = [...section.querySelectorAll('[data-block-name]')].filter(
    (b) => b.dataset.blockName && !skip.has(b.dataset.blockName),
  );
  const bi = liveOrder.indexOf(block);
  if (bi < 0) return null;

  let n = 0;
  const { children } = plainSection;
  for (let i = 0; i < children.length; i += 1) {
    const el = children[i];
    if (el.tagName !== 'DIV' || el.classList.length === 0) {
      /* skip */
    } else if (skip.has(el.classList[0])) {
      /* skip */
    } else if (n === bi) {
      return el.classList[0] === block.dataset.blockName ? el : null;
    } else {
      n += 1;
    }
  }
  return null;
}

/**
 * Finds the decorated live block (`[data-block-name]`) for a node in `.plain.html`.
 * @param {Element} plainNode - Any element inside an authored block in `.plain.html`
 * @param {Document} doc - Live document
 * @param {Document} plainDom - Parsed `.plain.html`
 * @param {Set<string>} skip - Block names to skip in ordering (must match `plainBlockEquivalent`)
 * @returns {Element|null}
 */
function liveBlockEquivalent(plainNode, doc, plainDom, skip) {
  if (!plainNode || !doc || !plainDom || !plainDom.body) return null;

  let cur = plainNode;
  while (cur.parentElement && cur.parentElement.parentElement !== plainDom.body) {
    cur = cur.parentElement;
  }
  const blockRoot = cur;
  const plainSection = cur && cur.parentElement;
  if (!blockRoot || !plainSection || plainSection.parentElement !== plainDom.body) return null;
  if (blockRoot.tagName !== 'DIV' || !blockRoot.classList || blockRoot.classList.length === 0) {
    return null;
  }

  const plainName = blockRoot.classList[0];
  const si = [...plainDom.body.children].indexOf(plainSection);
  if (si < 0) return null;

  let bi = -1;
  let n = 0;
  const { children } = plainSection;
  for (let i = 0; i < children.length; i += 1) {
    const el = children[i];
    if (el.tagName !== 'DIV' || !el.classList || el.classList.length === 0) {
      /* skip */
    } else if (skip.has(el.classList[0])) {
      /* skip */
    } else if (el === blockRoot) {
      bi = n;
      break;
    } else {
      n += 1;
    }
  }
  if (bi < 0) return null;

  const main = doc.querySelector('main') || doc.body;
  const sections = [...main.children].filter((el) => el.classList.contains('section'));
  const section = sections[si];
  if (!section) return null;

  const liveOrder = [...section.querySelectorAll('[data-block-name]')].filter(
    (b) => b.dataset.blockName && !skip.has(b.dataset.blockName),
  );
  const live = liveOrder[bi];
  if (!live || live.dataset.blockName !== plainName) return null;
  return live;
}

// structural wrappers are NOT scope boundaries
const STRUCTURAL_WRAPPERS = ['button-wrapper', 'img-wrapper', 'video-wrapper'];

/**
 * Finds nearby scope container for an element.
 * @param {Element} el - Starting element
 * @returns {Element} Closest .section, .block, or content -wrapper (ignoring structural wrappers)
 */
function getNearbyScope(el) {
  let current = el.parentElement;

  while (current && current !== document.body) {
    const { classList } = current;
    const isSection = classList.contains('section');
    const isBlock = classList.contains('block');

    if (isSection || isBlock) return current;

    const hasWrapper = [...classList].some((c) => c.includes('-wrapper'));
    const isStructural = STRUCTURAL_WRAPPERS.some((w) => classList.contains(w));

    if (hasWrapper && !isStructural) return current;

    current = current.parentElement;
  }

  return el.parentElement;
}

/**
 * Returns whether the image has any surrounding text in its scope (same block/section).
 * @param {HTMLImageElement} img - Image element
 * @returns {boolean} Whether any ancestor has non-empty text content
 */
function imageHasSurroundingText(img) {
  let current = img.parentElement;

  while (current && current !== document.body) {
    const node = current;
    const hasWrapper = [...node.classList].some((c) => c.includes('-wrapper'));
    const isStructural = STRUCTURAL_WRAPPERS.some((w) => node.classList.contains(w));
    const isBlock = node.classList.contains('block');
    const isSection = node.classList.contains('section');
    const isBoundary = (hasWrapper && !isStructural) || isBlock || isSection;

    const scopeText = node.textContent.trim();
    if (scopeText.length > 0) return true;

    if (isBoundary) break;
    current = current.parentElement;
  }

  return false;
}

/**
 * Gets accessible name for an element.
 * @param {Element} el - Element to check
 * @returns {string} Accessible name or empty string
 */
function getAccessibleName(el) {
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel) return ariaLabel.trim();

  const ariaLabelledBy = el.getAttribute('aria-labelledby');
  if (ariaLabelledBy) {
    const labelEl = document.getElementById(ariaLabelledBy);
    if (labelEl) return labelEl.textContent.trim();
  }

  return el.textContent.trim();
}

/**
 * Gets highlight target element for an image.
 * @param {HTMLImageElement} img - Image element
 * @returns {Element} Element to highlight
 */
function getImageHighlightTarget(img) {
  const imgPosition = window.getComputedStyle(img).position;
  if (imgPosition === 'absolute') return img;

  const picture = img.closest('picture');
  if (picture) {
    const picturePosition = window.getComputedStyle(picture).position;
    return picturePosition === 'absolute' ? picture : picture.parentElement;
  }

  return img.parentElement || img;
}

/**
 * Calculates overall score from issue details.
 * @param {Object} details - Issue details object with issue arrays (each issue has outcome)
 * @returns {string} Score: 'good' | 'needs-improvement' | 'poor'
 */
function calculateScore(details) {
  let errors = 0;
  let warnings = 0;
  Object.values(details).forEach((arr) => {
    if (!Array.isArray(arr)) return;
    arr.forEach((issue) => {
      const o = issue.outcome;
      if (o === 'error') errors += 1;
      else if (o === 'warning') warnings += 1;
    });
  });
  if (errors >= 1) return 'poor';
  if (warnings >= 1) return 'needs-improvement';
  return 'good';
}

/**
 * Default emoji per category for issue media when no thumbnail.
 */
const CATEGORY_EMOJI = {
  alt: '🖼️',
  heading: '🔤',
  link: '🔗',
  'nested-blocks': '🔁',
  'row-col-spans': '📐',
  'column-counts': '📊',
  'list-like': '📋',
  'block-sprawl': '📦',
  'config-like': '⚙️',
};

/**
 * Builds one issue in the canonical shape (see ISSUES.md). Single place that knows the schema.
 * @param {Object} raw - Issue-like object from detector (issueFromRule + extras)
 * @param {number} index - Index within category for stable id
 * @returns {Object} Canonical issue (id, ruleId, category, label, outcome, issue, recommendation,
 *   fixableBy, elements, elementLabels, media) plus element and legacy fields for tray compat.
 */
function buildCanonicalIssue(raw, index) {
  let elements = [];
  if (Array.isArray(raw.elements) && raw.elements.length > 0) {
    elements = raw.elements;
  } else if (raw.element) {
    elements = [raw.element];
  }
  const elementLabels = Array.isArray(raw.elementLabels) ? raw.elementLabels : [];
  const media = raw.src
    ? { type: 'thumbnail', src: raw.src }
    : { type: 'emoji', char: CATEGORY_EMOJI[raw.category] || '⚠️' };

  return {
    id: `${raw.ruleId}_${index}`,
    ruleId: raw.ruleId,
    category: raw.category || 'unknown',
    label: raw.label || raw.ruleId,
    outcome: raw.outcome,
    issue: raw.issue,
    recommendation: raw.recommendation || undefined,
    fixableBy: raw.fixableBy,
    elements,
    elementLabels,
    media,
    element: elements[0] || null,
    src: raw.src,
    alt: raw.alt,
    tag: raw.tag,
    text: raw.text,
  };
}

/**
 * Normalizes all issue arrays in details to canonical shape. Mutates details.
 * @param {Object} details - Details object with issue arrays (mutated)
 */
function normalizeDetailsToCanonical(details) {
  Object.keys(details).forEach((key) => {
    const arr = details[key];
    if (!Array.isArray(arr)) return;
    details[key] = arr.map((raw, i) => buildCanonicalIssue(raw, i));
  });
}

/**
 * Assigns outcome (warning/error) to each issue that does not have it.
 * @param {Object} details - Issue details (mutated)
 * @param {Object} config - Config from loadConfig()
 */
function assignIssueOutcome(details, config) {
  const categories = config.categories || [];
  const detailKeyToCategory = Object.fromEntries(
    categories.map((c) => [categoryIdToDetailsKey(c.id), c.id]),
  );

  Object.keys(detailKeyToCategory).forEach((key) => {
    const issues = details[key];
    if (!Array.isArray(issues) || issues.length === 0) return;

    const category = detailKeyToCategory[key];
    const rules = getRulesByCategory(config, category);
    const errorThresholds = rules
      .map((r) => (r.thresholds && r.thresholds.error))
      .filter((t) => typeof t === 'number');
    if (errorThresholds.length === 0) return;

    const minError = Math.min(...errorThresholds);
    const outcome = issues.length >= minError ? 'error' : 'warning';
    issues.forEach((issue) => {
      if (issue.outcome == null) {
        issue.outcome = outcome;
      }
    });
  });
}

/**
 * Checks image elements for alt text: warns when image has alt and has surrounding text.
 * @param {Document} doc - Document to check
 * @param {Object} config - Config from loadConfig()
 * @returns {Array} Image alt text issues
 */
function checkImageAlt(doc, config) {
  return runSelectorDetector(config, 'alt-not-needed-with-surrounding-text', doc, 'warning', (img) => {
    const altTrimmed = (img.getAttribute('alt') || '').trim();
    if (altTrimmed.length === 0) return null;
    if (img.getAttribute('aria-hidden') === 'true') return null;
    if (img.closest('a[href], button')) return null;
    if (!imageHasSurroundingText(img)) return null;
    return {
      element: getImageHighlightTarget(img),
      extra: { tag: 'img', src: img.getAttribute('src') || '', alt: altTrimmed },
    };
  });
}

/**
 * Checks for images that are the only content in a link or button with no accessible name.
 * @param {Document} doc - Document to check
 * @param {Object} config - Config from loadConfig()
 * @returns {Array} Alt-required issues
 */
function checkAltRequiredInLinkButton(doc, config) {
  return runSelectorDetector(config, 'alt-required-in-link-button', doc, 'error', (link) => {
    const img = link.querySelector('img');
    if (!img) return null;
    const childElements = [...link.children].filter((el) => el.tagName !== 'SCRIPT' && el.tagName !== 'STYLE');
    const onlyImg = childElements.length === 1 && childElements[0] === img;
    if (!onlyImg) return null;

    const accessibleName = (getAccessibleName(link) || '').trim();
    if (accessibleName.length > 0) return null;

    const linkOrButton = link.tagName.toLowerCase() === 'a' ? 'link' : 'button';
    return {
      element: getImageHighlightTarget(img),
      extra: {
        tag: 'img',
        src: img.getAttribute('src') || '',
        alt: (img.getAttribute('alt') || '').trim(),
      },
      messageContext: { type: linkOrButton },
    };
  });
}

/**
 * Checks heading structure for hierarchy issues using config.
 * @param {Document} doc - Document to check
 * @param {Object} config - Config from loadConfig()
 * @returns {Array} Heading issues found
 */
function checkHeadings(doc, config) {
  const issues = [];
  let previousLevel = 0;
  let previousHeading = null;
  const noH1Rule = getRule(config, 'heading-no-h1');
  const multiH1Rule = getRule(config, 'heading-multiple-h1');
  const skippedRule = getRule(config, 'heading-skipped-level');
  const h1Selector = getSelectorFromRule(noH1Rule) || getSelectorFromRule(multiH1Rule);
  const headingSelector = getSelectorFromRule(skippedRule);

  const h1s = h1Selector ? doc.querySelectorAll(h1Selector) : [];
  if (h1s.length === 0 && noH1Rule && getProblemMessage(noH1Rule)) {
    issues.push(issueFromRule(noH1Rule, getProblemMessage(noH1Rule), null, null, { tag: 'h1' }));
  } else if (h1s.length > 1 && multiH1Rule && getProblemMessage(multiH1Rule)) {
    const msg = formatMessage(getProblemMessage(multiH1Rule), { count: h1s.length });
    issues.push(issueFromRule(multiH1Rule, msg, null, h1s[0], { tag: 'h1', elements: [...h1s] }));
  }

  const headings = headingSelector ? doc.querySelectorAll(headingSelector) : [];
  headings.forEach((heading) => {
    const currentLevel = parseInt(heading.tagName.substring(1), 10);

    const skipped = previousLevel > 0 && currentLevel > previousLevel + 1
      && skippedRule && getProblemMessage(skippedRule);
    if (skipped) {
      const msg = formatMessage(getProblemMessage(skippedRule), {
        previousLevel,
        tag: heading.tagName.toLowerCase(),
      });
      const recTemplate = skippedRule.messages && skippedRule.messages.recommendation;
      const recommendation = recTemplate
        ? formatMessage(recTemplate, { previousLevel, nextLevel: previousLevel + 1 })
        : undefined;
      issues.push(issueFromRule(skippedRule, msg, null, previousHeading, {
        tag: heading.tagName.toLowerCase(),
        elements: [previousHeading, heading],
        recommendation,
      }));
    }

    previousLevel = currentLevel;
    previousHeading = heading;
  });

  return issues;
}

/**
 * Checks links and buttons for text quality issues using config.
 * @param {Document} doc - Document to check
 * @param {Object} config - Config from loadConfig()
 * @returns {Array} Array of link issues
 */
function checkLinks(doc, config) {
  const genericRule = getRule(config, 'link-generic-text');
  const repeatedRule = getRule(config, 'link-repeated-in-section');
  const linkSelector = getSelectorFromRule(genericRule) || getSelectorFromRule(repeatedRule);
  if (!linkSelector) return [];

  const links = doc.querySelectorAll(linkSelector);
  const issues = [];
  const sectionCounts = new Map();

  links.forEach((link) => {
    const text = getAccessibleName(link);
    const normalizedText = normalizeText(text);
    if (!normalizedText) return;

    const tag = link.tagName.toLowerCase();
    if (genericRule && genericRule.patterns && genericRule.patterns.length > 0) {
      const found = genericRule.patterns.filter((term) => normalizedText === term);
      if (found.length > 0) {
        const msg = formatMessage(getProblemMessage(genericRule), { found: found.join(', ') });
        issues.push(issueFromRule(genericRule, msg, null, link, { tag, text }));
      }
    }

    const section = getNearbyScope(link);
    if (!sectionCounts.has(section)) {
      sectionCounts.set(section, new Map());
    }
    const textCounts = sectionCounts.get(section);
    const count = (textCounts.get(normalizedText) || 0) + 1;
    textCounts.set(normalizedText, count);
  });

  if (repeatedRule) {
    sectionCounts.forEach((textCounts, section) => {
      textCounts.forEach((count, text) => {
        if (count > 1 && text.length > 0) {
          const matchingLinks = [...section.querySelectorAll(linkSelector)]
            .filter((el) => normalizeText(getAccessibleName(el)) === text);

          if (matchingLinks.length > 0) {
            const linksWithHref = matchingLinks.filter((el) => el.tagName.toLowerCase() === 'a' && el.href);
            const distinctHrefs = new Set(
              linksWithHref.map((el) => el.href.replace(/\/$/, '')),
            );
            const allSameDestination = linksWithHref.length === matchingLinks.length
              && distinctHrefs.size === 1;
            if (allSameDestination) return;

            const firstLink = matchingLinks[0];
            const msg = formatMessage(getProblemMessage(repeatedRule), {
              count,
              text: getAccessibleName(firstLink),
            });
            issues.push(issueFromRule(repeatedRule, msg, null, firstLink, {
              elements: matchingLinks,
              elementLabels: matchingLinks.map((el) => getAccessibleName(el)),
              tag: firstLink.tagName.toLowerCase(),
              text: getAccessibleName(firstLink),
            }));
          }
        }
      });
    });
  }

  return issues;
}

/**
 * Checks for nested blocks using config.
 * @param {Object} config - Config from loadConfig()
 * @param {Document|null} plainDom - Parsed `.plain.html` document, or `null` if unavailable
 * @returns {Array} Nested block issues
 */
function checkNestedBlocks(config, plainDom) {
  const issues = [];
  const rule = getRule(config, 'nested-blocks');

  if (!plainDom || !rule) return issues;

  const tableSelector = getSelectorFromRule(rule) || 'table';
  const tables = plainDom.querySelectorAll(tableSelector);
  tables.forEach((table) => {
    const nestedTables = table.querySelectorAll(tableSelector);
    if (nestedTables.length > 0) {
      const count = nestedTables.length;
      const blockWord = count === 1 ? 'block' : 'blocks';
      const msg = formatMessage(getProblemMessage(rule), { count, blockWord });
      const outcome = getOutcomeFromThresholds(count, rule);
      issues.push(issueFromRule(rule, msg, outcome, null));
    }
  });

  return issues;
}

/**
 * Checks for complex rowspan/colspan patterns using config.
 * @param {Object} config - Config from loadConfig()
 * @param {Document|null} plainDom - Parsed `.plain.html` document, or `null` if unavailable
 * @param {Document} doc - Live document
 * @returns {Array} Row/column span issues
 */
function checkRowColSpans(config, plainDom, doc) {
  const issues = [];
  const rule = getRule(config, 'row-col-spans');

  if (!plainDom || !rule) return issues;

  const tableSelector = getSelectorFromRule(rule);
  if (!tableSelector) return issues;

  const skipBlocks = new Set(['metadata', 'section-metadata', 'header', 'footer']);
  const liveDoc = doc || document;

  plainDom.querySelectorAll(tableSelector).forEach((block) => {
    const rows = [...block.children];
    if (rows.length === 0) return;

    const cellCounts = rows.map((row) => row.children.length);
    const uniform = cellCounts.every((n) => n === cellCounts[0]);
    if (uniform) return;

    let root = block;
    while (root.parentElement && root.parentElement.parentElement !== plainDom.body) {
      root = root.parentElement;
    }
    const blockName = root && root.classList && root.classList.length
      ? root.classList[0]
      : 'unknown';

    const msg = formatMessage(getProblemMessage(rule), { blockName });
    const first = cellCounts[0];
    const offendingRows = cellCounts.filter((n) => n !== first).length;
    const outcome = getOutcomeFromThresholds(offendingRows, rule);
    const element = liveBlockEquivalent(block, liveDoc, plainDom, skipBlocks);
    issues.push(issueFromRule(rule, msg, outcome, element));
  });

  return issues;
}

/**
 * Checks for tables with too many columns using config.
 * @param {Object} config - Config from loadConfig()
 * @param {Document|null} plainDom - Parsed `.plain.html` document, or `null` if unavailable
 * @param {Document} doc - Live document
 * @returns {Array} Column count issues
 */
function checkColumnCounts(config, plainDom, doc) {
  const issues = [];
  const rule = getRule(config, 'column-counts');

  if (!plainDom || !rule) return issues;

  const { recommended, warning } = rule.thresholds || {};
  const tableSelector = getSelectorFromRule(rule);
  if (!tableSelector) return issues;

  const threshold = typeof recommended === 'number' ? recommended : warning;
  if (typeof threshold !== 'number') return issues;

  const skipBlocks = new Set(['metadata', 'section-metadata', 'header', 'footer']);
  const liveDoc = doc || document;

  const tables = plainDom.querySelectorAll(tableSelector);
  tables.forEach((block) => {
    const rows = [...block.children];
    const cols = rows.map((row) => [...row.children].length);
    if (!cols.length) return;

    const maxCols = Math.max(...cols);
    if (maxCols > threshold) {
      let root = block;
      while (root.parentElement && root.parentElement.parentElement !== plainDom.body) {
        root = root.parentElement;
      }
      const blockName = root && root.classList && root.classList.length
        ? root.classList[0]
        : 'unknown';
      const msg = formatMessage(getProblemMessage(rule), {
        blockName,
        maxColumns: maxCols,
        threshold,
      });
      const outcome = getOutcomeFromThresholds(maxCols, rule);
      const element = liveBlockEquivalent(block, liveDoc, plainDom, skipBlocks);
      issues.push(issueFromRule(rule, msg, outcome, element, {
        recommendationContext: { threshold },
      }));
    }
  });

  return issues;
}

/**
 * Checks for list-like content not using proper list markup.
 * @param {HTMLParagraphElement[]} paragraphs - All <p> in document order
 * @param {Function} matches - (text) => boolean
 * @param {Object} rule - Config rule (category, thresholds, messages.problem)
 * @returns {Array} Issues (one per run)
 */
function findListLikeRuns(paragraphs, matches, rule) {
  const issues = [];
  const minRun = rule && rule.thresholds && rule.thresholds.warning;
  if (!rule || typeof minRun !== 'number' || paragraphs.length < minRun) return issues;

  let run = [];
  paragraphs.forEach((p) => {
    const text = p.textContent.trim();
    if (matches(text)) {
      run.push(p);
    } else {
      if (run.length >= minRun) {
        const msg = formatMessage(getProblemMessage(rule), { count: run.length });
        const outcome = getOutcomeFromThresholds(run.length, rule);
        issues.push(issueFromRule(rule, msg, outcome, run[0]));
      }
      run = [];
    }
  });
  if (run.length >= minRun) {
    const msg = formatMessage(getProblemMessage(rule), { count: run.length });
    const outcome = getOutcomeFromThresholds(run.length, rule);
    issues.push(issueFromRule(rule, msg, outcome, run[0]));
  }
  return issues;
}

/**
 * Checks for list-like content: runs of adjacent <p> that start with bullet/dash/number.
 * @param {Document} [doc=document] - Document to analyze
 * @param {Object} config - Config from loadConfig()
 * @returns {Array} Array of list-like issues
 */
function checkListLikeContent(doc = document, config = {}) {
  const paragraphs = [...doc.querySelectorAll('p')];
  const bulletsRule = getRule(config, 'list-like-bullets');
  const numberRule = getRule(config, 'list-like-numbers');

  const issues = [];
  issues.push(...findListLikeRuns(
    paragraphs,
    (text) => /^[•●○◦▪▫■□·‣⁃]/.test(text) || /^[-–—]/.test(text),
    bulletsRule,
  ));
  issues.push(...findListLikeRuns(
    paragraphs,
    (text) => /^\d+[.)]/.test(text),
    numberRule,
  ));
  return issues;
}

/**
 * Checks for block and variant sprawl from .plain.html using config.
 * @param {Object} config - Config from loadConfig()
 * @param {Document|null} plainDom - Parsed `.plain.html` document, or `null` if unavailable
 * @returns {Array} Block sprawl issues
 */
function checkBlockSprawl(config, plainDom) {
  const issues = [];
  const typesRule = getRule(config, 'block-sprawl-types');
  const variantsRule = getRule(config, 'block-sprawl-variants');

  if (!plainDom) return issues;

  const blockTypes = new Set();
  const variants = new Set();
  const divSelector = getSelectorFromRule(typesRule) || getSelectorFromRule(variantsRule);
  const blockDivs = divSelector ? plainDom.querySelectorAll(divSelector) : [];
  blockDivs.forEach((div) => {
    const classes = [...div.classList];
    if (classes.length === 0) return;

    blockTypes.add(classes[0]);
    classes.slice(1).forEach((c) => variants.add(c));
  });

  const blockCount = blockTypes.size;
  const variantCount = variants.size;

  if (typesRule) {
    const t = typesRule.thresholds || {};
    const threshold = t.recommended ?? t.warning;
    if (typeof threshold === 'number' && blockCount > threshold) {
      const msg = formatMessage(getProblemMessage(typesRule), { count: blockCount, threshold });
      const outcome = getOutcomeFromThresholds(blockCount, typesRule);
      issues.push(issueFromRule(typesRule, msg, outcome, null, {
        recommendationContext: { threshold },
      }));
    }
  }

  if (variantsRule) {
    const t = variantsRule.thresholds || {};
    const threshold = t.recommended ?? t.warning;
    if (typeof threshold === 'number' && variantCount > threshold) {
      const msg = formatMessage(getProblemMessage(variantsRule), {
        count: variantCount,
        threshold,
      });
      const outcome = getOutcomeFromThresholds(variantCount, variantsRule);
      issues.push(issueFromRule(variantsRule, msg, outcome, null, {
        recommendationContext: { threshold },
      }));
    }
  }

  return issues;
}

/**
 * Compares paired plain vs live blocks.
 * @param {Document} doc - Rendered document
 * @param {Object} config - Config from loadConfig()
 * @param {Document|null} plainDom - Parsed .plain.html document, or null if unavailable
 * @returns {Array} Inline config issues
 */
function checkInlineConfig(doc, config, plainDom) {
  const rule = getRule(config, 'inline-config');
  if (!rule || !plainDom) return [];

  const SKIP_BLOCKS = new Set(['metadata', 'section-metadata', 'header', 'footer']);
  const selector = getSelectorFromRule(rule);
  if (!selector) return [];

  const { warning: warnThresh, error: errThresh } = rule.thresholds || {};
  const issues = [];

  doc.querySelectorAll(selector).forEach((block) => {
    const { blockName } = block.dataset;
    if (!blockName || SKIP_BLOCKS.has(blockName)) return;

    const plainBlock = plainBlockEquivalent(block, doc, plainDom, SKIP_BLOCKS);
    if (!plainBlock) return;

    const renderedNorm = normalizeText(block.textContent || '');
    let neverOnPage = 0;

    const leafDivs = plainBlock.querySelectorAll('div');
    for (let i = 0; i < leafDivs.length; i += 1) {
      const cell = leafDivs[i];
      if (!cell.querySelector(':scope > div')) {
        const raw = (cell.textContent || '').replace(/\s+/g, ' ').trim();
        if (raw.length > 0) {
          const cellNorm = normalizeText(raw);
          if (cellNorm.length > 0 && !renderedNorm.includes(cellNorm)) {
            neverOnPage += 1;
          }
        }
      }
    }

    const meetsWarn = typeof warnThresh === 'number' && neverOnPage >= warnThresh;
    const meetsErr = typeof errThresh === 'number' && neverOnPage >= errThresh;
    if (!meetsWarn && !meetsErr) return;

    const msg = formatMessage(getProblemMessage(rule), {
      count: neverOnPage,
      block: blockName,
    });
    const outcome = getOutcomeFromThresholds(neverOnPage, rule);
    issues.push(issueFromRule(rule, msg, outcome, block));
  });

  return issues;
}

/** Detail key → detector `(doc, config, plainDom)` → issues or Promise<issues>. */
const DETECTORS = {
  altIssues: (doc, config) => [
    ...checkImageAlt(doc, config),
    ...checkAltRequiredInLinkButton(doc, config),
  ],
  headingIssues: (doc, config) => checkHeadings(doc, config),
  linkIssues: (doc, config) => checkLinks(doc, config),
  nestedBlocksIssues: (_doc, config, plainDom) => checkNestedBlocks(config, plainDom),
  rowColSpansIssues: (doc, config, plainDom) => checkRowColSpans(config, plainDom, doc),
  columnCountsIssues: (doc, config, plainDom) => checkColumnCounts(config, plainDom, doc),
  listLikeIssues: (doc, config) => checkListLikeContent(doc, config),
  blockSprawlIssues: (_doc, config, plainDom) => checkBlockSprawl(config, plainDom),
  configLikeIssues: (doc, config, plainDom) => checkInlineConfig(doc, config, plainDom),
};

/**
 * Analyzes document for content issues.
 * @param {Document} [doc=document]
 * @returns {Object} Summary object with score and details
 */
export default async function analyzeContent(doc = document) {
  const config = await loadConfig();
  const categories = config.categories || [];
  const keys = categories.map((c) => categoryIdToDetailsKey(c.id));
  const needsPlainDom = keys.some(
    (key) => key === 'nestedBlocksIssues'
      || key === 'rowColSpansIssues'
      || key === 'columnCountsIssues'
      || key === 'blockSprawlIssues'
      || key === 'configLikeIssues',
  );
  const plainDom = needsPlainDom ? await fetchPlainDom() : null;
  const results = await Promise.all(
    keys.map((key) => Promise.resolve(DETECTORS[key] ? DETECTORS[key](doc, config, plainDom) : [])),
  );
  const details = Object.fromEntries(keys.map((key, i) => [key, results[i]]));

  assignIssueOutcome(details, config);
  normalizeDetailsToCanonical(details);
  const score = calculateScore(details);

  return { score, details, config };
}

/**
 * Updates visibility of badge's dismiss button based on error/warning counts and tray open state.
 * On Needs Improvement, the close button appears only after the user has opened the tray once.
 * @param {HTMLElement} badge - The .content-score-badge wrapper element
 */
function updateBadgeDismissVisibility(badge) {
  const errors = parseInt(badge.dataset.errors, 10) || 0;
  const warnings = parseInt(badge.dataset.warnings, 10) || 0;
  const toggle = badge.querySelector('.content-score-toggle');
  const dismiss = badge.querySelector('.content-score-dismiss');
  if (!toggle || !dismiss) return;
  const hasOpenedTray = badge.dataset.hasOpenedTray === 'true';
  const show = (errors === 0 && warnings === 0) || (errors === 0 && warnings >= 1 && hasOpenedTray);
  if (show) {
    dismiss.removeAttribute('hidden');
  } else {
    dismiss.setAttribute('hidden', '');
  }
}

/**
 * Renders content score UI (badge + tray).
 * @param {Object} result - Analysis result from analyzeContent()
 * @returns {{ badge: HTMLElement, tray: ContentScoreTray }}
 */
function renderBadge(result) {
  const { score, details } = result;
  let errors = 0;
  let warnings = 0;
  Object.values(details).forEach((arr) => {
    if (!Array.isArray(arr)) return;
    arr.forEach((issue) => {
      if (issue.outcome === 'error') errors += 1;
      else if (issue.outcome === 'warning') warnings += 1;
    });
  });
  const countText = getCountText(errors, warnings);
  const badgeCopy = getBadgeCopy()[score];

  const existingBadge = document.querySelector('.content-score-badge');
  const existingTray = document.querySelector('content-score-tray');
  if (existingBadge) existingBadge.remove();
  if (existingTray) existingTray.remove();

  const dismissHtml = errors === 0
    ? `<button type="button" class="content-score-dismiss" aria-label="Close" ${warnings >= 1 ? 'hidden' : ''}></button>`
    : '';
  const headline = badgeCopy.action
    ? `<span class="badge-message">${badgeCopy.message}</span> <span class="badge-action">${badgeCopy.action}</span>`
    : `<span class="badge-message">${badgeCopy.message}</span>`;
  const badgeHtml = `<div class="content-score-badge score-${score} count-visible" role="group" aria-label="Content score" data-errors="${errors}" data-warnings="${warnings}">
    <button type="button" class="content-score-toggle" aria-expanded="false" aria-controls="content-score-tray" aria-label="${badgeCopy.message}${badgeCopy.action ? `. ${badgeCopy.action}` : ''}. ${countText}">
      <p class="badge-headline">${headline}</p>
      <p class="badge-count">${countText}</p>
    </button>
    ${dismissHtml}
  </div>`;
  document.body.insertAdjacentHTML('beforeend', badgeHtml);
  const badge = document.querySelector('.content-score-badge');
  const toggle = badge.querySelector('.content-score-toggle');

  const tray = document.createElement('content-score-tray');
  tray.id = 'content-score-tray';
  tray.setAttribute('score', score);
  tray.setAttribute('hidden', '');
  Object.assign(tray, details);
  tray.categories = (result.config && result.config.categories) ? result.config.categories : [];

  toggle.addEventListener('click', () => {
    const isOpen = toggle.getAttribute('aria-expanded') === 'true';
    if (!isOpen) {
      badge.dataset.hasOpenedTray = 'true';
      tray.setAttribute('data-has-opened-tray', 'true');
    }
    toggle.setAttribute('aria-expanded', !isOpen);
    badge.classList.toggle('expanded', !isOpen);
    tray.toggle();
    updateBadgeDismissVisibility(badge);
  });

  function onEscape(e) {
    if (e.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') {
      toggle.setAttribute('aria-expanded', 'false');
      badge.classList.remove('expanded');
      tray.close();
      toggle.focus();
    }
  }
  function onTrayClose() {
    const b = document.querySelector('.content-score-badge');
    if (!b) return;
    const t = b.querySelector('.content-score-toggle');
    if (t) t.setAttribute('aria-expanded', 'false');
    b.classList.remove('expanded');
    updateBadgeDismissVisibility(b);
  }
  document.addEventListener('keydown', onEscape);
  document.addEventListener('content-score-tray-close', onTrayClose);

  const dismiss = badge.querySelector('.content-score-dismiss');
  if (dismiss) {
    dismiss.addEventListener('click', (e) => {
      e.stopPropagation();
      tray.close();
      badge.remove();
      tray.remove();
      document.removeEventListener('keydown', onEscape);
      document.removeEventListener('content-score-tray-close', onTrayClose);
    });
  }

  document.body.append(tray);

  setTimeout(() => badge.classList.remove('count-visible'), 8000);

  return { badge, tray };
}

/**
 * Initializes the content score tool (CSS, analysis, badge and tray).
 * @returns {Promise<void>}
 */
export async function init() {
  await loadCSS(new URL('styles.css', getBase()).href);

  const result = await analyzeContent(document);
  window.contentScore = result;
  renderBadge(result);

  const sk = document.querySelector('aem-sidekick');
  if (sk) {
    const observer = new MutationObserver(() => {
      if (!sk.open) {
        observer.disconnect();
        const badge = document.querySelector('.content-score-badge');
        if (badge) badge.remove();
        const tray = document.querySelector('content-score-tray');
        if (tray) tray.remove();
      }
    });
    observer.observe(sk, { attributes: true, attributeFilter: ['open'] });
  }
}
