import { createOptimizedPicture } from '../../scripts/aem.js';

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

function handleSearchInput(e) {
  const searchValue = e.target.value.trim().toLowerCase();
  const ul = e.target.closest('.tool-catalog').querySelector('ul');
  const items = ul.querySelectorAll(':scope > li');
  items.forEach((li) => {
    const text = li.querySelector('.cards-card-body')?.textContent.toLowerCase() || '';
    li.hidden = searchValue && !text.includes(searchValue);
  });
  const hasVisible = [...items].some((li) => !li.hidden);
  if (!hasVisible) {
    items.forEach((li) => { li.hidden = false; });
  }
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

  // add search form
  const searchForm = document.createElement('form');
  searchForm.innerHTML = `
    <div class="form-field">
      <input type="text" placeholder="Filter tools.." name="search" id="search" aria-label="Filter">
    </div>
  `;
  block.prepend(searchForm);

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

  observeLabStatus(ul);
}
