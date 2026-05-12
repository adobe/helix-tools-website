import { getMetadata, loadBlock } from '../../scripts/aem.js';
import {
  swapIcons,
  applyTheme,
  getStoredTheme,
  storeTheme,
} from '../../scripts/scripts.js';
import { loadFragment } from '../fragment/fragment.js';
import { parseCategories } from './categories.js';
import { createCombobox, CHEVRON_SVG } from './combobox.js';
import {
  loadProjects,
  updateStorage,
  getProjectFromUrl,
} from '../../utils/config/config.js';

// Theme toggle constants
const CONTRAST_ICON_URL = '/icons/s2-icon-contrast-20-n.svg';
let contrastIconMarkup = null;

const THEME_NAMES = {
  system: 'System',
  light: 'Light',
  dark: 'Dark',
};

const EXPERIMENTAL_TOOLTIP = 'Experimental tools should be considered early-access: they may undergo significant changes without warning and are not yet widely adopted.';

function getNextTheme(current) {
  if (current === 'dark') return 'light';
  if (current === 'light') return 'dark';
  // No explicit preference yet ('system'): switch away from whatever the OS resolves to,
  // and from here on the toggle just flips light <-> dark (never back to 'system').
  const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  return prefersDark ? 'light' : 'dark';
}

function getThemeLabel(current) {
  const next = getNextTheme(current);
  return `Theme: ${THEME_NAMES[current]} (click for ${THEME_NAMES[next]})`;
}

function attachTooltip(ribbon, tooltip) {
  let hideTimeout;
  const show = () => {
    clearTimeout(hideTimeout);
    tooltip.classList.add('is-visible');
    tooltip.setAttribute('aria-hidden', 'false');
  };
  const hide = () => {
    hideTimeout = setTimeout(() => {
      tooltip.classList.remove('is-visible');
      tooltip.setAttribute('aria-hidden', 'true');
    }, 100);
  };

  ribbon.addEventListener('mouseenter', show);
  ribbon.addEventListener('mouseleave', hide);
  ribbon.addEventListener('focus', show);
  ribbon.addEventListener('blur', hide);
  tooltip.addEventListener('mouseenter', show);
  tooltip.addEventListener('mouseleave', hide);
  tooltip.addEventListener('focusin', show);
  tooltip.addEventListener('focusout', hide);
}

function decorateExperimentalRibbon(block) {
  const ribbon = document.createElement('div');
  const tooltip = document.createElement('span');
  const tooltipText = document.createElement('span');
  const lifecycleLink = document.createElement('a');

  ribbon.className = 'experimental-ribbon';
  ribbon.textContent = 'Experimental';
  ribbon.tabIndex = 0;
  ribbon.setAttribute('aria-label', `Experimental. ${EXPERIMENTAL_TOOLTIP}`);
  ribbon.setAttribute('aria-describedby', 'experimental-tooltip');

  tooltip.id = 'experimental-tooltip';
  tooltip.className = 'experimental-tooltip';
  tooltip.setAttribute('aria-hidden', 'true');
  tooltip.setAttribute('role', 'tooltip');

  tooltipText.textContent = EXPERIMENTAL_TOOLTIP;
  lifecycleLink.href = 'https://www.aem.live/docs/lifecycle';
  lifecycleLink.textContent = 'Learn about the AEM feature lifecycle.';
  tooltip.append(tooltipText, ' ', lifecycleLink);

  attachTooltip(ribbon, tooltip);
  block.prepend(tooltip);
  block.prepend(ribbon);
}

async function fetchContrastIcon() {
  if (contrastIconMarkup !== null) return contrastIconMarkup;
  try {
    const response = await fetch(CONTRAST_ICON_URL);
    contrastIconMarkup = response.ok ? await response.text() : '';
  } catch (e) {
    contrastIconMarkup = '';
  }
  return contrastIconMarkup;
}

async function updateThemeButton(button, theme) {
  button.innerHTML = await fetchContrastIcon();
  button.setAttribute('aria-label', getThemeLabel(theme));
  button.setAttribute('title', getThemeLabel(theme));
}

async function initThemeToggle(button) {
  let currentTheme = getStoredTheme();
  await updateThemeButton(button, currentTheme);
  button.addEventListener('click', async () => {
    currentTheme = getNextTheme(currentTheme);
    applyTheme(currentTheme);
    storeTheme(currentTheme);
    await updateThemeButton(button, currentTheme);
  });
}

