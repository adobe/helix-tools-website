/*
 * This file centralizes all of the data loading used by the power score results and provides a
 * mechanism for blocks to be notified via callbakcs when the data they need is ready/updated.
 *
 * Essentially, it is an application specific pub/sub framework, initialized by the results block,
 * but used by the data-element, sub-score, and power-score blocks.
 */

/**
 * an enum of the allowed/supported data types.
 * Note that no validation is performed based on the values,
 * it is simply a way to communicate the expected types and to avoid using the same string
 * in multiple places.
 */
export const DATA_TYPES = Object.freeze({
  SETUP: Symbol('setup'),
  SITEMAP: Symbol('sitemap'),
  TEMPLATES: Symbol('templates'),
  RAW_TRAFFIC: Symbol('raw-traffic'),
  TRAFFIC: Symbol('traffic'),
  DNS: Symbol('dns'),
  CDN: Symbol('cdn'),
  PSI: Symbol('psi'),
  PSI_MOBILE: Symbol('psi-mobile'),
  PSI_DESKTOP: Symbol('psi-desktop'),
  SAMPLED_URLS: Symbol('sampled-urls'),
  BLOCKS: Symbol('blocks'),
  INTEGRATIONS: Symbol('integrations'),
  CODE_COMPLEXITY: Symbol('code-complexity'),
  IMPORT_COMPLEXITY: Symbol('import-complexity'),
  SITE_COMPLEXITY: Symbol('site-complexity'),
  CUSTOMER_COMPLEXITY: Symbol('customer-complexity'),
  CUSTOMER_URGENCY: Symbol('customer-urgency'),
});

export const UNKNOWN_CDN = {
  id: 'unknown',
  icon: 'question',
  cnames: [],
  label: 'Unknown',
};
export const CDN_MAP = {
  akamai: {
    id: 'akamai',
    icon: 'akamai',
    cnames: ['edgekey.net', 'edgesuite.net'],
    label: 'Akamai',
  },
  cloudfront: {
    id: 'cloudfront',
    icon: 'cloudfront',
    cnames: ['cloudfront.net'],
    label: 'AWS Cloudfront',
  },
  azure: {
    id: 'azure',
    icon: 'azure-cdn',
    cnames: ['azureedge.net'],
    label: 'Azure Edge',
  },
  wpengine: {
    id: 'wpengine',
    icon: 'wpengine',
    cnames: ['wpeproxy.com'],
    label: 'WordPress Engine',
  },
  adobe: {
    id: 'adobe',
    icon: 'adobe',
    cnames: ['adobeaemcloud.com', 'hlxcdn'],
    label: 'Adobe',
  },
  fastly: {
    id: 'fastly',
    icon: 'fastly',
    cnames: ['fastly'],
    label: 'Fastly',
  },
  cloudflare: {
    id: 'cloudflare',
    icon: 'cloudflare',
    cnames: ['cloudflare.com'],
    label: 'Cloudflare',
  },
};

/**
 * tracks the callback functions for each data type
 */
const dataCallbacks = {};

/**
 * Observe for specific types of results data and receive a callback when data is ready/updated.
 *
 *  The callback function will be called when all the dataTypes you ask for are ready, when any
 * of those data are updated, or if an error occurs loading any of the required data.
 *
 * The callback function takes 2 parameters:
 * - an array of data, ordered exactly the same as the `dataTypes` array used to call this function
 * - an error object, if an error occurs
 *
 * If an error occurs and the second parameter is provided, the first parameter is an empty array.
 *
 * All of this is intended so that array destrucuring can be used, eg:
 * `observeData(['dataTypeOne', 'dataTypeTwo'], ([dataOne, dataTwo], err) => {});`
 *
 * @param {String[]|Symbol[]} dataTypes the data types to observe
 * @param {function} callBackFn the callback function
 */
