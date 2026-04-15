import { getMetadata, loadBlock } from '../../scripts/aem.js';
import {
  swapIcons,
  applyTheme,
  getStoredTheme,
  storeTheme,
} from '../../scripts/scripts.js';
import { loadFragment } from '../fragment/fragment.js';

// Theme toggle constants
const THEMES = ['system', 'light', 'dark'];
const themeIconsCache = {};

const THEME_NAMES = {
  system: 'System',
  light: 'Light',
  dark: 'Dark',
};

const EXPERIMENTAL_TOOLTIP = 'Experimental means this tool was developed for a production use case and is marked experimental until we observe wider adoption. These tools should be used for your project when they make sense and are encouraged for production workflows.';

function getNextTheme(current) {
  const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  const systemResolved = prefersDark ? 'dark' : 'light';
  const opposite = prefersDark ? 'light' : 'dark';

  if (current === 'system') return opposite;
  if (current === opposite) return systemResolved;
  return 'system';
}

function getThemeLabel(current) {
  const next = getNextTheme(current);
  return `Theme: ${THEME_NAMES[current]} (click for ${THEME_NAMES[next]})`;
}

function attachTooltip(ribbon, tooltip) {
  const show = () => tooltip.classList.add('is-visible');
  const hide = () => tooltip.classList.remove('is-visible');

  ribbon.addEventListener('mouseenter', show);
  ribbon.addEventListener('mouseleave', hide);
  ribbon.addEventListener('focus', show);
  ribbon.addEventListener('blur', hide);
}

async function fetchThemeIcon(theme) {
  if (themeIconsCache[theme]) return themeIconsCache[theme];
  try {
    const response = await fetch(`/icons/theme-${theme}.svg`);
    if (response.ok) {
      const svg = await response.text();
      themeIconsCache[theme] = svg;
      return svg;
    }
  } catch (e) {
    // Fetch failed
  }
  return '';
}

async function updateThemeButton(button, theme) {
  const svg = await fetchThemeIcon(theme);
  button.innerHTML = svg;
  button.setAttribute('aria-label', getThemeLabel(theme));
  button.setAttribute('title', getThemeLabel(theme));
}

async function initThemeToggle(button) {
  let currentTheme = getStoredTheme();
  // Preload all icons
  await Promise.all(THEMES.map((theme) => fetchThemeIcon(theme)));
  await updateThemeButton(button, currentTheme);
  button.addEventListener('click', async () => {
    currentTheme = getNextTheme(currentTheme);
    applyTheme(currentTheme);
    storeTheme(currentTheme);
    await updateThemeButton(button, currentTheme);
  });
}

function clickToggleListener(e) {
  const inNav = e.target.closest('.header-nav');
  if (!inNav) {
    const button = document.getElementById('toggle-nav');
    const sections = document.getElementById('nav-sections');
    // eslint-disable-next-line no-use-before-define
    toggleNav(button, sections);
  }
}

function keyToggleListener(e) {
  if (e.key === 'Escape') {
    const button = document.getElementById('toggle-nav');
    const sections = document.getElementById('nav-sections');
    // eslint-disable-next-line no-use-before-define
    toggleNav(button, sections);
    button.focus();
  }
}

function closeOnFocusLost(e) {
  const nav = e.currentTarget;
  if ((nav && e.relatedTarget) && !nav.contains(e.relatedTarget)) {
    const button = nav.querySelector('.toggle-nav');
    const sections = nav.querySelector('.nav-sections');
    // eslint-disable-next-line no-use-before-define
    toggleNav(button, sections);
  }
}

function toggleNav(button, sections) {
  const expanded = button.getAttribute('aria-expanded') === 'true';
  button.setAttribute('aria-expanded', !expanded);
  sections.setAttribute('aria-hidden', expanded);
  button.setAttribute('aria-label', !expanded ? 'Close navigation' : 'Open navigation');

  const nav = button.closest('#nav');
  if (!expanded) {
    document.addEventListener('click', clickToggleListener);
    window.addEventListener('keydown', keyToggleListener);
    nav.addEventListener('focusout', closeOnFocusLost);
  } else {
    document.removeEventListener('click', clickToggleListener);
    window.removeEventListener('keydown', keyToggleListener);
    nav.removeEventListener('focusout', closeOnFocusLost);
  }
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

  const classes = ['title', 'sections', 'tools'];
  classes.forEach((c, i) => {
    const section = nav.children[i];
    if (section) {
      section.id = `nav-${c}`;
      section.classList.add(`nav-${c}`);
    }
  });

  // decorate title
  const title = nav.querySelector('.nav-title');
  const sections = nav.querySelector('.nav-sections');
  if (title) {
    if (sections) {
      // make button
      const button = document.createElement('button');
      button.classList.add('button', 'outline', 'toggle-nav');
      button.id = 'toggle-nav';
      button.setAttribute('aria-label', 'Open navigation');
      button.setAttribute('aria-haspopup', true);
      button.setAttribute('aria-expanded', false);
      button.setAttribute('aria-controls', 'nav-sections');
      button.textContent = title.textContent;
      title.replaceWith(button);

      const buttonIcon = document.createElement('span');
      buttonIcon.classList.add('toggle-nav-icon');
      button.append(buttonIcon);

      button.addEventListener('click', () => {
        toggleNav(button, sections);
      });

      sections.setAttribute('aria-hidden', true);
    } else if (!title.querySelector('a[href]')) {
      const content = title.querySelector('h1, h2, h3, h4, h5, h6, p');
      content.className = 'title-content';
      if (content && content.textContent) {
        const link = document.createElement('a');
        link.href = '/';
        link.innerHTML = content.innerHTML;
        content.innerHTML = link.outerHTML;
      }
    }
  }

  // decorate sections
  if (sections) {
    const wrapper = document.createElement('nav');
    const ul = sections.querySelector('ul');
    wrapper.append(ul);
    sections.prepend(wrapper);
    [...ul.children].forEach((li) => {
      const subsection = li.querySelector('ul');
      if (subsection) {
        li.className = 'subsection';
        const label = li.textContent.replace(subsection.textContent, '').trim();
        if (label) {
          const span = document.createElement('span');
          span.textContent = label;
          li.replaceChildren(span, subsection);
        }
      }
    });
  }

  // add login button
  const tools = nav.querySelector('.nav-tools');
  if (tools) {
    const toolsList = tools.querySelector('ul');
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

  // add experimental ribbon for pages with lab metadata
  const isLab = getMetadata('lab') === 'true';
  if (isLab) {
    const ribbon = document.createElement('div');
    const tooltip = document.createElement('span');
    ribbon.className = 'experimental-ribbon';
    ribbon.textContent = 'Experimental';
    tooltip.className = 'experimental-tooltip';
    tooltip.textContent = EXPERIMENTAL_TOOLTIP;
    tooltip.setAttribute('aria-hidden', 'true');
    tooltip.setAttribute('role', 'tooltip');
    ribbon.setAttribute('aria-label', `Experimental. ${EXPERIMENTAL_TOOLTIP}`);
    ribbon.tabIndex = 0;
    attachTooltip(ribbon, tooltip);
    block.prepend(tooltip);
    block.prepend(ribbon);
  }

  swapIcons(block);
}
