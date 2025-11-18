import { diffChars } from './diff.js';

const scannerForm = document.getElementById('scanner-form');
const resultsTable = document.querySelector('#results tbody');
const shareSelectedButton = document.querySelector('#share-selected');

async function corsFetch(url, cache = false, reload = false) {
  const cacheParam = cache ? 'cache=hard&' : 'cache=off&';
  const reloadParam = reload ? 'reload=true&' : '';
  const resp = await fetch(`https://little-forest-58aa.david8603.workers.dev/?${cacheParam}${reloadParam}url=${encodeURIComponent(url)}`);
  return resp;
}

async function logResult(result, config) {
  const checkSame = (prop) => {
    if (result.prod[prop] === undefined && result.new[prop] === undefined) {
      return { same: true, value: '' };
    }
    if (result.prod[prop] === result.new[prop]) {
      return { same: true, value: result.prod[prop] };
    }
    if (result.prod[prop]?.length > 100 || result.new[prop]?.length > 100) {
      const diff = diffChars(result.prod[prop], result.new[prop]);
      const diffHtml = diff.map((part) => {
        if (part.added) {
          return `<span class="diff-added">${part.value}</span>`;
        }
        if (part.removed) {
          return `<span class="diff-removed">${part.value}</span>`;
        }
        return part.value;
      }).join('');
      return { same: false, value: `${diffHtml}` };
    }
    return { same: false, value: `${result.prod[prop]} / ${result.new[prop]}` };
  };
  const urls = {
    Prod: result.prod.url,
    New: result.new.url,
  };

  const createImage = async (url) => {
    const toHumanReadableAgo = (date) => {
      if (!date) return 'never';
      const diff = new Date() - new Date(date);
      const diffInSeconds = Math.floor(diff / 1000);
      const diffInMinutes = Math.floor(diffInSeconds / 60);
      const diffInHours = Math.floor(diffInMinutes / 60);
      const diffInDays = Math.floor(diffInHours / 24);
      if (diffInDays > 0) return `${diffInDays}d`;
      if (diffInHours > 0) return `${diffInHours}h`;
      if (diffInMinutes > 0) return `${diffInMinutes}m`;
      return `${diffInSeconds}s`;
    };

    const div = document.createElement('div');
    const img = document.createElement('img');
    img.src = `https://image-forest-58aa.david8603.workers.dev/?url=${encodeURIComponent(url)}`;
    img.alt = 'image';
    img.width = 100;
    div.appendChild(img);
    const resp = await fetch(`https://image-forest-58aa.david8603.workers.dev/?url=${encodeURIComponent(url)}&metadata=true`);
    const imgData = await resp.json();
    const imgInfo = document.createElement('span');
    imgInfo.textContent = `updated ${toHumanReadableAgo(imgData['last-modified'])}`;
    div.appendChild(imgInfo);
    img.addEventListener('click', () => {
      img.src = `${img.src}&reload=true`;
      img.style.opacity = 0.5;
    });
    img.addEventListener('load', () => {
      if (img.src.includes('&reload=true')) {
        img.style.opacity = 1;
        img.src = img.src.replace('&reload=true', `&ck=${Math.random()}`);
        imgInfo.textContent = 'updated now';
      }
    });
    return div;
  };

  const prodImg = result.prod.status === 200 ? await createImage(result.prod.url) : document.createElement('div');
  const newImg = result.new.status === 200 ? await createImage(result.new.url) : document.createElement('div');
  const row = document.createElement('tr');
  row.innerHTML = `
    <td class="url"><input type="checkbox" data-urls="${encodeURIComponent(JSON.stringify(urls))}">${result.prod.url.split('/').pop()} [<a href="${result.prod.url}" target="_blank">prod</a> | <a href="${result.new.url}" target="_blank">new</a>]</td>
    <td class="status ${checkSame('status').same ? 'pass' : 'fail'}">${checkSame('status').value}</td>
  `;

  row.querySelector('input[type="checkbox"]').addEventListener('change', () => {
    if (document.querySelectorAll('input[type="checkbox"]:checked').length > 0) {
      shareSelectedButton.disabled = false;
    } else {
      shareSelectedButton.disabled = true;
    }
  });

  config.forEach((item) => {
    const td = document.createElement('td');
    td.innerHTML = checkSame(item.Field).value;
    td.classList.add(checkSame(item.Field).same ? 'pass' : 'fail');
    td.setAttribute('data-field', item.Field);
    row.appendChild(td);
  });

  const wrapInTd = (elem, className = '') => {
    const td = document.createElement('td');
    td.className = className;
    td.appendChild(elem);
    return td;
  };

  row.appendChild(wrapInTd(prodImg, 'prod-img img-container'));
  row.appendChild(wrapInTd(newImg, 'new-img img-container'));

  resultsTable.appendChild(row);
}