// Shares the `aem-projects` localStorage shape and sidekick `getSites` source with the
// per-tool org/site pickers (see utils/config/config.js). Header-prefixed ids keep
// this picker's inputs distinct from any per-tool form inputs.
function buildProjectFields() {
  const wrap = document.createElement('div');
  wrap.className = 'header-project';

  const orgCombo = createCombobox({
    id: 'header-org', label: 'Organization', placeholder: 'Select org', labelVisible: true,
  });
  const sep = document.createElement('span');
  sep.className = 'header-project-sep';
  sep.textContent = '/';
  const siteCombo = createCombobox({
    id: 'header-site', label: 'Site', placeholder: 'site', disabled: true, labelVisible: true,
  });
  wrap.append(orgCombo.element, sep, siteCombo.element);

  let projects = { orgs: [], sitesByOrg: {} };

  const persist = () => {
    const org = orgCombo.getValue();
    if (!org) return;
    const site = siteCombo.getValue();
    updateStorage(org, site);
    const url = new URL(window.location.href);
    url.searchParams.set('org', org);
    if (site) url.searchParams.set('site', site);
    else url.searchParams.delete('site');
    window.history.replaceState({}, '', url);
    window.dispatchEvent(new CustomEvent('tools:project-change', { detail: { org, site } }));
  };

  const refillSites = (org) => {
    const sites = (org && projects.sitesByOrg[org]) || [];
    siteCombo.setItems(sites);
    const current = siteCombo.getValue();
    if (current && !sites.includes(current)) siteCombo.setValue('');
    siteCombo.setDisabled(!org);
  };

  orgCombo.on('commit', (org) => { refillSites(org); persist(); });
  siteCombo.on('commit', () => persist());

  (async () => {
    const { org: urlOrg, site: urlSite } = getProjectFromUrl();
    if (urlOrg) orgCombo.setValue(urlOrg);
    if (urlSite) siteCombo.setValue(urlSite);
    projects = await loadProjects();
    orgCombo.setItems(projects.orgs);
    let org = orgCombo.getValue();
    if (!org && projects.orgs[0]) {
      [org] = projects.orgs;
      orgCombo.setValue(org);
    }
    if (org) {
      const sites = projects.sitesByOrg[org] || [];
      siteCombo.setItems(sites);
      siteCombo.setDisabled(false);
      if (!siteCombo.getValue() && sites[0]) siteCombo.setValue(sites[0]);
      persist();
    }
  })();

  return wrap;
}

function buildMegaNav(categories) {
  const wrap = document.createElement('div');
  wrap.className = 'header-mega';

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'header-mega-trigger';
  trigger.setAttribute('aria-haspopup', 'true');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-controls', 'header-mega-panel');
  const triggerLabel = document.createTextNode('Tools');
  const chevron = document.createElement('span');
  chevron.className = 'header-mega-chevron';
  chevron.setAttribute('aria-hidden', 'true');
  chevron.innerHTML = CHEVRON_SVG;
  trigger.append(triggerLabel, chevron);

  const panel = document.createElement('nav');
  panel.id = 'header-mega-panel';
  panel.className = 'header-mega-panel';
  panel.setAttribute('aria-label', 'Tools');
  panel.hidden = true;

  categories.forEach((cat) => {
    const col = document.createElement('div');
    col.className = 'header-mega-col';
    const heading = document.createElement('h4');
    heading.textContent = cat.label;
    col.append(heading);
    const ul = document.createElement('ul');
    cat.tools.forEach((tool) => {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = tool.url;
      a.textContent = tool.label;
      li.append(a);
      ul.append(li);
    });
    col.append(ul);
    panel.append(col);
  });

  wrap.append(trigger, panel);

  const close = () => {
    panel.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    trigger.classList.remove('is-open');
  };
  const open = () => {
    panel.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    trigger.classList.add('is-open');
  };

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    if (panel.hidden) open();
    else close();
  });

  document.addEventListener('click', (e) => {
    if (panel.hidden) return;
    if (!wrap.contains(e.target)) close();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !panel.hidden) {
      close();
      trigger.focus();
    }
  });

  return wrap;
}

const HAMBURGER_SVG = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M3 6h18M3 12h18M3 18h18"/></svg>';
const CLOSE_SVG = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M5 5l14 14M19 5L5 19"/></svg>';

/**
 * Collapses the header behind a hamburger on narrow viewports: the "Tools" nav and
 * the right-side tools (org/site pickers, links, theme toggle, profile) move into a
 * left slide-in drawer. On wide viewports the drawer is just an inline flex container
 * and the toggle/backdrop are hidden by CSS — no DOM is moved back.
 * @param {Element} nav The `.header-nav` element.
 * @param {Element} block The header block element.
 */
