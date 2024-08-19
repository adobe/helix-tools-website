/* eslint-disable class-methods-use-this */
import { buildModal } from '../../scripts/scripts.js';
import { decorateIcons } from '../../scripts/aem.js';

// utility functions
function getFormData(form) {
  const data = {};
  [...form.elements].forEach((field) => {
    const { name, type, value } = field;
    if (name && type && value) {
      switch (type) {
        case 'number':
        case 'range':
          data[name] = parseFloat(value, 10);
          break;
        case 'date':
        case 'datetime-local':
          data[name] = new Date(value);
          break;
        case 'checkbox':
          if (field.checked) {
            if (data[name]) data[name].push(value);
            else data[name] = [value];
          }
          break;
        case 'radio':
          if (field.checked) data[name] = value;
          break;
        case 'url':
          data[name] = new URL(value);
          break;
        case 'file':
          data[name] = field.files;
          break;
        default:
          data[name] = value;
      }
    }
  });
  return data;
}

function extractUrlType(url) {
  const { hostname, pathname } = new URL(url);
  const aemHosts = ['hlx.page', 'hlx.live', 'aem.page', 'aem.live'];
  const aemSite = aemHosts.find((h) => hostname.endsWith(h));
  if (pathname.endsWith('.xml')) return 'sitemap';
  if (pathname.includes('robots.txt')) return 'robots';
  if (aemSite || hostname.includes('github')) {
    return 'write sitemap';
  }
  return false;
}

function writeSitemapUrl(url) {
  const { hostname, pathname } = new URL(url);
  const aemHosts = ['hlx.page', 'hlx.live', 'aem.page', 'aem.live'];
  const aemSite = aemHosts.find((h) => hostname.endsWith(h));
  if (aemSite) {
    const [ref, repo, owner] = hostname.replace(`.${aemSite}`, '').split('--');
    return `https://${ref}--${repo}--${owner}.${aemSite.split('.')[0]}.live/sitemap.xml`;
  }
  if (hostname.includes('github')) {
    const [owner, repo] = pathname.split('/').filter((p) => p);
    return `https://main--${repo}--${owner}.hlx.live/sitemap.xml`;
  }
  return null;
}

async function findSitemapUrl(url) {
  const req = await fetch(url);
  if (req.ok) {
    const text = await req.text();
    const lines = text.split('\n');
    const sitemapLine = lines.find((line) => line.startsWith('Sitemap'));
    return sitemapLine ? sitemapLine.split(' ')[1] : null;
  }
  return null;
}

/**
 * Fetches URLs from a sitemap.
 * @param {string} sitemap - URL of the sitemap to fetch.
 * @returns {Promise<Object[]>} - Promise that resolves to an array of URL objects.
 */
async function fetchSitemap(sitemap) {
  const req = await fetch(sitemap);
  if (req.ok) {
    const text = await req.text();
    const xml = new DOMParser().parseFromString(text, 'text/xml');

    // check for nested sitemaps and recursively fetch them
    if (xml.querySelector('sitemap')) {
      const sitemaps = [...xml.querySelectorAll('sitemap loc')];
      const allUrls = [];
      // eslint-disable-next-line no-restricted-syntax
      for (const loc of sitemaps) {
        const { href, origin } = new URL(loc.textContent.trim());
        const originSwapped = href.replace(origin, sitemap.origin);
        // eslint-disable-next-line no-await-in-loop
        const nestedUrls = await fetchSitemap(originSwapped);
        allUrls.push(...nestedUrls);
      }
      return allUrls;
    }
    if (xml.querySelector('url')) {
      const urls = [...xml.querySelectorAll('url loc')].map((loc) => {
        const { href, origin } = new URL(loc.textContent.trim());
        const originSwapped = href.replace(origin, sitemap.origin);
        const plain = `${originSwapped.endsWith('/') ? `${originSwapped}index` : originSwapped}.plain.html`;
        return { href: originSwapped, plain };
      });
      return urls;
    }
  }
  return [];
}

