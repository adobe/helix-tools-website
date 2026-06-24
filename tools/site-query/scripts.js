import { registerToolReady } from '../../scripts/scripts.js';
import { initConfigField, updateConfig } from '../../utils/config/config.js';
import getAdminClient from '../../scripts/admin-compat.js';
import { executeAdminRequest, AuthMode } from '../../utils/admin-request.js';

let admin;

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

function disableForm(form) {
  [...form.elements].forEach((el) => {
    el.disabled = true;
  });
}

function enableForm(form) {
  [...form.elements].forEach((el) => {
    el.disabled = false;
  });
}

function clearResults(table) {
  const tbody = table.querySelector('tbody.results');
  tbody.replaceChildren();

  const caption = table.querySelector('caption');
  caption.setAttribute('aria-hidden', true);
}

function updateTableError(table, errCode) {
  const { title, msg } = (() => {
    switch (errCode) {
      case 401:
        return {
          title: 'Unauthorized',
          msg: 'Unable to display results. You may not have access to this content.',
        };
      case 403:
        return {
          title: 'Forbidden',
          msg: 'Unable to display results. Access to this content was denied. If the site is protected, you need to add <code>tools.aem.live</code> to the site\'s <code>sidekick.trustedHosts</code>. See the <a href="https://www.aem.live/developer/sidekick-development" target="_blank" rel="noopener noreferrer">sidekick development docs</a> for more information.',
        };
      case 404:
        return {
          title: '404 Not Found Error',
          msg: 'Unable to display results. Ensure your sitemap/index path is correct.',
        };
      case 499:
        return {
          title: 'Initial Fetch Failed',
          msg: 'This is likely due to CORS. Either use a CORS allow plugin or add a header <code>Access-Control-Allow-Origin: https://tools.aem.live</code> in your site config.',
        };
      default:
        return {
          title: 'Error',
          msg: 'Unable to display results. Please check the console for more information.',
        };
    }
  })();

  table.querySelectorAll('tbody').forEach((tbody) => {
    if (tbody.classList.contains('error')) {
      tbody.setAttribute('aria-hidden', 'false');
      tbody.querySelector('.error-title').textContent = title;
      tbody.querySelector('.error-msg').innerHTML = msg;
    } else {
      tbody.setAttribute('aria-hidden', 'true');
    }
  });
}

function displayResult(url, matches, org, site) {
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td><a href="${url.href}" target="_blank">${url.href}</a> (<a class="edit-link" href="#">Edit</a>)</td>
    <td>${matches}</td>
  `;

  const editLink = tr.querySelector('a.edit-link');
  editLink.addEventListener('click', async (e) => {
    e.preventDefault();

    if (editLink.classList.contains('disabled')) return;

    if (editLink.getAttribute('href') !== '#') {
      window.open(editLink.href);
      return;
    }

    try {
      const statusRes = await executeAdminRequest(
        () => admin.status({ org, site }).get(url.pathname, { params: { editUrl: 'auto' } }),
        { org, site },
      );
      if (!statusRes) return; // login cancelled
      const status = await statusRes.json();
      let editUrl = status.edit && status.edit.url;

      // fallback to sidekick config if status doesn't provide edit URL
      if (!editUrl) {
        const configRes = await executeAdminRequest(
          () => admin.sidekick({ org, site }).get('config.json'),
          { org, site },
        );
        if (!configRes) return; // login cancelled
        const config = await configRes.json();
        const editUrlPattern = config.editUrl;
        if (editUrlPattern) {
          editUrl = editUrlPattern
            .replace('{{pathname}}', url.pathname)
            .replace('{{org}}', org)
            .replace('{{site}}', site);
        }
      }

      if (editUrl) {
        editLink.href = editUrl;
        window.open(editUrl);
      } else {
        throw new Error('admin did not return an edit url');
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('failed to open edit link', err);
      editLink.textContent = 'Error opening edit link';
      editLink.classList.add('disabled');
    }
  });

  return tr;
}

async function* fetchQueryIndex(queryIndexPath, liveHost) {
  const limit = 512;
  let offset = 0;
  let more = true;

  do {
    let res;
    try {
      // eslint-disable-next-line no-await-in-loop
      res = await fetch(`https://${liveHost}${queryIndexPath}?offset=${offset}&limit=${limit}`);
    } catch (err) {
      throw new Error('Failed on initial fetch of index.', err);
    }

    if (!res.ok) {
      const error = new Error(`Not found: ${queryIndexPath}`);
      error.status = res.status;
      throw error;
    }
    // eslint-disable-next-line no-await-in-loop
    const json = await res.json();
    offset += limit;
    more = json.data.length > 0;
    for (let i = 0; i < json.data.length; i += 1) {
      const item = json.data[i];
      const url = new URL(item.path, `https://${liveHost}`);
      url.host = liveHost;
      yield url;
    }
  } while (more);
}

