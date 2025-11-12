import {
  buildBlock,
  loadHeader,
  loadFooter,
  decorateIcons,
  decorateSections,
  decorateBlocks,
  decorateTemplateAndTheme,
  waitForFirstImage,
  loadSection,
  loadSections,
  loadCSS,
  getMetadata,
  loadBlock,
  decorateBlock,
  loadScript,
} from './aem.js';

/**
 * Helper function to create DOM elements
 * @param {string} tag DOM element to be created
 * @param {array} attributes attributes to be added
 */
export function createTag(tag, attributes, html) {
  const el = document.createElement(tag);
  if (html) {
    if (html instanceof HTMLElement || html instanceof SVGElement) {
      el.append(html);
    } else {
      el.insertAdjacentHTML('beforeend', html);
    }
  }
  if (attributes) {
    Object.entries(attributes).forEach(([key, val]) => {
      el.setAttribute(key, val);
    });
  }
  return el;
}

/**
 * load fonts.css and set a session storage flag
 */
async function loadFonts() {
  await loadCSS(`${window.hlx.codeBasePath}/styles/fonts.css`);
  try {
    if (!window.location.hostname.includes('localhost')) sessionStorage.setItem('fonts-loaded', 'true');
  } catch (e) {
    // do nothing
  }
}

/**
 * Replaces image icons with inline SVGs when they enter the viewport.
 */
export function swapIcons() {
  document.querySelectorAll('span.icon > img').forEach((icon) => {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(async (entry) => {
        if (entry.isIntersecting) {
          const resp = await fetch(icon.src);
          const temp = document.createElement('div');
          temp.innerHTML = await resp.text();
          const svg = temp.querySelector('svg');
          temp.remove();
          // check if svg has inline styles
          let style = svg.querySelector('style');
          if (style) style = style.textContent.toLowerCase().includes('currentcolor');
          let fill = svg.querySelector('[fill]');
          if (fill) fill = fill.getAttribute('fill').toLowerCase().includes('currentcolor');
          // replace image with SVG, ensuring color inheritance
          if ((style || fill) || (!style && !fill)) {
            const p = icon.closest('p');
            if (p) p.removeAttribute('class');
            icon.replaceWith(svg);
          }
          observer.disconnect();
        }
      });
    }, { threshold: 0 });
    observer.observe(icon);
  });
}

/**
 * Decorates links with appropriate classes to style them as buttons
 * @param {HTMLElement} main The main container element
 */
function decorateButtons(main) {
  main.querySelectorAll('p a[href]').forEach((a) => {
    a.title = a.title || a.textContent;
    const p = a.closest('p');
    // identify standalone links
    if (a.href !== a.textContent && p.textContent === a.textContent) {
      a.className = 'button';
      const strong = a.closest('strong');
      const em = a.closest('em');
      const double = !!strong && !!em;
      if (double) a.classList.add('accent');
      else if (strong) a.classList.add('emphasis');
      else if (em) a.classList.add('outline');
      p.innerHTML = a.outerHTML;
      p.className = 'button-wrapper';
    }
  });
}

function decorateImages(main) {
  main.querySelectorAll('p img').forEach((img) => {
    const p = img.closest('p');
    p.className = 'img-wrapper';
  });
}

function updateGuideTemplateStyleBasedOnHero() {
  const isHeroContentExist = document.querySelector(
    '.guides-template .section.heading',
  );

  if (isHeroContentExist) {
    document.querySelector('main').classList.add('has-full-width-hero');
    const cardListBlocks = document.querySelectorAll('.block.card-list');
    // make card list in main category page has '.image-card-listing' class
    cardListBlocks.forEach((block) => block.classList.add('image-card-listing'));
  } else {
    document.querySelector('main').classList.add('without-full-width-hero');
  }
}

export function setUpSideNav(main, aside) {
  const sideNav = buildBlock('side-navigation', '');
  aside.append(sideNav);
  main.insertBefore(aside, main.querySelector('.section.content'));
  updateGuideTemplateStyleBasedOnHero();
  decorateBlock(sideNav);
  return loadBlock(sideNav);
}