async function extractData(prodDoc, newDoc, JSONLDData, config, result) {
  const findSwatches = (scripts) => {
    for (let i = 0; i < scripts.length; i += 1) {
      const script = scripts[i];
      const json = JSON.parse(script.textContent);
      if (json['[data-role=swatch-options]']) {
        const swatches = json['[data-role=swatch-options]']['Magento_Swatches/js/swatch-renderer'].jsonConfig.attributes['93'].options;
        return swatches.filter((swatch) => swatch.products.length > 0);
      }
    }
    return [];
  };

  config.forEach(async (item) => {
    switch (item.Field) {
      case 'price': {
        const prodElem = prodDoc.querySelector(item.QuerySelector);
        result.prod.price = prodElem ? prodElem.textContent.replace(/[^0-9.]/g, '') : '';
        result.new.price = JSONLDData?.offers?.[0]?.price;
        break;
      }
      case 'number of variants': {
        result.prod['number of variants'] = findSwatches([...prodDoc.querySelectorAll('script[type="text/x-magento-init"]')]).length || 1;
        result.new['number of variants'] = JSONLDData?.offers?.length;
        break;
      }
      case 'availability': {
        result.prod.availability = prodDoc.querySelector(item.QuerySelector).textContent.split('/').pop();
        result.new.availability = JSONLDData?.offers?.[0]?.availability.split('/').pop();
        break;
      }
      case 'sku': {
        result.prod.sku = prodDoc.querySelector(item.QuerySelector).textContent;
        result.new.sku = JSONLDData.sku;
        break;
      }
      case 'productid': {
        const prodElem = prodDoc.querySelector(item.QuerySelector);
        result.prod.productId = prodElem ? prodElem.textContent : undefined;
        result.new.productId = result.prod.productid;
        break;
      }
      case 'warranty': {
        const prodElem = prodDoc.querySelector(item.QuerySelector);
        if (prodElem) prodElem.querySelectorAll('style').forEach((style) => style.remove());
        result.prod.warranty = prodElem ? prodElem.textContent.trim() : undefined;
        result.new.warranty = JSONLDData.custom.warranty;
        const div = document.createElement('div');
        div.innerHTML = result.new.warranty;
        div.innerHTML = div.textContent;
        result.new.warranty = div.textContent;
        break;
      }

      case 'specifications': {
        const prodElem = prodDoc.querySelector(item.QuerySelector);
        result.prod.specifications = prodElem ? prodElem.textContent.trim().replace(/\s+/g, ' ').replace(/ :/g, ':') : undefined;
        result.new.specifications = `Product Specifications ${newDoc.querySelector('div.specifications')?.textContent.trim().replace(/\s+/g, ' ')}`;
        break;
      }

      case 'features': {
        const prodElem = prodDoc.querySelector(item.QuerySelector);
        result.prod.features = prodElem ? prodElem.textContent.trim().replace(/\s+/g, ' ').replace(/ :/g, ':') : undefined;
        const fragmentUrl = `${result.new.url.replace('/products/', '/products/fragments/')}.plain.html`;
        const fragmentResponse = await corsFetch(fragmentUrl);
        const fragmentHtml = await fragmentResponse.text();
        // eslint-disable-next-line no-console
        console.log(fragmentHtml);
        const fragmentDoc = new DOMParser().parseFromString(fragmentHtml, 'text/html');
        result.new.features = `${fragmentDoc.body?.textContent.trim().replace(/\s+/g, ' ')}`;
        break;
      }

      case 'custom block': {
        const prodElem = prodDoc.querySelector(item.QuerySelector);
        result.prod['custom block'] = prodElem ? 'Yes' : 'No';
        const fragmentUrl = `${result.new.url.replace('/products/', '/products/fragments/')}.plain.html`;
        const fragmentResponse = await corsFetch(fragmentUrl);
        await fragmentResponse.text();
        result.new['custom block'] = fragmentResponse.status === 200 ? 'Yes' : 'No';
        break;
      }

      default:
        if (item.AuxRequest) {
          result.prod[item.Field] = '';
        } else if (item.QuerySelector) {
          if (item.QuerySelector) {
            if (prodDoc.querySelector(item.QuerySelector)) {
              result.prod[item.Field] = prodDoc.querySelector(item.QuerySelector)
                .textContent.trim();
            } else {
              result.prod[item.Field] = '';
            }
          } else {
            result.prod[item.Field] = '';
          }
        }
        result.new[item.Field] = JSONLDData?.custom?.[item.Field];
    }
  });
}

async function processAuxRequests(config, result) {
  const patchVars = (template) => template.replace(/\${(\w+)}/g, (match, p1) => result.prod[p1]);

  const auxRequests = config.filter((item) => item.AuxRequest);
  for (let i = 0; i < auxRequests.length; i += 1) {
    const auxRequest = auxRequests[i];
    const finalURL = patchVars(auxRequest.AuxRequest);
    if (!finalURL.includes('undefined')) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const resp = await corsFetch(finalURL, true);
        // eslint-disable-next-line no-await-in-loop
        const respData = await resp.json();
        const path = auxRequest.QuerySelector.split('.');
        let value = respData;
        for (let j = 0; j < path.length; j += 1) {
          value = value[path[j]];
        }
        result.prod[auxRequest.Field] = value;
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error(e);
      }
    }
  }
}