async function* fetchSitemap(sitemapPath, liveHost) {
  let res;
  try {
    res = await fetch(`https://${liveHost}${sitemapPath}`);
    if (!res.ok) {
      const error = new Error(`Not found: ${sitemapPath}`);
      error.status = res.status;
      throw error;
    }
  } catch (err) {
    if (err.status) {
      throw err;
    }
    throw new Error('Failed on initial fetch of sitemap.', err);
  }

  const xml = await res.text();
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, 'application/xml');

  const sitemapLocs = doc.querySelectorAll('sitemap > loc');
  for (let i = 0; i < sitemapLocs.length; i += 1) {
    const loc = sitemapLocs[i];
    const liveUrl = new URL(loc.textContent);
    const resucrsiveResults = fetchSitemap(liveUrl.pathname, liveHost);
    // eslint-disable-next-line no-restricted-syntax, no-await-in-loop
    for await (const url of resucrsiveResults) {
      yield url;
    }
  }

  const urlLocs = doc.querySelectorAll('url > loc');
  for (let i = 0; i < urlLocs.length; i += 1) {
    const loc = urlLocs[i];
    const url = new URL(loc.textContent, `https://${liveHost}`);
    url.host = liveHost;
    yield url;
  }
}

/**
 * creates a rate limiter that spaces out request starts so they don't exceed
 * a maximum rate. await the returned function before each fetch.
 *
 * @returns {() => Promise<void>} acquire a slot, resolving when it's safe to fetch
 */
function createRateLimiter() {
  // the live host rate-limits at 200 requests/second/IP; stay well under that to
  // leave headroom for other tabs/tools sharing the same IP budget
  const maxPerSecond = 100;
  const minInterval = 1000 / maxPerSecond;
  let nextTime = 0;
  return () => {
    const now = performance.now();
    const scheduled = Math.max(now, nextTime);
    nextTime = scheduled + minInterval;
    const wait = scheduled - now;
    return wait > 0
      ? new Promise((resolve) => { setTimeout(resolve, wait); })
      : Promise.resolve();
  };
}

/**
 * query the page for matches
 *
 * @param {URL} url the url to query
 * @param {string} query the query string
 * @param {string} queryType the query type
 * @param {() => Promise<void>} acquire rate-limiter slot to await before fetching
 */
async function queryPage(url, query, queryType, acquire) {
  await acquire();
  const res = await fetch(url);
  const html = await res.text();
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  if (queryType === 'selector') {
    const elements = doc.querySelectorAll(query);
    return elements.length;
  }
  if (queryType === 'media') {
    const media = doc.querySelectorAll(`img[src*="${query}"]`);
    return media.length;
  }

  const body = doc.querySelector('body');
  const text = body.textContent;
  const matches = text.match(new RegExp(query, 'gi'));
  return matches ? matches.length : 0;
}

async function processUrl(sitemapUrl, query, queryType, org, site, acquire) {
  try {
    const matches = await queryPage(sitemapUrl, query, queryType, acquire);
    if (matches > 0) {
      return displayResult(sitemapUrl, matches, org, site);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`Failed to query ${sitemapUrl.href}:`, err.message);
  }

  return null;
}

