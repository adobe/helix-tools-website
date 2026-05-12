import { createOptimizedPicture } from '../../scripts/aem.js';
import { matchesCategory, matchesSearch, parseCategoryFromUrl } from './filter.js';

const labCache = new Map();

async function isLabTool(url) {
  if (labCache.has(url)) return labCache.get(url);
  try {
    const resp = await fetch(url);
    if (!resp.ok) return false;
    const html = await resp.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const isLab = doc.querySelector('meta[name="lab"][content="true"]') !== null;
    labCache.set(url, isLab);
    return isLab;
  } catch {
    return false;
  }
}

function observeLabStatus(ul) {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      const li = entry.target;
      observer.unobserve(li);
      const link = li.querySelector('a[href]');
      if (!link) return;
      isLabTool(link.href).then((isLab) => {
        if (isLab) {
          const ribbon = document.createElement('span');
          ribbon.className = 'cards-card-lab';
          ribbon.textContent = 'Experimental';
          li.prepend(ribbon);
        }
      });
    });
  }, { rootMargin: '200px' });

  ul.querySelectorAll(':scope > li').forEach((li) => observer.observe(li));
}

function refreshEmptyState(ul) {
  const hasVisible = [...ul.querySelectorAll(':scope > li')].some((li) => !li.hidden);
  const empty = ul.closest('.tool-catalog')?.querySelector('.tool-catalog-empty');
  if (empty) empty.hidden = hasVisible;
}

function applyCategoryFilter(ul, slug) {
  const map = window.toolCategories || {};
  ul.querySelectorAll(':scope > li').forEach((li) => {
    const a = li.querySelector('a[href]');
    if (!a) return;
    const path = new URL(a.getAttribute('href'), window.location.origin).pathname;
    li.dataset.categoryHidden = matchesCategory(path, slug, map) ? '' : 'true';
    li.hidden = li.dataset.categoryHidden === 'true' || li.dataset.searchHidden === 'true';
  });
  refreshEmptyState(ul);
}

function handleSearchInput(e) {
  const query = e.target.value;
  const ul = e.target.closest('.tool-catalog').querySelector('ul');
  ul.querySelectorAll(':scope > li').forEach((li) => {
    const text = li.querySelector('.cards-card-body')?.textContent || '';
    li.dataset.searchHidden = matchesSearch(text, query) ? '' : 'true';
    li.hidden = li.dataset.searchHidden === 'true' || li.dataset.categoryHidden === 'true';
  });
  refreshEmptyState(ul);
}

export default async function decorate(block) {
  // convert cards to list and list items
  const ul = document.createElement('ul');
  [...block.children].forEach((row) => {
    const li = document.createElement('li');
    li.append(...row.children);
    [...li.children].forEach((div) => {
      if (div.children.length === 1 && div.querySelector('picture')) div.className = 'cards-card-image';
      else div.className = 'cards-card-body';
    });
    ul.append(li);
  });
  // decorate card content
  ul.querySelectorAll('img').forEach((img) => img.closest('picture').replaceWith(
    createOptimizedPicture(img.src, img.alt, false, [{ width: '750' }]),
  ));
  ul.querySelectorAll(':scope > li a[href]:first-of-type').forEach((a) => {
    const li = a.closest('li');
    li.className = 'cards-card-linked';
    li.addEventListener('click', () => a.click());
  });
  block.replaceChildren(ul);

  // add toolbar (tabs + search) above the grid
  const toolbar = document.createElement('div');
  toolbar.className = 'tool-catalog-toolbar';

  const tabBar = document.createElement('nav');
  tabBar.className = 'tool-catalog-tabs';
  tabBar.setAttribute('role', 'tablist');
  tabBar.setAttribute('aria-label', 'Tool categories');

  const searchForm = document.createElement('form');
  searchForm.className = 'tool-catalog-search';
  searchForm.innerHTML = `
    <div class="form-field">
      <input type="text" placeholder="Search tools..." name="search" id="search" aria-label="Filter">
    </div>
  `;

  toolbar.append(tabBar, searchForm);
  block.prepend(toolbar);

  const emptyMessage = document.createElement('p');
  emptyMessage.className = 'tool-catalog-empty';
  emptyMessage.textContent = 'No results found.';
  emptyMessage.hidden = true;
  block.append(emptyMessage);

  const searchInput = searchForm.querySelector('input');
  // Debounce function
  function debounce(fn, delay) {
    let timeoutId;
    return (...args) => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => fn(...args), delay);
    };
  }

  searchInput.addEventListener('input', debounce(handleSearchInput, 200));

  function renderTabs(active) {
    const categoriesMap = window.toolCategories || {};
    const slugs = ['all', ...Object.keys(categoriesMap)];
    const totalCount = Object.values(categoriesMap)
      .reduce((n, c) => n + (c.tools?.length ?? 0), 0);
    tabBar.replaceChildren();
    slugs.forEach((slug) => {
      const tab = document.createElement('a');
      tab.className = 'tool-catalog-tab';
      tab.setAttribute('role', 'tab');
      tab.dataset.category = slug;
      tab.href = slug === 'all' ? window.location.pathname : `${window.location.pathname}?category=${encodeURIComponent(slug)}`;
      const isActive = slug === active;
      tab.classList.toggle('is-active', isActive);
      tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
      const label = slug === 'all' ? 'All' : (categoriesMap[slug]?.label ?? slug);
      const count = slug === 'all' ? totalCount : (categoriesMap[slug]?.tools?.length ?? 0);
      tab.textContent = `${label} (${count})`;
      tab.addEventListener('click', (e) => {
        e.preventDefault();
        const url = new URL(window.location);
        if (slug === 'all') url.searchParams.delete('category');
        else url.searchParams.set('category', slug);
        window.history.pushState({}, '', url);
        renderTabs(slug);
        applyCategoryFilter(ul, slug === 'all' ? null : slug);
      });
      tabBar.append(tab);
    });
  }

  observeLabStatus(ul);

  const initialSlug = parseCategoryFromUrl(window.location.href);
  const renderAndApply = () => {
    const slug = parseCategoryFromUrl(window.location.href) || 'all';
    renderTabs(slug);
    applyCategoryFilter(ul, slug === 'all' ? null : slug);
  };
  if (window.toolCategories) {
    renderTabs(initialSlug || 'all');
    applyCategoryFilter(ul, initialSlug);
  } else {
    window.addEventListener('tools:categories-ready', renderAndApply, { once: true });
  }
  window.addEventListener('popstate', renderAndApply);
}
