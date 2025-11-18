/* eslint-disable no-restricted-syntax */
/* eslint-disable class-methods-use-this */
import { buildModal } from '../../scripts/scripts.js';
import { decorateIcons } from '../../scripts/aem.js';
import { initConfigField } from '../../utils/config/config.js';
/* reporting utilities */
/**
 * Generates sorted array of audit report rows.
 * @returns {Object[]} Sorted array of report rows.
 */
function writeReportRows() {
  const unique = window.audit;
  const entries = [];
  unique.forEach((image) => {
    if (image && image.site) {
      image.site.forEach((site, i) => {
        entries.push({
          Site: site,
          'Image Source': new URL(image.src, image.origin).href,
          'Alt Text': image.alt[i],
        });
      });
    }
  });
  // sort the entries array alphabetically by the 'Site' property
  const sorted = entries.sort((a, b) => a.Site.localeCompare(b.Site));
  return sorted;
}

/**
 * Converts report rows into a CSV Blob.
 * @param {Object[]} rows - Array of report rows to be converted.
 * @returns {Blob|null} Blob representing the CSV data.
 */
function generateCSV(rows) {
  if (rows.length === 0) return null;
  // write the CSV column headers using the keys from the first row object
  const headers = `${Object.keys(rows[0]).join(',')}\n`;
  // convert the rows into a single string separated by newlines
  const csv = headers + rows.map((row) => Object.values(row).map((value) => {
    const escape = (`${value}`).replace(/"/g, '""'); // escape quotes
    return `"${escape}"`;
  }).join(',')).join('\n');
  // create a Blob from the CSV string
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  return blob;
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
/* modal utilities */
/**
 * Generates a unique ID for a modal based on the image source URL.
 * @param {string} src - Source URL of the image.
 * @returns {string} Generated or extracted modal ID.
 */
function getModalId(src) {
  if (src.includes('_')) return src.split('_')[1].split('.')[0];
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 15);
}

/**
 * Displays (and creates) a modal with image information.
 * @param {HTMLElement} figure - Figure element representing the image.
 */
function displayModal(figure) {
  const { src } = figure.querySelector(':scope > img[data-src]').dataset;
  const id = getModalId(src);
  // check if a modal with this ID already exists
  let modal = document.getElementById(id);
  if (!modal) {
    // build new modal
    const [newModal, body] = buildModal();
    newModal.id = id;
    modal = newModal;
    // define and populate modal content
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
    // format data for display
    const data = window.audit.find((img) => src.includes(img.src.slice(2)));
    if (!data) return;
    const formattedData = new RewrittenData(data);
    formattedData.rewrite(Object.keys(rows));
    Object.keys(rows).forEach((key) => {
      if (formattedData.data[key]) {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${rows[key]}</td><td>${formattedData.data[key]}</td>`;
        table.querySelector('tbody').append(tr);
      }
    });
    body.append(table);
    document.body.append(modal);
  }
  modal.showModal();
}
/* image processing and display */
/**
 * Validates that every image in an array has alt text.
 * @param {string[]} alt - Array of alt text strings associated with the image.
 * @param {number} count - Expected number of alt text entries (equal to the number of appearances).
 * @returns {boolean} `true` if the alt text is valid, `false` otherwise.
 */
function validateAlt(alt, count) {
  if (alt.length === 0 || alt.length !== count) return false;
  if (alt.some((item) => item === '')) return false;
  return true;
}

/**
 * Filters out duplicate images and compiles unique image data.
 * @param {Object[]} data - Array of image data objects.
 * @returns {Object[]} Array of unique image data objects.
 */
function findUniqueImages(data) {
  // use a map to track unique images by their src attribute
  const unique = new Map();
  data.forEach((img) => {
    const {
      src, origin, site, alt, width, height, aspectRatio, fileType,
    } = img;
    // if the image src is not already in the map, init a new entry
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
    // update the existing entry with additional image data
    const entry = unique.get(src);
    entry.count += 1;
    entry.site.push(site);
    entry.alt.push(alt);
  });
  // convert the map values to an array
  return [...unique.values()];
}

/**
 * Displays a collection of images in the gallery.
 * @param {Object[]} images - Array of image data objects to be displayed.
 */
function displayImages(images) {
  const gallery = document.getElementById('image-gallery');
  images.forEach((data) => {
    // create a new figure to hold the image and its metadata
    const figure = document.createElement('figure');
    figure.dataset.alt = validateAlt(data.alt, data.count);
    figure.dataset.altText = data.alt.join(' ');
    figure.dataset.pages = data.site.join(' ');
    figure.dataset.aspect = data.aspectRatio;
    figure.dataset.count = data.count;
    // build image
    const { href } = new URL(data.src, data.origin);
    const img = document.createElement('img');
    img.dataset.src = href;
    img.width = data.width;
    img.height = data.height;
    img.loading = 'lazy';
    figure.append(img);
    // load the image when it comes into view
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.timeoutId = setTimeout(() => {
            img.src = img.dataset.src;
            observer.disconnect();
          }, 500); // delay image loading
        } else {
          // cancel loading delay if image is scrolled out of view
          clearTimeout(entry.target.timeoutId);
        }
      });
    }, { threshold: 0 });
    observer.observe(figure);
    // build info button
    const info = document.createElement('button');
    info.setAttribute('aria-label', 'More information');
    info.setAttribute('type', 'button');
    info.innerHTML = '<span class="icon icon-info"></span>';
    figure.append(info);
    // check if image already exists in the gallery
    const existingImg = gallery.querySelector(`figure img[src="${href}"], figure [data-src="${href}"]`);
    if (existingImg) {
      const existingFigure = existingImg.parentElement;
      const existingCount = parseInt(existingFigure.dataset.count, 10);
      if (existingCount !== data.count) {
        // if count has changed, replace existing figure with the new one
        gallery.replaceChild(figure, existingFigure);
      }
    } else gallery.append(figure);
  });
}
/**
 * Fetches the HTML content of a page.
 * @param {string} url - URL of the page to fetch.
 * @returns {Promise<HTMLElement|null>} - Promise that resolves to HTML (or `null` if fetch fails).
 */
async function fetchPage(url) {
  const req = await fetch(`https://little-forest-58aa.david8603.workers.dev/?url=${encodeURIComponent(url)}`, { redirect: 'manual' });
  if (req.ok) {
    const html = await req.text();
    return new DOMParser().parseFromString(html, 'text/html');
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
    const pageUrl = url.href;
    const html = await fetchPage(pageUrl);
    if (html) {
      const images = html.querySelectorAll('img[src]');
      const imgData = [...images].map((img) => {
        const originURL = new URL(img.getAttribute('src'), pageUrl);
        const src = originURL.href.replace('format=jpeg', 'format=webply').replace('format=png', 'format=webply');
        const alt = img.getAttribute('alt') || '';
        const width = img.getAttribute('width') || img.naturalWidth;
        const height = img.getAttribute('height') || img.naturalHeight;
        const aspectRatio = parseFloat((width / height).toFixed(1)) || '';
        const fileType = src.split('.').pop().split('?')[0];
        return {
          site: pageUrl,
          origin: new URL(pageUrl).origin,
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
 * Updates the numeric content of an HTML element by a specified increment.
 * @param {HTMLElement} counter - Counter whose text content will be updated.
 * @param {number} increment - Amount to increment the current value by.
 * @param {boolean} [float=false] - Check if counter will be updated by a float or an integer.
 */
function updateCounter(counter, increment, float = false) {
  const value = parseFloat(counter.textContent, 10);
  // calculate the new value (or reset to 0 if no increment is provided)
  const targetValue = increment ? value + increment : 0;
  counter.textContent = float ? targetValue.toFixed(1) : Math.floor(targetValue);
}
async function fetchAndDisplayImages(url) {
  const data = [];
  const main = document.querySelector('main');
  const results = document.getElementById('audit-results');
  const download = results.querySelector('button');
  download.disabled = true;
  const gallery = document.getElementById('image-gallery');

  // reset counters

  const pagesCounter = document.getElementById('pages-counter');
  updateCounter(pagesCounter, 1);

  const imgData = await fetchImageDataFromPage(url);
  data.push(...imgData);

  // display images as they are fetched
  main.dataset.canvas = true;
  results.removeAttribute('aria-hidden');

  const uniqueBatchData = findUniqueImages(data);
  window.audit.push(...uniqueBatchData);
  const imagesCounter = document.getElementById('images-counter');
  imagesCounter.textContent = parseInt(imagesCounter.textContent, 10) + uniqueBatchData.length;
  displayImages(uniqueBatchData);
  decorateIcons(gallery);
  data.length = 0;
  download.disabled = false;
  return data;
}

/* form utilities */
/**
 * Fetches form data from a form element.
 * @param {HTMLFormElement} form - Form element to fetch data from.
 * @returns {Object} Object with form data.
 */
function getFormData(form) {
  const data = {};
  [...form.elements].forEach((field) => {
    const { name, type } = field;
    const value = !field.value && field.dataset.defaultValue
      ? field.dataset.defaultValue : field.value;
    if (name && type && value) {
      switch (type) {
        // parse number and range as floats
        case 'number':
        case 'range':
          data[name] = parseFloat(value, 10);
          break;
        // convert date and datetime-local to date objects
        case 'date':
        case 'datetime-local':
          data[name] = new Date(value);
          break;
        // store checked checkbox values in array
        case 'checkbox':
          if (field.checked) {
            if (data[name]) data[name].push(value);
            else data[name] = [value];
          }
          break;
        // only store checked radio
        case 'radio':
          if (field.checked) data[name] = value;
          break;
        // convert url to url object
        case 'url':
          data[name] = new URL(value);
          break;
        // store file filelist objects
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

/**
 * Enables all form elements.
 * @param {HTMLFormElement} form - Form element to enable.
 */
function enableForm(form) {
  [...form.elements].forEach((el) => {
    el.disabled = false;
  });
}

/**
 * Disables all form elements.
 * @param {HTMLFormElement} form - Form element to disable.
 */
function disableForm(form) {
  [...form.elements].forEach((el) => {
    el.disabled = true;
  });
}
/* fetching data */

/**
 * Fetches URLs from a sitemap.
 * @param {string} sitemap - URL of the sitemap to fetch.
 * @returns {Promise<Object[]>} - Promise that resolves to an array of URL objects.
 */
async function* fetchSitemap(sitemapURL) {
  const fetchUrl = `https://little-forest-58aa.david8603.workers.dev/?url=${encodeURIComponent(sitemapURL)}`;
  const res = await fetch(fetchUrl);
  if (!res.ok) {
    if (res.status === 404) throw new Error(`Not found: ${sitemapURL}`);
    throw new Error('Failed on initial fetch of sitemap.', res.status);
  }

  const xml = await res.text();

  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, 'application/xml');

  const sitemapLocs = doc.querySelectorAll('sitemap > loc');
  for (let i = 0; i < sitemapLocs.length; i += 1) {
    const loc = sitemapLocs[i];
    const liveUrl = new URL(loc.textContent);
    const resucrsiveResults = fetchSitemap(liveUrl);
    // eslint-disable-next-line no-restricted-syntax, no-await-in-loop
    for await (const url of resucrsiveResults) {
      yield url;
    }
  }

  const urlLocs = doc.querySelectorAll('url > loc');
  for (let i = 0; i < urlLocs.length; i += 1) {
    const loc = urlLocs[i];
    const url = new URL(loc.textContent);
    yield url;
  }
}

async function* fetchFromRobotsTxt(origin) {
  const fullOrigin = origin.includes('/') ? origin : `https://${origin}/`;
  const robotsTxtUrl = `https://little-forest-58aa.david8603.workers.dev/?url=${encodeURIComponent(fullOrigin)}robots.txt`;
  const robotsTxt = await fetch(robotsTxtUrl);
  const text = await robotsTxt.text();
  const lines = text.split('\n');
  for (const line of lines) {
    if (line.startsWith('Sitemap:')) {
      const sitemapUrl = line.split('Sitemap:')[1].trim();
      yield* fetchSitemap(sitemapUrl);
    }
  }
}

/**
 * Fetches URLs from a query index.
 * @param {string} indexUrl - URL of the query index.
 * @returns {AsyncGenerator<URL>} - Async generator of URLs.
 */
async function* fetchQueryIndex(indexUrl) {
  const limit = 512;
  let offset = 0;
  let more = true;

  do {
    let res;
    try {
      // eslint-disable-next-line no-await-in-loop
      res = await fetch(`https://little-forest-58aa.david8603.workers.dev/?url=${encodeURIComponent(indexUrl)}?offset=${offset}&limit=${limit}`);
    } catch (err) {
      throw new Error('Failed on initial fetch of index.', err);
    }

    if (!res.ok) {
      throw new Error(`Not found: ${indexUrl}`);
    }
    // eslint-disable-next-line no-await-in-loop
    const json = await res.json();
    offset += limit;
    more = json.data.length > 0;
    for (let i = 0; i < json.data.length; i += 1) {
      const item = json.data[i];
      const path = item.path || item.Path;
      const url = new URL(path, indexUrl);
      yield url;
    }
  } while (more);
}

/**
 * Updates the error message and title in the error wrapper.
 * @param {HTMLElement} errorWrapper - The error wrapper element.
 * @param {number} errCode - The error code.
 * @param {string} org - The organization name.
 * @param {string} site - The site name.
 * @param {string} [sitemap] - The sitemap path.
 */
function updateError(errorWrapper, errCode, org, site, sitemap) {
  const errorTitle = errorWrapper.querySelector('.error-title');
  const errorMsg = errorWrapper.querySelector('.error-msg');
  const { title, msg } = (() => {
    switch (errCode) {
      case 401:
        return {
          title: '401 Unauthorized Error',
          msg: `Unable to display results. <a target="_blank" href="https://main--${site}--${org}.aem.page">Sign in to the ${site} project sidekick</a> to view the results.`,
        };
      case 404:
        return {
          title: '404 Not Found Error',
          msg: `<a target="_blank" href="https://main--${site}--${org}.aem.live${sitemap}">${sitemap}</a> is not found. Ensure your sitemap / query index path is correct.`,
        };
      case 499:
        return {
          title: 'Initial Fetch Failed',
          msg: `This is likely due to CORS. Either use a CORS allow plugin or add a header <code>Access-Control-Allow-Origin: ${window.location.origin}</code> in your site config.`,
        };
      default:
        return {
          title: 'Error',
          msg: 'Unable to display results. Please check the console for more information.',
        };
    }
  })();
  errorWrapper.setAttribute('aria-hidden', 'false');
  errorTitle.textContent = title;
  errorMsg.innerHTML = msg;
}

function registerListeners(doc) {
  const form = doc.getElementById('search-form');
  const errorWrapper = doc.querySelector('.error-wrapper');
  const errorTitle = errorWrapper.querySelector('.error-title');
  const errorMsg = errorWrapper.querySelector('.error-msg');
  const canvas = doc.getElementById('canvas');
  const gallery = canvas.querySelector('.gallery');
  const downloadReport = doc.getElementById('download-report');
  const actionbar = canvas.querySelector('.action-bar');
  const sortActions = actionbar.querySelectorAll('input[name="sort"]');
  const filterActions = actionbar.querySelectorAll('input[name="filter"]');
  const imagesCounter = document.getElementById('images-counter');
  const pagesCounter = document.getElementById('pages-counter');

  /**
   * Handles admin form submission.
   * @param {Event} e - Submit event
   */

  // handle form submission
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    disableForm(form);
    errorWrapper.setAttribute('aria-hidden', 'true');
    errorTitle.textContent = 'Error';
    errorMsg.textContent = '';
    gallery.innerHTML = '';
    const elapsed = document.getElementById('elapsed');
    updateCounter(elapsed);
    const timer = setInterval(() => updateCounter(elapsed, 0.1, true), 100);
    // clear all sorting and filters
    // eslint-disable-next-line no-return-assign
    [...sortActions, ...filterActions].forEach((action) => action.checked = false);
    const {
      url, path,
    } = getFormData(form);

    window.history.pushState({}, '', `${window.location.pathname}?url=${encodeURIComponent(url)}&path=${encodeURIComponent(path)}`);

    try {
      let sitemapUrls;
      if (url.endsWith('.json')) sitemapUrls = fetchQueryIndex(url);
      if (url.endsWith('.xml')) sitemapUrls = fetchSitemap(url);
      if (url.endsWith('/') || !url.includes('/')) sitemapUrls = fetchFromRobotsTxt(url);

      imagesCounter.textContent = 0;
      pagesCounter.textContent = 0;
      window.audit = [];
      for await (const sitemapUrl of sitemapUrls) {
        if (sitemapUrl.pathname.startsWith(path)) {
          await fetchAndDisplayImages(sitemapUrl);
        }
      }
      clearInterval(timer);
    } catch (err) {
      clearInterval(timer);
      // eslint-disable-next-line no-console
      console.error(err.message);
      if (err.message.startsWith('Failed to fetch')) {
        updateError(errorWrapper, 499, url);
      } else if (err.message.startsWith('Not found')) {
        updateError(errorWrapper, 404, url);
      } else {
        updateError(errorWrapper, 500, url);
      }
    } finally {
      clearInterval(timer);
      enableForm(form);
    }
  });

  form.addEventListener('reset', () => {
    errorWrapper.setAttribute('aria-hidden', 'true');
  });
  // handle gallery clicks to display modals
  gallery.addEventListener('click', (e) => {
    const figure = e.target.closest('figure');
    if (figure) displayModal(figure);
  });

  // handle csv report download
  downloadReport.addEventListener('click', () => {
    const rows = writeReportRows();
    if (rows[0]) {
      const siteName = new URL(rows[0].Site).hostname.split('.')[0];
      const csv = generateCSV(rows);
      const link = document.createElement('a');
      const url = URL.createObjectURL(csv);
      // insert link to enable download
      link.setAttribute('href', url);
      link.setAttribute('download', `${siteName}_image_audit_report.csv`);
      link.style.display = 'none';
      downloadReport.insertAdjacentElement('afterend', link);
      link.click();
      link.remove();
    }
  });

  sortActions.forEach((action) => {
    action.addEventListener('click', (e) => {
      const { target } = e;
      const type = target.value;
      // get the current sort order (1 for ascending, -1 for descending)
      const sortOrder = parseInt(target.dataset.order, 10);
      const figures = [...gallery.querySelectorAll('figure')];
      // sort figures based on selected type and order
      const sorted = figures.sort((a, b) => {
        const aVal = parseFloat(a.dataset[type], 10);
        const bVal = parseFloat(b.dataset[type], 10);
        return sortOrder > 0 ? aVal - bVal : bVal - aVal;
      });
      gallery.append(...sorted);
      // toggle the sort order for the next click
      target.dataset.order = sortOrder * -1;
    });
  });

  filterActions.forEach((action) => {
    action.addEventListener('input', () => {
      const checked = [...filterActions].filter((a) => a.checked).map((a) => a.value);
      const figures = [...gallery.querySelectorAll('figure')];
      const textFilter = actionbar.querySelector('#filter-text');

      figures.forEach((figure) => {
        const hasAlt = figure.dataset.alt === 'true';
        const aspect = parseFloat(figure.dataset.aspect, 10);
        // eslint-disable-next-line no-nested-ternary
        const shape = aspect === 1 ? 'square'
          // eslint-disable-next-line no-nested-ternary
          : aspect < 1 ? 'portrait'
            : aspect > 1.7 ? 'widescreen' : 'landscape';

        let hide = true; // hide figures by default

        // check images against filter critera
        if (checked.includes('missing-alt') && !checked.some((f) => f !== 'missing-alt')) { // only 'missing-alt' is selected
          // only show figures without alt text
          hide = hasAlt;
        } else if (checked.includes('missing-alt') && checked.some((f) => f !== 'missing-alt')) { // 'missing-alt' is selected along with shape(s)
          // show figures without alt text that match any selected shape(s)
          hide = !(checked.includes(shape) && !hasAlt);
        } else if (!checked.includes('missing-alt') && checked.includes(shape)) { // only shapes are selected
          // show figures that match the selected shape(s)
          hide = false;
        } else if (checked.length === 0) { // no filters are selected
          // show all figures
          hide = false;
        }
        if (!hide && textFilter.value) {
          // show figures that match the text filter
          const alt = figure.dataset.altText || '';
          const pages = figure.dataset.pages || '';

          const matchesAlt = alt.toLowerCase().includes(textFilter.value.toLowerCase());
          const matchesSrc = pages.toLowerCase().includes(textFilter.value.toLowerCase());

          hide = !(matchesAlt || matchesSrc);
        }
        figure.setAttribute('aria-hidden', hide);
      });
    });
  });
}

async function init() {
  await initConfigField();
  const params = new URLSearchParams(window.location.search);
  if (params.has('url')) document.getElementById('url').value = decodeURIComponent(params.get('url'));
  if (params.has('path')) document.getElementById('path').value = decodeURIComponent(params.get('path'));
  registerListeners(document);
}

init();