async function init(doc) {
  admin = await getAdminClient();
  doc.querySelector('.site-query').dataset.status = 'loading';
  await initConfigField();

  const form = doc.querySelector('#search-form');
  const table = doc.querySelector('.table table');
  const results = table.querySelector('tbody.results');
  const error = table.querySelector('tbody.error');
  const noResults = table.querySelector('tbody.no-results');
  const stopButton = doc.querySelector('#stop-search');
  const caption = table.querySelector('caption');
  let stopped = false;

  stopButton.addEventListener('click', () => {
    stopped = true;
    stopButton.setAttribute('aria-hidden', 'true');
    enableForm(form);
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    stopped = false;
    results.setAttribute('aria-hidden', 'false');
    error.setAttribute('aria-hidden', 'true');
    noResults.setAttribute('aria-hidden', 'true');

    const {
      org, site, query, sitemap, queryType, path,
    } = getFormData(form);

    try {
      clearResults(table);
      disableForm(form);

      // fetch host config
      const hostsResult = await executeAdminRequest(
        () => admin.status({ org, site }).get(''),
        { org, site, policy: AuthMode.PREFLIGHT_AND_RETRY },
      );
      if (!hostsResult) return; // login cancelled
      const hostsJson = hostsResult.ok ? await hostsResult.json() : null;
      const live = hostsJson?.live?.url ? new URL(hostsJson.live.url).host : null;
      if (!live) {
        updateTableError(table, hostsResult.status);
        stopButton.setAttribute('aria-hidden', 'true');
        caption.setAttribute('aria-hidden', 'true');
        return;
      }

      updateConfig();

      const sitemapUrls = sitemap.endsWith('.json') ? fetchQueryIndex(sitemap, live) : fetchSitemap(sitemap, live);

      let searched = 0;

      caption.setAttribute('aria-hidden', false);
      stopButton.setAttribute('aria-hidden', 'false');
      caption.querySelector('.term').textContent = query;
      const resultsFoundElement = caption.querySelector('.results-found');
      resultsFoundElement.textContent = 0;
      const resultsOfElement = caption.querySelector('.results-of');
      resultsOfElement.textContent = 0;

      const processingTasks = [];
      const acquire = createRateLimiter();
      const updateSearched = () => {
        searched += 1;
        resultsOfElement.textContent = searched;
      };

      // eslint-disable-next-line no-restricted-syntax
      for await (const sitemapUrl of sitemapUrls) {
        if (stopped) break;

        if (sitemapUrl.pathname.startsWith(path)) {
          const promise = processUrl(sitemapUrl, query, queryType, org, site, acquire)
            .then((tr) => {
              updateSearched();
              if (tr) {
                results.append(tr);
                resultsFoundElement.textContent = results.children.length;
              }
            });
          processingTasks.push(promise);
        }

        // max 50 inflight at a time
        if (processingTasks.length >= 50) {
          await Promise.allSettled(processingTasks);
          processingTasks.splice(0, processingTasks.length);
        }
      }
      resultsOfElement.textContent = searched;
      await Promise.allSettled(processingTasks);

      if (results.children.length === 0) {
        noResults.setAttribute('aria-hidden', 'false');
        results.setAttribute('aria-hidden', 'true');
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(err);
      if (err.status === 401 || err.message.startsWith('Unauthorized')) {
        updateTableError(table, 401);
      } else if (err.status === 403) {
        updateTableError(table, 403);
      } else if (err.message.startsWith('Failed on initial fetch')) {
        updateTableError(table, 499);
      } else if (err.message.startsWith('Not found')) {
        updateTableError(table, 404);
      } else {
        updateTableError(table, 500);
      }
    } finally {
      stopButton.setAttribute('aria-hidden', 'true');
      enableForm(form);
    }
  });

  form.addEventListener('reset', () => {
    clearResults(table);
  });

  doc.querySelector('.site-query').dataset.status = 'loaded';
}

registerToolReady(init(document));