function mapResultValues(result, config) {
  config.filter((item) => item.ValueMap).forEach((item) => {
    const rows = item.ValueMap.includes(';') ? item.ValueMap.split(';') : item.ValueMap.split(',');
    const map = {};
    rows.forEach((row) => {
      const [key, value] = row.split('=').map((i) => i.trim());
      map[key] = value;
    });
    if (map[result.prod[item.Field]]) {
      result.prod[item.Field] = map[result.prod[item.Field]];
    }
  });
}

async function scanPDP(row, config, branchOverride = null, reload = false) {
  const prodUrl = row.Prod;
  let newUrl = row.New;
  if (branchOverride) {
    newUrl = newUrl.replace('https://main--', `https://${branchOverride}--`);
  }

  const prodResponse = await corsFetch(prodUrl, true, reload, true);
  const prodHtml = await prodResponse.text();

  const newResponse = await corsFetch(newUrl, false);
  const newHtml = await newResponse.text();
  const result = {
    prod: {
      status: prodResponse.status,
      url: prodUrl,
    },
    new: {
      status: newResponse.status,
      url: newUrl,
    },
  };
  if (prodResponse.status !== 200 || newResponse.status !== 200) {
    return result;
  }

  const prodDoc = new DOMParser().parseFromString(prodHtml, 'text/html');
  const newDoc = new DOMParser().parseFromString(newHtml, 'text/html');

  let JSONLDData = {};
  const JSONLD = newDoc.querySelector('script[type="application/ld+json"]');
  if (JSONLD) {
    JSONLDData = JSON.parse(JSONLD.textContent);
  }

  await extractData(prodDoc, newDoc, JSONLDData, config, result);
  await processAuxRequests(config, result);
  mapResultValues(result, config);
  return result;
}

function updateUrl(configUrl) {
  const url = new URL(window.location.href);
  url.searchParams.set('config', configUrl);
  window.history.pushState({}, '', url);
}

function shareSelected() {
  const selectedRows = resultsTable.querySelectorAll('input[type="checkbox"]:checked');
  const selectedUrls = [...selectedRows].map((row) => JSON.parse(decodeURIComponent(row.dataset.urls)).Prod.split('/').pop());
  const url = new URL(window.location.href);
  url.searchParams.delete('share');
  for (let i = 0; i < selectedUrls.length; i += 1) {
    url.searchParams.append('share', selectedUrls[i]);
  }
  navigator.clipboard.writeText(url.toString());
}

async function runScan(url, focus, share) {
  const response = await corsFetch(`${url}`);
  const json = await response.json();
  let urls = [];
  let config = [];
  if (json[':type'] === 'multi-sheet') {
    urls = json.urls.data;
    config = json.config.data;
  } else {
    urls = json.data;
  }

  if (focus) {
    config = [];
  }

  if (share.length > 0) {
    urls = urls.filter((u) => share.includes(u.Prod.split('/').pop()));
  }

  const tableHead = document.querySelector('#results thead tr');
  tableHead.innerHTML = '';
  const thUrl = document.createElement('th');
  thUrl.textContent = 'URL';
  tableHead.appendChild(thUrl);

  const thStatus = document.createElement('th');
  thStatus.textContent = 'Status';
  tableHead.appendChild(thStatus);

  config.forEach((item) => {
    item.Field = item.Field.toLowerCase();
    const th = document.createElement('th');
    th.textContent = item.Field;
    tableHead.appendChild(th);
  });

  const thProd = document.createElement('th');
  thProd.textContent = 'Prod Screenshot';
  tableHead.appendChild(thProd);

  const thNew = document.createElement('th');
  thNew.textContent = 'New Screenshot';
  tableHead.appendChild(thNew);

  const params = new URLSearchParams(window.location.search);
  const limit = +params.get('limit') || urls.length;
  const branchOverride = params.get('branch');

  shareSelectedButton.addEventListener('click', () => shareSelected());
  for (let i = 0; i < limit && i < urls.length; i += 1) {
    const row = urls[i];
    // eslint-disable-next-line no-await-in-loop
    const result = await scanPDP(row, config, branchOverride);
    // eslint-disable-next-line no-await-in-loop
    await logResult(result, config);
  }
}

function init() {
  const urlInput = document.getElementById('url');

  // Populate from URL parameter if present
  const currentUrl = new URL(window.location.href);
  const initialConfigUrl = currentUrl.searchParams.get('config');
  if (initialConfigUrl) {
    urlInput.value = initialConfigUrl;
  }

  const focus = currentUrl.searchParams.get('focus');

  const share = currentUrl.searchParams.getAll('share');
  if (share.length > 0) {
    document.body.classList.add('share');
    runScan(urlInput.value, focus, share);
  }

  scannerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = document.getElementById('url').value.trim();
    updateUrl(url);

    // Clear previous results
    resultsTable.innerHTML = '';
    await runScan(url, focus, share);
  });
}

init();
