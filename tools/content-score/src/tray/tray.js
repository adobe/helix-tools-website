import {
  categoryIdToDetailsKey,
  escapeHtml,
  getBase,
  getCountText,
  getNoIssuesText,
  getScoreLabels,
  loadCloseSvg,
  outcomeRank,
} from '../utils.js';

/**
 * Loads the tray HTML template.
 * @returns {Promise<string>} Resolves with the tray HTML string
 */
async function loadTrayTemplate() {
  if (!loadTrayTemplate.cache) {
    const response = await fetch(new URL('tray/tray.html', getBase()));
    loadTrayTemplate.cache = await response.text();
  }
  return loadTrayTemplate.cache;
}

/**
 * Builds the attribute string for a clickable issue row (click/focus to highlight page element).
 * @param {number} index - Index of the issue in the combined list (for lookup)
 * @returns {string} HTML attribute string for the list item
 */
function clickableIssueAttrs(index) {
  return `class="issue-item clickable" tabindex="0" data-issue-index="${index}"`;
}

/**
 * Builds the HTML for a single issue list row (media, title, optional context and outcome).
 * @param {string} attrs - Attributes for the outer li (e.g. from clickableIssueAttrs)
 * @param {string} media - HTML for the media cell (icon or thumbnail)
 * @param {string} title - Issue title text (already escaped)
 * @param {string} [context] - Optional extra context HTML below the title
 * @param {string} [outcome] - Optional outcome for the issue (warning, error, info)
 * @returns {string} HTML string for one list item
 */
function issueItem(attrs, media, title, context = '', outcome = '') {
  const outcomeAttr = outcome ? ` data-issue-outcome="${escapeHtml(outcome)}"` : '';
  const outcomeBadge = outcome
    ? `<span class="issue-outcome-badge">${escapeHtml(outcome)}</span> `
    : '';
  return `
    <li ${attrs}${outcomeAttr}>
      <div class="issue-media">${media}</div>
      <div class="details">
        <p class="issue-title">${outcomeBadge}${title}</p>
        ${context}
      </div>
    </li>
  `;
}

/**
 * Returns the element only if it is still in the document; otherwise null.
 * @param {Element} element - Element to validate
 * @returns {Element|null} The element if in document, else null
 */
function getValidElement(element) {
  return (element && document.contains(element)) ? element : null;
}

/**
 * Renders one issue row from the canonical issue shape. Single render path; no type branching.
 * @param {Object} issue - Canonical issue
 * @param {number} indexInFullList - Index in the full combined list (for data-issue-index lookup)
 * @returns {string} HTML string for one list item
 */
function renderIssueRow(issue, indexInFullList) {
  const hasElements = issue.elements && issue.elements.length > 0;
  const attrs = hasElements
    ? clickableIssueAttrs(indexInFullList)
    : 'class="issue-item"';

  let mediaHtml = '';
  if (issue.media && issue.media.type === 'thumbnail' && issue.media.src) {
    mediaHtml = `<img src="${escapeHtml(issue.media.src)}" alt="" class="thumbnail">`;
  } else {
    const char = (issue.media && issue.media.type === 'emoji' && issue.media.char)
      ? issue.media.char
      : '⚠️';
    mediaHtml = escapeHtml(String(char));
  }

  let context = '';
  if (hasElements && issue.elements.length > 1) {
    const labels = issue.elementLabels || [];
    const pills = issue.elements.map((el, i) => {
      let label = labels[i];
      if (label === undefined && el && el.textContent) label = el.textContent.trim();
      if (label === undefined) label = '';
      let tag = '?';
      if (el && el.tagName) tag = el.tagName.toLowerCase();
      const text = escapeHtml(label);
      return `<li class="target-option" tabindex="0" data-target-index="${i}">&lt;${tag}&gt; "${text}"</li>`;
    }).join('');
    context = `<ul class="issue-targets">${pills}</ul>`;
  }
  if (issue.recommendation) {
    context += `<p class="issue-recommendation">${escapeHtml(issue.recommendation)}</p>`;
  }

  return issueItem(
    attrs,
    mediaHtml,
    escapeHtml(issue.issue),
    context,
    issue.outcome,
  );
}

/**
 * Fills a list element with issue rows or a single "no issues" row.
 * @param {Element} list - The ul to populate (innerHTML is replaced)
 * @param {Array} issues - Array of canonical issues (possibly filtered)
 * @param {string} [noIssuesText] - Text for the empty state row (default: getNoIssuesText())
 * @param {Array} [fullList] - Full combined issue list; each row gets data-issue-index from this
 */