export const observeData = (dataTypes, callBackFn) => {
  const resultsData = {};
  const effectiveDataTypes = dataTypes.map((d) => ((typeof d === 'symbol') ? d.description : d));
  const onData = (dataType, data, err) => {
    resultsData[dataType] = { data, err };
    let hasError = false;
    const results = effectiveDataTypes.map((d) => {
      if (resultsData[d] && resultsData[d].err) {
        hasError = true;
        callBackFn([], err);
      }
      if (resultsData[d] && resultsData[d].data) {
        return resultsData[d].data;
      }

      return '';
    }).filter((datum) => !!datum);

    if (!hasError && results.length === effectiveDataTypes.length) {
      callBackFn(results);
    }
  };

  effectiveDataTypes.forEach((dataType) => {
    if (!dataCallbacks[dataType]) {
      dataCallbacks[dataType] = [];
    }
    const callbacks = dataCallbacks[dataType];
    callbacks.push(onData);
  });
};

/**
 * Provides/updates data, invoking any neccessary callbacks.
 *
 * @param {String|Symbol} dataType the data type
 * @param {Object} data the data (usually a json response body)
 */
export const provideData = (dataType, data) => {
  const dataTypeString = (typeof dataType === 'symbol') ? dataType.description : dataType;
  // eslint-disable-next-line no-console
  console.log(dataTypeString, data);
  const callbacks = dataCallbacks[dataTypeString];
  if (callbacks) {
    callbacks.forEach((fn) => {
      fn(dataTypeString, data);
    });
  }
};

/**
 * Notifies that a particular type of data failed to load, invoking any neccessary callbacks.
 *
 * @param {String|Symbol} dataType the data type
 * @param {Error} err the error that occurred
 */
export const dataProviderError = (dataType, err) => {
  const dataTypeString = (typeof dataType === 'symbol') ? dataType.description : dataType;
  // eslint-disable-next-line no-console
  console.error(dataTypeString, err);
  const callbacks = dataCallbacks[dataTypeString];
  if (callbacks) {
    callbacks.forEach((fn) => {
      fn(dataTypeString, undefined, err);
    });
  }
};

const IO_BASE_URL_STAGE = 'https://316182-301graysole-stage.adobeioruntime.net/api/v1/web/powerscore';
const IO_BASE_URL_PROD = 'https://316182-301graysole.adobeioruntime.net/api/v1/web/powerscore';
const CF_WORKER_BASE_URL = 'https://powerscore.adobeaem.workers.dev';
let ioBaseURL = IO_BASE_URL_PROD;

const pollForResult = (dataType, resultFetcher, pollingInterval, maxTime) => {
  let timeWaited = 0;
  let wait = 0;
  const pollingIntervalMs = pollingInterval * 1000;

  const exec = () => {
    timeWaited += wait;
    wait = pollingIntervalMs;
    if (timeWaited >= (maxTime * 1000)) {
      const exceededError = new Error(`action ${dataType.description} exceeded max allowed time of ${maxTime}s`);
      dataProviderError(dataType, exceededError);
      return;
    }

    resultFetcher().then((data) => {
      if (data) {
        try {
          provideData(dataType, data);
        } catch (err) {
          dataProviderError(dataType, err);
        }
      } else {
        setTimeout(exec, wait);
      }
    }).catch(() => {
      setTimeout(exec, wait);
    });
  };
  setTimeout(exec, wait);
};