async function loadHighlightLibrary() {
  const highlightCSS = createTag('link', {
    rel: 'stylesheet',
    href: '/libs/highlight/atom-one-dark.min.css',
  });
  document.head.append(highlightCSS);

  await loadScript('/libs/highlight/highlight.min.js');
  const initScript = createTag('script', {}, 'hljs.highlightAll();');
  document.body.append(initScript);
}

export async function decorateGuideTemplateCodeBlock() {
  const firstCodeBlock = document.querySelector('pre code');
  if (!firstCodeBlock) return;

  const intersectionObserver = new IntersectionObserver(
    (entries, observer) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          observer.unobserve(entry.target);
          loadHighlightLibrary();
        }
      });
    },
    {
      root: null,
      rootMargin: '200px', // Adjust rootMargin as needed to trigger intersection at the desired position before the codeblock becomes visible
      threshold: 0,
    },
  );

  // when first codeblock is coming into view, load highlight.js for page
  intersectionObserver.observe(firstCodeBlock);
}

function decorateLinks(main) {
  main.querySelectorAll('a').forEach((a) => {
    if (!a.href) return; // Skip anchors without href
    try {
      const url = new URL(a.href);
      if (url.hostname === 'tools.aem.live') {
        a.href = url.pathname;
      }
    } catch (e) {
      // Skip invalid URLs
    }
  });
}

/**
 * Decorates the main element.
 * @param {Element} main The main element
 */
// eslint-disable-next-line import/prefer-default-export
export function decorateMain(main) {
  decorateIcons(main);
  decorateImages(main);
  decorateLinks(main);
  decorateSections(main);
  decorateBlocks(main);
  decorateButtons(main);
}

async function toolReady() {
  const isToolPage = window.location.pathname.includes('/tools/') && window.location.pathname.endsWith('.html');
  if (isToolPage) {
    try {
      const toolScript = [...document.querySelectorAll('script')].find((s) => {
        if (s.src && s.src.includes('/tools/')) {
          const toolName = s.src.split('/tools/').pop().split('/')[0];
          return s.src.endsWith(`${toolName}.js`) || s.src.endsWith('scripts.js');
        }

        return false;
      });
      if (toolScript) {
        const mod = await import(toolScript.src);
        if (mod && mod.ready) {
          return mod.ready();
        }
      }
    } catch {
      // do nothing
    }
  }

  return Promise.resolve();
}

/**
 * Loads everything needed to get to LCP.
 * @param {Element} doc The container element
 */
async function loadEager(doc) {
  document.documentElement.lang = 'en';
  decorateTemplateAndTheme();
  const main = doc.querySelector('main');
  if (main) {
    decorateMain(main);
    document.body.classList.add('appear');
    await loadSection(main.querySelector('.section'), waitForFirstImage);
    await toolReady();
  }

  try {
    /* if desktop (proxy for fast connection) or fonts already loaded, load fonts.css */
    if (window.innerWidth >= 900 || sessionStorage.getItem('fonts-loaded')) {
      loadFonts();
    }
  } catch (e) {
    // do nothing
  }
}

/**
 * Loads everything that doesn't need to be delayed.
 * @param {Element} doc The container element
 */
async function loadLazy(doc) {
  const main = doc.querySelector('main');
  await loadSections(main);

  const { hash } = window.location;
  const element = hash ? doc.getElementById(hash.substring(1)) : false;
  if (hash && element) element.scrollIntoView();

  loadHeader(doc.querySelector('header'));
  loadFooter(doc.querySelector('footer'));

  loadCSS(`${window.hlx.codeBasePath}/styles/lazy-styles.css`);
  loadFonts();
  swapIcons(main);

  if (getMetadata('supressframe')) {
    doc.querySelector('header').remove();
    doc.querySelector('footer').remove();
  } else {
    // breadcrumb setup
    // loadBreadcrumb(main);
    // sidebar + related style setup
    const aside = main.querySelector('main > aside');
    if (aside) setUpSideNav(main, aside);
    decorateGuideTemplateCodeBlock();
  }
}

/**
 * Loads everything that happens a lot later,
 * without impacting the user experience.
 */
function loadDelayed() {
  // eslint-disable-next-line import/no-cycle
  window.setTimeout(() => import('./delayed.js'), 3000);
  // load anything that can be postponed to the latest here
}

async function loadPage() {
  await loadEager(document);
  await loadLazy(document);
  loadDelayed();
}

loadPage();