class RewrittenData {
  constructor(data) {
    this.data = data;
  }

  fileType(value) {
    if (!value) return 'Unknown file type';
    return `${value.toUpperCase()} image`;
  }

  site(value) {
    if (!value) return '-';
    const sites = value.map((site, i) => {
      const alt = this.data.alt[i];
      const a = `<a href="${new URL(site, this.data.origin).href}" target="_blank">${new URL(site).pathname}</a>`;
      return alt ? `<p>${a} (${alt})</p>` : `<p>${a}</p>`;
    });
    return sites.join(' ');
  }

  dimensions() {
    const { width, height } = this.data;
    if (!width && !height) return '-';
    return `${width || '-'} × ${height || '-'}`;
  }

  aspectRatio(value) {
    if (!value) return '-';
    const ar = (v, symbol) => `<i class="symbol symbol-${symbol.toLowerCase()}"></i> ${symbol} (${v})`;
    if (value === 1) return ar(value, 'Square');
    if (value < 1) return ar(value, 'Portrait');
    if (value > 1.7) return ar(value, 'Widescreen');
    return ar(value, 'Landscape');
  }

  src(value) {
    return `<img src="${new URL(value, this.data.origin).href}" />`;
  }

  // rewrite data based on key
  rewrite(keys) {
    keys.forEach((key) => {
      if (this[key]) {
        this.data[key] = this[key](this.data[key]);
      }
    });
  }
}

function getModalId(src) {
  if (src.includes('_')) {
    return src.split('_')[1].split('.')[0];
  }
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 15);
}