function setupResponsiveNav(nav, block) {
  const drawer = document.createElement('div');
  drawer.className = 'header-drawer';
  drawer.id = 'header-drawer';

  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'header-drawer-close';
  closeButton.setAttribute('aria-label', 'Close menu');
  closeButton.innerHTML = CLOSE_SVG;
  drawer.append(closeButton);

  // everything but the logo moves into the drawer (in document order: mega, then tools)
  nav.querySelectorAll(':scope > .header-mega, :scope > .nav-tools').forEach((el) => drawer.append(el));
  nav.append(drawer);

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'header-nav-toggle';
  toggle.setAttribute('aria-label', 'Open menu');
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-controls', 'header-drawer');
  toggle.innerHTML = HAMBURGER_SVG;
  nav.append(toggle);

  const backdrop = document.createElement('div');
  backdrop.className = 'header-drawer-backdrop';
  block.append(backdrop);

  const setOpen = (open) => {
    block.classList.toggle('is-nav-open', open);
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    if (open) document.body.setAttribute('data-scroll', 'disabled');
    else document.body.removeAttribute('data-scroll');
  };

  toggle.addEventListener('click', () => setOpen(!block.classList.contains('is-nav-open')));
  closeButton.addEventListener('click', () => setOpen(false));
  backdrop.addEventListener('click', () => setOpen(false));
  drawer.addEventListener('click', (e) => { if (e.target.closest('a[href]')) setOpen(false); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && block.classList.contains('is-nav-open')) {
      setOpen(false);
      toggle.focus();
    }
  });
}

/**
 * loads and decorates the header
 * @param {Element} block The header block element
 */
export default async function decorate(block) {
  // load nav as fragment
  const navMeta = getMetadata('nav');
  const navPath = navMeta ? new URL(navMeta, window.location).pathname : '/nav';
  const fragment = await loadFragment(navPath);

  // decorate nav DOM
  const nav = document.createElement('section');
  nav.id = 'nav';
  nav.classList.add('header-nav');
  while (fragment.firstElementChild) nav.append(fragment.firstElementChild);

  const navHtml = nav.innerHTML;
  const categories = parseCategories(navHtml);
  window.toolCategories = Object.freeze(Object.fromEntries(
    categories.map((c) => [c.slug, Object.freeze({ label: c.label, tools: c.tools })]),
  ));
  window.dispatchEvent(new CustomEvent('tools:categories-ready', { detail: { categories } }));

  const classes = ['title', 'sections', 'tools'];
  classes.forEach((c, i) => {
    const section = nav.children[i];
    if (section) {
      section.id = `nav-${c}`;
      section.classList.add(`nav-${c}`);
    }
  });

  // decorate title as a plain logo link (no dropdown trigger)
  const title = nav.querySelector('.nav-title');
  const sections = nav.querySelector('.nav-sections');
  if (title && !title.querySelector('a[href]')) {
    const content = title.querySelector('h1, h2, h3, h4, h5, h6, p');
    if (content && content.textContent) {
      content.className = 'title-content';
      const link = document.createElement('a');
      link.href = '/';
      link.innerHTML = content.innerHTML;
      content.innerHTML = link.outerHTML;
    }
  }

  // drop the original nav-sections markup; replace it with the mega-nav.
  if (sections) sections.remove();

  // add login button
  const tools = nav.querySelector('.nav-tools');
  // place the mega-nav between the title and the tools area, where nav-sections used to live.
  if (tools) nav.insertBefore(buildMegaNav(categories), tools);
  else nav.append(buildMegaNav(categories));
  if (tools) {
    const toolsList = tools.querySelector('ul');
    tools.prepend(buildProjectFields());
    toolsList.classList.add('tools-list');

    toolsList.querySelectorAll('a').forEach((a) => {
      const url = new URL(a.href);
      if (url.hostname !== 'tools.aem.live' && url.hostname !== window.location.hostname) {
        a.classList.add('button', 'outline');
        a.target = '_blank';
        a.title = a.textContent;
      }

      const icon = a.querySelector('.icon');
      if (icon) {
        const label = document.createElement('span');
        label.classList.add('label');
        label.textContent = a.textContent;
        a.replaceChildren(label, icon);
      }
    });

    // add theme toggle
    const themeToggleLi = document.createElement('li');
    const themeToggle = document.createElement('button');
    themeToggle.classList.add('theme-toggle');
    themeToggle.setAttribute('type', 'button');
    themeToggleLi.append(themeToggle);
    toolsList.append(themeToggleLi);
    initThemeToggle(themeToggle);

    const loginBlock = document.createElement('div');
    loginBlock.classList.add('profile');
    loginBlock.dataset.blockName = 'profile';

    if (tools.querySelector('.icon-user')) {
      tools.querySelector('.icon-user').replaceWith(loginBlock);
    } else {
      tools.append(loginBlock);
    }
    await loadBlock(loginBlock);
  }

  const navWrapper = document.createElement('div');
  navWrapper.className = 'nav-wrapper';
  navWrapper.append(nav);
  block.replaceChildren(navWrapper);

  setupResponsiveNav(nav, block);

  // add experimental ribbon for pages with lab metadata
  const isLab = getMetadata('lab') === 'true';
  if (isLab) {
    decorateExperimentalRibbon(block);
  }

  swapIcons(block);
}