function renderIssueList(list, issues, noIssuesText = getNoIssuesText(), fullList = null) {
  if (issues.length === 0) {
    list.innerHTML = `<li class="no-issues">${escapeHtml(noIssuesText)}</li>`;
    return;
  }

  const refList = fullList || issues;
  list.innerHTML = issues
    .map((issue) => {
      const index = refList.indexOf(issue);
      return renderIssueRow(issue, index >= 0 ? index : 0);
    })
    .join('');
}

// content score tray web component
export default class ContentScoreTray extends HTMLElement {
  /**
   * Section config: fixed order/outcome sections plus type sections from config (this.categories).
   * @returns {Array<Object>} Section config entries
   */
  getSectionConfig() {
    if (this.sectionConfigCache && this.sectionConfigCategoriesRef === this.categories) {
      return this.sectionConfigCache;
    }
    const categories = this.categories || [];
    const typeSections = categories.map((c) => ({
      key: c.id,
      category: c.id,
      displayMode: 'type',
      heading: c.heading,
    }));
    const config = [
      {
        key: 'combined',
        displayMode: 'order',
        heading: 'All Issues',
      },
      {
        key: 'errors',
        outcome: 'error',
        displayMode: 'outcome',
        heading: 'Errors',
      },
      {
        key: 'warnings',
        outcome: 'warning',
        displayMode: 'outcome',
        heading: 'Warnings',
      },
      ...typeSections,
    ];
    this.sectionConfigCategoriesRef = this.categories;
    this.sectionConfigCache = config;
    return config;
  }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.sortMode = 'order';
    this.highlightedElement = null;
    this.selectedItem = null;
  }

  async connectedCallback() {
    await this.render();
    this.setupEventListeners();
  }

  /**
   * Merges all category issue arrays into one, sorted by current mode (order, outcome, or type).
   * @returns {Array} Flat array of canonical issues
   */
  getCombinedIssues() {
    const sectionConfig = this.getSectionConfig();
    const typeSections = sectionConfig.filter((s) => s.displayMode === 'type');
    const all = [].concat(
      ...typeSections.map((s) => this[categoryIdToDetailsKey(s.key)] || []),
    );

    const docOrder = (a, b) => {
      const elA = (a.elements && a.elements[0]) || a.element;
      const elB = (b.elements && b.elements[0]) || b.element;
      if (!elA && !elB) return 0;
      if (!elA) return 1;
      if (!elB) return -1;
      const position = elA.compareDocumentPosition(elB);
      // eslint-disable-next-line no-bitwise
      const isFollowing = (position & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
      return isFollowing ? -1 : 1;
    };

    if (this.sortMode === 'order') {
      all.sort(docOrder);
    } else if (this.sortMode === 'outcome') {
      all.sort((a, b) => {
        const aRank = outcomeRank(a.outcome);
        const bRank = outcomeRank(b.outcome);
        if (aRank !== bRank) return aRank - bRank;
        return docOrder(a, b);
      });
    } else {
      all.sort((a, b) => {
        if (a.category !== b.category) return a.category.localeCompare(b.category);
        return (a.issue || '').localeCompare(b.issue || '');
      });
    }

    return all;
  }

  async render() {
    const scoreLabels = getScoreLabels();
    const score = this.getAttribute('score') || 'needs-improvement';
    const combinedIssues = this.getCombinedIssues();
    this.combinedIssuesRef = combinedIssues;

    const template = await loadTrayTemplate();
    const parser = new DOMParser();
    const doc = parser.parseFromString(template, 'text/html');

    doc.querySelector('[data-tray-styles]').href = new URL('tray/tray.css', getBase()).href;

    const scoreBadge = doc.querySelector('[data-score]');
    scoreBadge.textContent = scoreLabels[score];
    scoreBadge.setAttribute('data-score', score);

    const errors = combinedIssues.filter((issue) => issue.outcome === 'error').length;
    const warnings = combinedIssues.filter((issue) => issue.outcome === 'warning').length;
    const summaryEl = doc.querySelector('[data-summary]');
    if (summaryEl) {
      summaryEl.textContent = getCountText(errors, warnings);
    }

    const sectionsContainer = doc.querySelector('.tray-sections');
    if (sectionsContainer) {
      this.getSectionConfig().forEach((section) => {
        const sectionEl = doc.createElement('section');
        sectionEl.setAttribute(`data-${section.key}-section`, '');
        sectionEl.setAttribute('aria-labelledby', `tray-section-${section.key}`);
        const h3 = doc.createElement('h3');
        h3.id = `tray-section-${section.key}`;
        h3.textContent = section.heading;
        const list = doc.createElement('ul');
        list.setAttribute(`data-${section.key}-list`, '');
        sectionEl.append(h3, list);
        sectionsContainer.append(sectionEl);
      });
    }

    this.configureSections(doc, combinedIssues);

    const sortToggle = doc.querySelector('.sort-toggle');
    if (sortToggle) sortToggle.value = this.sortMode;

    const closeBtn = doc.querySelector('.tray-close');
    if (closeBtn) {
      const closeSvg = (await loadCloseSvg()).replace('<svg ', '<svg class="tray-close-icon" aria-hidden="true" ');
      closeBtn.innerHTML = closeSvg;
    }

    this.shadowRoot.innerHTML = '';
    this.shadowRoot.append(...doc.head.childNodes, ...doc.body.childNodes);
  }

  /**
   * Shows/hides sections and fills lists by sort mode; section.displayMode controls visibility.
   * @param {Document} doc - Parsed tray template document (before append to shadow)
   * @param {Array} combinedIssues - Sorted combined issues from getCombinedIssues()
   */
  configureSections(doc, combinedIssues) {
    this.getSectionConfig().forEach((section) => {
      const sectionEl = doc.querySelector(`[data-${section.key}-section]`);
      const listEl = doc.querySelector(`[data-${section.key}-list]`);

      if (this.sortMode !== section.displayMode) {
        sectionEl.setAttribute('hidden', '');
        return;
      }

      sectionEl.removeAttribute('hidden');

      if (section.displayMode === 'order') {
        renderIssueList(listEl, combinedIssues, getNoIssuesText(), combinedIssues);
        return;
      }

      if (section.displayMode === 'outcome') {
        const filtered = section.outcome === 'warning'
          ? combinedIssues.filter((issue) => issue.outcome !== 'error')
          : combinedIssues.filter((issue) => issue.outcome === section.outcome);
        renderIssueList(listEl, filtered, getNoIssuesText(), combinedIssues);
        return;
      }

      const filtered = combinedIssues.filter((issue) => issue.category === section.category);
      renderIssueList(listEl, filtered, getNoIssuesText(), combinedIssues);
    });
  }

  /**
   * Binds sort change and list focus/click/keydown to the current shadow DOM.
   */
  setupEventListeners() {
    const closeBtn = this.shadowRoot.querySelector('.tray-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.close());
    }

    const sortToggle = this.shadowRoot.querySelector('.sort-toggle');
    if (sortToggle) {
      sortToggle.addEventListener('change', async (e) => {
        this.sortMode = e.target.value;
        this.clearSelection();
        await this.render();
        this.setupEventListeners();
      });
    }

    const listSelector = this.getSectionConfig().map((s) => `[data-${s.key}-list]`).join(', ');
    const lists = this.shadowRoot.querySelectorAll(listSelector);
    lists.forEach((list) => {
      list.addEventListener('focusin', (e) => {
        const { target, element } = this.getTargetFromEvent(e);
        if (element && target) {
          const issueRow = target.closest('.issue-item') || target;
          const outcome = issueRow.getAttribute('data-issue-outcome') || 'warning';
          this.highlightElement(element, { outcome, scroll: true });
        }
      });

      list.addEventListener('focusout', (e) => {
        const stillInList = list.contains(e.relatedTarget);
        if (!stillInList && !this.selectedItem) {
          this.clearHighlight();
        }
      });

      list.addEventListener('click', (e) => {
        const { target, element } = this.getTargetFromEvent(e);
        if (target && element) {
          if (e.target.closest('.target-option')) {
            e.stopPropagation();
          }
          this.setSelection(target, element);
        }
      });

      list.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const { target, element } = this.getTargetFromEvent(e);
        if (target && element) {
          e.preventDefault();
          this.setSelection(target, element);
        }
      });
    });
  }

  /**
   * Resolves the clicked/focused list item and the corresponding page element from an event.
   * @param {Event} e - focusin, focusout, click, or keydown on a list
   * @returns {{ target: Element|null, element: Element|null }} Item and page element, or nulls
   */
  getTargetFromEvent(e) {
    const multiItem = e.target.closest('.target-option');
    const item = e.target.closest('.issue-item.clickable');

    if (multiItem) return { target: multiItem, element: this.getMultiElement(multiItem) };
    if (item) return { target: item, element: this.getElementForItem(item, e) };

    return { target: null, element: null };
  }

  /**
   * Resolves the page element for a target-option sub-item (one of multiple elements).
   * @param {Element} multiItem - The .target-option that was clicked
   * @returns {Element|null} The corresponding element in the page, or null
   */
  getMultiElement(multiItem) {
    const parentItem = multiItem.closest('.issue-item');
    if (!parentItem || !this.combinedIssuesRef) return null;
    const issueIndex = parseInt(parentItem.getAttribute('data-issue-index'), 10);
    const itemIndex = parseInt(multiItem.getAttribute('data-target-index'), 10);
    const issue = this.combinedIssuesRef[issueIndex];
    if (!issue || !issue.elements) return null;
    const element = issue.elements[itemIndex];
    return (element && document.contains(element)) ? element : null;
  }

  /**
   * Marks the given list item as selected and highlights the given page element.
   * @param {Element} item - The tray list item (e.g. .issue-item.clickable)
   * @param {Element} element - The page element to highlight (e.g. heading, link)
   */
  setSelection(item, element) {
    if (this.selectedItem) this.selectedItem.removeAttribute('aria-selected');

    this.selectedItem = item;
    item.setAttribute('aria-selected', true);
    const issueRow = item.closest('.issue-item') || item;
    const outcome = issueRow.getAttribute('data-issue-outcome') || 'warning';
    this.highlightElement(element, { outcome, scroll: true });
  }

  // clears the current selection and removes the page highlight
  clearSelection() {
    if (this.selectedItem) {
      this.selectedItem.removeAttribute('aria-selected');
      this.selectedItem = null;
    }
    this.clearHighlight();
  }

  // removes content-score-highlight and outcome attr from the currently highlighted element
  clearHighlight() {
    if (this.highlightedElement) {
      this.highlightedElement.classList.remove('content-score-highlight');
      this.highlightedElement.removeAttribute('data-content-score-outcome');
      this.highlightedElement = null;
    }
  }

  /**
   * Highlights the given page element with an outcome-matched outline and optionally scrolls.
   * @param {Element} element - The page element to highlight
   * @param {Object} [options] - Options
   * @param {string} [options.outcome] - Issue outcome (error, warning, info) for outline color
   * @param {boolean} [options.scroll=true] - Whether to scroll the element into view
   */
  highlightElement(element, options = {}) {
    if (!element) return;
    if (element === this.highlightedElement) return;

    const scroll = options.scroll !== false;
    const outcome = options.outcome || 'warning';

    this.clearHighlight();
    this.highlightedElement = element;
    element.classList.add('content-score-highlight');
    element.setAttribute('data-content-score-outcome', outcome);

    if (scroll) {
      const isWide = window.matchMedia('(width >= 1200px)').matches;
      const blockPosition = isWide ? 'center' : 'start';
      element.scrollIntoView({ behavior: 'smooth', block: blockPosition });
    }
  }

  /**
   * Resolves the page element for an issue list item from the combined list.
   * @param {Element} item - The tray list item (has data-issue-index)
   * @param {Event} [e] - Optional event; used to resolve .target-option index for multi-element
   * @returns {Element|null} The corresponding page element, or null
   */
  getElementForItem(item, e) {
    if (!this.combinedIssuesRef) return null;
    const issueIndex = parseInt(item.getAttribute('data-issue-index'), 10);
    const issue = this.combinedIssuesRef[issueIndex];
    if (!issue) return null;

    if (e) {
      const targetOption = e.target.closest('.target-option');
      if (targetOption && issue.elements) {
        const targetIndex = parseInt(targetOption.getAttribute('data-target-index'), 10);
        return getValidElement(issue.elements[targetIndex]);
      }
    }

    const el = (issue.elements && issue.elements[0]) || issue.element;
    if (!el) return null;
    const valid = getValidElement(el);
    if (!valid) return null;
    if (valid.classList && valid.classList.contains('button')) {
      return valid.closest('.button-wrapper') || valid;
    }
    return valid;
  }

  // shows the tray (removes hidden attribute)
  open() {
    this.removeAttribute('hidden');
  }

  // hides the tray and clears selection/highlight
  close() {
    this.clearSelection();
    this.setAttribute('hidden', '');
    this.dispatchEvent(new CustomEvent('content-score-tray-close', { bubbles: true }));
  }

  // toggles tray visibility (open if hidden, close if visible)
  toggle() {
    if (this.hasAttribute('hidden')) {
      this.open();
    } else {
      this.close();
    }
  }
}

customElements.define('content-score-tray', ContentScoreTray);
