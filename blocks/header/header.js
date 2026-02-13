import { getMetadata } from '../../scripts/aem.js';
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
  const navPath = navMeta ? new URL(navMeta, window.location).pathname : '/drafts/shsteimer/admin-nav';
  const fragment = await loadFragment(navPath);

  // decorate nav DOM
  const nav = document.createElement('section');
  nav.id = 'nav';
  nav.classList.add('header-nav');
  while (fragment.firstElementChild) nav.append(fragment.firstElementChild);

  const classes = ['workspace', 'sections'];
  classes.forEach((c, i) => {
    const section = nav.children[i];
    if (section) {
      section.id = `nav-${c}`;
      section.classList.add(`nav-${c}`);
    }
  });

  const sections = nav.querySelector('.nav-sections');
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

  // build nav-toggles with hamburger and theme toggle
  const navToggles = document.createElement('div');
  navToggles.className = 'nav-toggles';

  const hamburger = document.createElement('button');
  hamburger.className = 'toggle-nav';
  hamburger.id = 'toggle-nav';
  hamburger.setAttribute('type', 'button');
  hamburger.setAttribute('aria-expanded', 'false');
  hamburger.setAttribute('aria-label', 'Open navigation');
  hamburger.setAttribute('aria-controls', 'nav-sections');
  hamburger.innerHTML = '🛠️ <span class="toggle-nav-icon"></span>';
  hamburger.addEventListener('click', () => toggleNav(hamburger, sections));
  navToggles.append(hamburger);

  const themeToggle = document.createElement('button');
  themeToggle.className = 'theme-toggle';
  themeToggle.setAttribute('type', 'button');
  navToggles.append(themeToggle);
  initThemeToggle(themeToggle);

  // insert nav-toggles between workspace and sections
  if (sections) {
    nav.insertBefore(navToggles, sections);
  } else {
    nav.append(navToggles);
  }

  const navWrapper = document.createElement('div');
  navWrapper.className = 'nav-wrapper';
  navWrapper.append(nav);
  block.replaceChildren(navWrapper);

  // add experimental ribbon for pages with lab metadata
  const isLab = getMetadata('lab') === 'true';
  if (isLab) {
    const ribbon = document.createElement('div');
    ribbon.className = 'experimental-ribbon';
    ribbon.textContent = 'Experimental';
    block.prepend(ribbon);
  }

  swapIcons(block);
}