function displayModal(data) {
  let { id } = data;
  if (!id) {
    id = getModalId(data.src);
    const [modal, body] = buildModal();
    modal.id = id;
    data.id = id;
    const table = document.createElement('table');
    table.innerHTML = '<tbody></tbody>';
    const rows = {
      fileType: 'Kind',
      count: 'Appearances',
      site: 'Where',
      dimensions: 'Dimensions',
      aspectRatio: 'Aspect ratio',
      src: 'Preview',
    };
    // rewrite data for display
    const formattedData = new RewrittenData(data);
    formattedData.rewrite(Object.keys(rows));
    Object.keys(rows).forEach((key) => {
      if (formattedData.data[key]) {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${rows[key]}</td>
          <td>${formattedData.data[key]}</td>`;
        table.querySelector('tbody').append(tr);
      }
    });
    body.append(table);
    document.body.append(modal);
    modal.showModal();
  } else {
    const modal = document.getElementById(id);
    modal.showModal();
  }
}

function validateAlt(alt, count) {
  if (alt.length === 0 || alt.length !== count) return false;
  return true;
}

function displayImages(images) {
  const gallery = document.getElementById('image-gallery');
  images.forEach((data) => {
    const figure = document.createElement('figure');
    figure.dataset.alt = validateAlt(data.alt, data.count);
    figure.dataset.aspectRatio = data.aspectRatio;
    figure.dataset.count = data.count;
    // build image
    const { href } = new URL(data.src, data.origin);
    const img = document.createElement('img');
    img.dataset.src = href;
    img.width = data.width;
    img.height = data.height;
    img.loading = 'lazy';
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.timeoutId = setTimeout(() => {
            img.src = img.dataset.src;
            figure.addEventListener('click', () => {
              displayModal(data);
            });
            observer.disconnect();
          }, 500);
        } else {
          clearTimeout(entry.target.timeoutId);
        }
      });
    }, { threshold: 0 });
    observer.observe(figure);
    figure.append(img);
    // build info button
    const info = document.createElement('button');
    info.setAttribute('aria-label', 'More information');
    info.setAttribute('type', 'button');
    info.innerHTML = '<span class="icon icon-info"></span>';
    figure.append(info);
    // check for existing figure el with the same img src
    const existingImg = gallery.querySelector(`figure img[src="${href}"]`);
    if (existingImg) {
      const existingFigure = existingImg.parentElement;
      const existingCount = parseInt(existingFigure.dataset.count, 10);
      // if count has changed, replace existing figure with new one
      if (existingCount !== data.count) {
        gallery.replaceChild(figure, existingFigure);
      }
    } else gallery.append(figure);
  });
}

function findUniqueImages(data) {
  const unique = new Map();

  data.forEach((img) => {
    const {
      src, origin, site, alt, width, height, aspectRatio, fileType,
    } = img;
    // init new unique image
    if (!unique.has(src)) {
      unique.set(src, {
        src,
        origin,
        count: 0,
        site: [],
        alt: [],
        width,
        height,
        aspectRatio,
        fileType,
      });
    }
    // populate image entry
    const entry = unique.get(src);
    entry.count += 1;
    entry.site.push(site);
    entry.alt.push(alt);
  });

  return [...unique.values()];
}

/**
 * Fetches the HTML content of a page.
 * @param {string} url - URL of the page to fetch.
 * @returns {Promise<HTMLElement|null>} - Promise that resolves to HTML (or `null` if fetch fails).
 */
async function fetchPage(url) {
  const req = await fetch(url, { redirect: 'manual' });
  if (req.ok) {
    const temp = document.createElement('div');
    temp.innerHTML = await req.text();
    return temp;
  }
  return null;
}

/**
 * Fetches image data from a page URL.
 * @param {Object} url - URL object.
 * @returns {Promise<Object[]>} - Promise that resolves to an array of image data objects.
 */
async function fetchImageDataFromPage(url) {
  try {
    const html = await fetchPage(url.plain);
    if (html) {
      const images = html.querySelectorAll('img[src]');
      const imgData = [...images].map((img) => {
        const src = img.getAttribute('src').split('?')[0];
        const alt = img.getAttribute('alt') || '';
        const width = img.getAttribute('width') || img.naturalWidth;
        const height = img.getAttribute('height') || img.naturalHeight;
        const aspectRatio = parseFloat((width / height).toFixed(1)) || '';
        const fileType = src.split('.').pop();
        return {
          site: url.href,
          origin: new URL(url.href).origin,
          src,
          alt,
          width,
          height,
          aspectRatio,
          fileType,
        };
      });
      html.innerHTML = '';
      return imgData;
    }
    return [];
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(`unable to fetch ${url.href}:`, error);
    return [];
  }
}

/**
 * Fetches data from a batch of URLs.
 * @param {Object[]} batch - Array of URL objects to process in the current batch.
 * @param {number} concurrency - Number of concurrent fetches within the batch.
 * @returns {Promise<Object[]>} - Promise that resolves to an array of image data objects.
 */
async function fetchBatch(batch, concurrency) {
  const results = [];
  const tasks = [];

  for (let i = 0; i < concurrency; i += 1) {
    tasks.push((async () => {
      while (batch.length > 0) {
        // get the next URL from the batch
        const url = batch.shift();
        // eslint-disable-next-line no-await-in-loop
        const imgData = await fetchImageDataFromPage(url);
        results.push(...imgData);
      }
    })());
  }

  await Promise.all(tasks); // wait for all concurrent tasks to complete
  return results;
}

function updateCounter(el, increment, float = false) {
  const value = parseFloat(el.textContent, 10);
  const targetValue = increment ? value + increment : 0;
  el.textContent = float ? targetValue.toFixed(1) : Math.floor(targetValue);
}

/**
 * Fetches and display image data in batches.
 * @param {Object[]} urls - Array of URL objects.
 * @param {number} [batchSize = 50] - Number of URLs to fetch per batch.
 * @param {number} [delay = 2000] - Delay (in milliseconds) between each batch.
 * @param {number} [concurrency = 5] - Number of concurrent fetches within each batch.
 * @returns {Promise<Object[]>} - Promise that resolves to an array of image data objects.
 */
async function fetchAndDisplayBatches(urls, batchSize = 50, delay = 2000, concurrency = 5) {
  const data = [];
  const gallery = document.getElementById('image-gallery');
  gallery.innerHTML = '';

  // reset counters
  const imagesCounter = document.getElementById('images-counter');
  updateCounter(imagesCounter);
  const pagesCounter = document.getElementById('pages-counter');
  updateCounter(pagesCounter);
  const elapsed = document.getElementById('elapsed');
  updateCounter(elapsed);
  const timer = setInterval(() => updateCounter(elapsed, 0.1, true), 100);

  // initialize concurrent tasks
  for (let i = 0; i < urls.length; i += batchSize) {
    // get the next batch of URLs
    const batch = urls.slice(i, i + batchSize);
    updateCounter(pagesCounter, batch.length);
    // eslint-disable-next-line no-await-in-loop
    const batchData = await fetchBatch(batch, concurrency); // fetch the batch concurrently
    data.push(...batchData);

    // display images as they are fetched
    document.querySelector('main').dataset.canvas = true;
    const info = document.getElementById('info');
    info.removeAttribute('aria-hidden');

    // console.log(uniqueBatchData.length, 'out of', data.length);
    const uniqueBatchData = findUniqueImages(data);
    updateCounter(imagesCounter);
    updateCounter(imagesCounter, uniqueBatchData.length);
    displayImages(uniqueBatchData);
    decorateIcons(gallery);

    if (i + batchSize < urls.length) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => { // wait before continuing to the next batch
        setTimeout(resolve, delay);
      });
    }
  }

  clearInterval(timer);
  return data;
}

async function processForm(sitemap) {
  const urls = await fetchSitemap(sitemap);
  // await fetchAndDisplayBatches(urls.slice(8000, 8100));
  await fetchAndDisplayBatches(urls);
}

function registerListeners(doc) {
  const URL_FORM = doc.getElementById('site-form');
  // const URL_FIELD = URL_FORM.querySelector('#site-url');
  const CANVAS = doc.getElementById('canvas');
  const GALLERY = CANVAS.querySelector('.gallery');
  const ACTION_BAR = CANVAS.querySelector('.action-bar');
  const ACTIONS = ACTION_BAR.querySelectorAll('button');
  const APPEARANCES_SORT = doc.getElementById('sort-count');
  const ASPECTRATIO_SORT = doc.getElementById('sort-aspect');

  URL_FORM.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = getFormData(e.srcElement);
    const url = data['site-url'];
    const urlType = extractUrlType(url);
    if (urlType.includes('sitemap')) {
      // fetch sitemap
      const sitemap = urlType === 'sitemap' ? url : writeSitemapUrl(url);
      processForm(sitemap);
    } else if (urlType === 'robots') {
      // parse robots.txt
      const sitemap = await findSitemapUrl(url);
      if (sitemap) processForm(sitemap);
    }
  });

  APPEARANCES_SORT.addEventListener('click', () => {
    const selected = APPEARANCES_SORT.getAttribute('aria-selected') === 'true';
    if (!selected) {
      ACTIONS.forEach((action) => action.setAttribute('aria-selected', false));
      APPEARANCES_SORT.setAttribute('aria-selected', true);
      const figures = [...GALLERY.querySelectorAll('figure')];
      const sorted = figures.sort((a, b) => {
        const countA = parseInt(a.getAttribute('data-count'), 10);
        const countB = parseInt(b.getAttribute('data-count'), 10);
        return countB - countA;
      });
      GALLERY.append(...sorted);
    }
  });

  ASPECTRATIO_SORT.addEventListener('click', () => {
    const selected = ASPECTRATIO_SORT.getAttribute('aria-selected') === 'true';
    if (!selected) {
      ACTIONS.forEach((action) => action.setAttribute('aria-selected', false));
      ASPECTRATIO_SORT.setAttribute('aria-selected', true);
      const figures = [...GALLERY.querySelectorAll('figure')];
      const sorted = figures.sort((a, b) => {
        const aspectA = parseFloat(a.getAttribute('data-aspect-ratio'), 10);
        const aspectB = parseFloat(b.getAttribute('data-aspect-ratio'), 10);
        return aspectB - aspectA;
      });
      GALLERY.append(...sorted);
    }
  });
}

registerListeners(document);