const cfGetFile = async (signedUrl) => {
  try {
    const resp = await fetch(signedUrl);
    if (resp.ok) {
      const json = await resp.json();
      return json;
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('get file failed.', err);
  }

  return undefined;
};

const invokeCfDataActionAsync = async (dataType, path, params, intervalTime = 10, maxTime = 60) => {
  try {
    const { id } = JSON.parse(sessionStorage.getItem('powerScoreParams'));
    const fileName = `${id}__${dataType.description.toLowerCase()}`;
    const paramsWithFileName = {
      ...params,
      fileName,
    };
    const paramsString = Object.entries(paramsWithFileName).map(([key, val]) => `${key}=${encodeURIComponent(val)}`).join('&');
    const res = await fetch(`${CF_WORKER_BASE_URL}${path}?${paramsString}`, {
      method: 'GET',
    });

    if (res.ok) {
      const json = await res.json();
      if (json && json.body && json.body.ObjectUrl) {
        pollForResult(
          dataType,
          async () => cfGetFile(json.body.ObjectUrl),
          intervalTime,
          maxTime,
        );
      }
    } else {
      throw new Error('failed to load results');
    }
  } catch (err) {
    dataProviderError(dataType, err);
  }

  return {};
};

/**
 * Invoke an IO action to get data. data is then made available to other blocks
 * @param {Symbol} dataType the type of data
 * @param {string} path the path of the action
 * @param {object} body the post body for the action
 * @returns the body data returned from the action
 */
const invokeIoDataAction = async (dataType, path, body) => {
  try {
    const res = await fetch(`${ioBaseURL}/${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      const json = await res.json();
      provideData(dataType, json.body);
      return json.body;
    }

    throw new Error('failed to load results');
  } catch (err) {
    dataProviderError(dataType, err);
  }

  return {};
};

/**
 * get a file from the io action
 * @param {String} fileName the file name
 * @returns the json data from that file or undefined if the file doesn't yet exist
 */
const ioGetFileUrl = async (fileName) => {
  try {
    const resp = await fetch(`${ioBaseURL}/get-file-url.json?fileName=${encodeURIComponent(fileName)}`);
    if (resp.ok) {
      const json = await resp.json();
      if (json.statusCode === 200) {
        const fileUrl = json.body.url;
        const fileUrlResp = await fetch(fileUrl);
        if (fileUrlResp.ok) {
          const fileJson = await fileUrlResp.json();
          return fileJson;
        }
      }
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('get file failed.', err);
  }

  return undefined;
};

/**
 * get a file from the io action
 * @param {String} fileName the file name
 * @returns the json data from that file or undefined if the file doesn't yet exist
 */
const ioGetFile = async (fileName) => {
  try {
    const resp = await fetch(`${ioBaseURL}/get-file.json?fileName=${encodeURIComponent(fileName)}`);
    if (resp.ok) {
      const json = await resp.json();
      if (json.statusCode === 200) {
        return json.body;
      }
    } else {
      return ioGetFileUrl(fileName);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('get file failed.', err);
  }

  return undefined;
};

/**
 * Invoke an asynchronous IO action to get data. data is then made available to other blocks
 * @param {Symbol} dataType the type of data
 * @param {string} actionName the name of the action to trigger
 * @param {object} body post body for the action
 * @param {number} intervalTime
 * (optional) the amount of time in ms to wait between checking for results.
 * Defaults to 5s.
 * @param {number} maxTime
 * (optional) the total time to wait before failing
 * Default 60 or 1 minute total.
 * @returns the body data returned from the action
 */
const invokeIoDataActionAsync = async (
  dataType,
  actionName,
  body,
  intervalTime = 10,
  maxTime = 60,
) => {
  try {
    const { id } = JSON.parse(sessionStorage.getItem('powerScoreParams'));
    const fileName = `${id}__${dataType.description.toLowerCase()}.json`;
    const dataFromFile = await ioGetFile(fileName);
    if (dataFromFile) {
      provideData(dataType, dataFromFile);
    } else {
      // trigger action and poll for file to exist
      const res = await fetch(`${ioBaseURL}/trigger-action.json`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...body,
          actionName,
          fileName,
        }),
      });

      if (res.ok) {
        pollForResult(dataType, async () => ioGetFile(fileName), intervalTime, maxTime);
      } else {
        throw new Error('failed to load results');
      }
    }
  } catch (err) {
    dataProviderError(dataType, err);
  }
};

const sampleUrls = (sitemapData) => {
  const sampledUrls = [];
  const allUrls = [];
  sitemapData.pages.forEach((pages) => {
    pages.urls.forEach((u) => allUrls.push(u));
  });

  const topLevelUrls = allUrls.filter((u) => {
    if (u.startsWith('/')) {
      // eslint-disable-next-line no-param-reassign
      u = sessionStorage.getItem('powerScoreUrl').concat(u);
    }
    const url = new URL(u);
    const segments = url.pathname.split('/').filter((seg) => seg.trim() !== '');
    return segments.length < 2;
  });
  sampledUrls.push(...topLevelUrls);
  const targetUrlCount = 50;
  const urlsToAdd = targetUrlCount - sampledUrls.length;
  if (urlsToAdd < 0) {
    // randomly remove urls to get to target count
    const urlsToRemove = sampleUrls - targetUrlCount;
    for (let i = 0; i < urlsToRemove; i += 1) {
      const randomIndex = Math.floor(Math.random() * sampledUrls.length);
      sampledUrls.splice(randomIndex, 1);
    }
  } else {
    const sampleRate = urlsToAdd / allUrls.length;
    allUrls.forEach((u) => {
      if (!sampledUrls.includes(u)) {
        const random = Math.random();
        if (random < sampleRate) {
          sampledUrls.push(u);
        }
      }
    });
  }

  return sampledUrls;
};

const clear = () => {
  Object.keys(dataCallbacks).forEach((key) => {
    delete dataCallbacks[key];
  });
};

export const initCalculations = () => {
  clear();

  observeData([DATA_TYPES.SITEMAP], ([sitemapData], sitemapError) => {
    if (sitemapError) {
      dataProviderError(DATA_TYPES.SAMPLED_URLS, sitemapError);
      return;
    }

    const urls = sampleUrls(sitemapData);
    provideData(DATA_TYPES.SAMPLED_URLS, urls);
  });

  observeData([DATA_TYPES.PSI], ([psiData], psiError) => {
    if (psiError) {
      dataProviderError(DATA_TYPES.PSI_MOBILE, psiError);
      dataProviderError(DATA_TYPES.PSI_DESKTOP, psiError);
      return;
    }
    provideData(DATA_TYPES.PSI_MOBILE, psiData.mobile);
    provideData(DATA_TYPES.PSI_DESKTOP, psiData.desktop);
  });

  observeData([DATA_TYPES.TEMPLATES], ([templatesData], templatesError) => {
    if (templatesError) {
      dataProviderError(DATA_TYPES.BLOCKS, templatesError);
      dataProviderError(DATA_TYPES.INTEGRATIONS, templatesError);
      return;
    }

    const { integrations } = templatesData;
    provideData(DATA_TYPES.INTEGRATIONS, integrations);

    const blockCount = templatesData.averageBlockCount || 27;
    provideData(DATA_TYPES.BLOCKS, { blockCount });
  });

  observeData([DATA_TYPES.RAW_TRAFFIC], ([trafficData], trafficError) => {
    if (trafficError) {
      dataProviderError(DATA_TYPES.TRAFFIC, trafficError);
      return;
    }

    let rank = trafficData.popularityRank || 'Unknown';
    const rankAsNum = Number.parseInt(
      rank.toLowerCase().replace('top', '').replaceAll(',', '').trim(),
      10,
    );
    if (Number.isNaN(rankAsNum)) {
      rank = 'Unknown';
    }
    provideData(DATA_TYPES.TRAFFIC, {
      ...trafficData,
      popularity: {
        rank,
        number: rankAsNum,
      },
    });
  });

  observeData([DATA_TYPES.DNS], ([dnsData], dnsError) => {
    if (dnsError) {
      dataProviderError(DATA_TYPES.CDN, dnsError);
      return;
    }

    const { cname } = dnsData.payload;
    let cdn = Object.values(CDN_MAP)
      .find((cdnInfo) => cdnInfo.cnames.some((aCname) => cname.includes(aCname)));
    if (!cdn) cdn = UNKNOWN_CDN;
    provideData(DATA_TYPES.CDN, { ...cdn, cname });
  });

  observeData(
    [DATA_TYPES.TEMPLATES, DATA_TYPES.BLOCKS, DATA_TYPES.INTEGRATIONS],
    ([templateData, blockData, integrationData], err) => {
      if (err) {
        dataProviderError(DATA_TYPES.CODE_COMPLEXITY, err);
        return;
      }
      const templateWeight = 1;
      const templateCount = templateData.templates.numTemplates;
      const templateScore = Math.min(templateCount * 3, 100);

      const blockWeight = 2;
      const { blockCount } = blockData;
      const blockScore = Math.min(blockCount, 100);

      let integrationScore = 0;
      const integrationWeight = 1;
      if (integrationData.commerce) integrationScore += 50;
      if (integrationData.authentication) integrationScore += 30;
      if (integrationData.forms) integrationScore += 20;

      const codeComplexity = ((templateScore * templateWeight)
        + (blockScore * blockWeight)
        + (integrationScore * integrationWeight))
        / (templateWeight + blockWeight + integrationWeight);
      provideData(DATA_TYPES.CODE_COMPLEXITY, codeComplexity);
    },
  );

  observeData([DATA_TYPES.SITEMAP, DATA_TYPES.TEMPLATES], ([sitemapData, templateData], err) => {
    if (err) {
      dataProviderError(DATA_TYPES.IMPORT_COMPLEXITY, err);
      return;
    }

    const pageCount = sitemapData.totalUrlCnt;
    const pagesWeight = 1;
    const pagesScore = Math.min(pageCount / 20, 100);

    const templateWeight = 2;
    const templateCount = templateData.templates.numTemplates;
    const templateScore = Math.min(templateCount * 3, 100);

    const importComplexity = ((pagesScore * pagesWeight)
      + (templateScore * templateWeight))
      / (pagesWeight + templateWeight);
    provideData(DATA_TYPES.IMPORT_COMPLEXITY, importComplexity);
  });

  observeData(
    [DATA_TYPES.PSI, DATA_TYPES.CDN, DATA_TYPES.TRAFFIC],
    ([psiData, cdnData, trafficData], err) => {
      if (err) {
        dataProviderError(DATA_TYPES.SITE_COMPLEXITY, err);
        return;
      }

      let cdnScore = 0;
      const cdnId = cdnData.id;
      if (cdnId === 'akamai') cdnScore = 30;
      if (cdnId === 'cloudfront') cdnScore = 55;
      if (cdnId === 'azure') cdnScore = 75;
      if (cdnId === 'wpengine') cdnScore = 100;
      if (cdnId === 'unknown') cdnScore = 100;
      const cdnWeight = 1;

      const mobilePerf = 100 - (psiData.mobile.lighthouseResult.categories.performance.score * 100);
      const psiWeight = 3;

      let trafficScore = 5;
      const trafficWeight = 2;
      const siteRank = trafficData.popularity.number;
      if (!Number.isNaN(siteRank)) {
        if (siteRank < 10000000) trafficScore = 20;
        if (siteRank < 5000000) trafficScore = 40;
        if (siteRank < 1000000) trafficScore = 60;
        if (siteRank < 100000) trafficScore = 90;
      }

      const siteComplexity = ((trafficWeight * trafficScore)
        + (mobilePerf * psiWeight)
        + (cdnWeight * cdnScore))
        / (trafficWeight + psiWeight + cdnWeight);
      provideData(DATA_TYPES.SITE_COMPLEXITY, siteComplexity);
    },
  );
};

export const loadCalculatorData = (params) => {
  provideData(DATA_TYPES.SETUP, {
    origin: params.url,
    id: params.id,
  });
  provideData(DATA_TYPES.SITEMAP, {
    totalUrlCnt: params.pages ? Number(params.pages) : 1,
    languages: params.langs ? Number(params.langs) : 1,
    sitemaps: [],
    pages: [],
  });
  provideData(DATA_TYPES.TEMPLATES, {
    templates: {
      numTemplates: params.layouts ? Number(params.layouts) : 1,
    },
  });
  provideData(DATA_TYPES.BLOCKS, {
    blockCount: params.blocks ? Number(params.blocks) : 1,
  });
  provideData(DATA_TYPES.TRAFFIC, {
    popularity: {
      number: params.trafficRank ? Number(params.trafficRank) : 5000000,
    },
  });
  provideData(DATA_TYPES.CDN, params.cdn ? CDN_MAP[params.cdn] : UNKNOWN_CDN);
  provideData(DATA_TYPES.INTEGRATIONS, {
    forms: params.forms === 'true',
    commerce: params.commerce === 'true',
    authentication: params.authentication === 'true',
  });
  provideData(DATA_TYPES.PSI, {
    mobile: {
      lighthouseResult: {
        categories: {
          performance: {
            score: params.mobilePerf ? Number(params.mobilePerf) : 0.5,
          },
        },
      },
    },
    desktop: {},
  });
  provideData(
    DATA_TYPES.CUSTOMER_COMPLEXITY,
    params.customerComplexity ? Number(params.customerComplexity) : 50,
  );
  provideData(
    DATA_TYPES.CUSTOMER_URGENCY,
    params.customerUrgency ? Number(params.customerUrgency) : 50,
  );
};

export const loadData = (url, forceUpdate = false, customSitemap = '', filterPath = '') => {
  if (window.location.hostname.includes('hlx.live') || window.location.hostname.includes('aem.live')) {
    ioBaseURL = IO_BASE_URL_PROD;
  } else {
    ioBaseURL = IO_BASE_URL_STAGE;
  }

  observeData([DATA_TYPES.SETUP], ([setupData], setupError) => {
    if (setupError) {
      dataProviderError(DATA_TYPES.SITEMAP, setupError);
      dataProviderError(DATA_TYPES.DNS, setupError);
      dataProviderError(DATA_TYPES.RAW_TRAFFIC, setupError);
      dataProviderError(DATA_TYPES.PSI, setupError);
      return;
    }

    const urlAndPath = setupData.path ? `${setupData.origin}${setupData.path}` : setupData.origin;
    invokeCfDataActionAsync(DATA_TYPES.SITEMAP, '/api/pages/', {
      powerscoreURL: urlAndPath,
      sitemapUrl: setupData.sitemapUrl,
      force: setupData.forceUpdate,
    }, 5, 300);

    invokeIoDataAction(DATA_TYPES.DNS, 'dns.json', {
      powerscoreURL: setupData.origin,
      id: setupData.id,
    });
    invokeIoDataAction(DATA_TYPES.RAW_TRAFFIC, 'get-traffic.json', {
      url: setupData.origin,
      id: setupData.id,
    });
    invokeIoDataActionAsync(DATA_TYPES.PSI, 'powerscore/psi', {
      powerscoreURL: setupData.origin,
    }, 15, 120);
  });

  observeData([DATA_TYPES.SAMPLED_URLS], ([sampledUrls], sampledUrlsError) => {
    if (sampledUrlsError) {
      dataProviderError(DATA_TYPES.TEMPLATES, sampledUrlsError);
      return;
    }

    invokeIoDataActionAsync(DATA_TYPES.TEMPLATES, 'powerscore/get-templates', {
      sampledUrls,
    }, 15, 600);
  });

  const powerScoreUrl = new URL(url);
  const powerScoreId = `${powerScoreUrl.hostname.replaceAll('.', '-')}--${filterPath ? filterPath.toLowerCase().replaceAll('/', '-') : 'root'}`;
  const powerScoreParams = {
    id: powerScoreId,
    origin: url.origin,
    path: filterPath,
    sitemapUrl: customSitemap,
    forceUpdate,
  };
  sessionStorage.setItem('powerScoreParams', JSON.stringify(powerScoreParams));
  provideData(DATA_TYPES.SETUP, powerScoreParams);
};
