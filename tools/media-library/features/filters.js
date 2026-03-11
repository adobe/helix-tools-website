import { getMediaType, isSvgFile } from '../core/media.js';
import { pluralize } from '../core/utils.js';
import { getDedupeKey } from '../core/urls.js';
import {
  Operation,
} from '../core/constants.js';

function normalizeFolderPath(path) {
  return !path || path === '/' ? '/' : path.replace(/\/$/, '');
}

function formatDocPath(doc) {
  return (doc || '').replace(/\.(md|html)$/, '');
}

function getUsageCountFromIndex(usageIndex, groupingKey) {
  if (!usageIndex) return null;
  const entries = usageIndex.get(groupingKey);
  if (!entries?.length) return null;
  const uniqueDocs = new Set(entries.map((e) => e.doc).filter(Boolean));
  return uniqueDocs.size;
}

function resolveSearchPath(value, basePath) {
  let searchPath = value.startsWith('/') ? value : `/${value}`;
  if (basePath && !searchPath.startsWith(basePath)) {
    searchPath = searchPath === '/' ? basePath : `${basePath}${searchPath}`;
  }
  return searchPath;
}

function docMatchesSelected(item, selectedDocument) {
  if (!selectedDocument || !item) return false;
  const searchPath = resolveSearchPath(selectedDocument, '').toLowerCase();
  const check = (doc) => doc && doc.toLowerCase().includes(searchPath);
  return check(item.doc) || (item.uniqueSources && item.uniqueSources.some(check));
}

function folderPathMatchesSelected(docPath, selectedFolder) {
  if (!docPath || !selectedFolder) return false;
  const normalizedFolder = normalizeFolderPath(selectedFolder);
  const searchPath = (normalizedFolder.startsWith('/') ? normalizedFolder : `/${normalizedFolder}`).toLowerCase();

  if (searchPath === '/' || searchPath === '') {
    return !docPath.includes('/', 1);
  }

  const cleanPath = docPath.replace(/\.html$/, '');
  const parts = cleanPath.split('/');
  if (parts.length < 2) return false;
  const folderPath = parts.slice(0, -1).join('/').toLowerCase();
  return folderPath.startsWith(searchPath);
}

export const FILTER_CONFIG = {
  all: (item) => !isSvgFile(item),
  documents: (item) => getMediaType(item) === 'document',
  fragments: (item) => getMediaType(item) === 'fragment',
  images: (item) => getMediaType(item) === 'image' && !isSvgFile(item),
  icons: (item) => isSvgFile(item),
  links: (item) => item.operation === Operation.EXTLINKS
    || item.operation === Operation.MARKDOWN_PARSED || getMediaType(item) === 'link',
  noReferences: (item) => item.status === 'unused',
  videos: (item) => getMediaType(item) === 'video',

  documentImages: (item, selectedDocument) => FILTER_CONFIG.images(item)
  && docMatchesSelected(item, selectedDocument),
  documentIcons: (item, selectedDocument) => FILTER_CONFIG.icons(item)
  && docMatchesSelected(item, selectedDocument),
  documentVideos: (item, selectedDocument) => FILTER_CONFIG.videos(item)
   && docMatchesSelected(item, selectedDocument),
  documentDocuments: (item, selectedDocument) => FILTER_CONFIG.documents(item)
   && docMatchesSelected(item, selectedDocument),
  documentFragments: (item, selectedDocument) => FILTER_CONFIG.fragments(item)
   && docMatchesSelected(item, selectedDocument),
  documentLinks: (item, selectedDocument) => FILTER_CONFIG.links(item)
   && docMatchesSelected(item, selectedDocument),

  documentTotal: (item, selectedDocument) => docMatchesSelected(item, selectedDocument),
};

export function applyFilter(data, filterName, selectedDocument) {
  const filterFn = FILTER_CONFIG[filterName];

  if (filterFn) {
    if (filterName.startsWith('document')) {
      return data.filter((item) => filterFn(item, selectedDocument));
    }
    return data.filter(filterFn);
  }

  return data;
}

function chunkArray(array, chunkSize) {
  const chunks = [];
  for (let i = 0; i < array.length; i += chunkSize) {
    chunks.push(array.slice(i, i + chunkSize));
  }
  return chunks;
}

export function initializeProcessedData() {
  const filterArrays = {};
  const usageData = {};
  const filterCounts = {};

  Object.keys(FILTER_CONFIG).forEach((filterName) => {
    if (!filterName.startsWith('document')) {
      filterArrays[filterName] = [];
    }
  });

  return {
    filterArrays,
    usageData,
    filterCounts,
    totalCount: 0,
  };
}

export async function processMediaData(mediaData, onProgress = null) {
  if (!mediaData || mediaData.length === 0) {
    return initializeProcessedData();
  }

  const processedData = initializeProcessedData();
  const uniqueMediaUrls = new Set();
  const uniqueNonSvgUrls = new Set();

  let batchSize = 1000;
  if (mediaData.length > 100000) {
    batchSize = 500;
  } else if (mediaData.length > 10000) {
    batchSize = 250;
  } else if (mediaData.length > 1000) {
    batchSize = 200;
  }

  const batches = chunkArray(mediaData, batchSize);
  const totalBatches = batches.length;

  const processBatch = (batch, index) => {
    batch.forEach((item) => {
      if (!item.hash) return;

      if (item.url) {
        const groupingKey = getDedupeKey(item.url);
        if (!processedData.usageData[groupingKey]) {
          processedData.usageData[groupingKey] = {
            hashes: [],
            uniqueDocs: new Set(),
            count: 0,
          };
        }
        processedData.usageData[groupingKey].hashes.push(item.hash);

        if (item.doc) {
          processedData.usageData[groupingKey].uniqueDocs.add(item.doc);
        }

        const ud = processedData.usageData[groupingKey].uniqueDocs;
        processedData.usageData[groupingKey].count = ud.size;
      }

      Object.keys(processedData.filterArrays).forEach((filterName) => {
        if (FILTER_CONFIG[filterName](item)) {
          processedData.filterArrays[filterName].push(item.hash);
        }
      });

      if (item.url) {
        uniqueMediaUrls.add(item.url);
        if (!isSvgFile(item)) {
          uniqueNonSvgUrls.add(item.url);
        }
      }
    });

    if (onProgress) {
      onProgress(((index + 1) / totalBatches) * 100);
    }
  };

  const runBatch = (index) => {
    if (index >= batches.length) return Promise.resolve();
    processBatch(batches[index], index);
    if (index < batches.length - 1) {
      let delay = 0;
      if (mediaData.length > 100000 && index % 5 === 0) delay = 1;
      else if (mediaData.length > 10000 && index % 3 === 0) delay = 1;
      return new Promise((resolve) => {
        setTimeout(resolve, delay);
      }).then(() => runBatch(index + 1));
    }
    return Promise.resolve();
  };

  await runBatch(0);

  const hashToItemMap = new Map();
  const groupingKeyToUrl = new Map();

  mediaData.forEach((item) => {
    if (item.hash) {
      hashToItemMap.set(item.hash, item);
    }
    if (item.url) {
      const groupingKey = getDedupeKey(item.url);
      groupingKeyToUrl.set(groupingKey, item.url);
    }
  });

  Object.keys(processedData.filterArrays).forEach((filterName) => {
    const uniqueUrls = new Set();
    processedData.filterArrays[filterName].forEach((hash) => {
      const item = hashToItemMap.get(hash);
      if (item && item.url) {
        uniqueUrls.add(item.url);
      }
    });
    processedData.filterCounts[filterName] = uniqueUrls.size;
  });

  processedData.filterCounts.all = uniqueNonSvgUrls.size;
  processedData.totalCount = uniqueMediaUrls.size;

  return processedData;
}

const SUPPORTED_COLON_FIELDS = ['doc', 'name', 'url', 'folder'];

export function parseColonSyntax(query) {
  if (!query) return null;

  const colonMatch = query.match(/^([a-zA-Z]+):(.*)$/);
  if (!colonMatch) return null;

  const [, rawField, rawValue] = colonMatch;
  const field = rawField.toLowerCase();
  if (!SUPPORTED_COLON_FIELDS.includes(field)) return null;

  return {
    field,
    value: rawValue.trim().toLowerCase(),
    originalQuery: query,
  };
}

function filterByColonSyntax(mediaData, colonSyntax) {
  const { field, value } = colonSyntax;

  const filteredResults = mediaData.filter((item) => {
    switch (field) {
      case 'doc': {
        if (!item.doc) return false;
        const searchPath = resolveSearchPath(value, '');
        return item.doc.toLowerCase().includes(searchPath);
      }
      case 'name':
        return item.name && item.name.toLowerCase().includes(value);
      case 'url':
        return item.url && item.url.toLowerCase().includes(value);
      case 'folder': {
        if (!item.doc) return false;

        const normalizedValue = normalizeFolderPath(value);

        if (normalizedValue === '' || normalizedValue === '/') {
          return !item.doc.includes('/', 1);
        }

        const cleanPath = item.doc.replace(/\.html$/, '');
        const parts = cleanPath.split('/');

        if (parts.length > 2) {
          const folderPath = parts.slice(0, -1).join('/');
          const searchPath = resolveSearchPath(normalizedValue, '');
          return folderPath.startsWith(searchPath);
        }

        return false;
      }
      default:
        return false;
    }
  });

  return filteredResults;
}

function filterByGeneralSearch(mediaData, query) {
  const results = [];
  for (let i = 0; i < mediaData.length; i += 1) {
    const item = mediaData[i];
    if ((item.name && item.name.toLowerCase().includes(query))
        || (item.url && item.url.toLowerCase().includes(query))
        || (item.doc && item.doc.toLowerCase().includes(query))) {
      results.push(item);
    }
  }
  return results;
}

export function filterBySearch(mediaData, searchQuery) {
  if (!searchQuery || !searchQuery.trim() || !mediaData) {
    return mediaData;
  }

  const query = searchQuery.toLowerCase().trim();
  const colonSyntax = parseColonSyntax(query);

  if (colonSyntax) {
    return filterByColonSyntax(mediaData, colonSyntax);
  }

  return filterByGeneralSearch(mediaData, query);
}

/**
 * Derive folder paths from document paths.
 * For /products/electronics/reviews → folders: /products, /products/electronics.
 */
function getFolderPathsFromDocs(mediaData) {
  const folders = new Set();
  const addFromPath = (path) => {
    const clean = (path || '').replace(/\.html$/, '').trim();
    if (!clean) return;
    const parts = clean.split('/').filter(Boolean);
    for (let i = 1; i < parts.length; i += 1) {
      if (parts[i - 1]?.startsWith('.')) break;
      folders.add(`/${parts.slice(0, i).join('/')}`);
    }
  };
  (mediaData || []).forEach((item) => {
    if (item.doc) addFromPath(item.doc);
    item.uniqueSources?.forEach(addFromPath);
  });
  return folders;
}

function getFolderSuggestions(folderPathsCache, value) {
  const basePath = '';

  if (!folderPathsCache || folderPathsCache.size === 0) {
    return [];
  }

  const searchPath = resolveSearchPath(value, basePath);

  const hasDotSegment = (p) => p.split('/').some((seg) => seg?.startsWith('.'));

  const filteredPaths = Array.from(folderPathsCache).filter((folderPath) => {
    if (hasDotSegment(folderPath)) return false;
    if (value === '' || value === '/') {
      return true;
    }

    if (searchPath.endsWith('/')) {
      return folderPath.startsWith(searchPath) && folderPath !== searchPath.slice(0, -1);
    }

    return folderPath.startsWith(searchPath);
  });

  const sortedPaths = filteredPaths.sort((a, b) => {
    const depthA = (a.match(/\//g) || []).length;
    const depthB = (b.match(/\//g) || []).length;
    if (depthA !== depthB) {
      return depthA - depthB;
    }
    return a.localeCompare(b);
  });

  const folderSuggestions = sortedPaths
    .map((folderPath) => {
      let displayPath = folderPath;
      if (basePath && folderPath.startsWith(basePath)) {
        displayPath = folderPath.substring(basePath.length) || '/';
        if (displayPath && !displayPath.startsWith('/')) {
          displayPath = `/${displayPath}`;
        }
      }
      return {
        type: 'folder',
        value: displayPath,
        display: displayPath,
        absolutePath: folderPath,
      };
    })
    .filter((suggestion) => {
      if (basePath && suggestion.value === '/') {
        return false;
      }
      return true;
    });

  return folderSuggestions;
}

function getDocSuggestions(mediaData, value) {
  const basePath = '';

  if (!mediaData || mediaData.length === 0) {
    return [];
  }

  const searchPath = resolveSearchPath(value, basePath);

  const matchingDocs = new Set();

  mediaData.forEach((item) => {
    if (!item.doc) return;

    const docPath = item.doc.trim();
    if (value === '' || value === '/') {
      const cleanPath = docPath.replace(/\.html$/, '');
      if (!cleanPath.includes('/', 1)) {
        matchingDocs.add(docPath);
      }
    } else if (searchPath.endsWith('/')) {
      const cleanPath = docPath.replace(/\.html$/, '');
      const parts = cleanPath.split('/');
      if (parts.length > 1) {
        const folderPath = parts.slice(0, -1).join('/');
        if (folderPath === searchPath.slice(0, -1)) {
          matchingDocs.add(docPath);
        }
      }
    } else {
      const cleanPath = docPath.replace(/\.html$/, '');
      if (cleanPath.startsWith(searchPath)) {
        matchingDocs.add(docPath);
      }
    }
  });

  const sortedDocs = Array.from(matchingDocs).sort((a, b) => {
    const depthA = (a.match(/\//g) || []).length;
    const depthB = (b.match(/\//g) || []).length;
    if (depthA !== depthB) {
      return depthA - depthB;
    }
    return a.localeCompare(b);
  });

  const docSuggestions = sortedDocs.map((doc) => {
    const normalizedDoc = formatDocPath(doc);
    let displayPath = normalizedDoc;
    if (basePath && normalizedDoc.startsWith(basePath)) {
      displayPath = normalizedDoc.substring(basePath.length) || '/';
      if (displayPath && !displayPath.startsWith('/')) {
        displayPath = `/${displayPath}`;
      }
    }
    return {
      type: 'doc',
      value: displayPath,
      display: displayPath,
      absolutePath: doc,
    };
  });

  return docSuggestions;
}

export function getSearchSuggestions(
  mediaData,
  query,
  createSuggestionFn,
  folderPathsCache = null,
) {
  if (!query || !query.trim() || !mediaData) {
    return [];
  }

  const q = query.toLowerCase().trim();
  const colonSyntax = parseColonSyntax(query);

  if (colonSyntax) {
    const { field, value } = colonSyntax;

    if (field === 'folder') {
      const folderPaths = (folderPathsCache?.size > 0)
        ? folderPathsCache
        : getFolderPathsFromDocs(mediaData);
      return getFolderSuggestions(folderPaths, value).slice(0, 10);
    }

    if (field === 'doc') {
      return getDocSuggestions(mediaData, value).slice(0, 10);
    }

    const suggestions = [];

    mediaData.forEach((item) => {
      switch (field) {
        case 'name': {
          if (item.name && item.name.toLowerCase().includes(value) && !isSvgFile(item)) {
            const suggestion = createSuggestionFn(item);
            if (suggestion) suggestions.push(suggestion);
          }
          break;
        }
        case 'url': {
          if (item.url && item.url.toLowerCase().includes(value) && !isSvgFile(item)) {
            const suggestion = createSuggestionFn(item);
            if (suggestion) suggestions.push(suggestion);
          }
          break;
        }
        default:
          break;
      }
    });

    return [...suggestions].slice(0, 10);
  }

  if (q.startsWith('/')) {
    const docFolderPaths = getFolderPathsFromDocs(mediaData);
    const folderPaths = docFolderPaths.size > 0
      ? docFolderPaths
      : (folderPathsCache || new Set());
    const folderSuggestions = getFolderSuggestions(folderPaths, q);
    const docSuggestions = getDocSuggestions(mediaData, q);

    const seen = new Set();
    const combined = [];
    [...folderSuggestions, ...docSuggestions].forEach((s) => {
      const key = (s.display || s.value || '').toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        combined.push(s);
      }
    });

    combined.sort((a, b) => {
      const depthA = (a.display.match(/\//g) || []).length;
      const depthB = (b.display.match(/\//g) || []).length;
      if (depthA !== depthB) {
        return depthA - depthB;
      }
      return a.display.localeCompare(b.display);
    });

    return combined.slice(0, 10);
  }

  const suggestions = [];
  const matchingDocs = new Set();

  mediaData.forEach((item) => {
    if (item.doc && item.doc.toLowerCase().includes(q)) {
      matchingDocs.add(item.doc);
    }

    if (!isSvgFile(item) && (
      (item.name && item.name.toLowerCase().includes(q))
        || (item.url && item.url.toLowerCase().includes(q))
    )) {
      const suggestion = createSuggestionFn(item);
      if (suggestion) suggestions.push(suggestion);
    }
  });

  const docSuggestions = Array.from(matchingDocs).map((doc) => ({
    type: 'doc',
    value: formatDocPath(doc),
    display: formatDocPath(doc),
    absolutePath: doc,
  }));

  return [...docSuggestions, ...suggestions].slice(0, 10);
}

export function createSearchSuggestion(item) {
  if (!item.name && !item.url && !item.doc) return null;

  if (isSvgFile(item)) return null;

  const firstDoc = item.doc || null;

  return {
    type: 'media',
    value: item,
    display: item.name || item.url || 'Unnamed Media',
    details: {
      doc: firstDoc ? formatDocPath(firstDoc) : null,
      url: item.url,
      type: getMediaType(item),
    },
  };
}

export function filterByDocument(
  processedData,
  mediaData,
  selectedDocument,
  selectedFilterType,
  usageIndex = null,
) {
  if (!selectedDocument || !mediaData) {
    return [];
  }

  const documentItems = mediaData.filter((item) => docMatchesSelected(item, selectedDocument));

  const seenUrls = new Set();
  const uniqueDocumentItems = documentItems.filter((item) => {
    if (!item.url) return true;
    if (seenUrls.has(item.url)) return false;
    seenUrls.add(item.url);
    return true;
  }).map((item) => {
    const groupingKey = getDedupeKey(item.url);
    const fromIndex = getUsageCountFromIndex(usageIndex, groupingKey);
    const fromProcessed = processedData?.usageData?.[groupingKey]?.count ?? null;
    const usageCount = fromIndex ?? fromProcessed ?? 0;

    return {
      ...item,
      usageCount,
    };
  });

  if (selectedFilterType && selectedFilterType !== 'documentTotal') {
    return applyFilter(uniqueDocumentItems, selectedFilterType, selectedDocument);
  }

  return uniqueDocumentItems;
}

export function filterByFolder(data, selectedFolder, usageIndex) {
  if (!selectedFolder || !data) {
    return data;
  }

  if (usageIndex && usageIndex.size > 0) {
    const mediaUrlsInFolder = new Set();

    const groupingKeyToMediaItem = new Map();
    data.forEach((item) => {
      const key = getDedupeKey(item.url);
      if (!groupingKeyToMediaItem.has(key)) {
        groupingKeyToMediaItem.set(key, item);
      }
    });

    usageIndex.forEach((usageEntries, groupingKey) => {
      usageEntries.forEach((entry) => {
        if (!entry.doc) return;

        const isInFolder = folderPathMatchesSelected(entry.doc, selectedFolder);

        if (isInFolder) {
          const mediaItem = groupingKeyToMediaItem.get(groupingKey);
          if (mediaItem) {
            mediaUrlsInFolder.add(mediaItem.url);
          }
        }
      });
    });

    return data.filter((item) => mediaUrlsInFolder.has(item.url));
  }

  return data.filter((item) => folderPathMatchesSelected(item.doc, selectedFolder));
}

export function getFilterLabel(filterType, count = 0) {
  const labels = {
    all: { singular: 'item', plural: 'items' },
    documents: { singular: 'PDF', plural: 'PDFs' },
    fragments: { singular: 'fragment', plural: 'fragments' },
    images: { singular: 'image', plural: 'images' },
    icons: { singular: 'SVG', plural: 'SVGs' },
    links: { singular: 'link', plural: 'links' },
    noReferences: { singular: 'item', plural: 'items' },
    videos: { singular: 'video', plural: 'videos' },
  };

  const label = labels[filterType] || labels.all;
  return pluralize(label.singular, label.plural, count);
}

export function computeResultSummary(
  mediaData,
  filteredData,
  searchQuery,
  filterType,
  options = {},
) {
  const { displayCount } = options;
  const count = displayCount !== undefined ? displayCount : (filteredData?.length ?? 0);
  if (count === 0 && (!mediaData || mediaData.length === 0)) {
    return '';
  }
  const filterLabel = getFilterLabel(filterType, count);

  if (!searchQuery) {
    return `${count} ${filterLabel}`;
  }

  const colonSyntax = parseColonSyntax(searchQuery);

  if (colonSyntax) {
    const { field, value } = colonSyntax;

    if (field === 'folder') {
      const folderPath = value || '/';
      return `${count} ${filterLabel} in ${folderPath}`;
    }

    if (field === 'doc') {
      const docPath = value.replace(/\.html$/, '');
      return `${count} ${filterLabel} in ${docPath}`;
    }

    return `${count} ${filterLabel}`;
  }

  return `${count} ${filterLabel}`;
}

export function deduplicateAndEnrich(sourceData, processedData, usageIndex = null) {
  const uniqueItems = [];
  const seenKeys = new Set();

  sourceData.forEach((item) => {
    const groupingKey = getDedupeKey(item.url);
    if (!seenKeys.has(groupingKey)) {
      seenKeys.add(groupingKey);

      // Prefer usageIndex (fresh) over processedData (cached)
      const fromIndex = getUsageCountFromIndex(usageIndex, groupingKey);
      const fromProcessed = processedData?.usageData?.[groupingKey]?.count ?? null;
      const usageCount = fromIndex ?? fromProcessed ?? 0;

      uniqueItems.push({
        ...item,
        usageCount,
      });
    }
  });

  return uniqueItems;
}

export function filterByDocumentUsage(uniqueItems, selectedDocument, usageIndex) {
  if (!selectedDocument || !usageIndex) {
    return uniqueItems;
  }

  const docFilteredItems = [];
  const groupingKeyToMediaItem = new Map();

  uniqueItems.forEach((item) => {
    const key = getDedupeKey(item.url);
    if (!groupingKeyToMediaItem.has(key)) {
      groupingKeyToMediaItem.set(key, item);
    }
  });

  usageIndex.forEach((usageEntries, groupingKey) => {
    const check = (doc) => doc && doc.toLowerCase().includes(resolveSearchPath(selectedDocument, '').toLowerCase());
    const hasDocUsage = usageEntries.some((entry) => check(entry.doc));
    if (hasDocUsage && groupingKeyToMediaItem.has(groupingKey)) {
      docFilteredItems.push(groupingKeyToMediaItem.get(groupingKey));
    }
  });

  return docFilteredItems;
}

/**
 * Filters media by search, document, folder, and type.
 * Order: search → document filter → dedupe → folder/doc-usage → type filter.
 * When selectedDocument + document* filterType, filterByDocument handles both.
 */
export function filterMedia(sourceData, options) {
  const {
    searchQuery,
    selectedDocument,
    selectedFolder,
    selectedFilterType,
    usageIndex,
    processedData,
  } = options;

  if (!sourceData || sourceData.length === 0) {
    return [];
  }

  let data = sourceData;

  if (searchQuery && searchQuery.trim()) {
    data = filterBySearch(data, searchQuery);
  }

  if (selectedDocument) {
    data = data.filter((item) => docMatchesSelected(item, selectedDocument));
  }

  if (selectedFilterType && selectedFilterType.startsWith('document')
      && selectedFilterType !== 'documents' && processedData) {
    return filterByDocument(
      processedData,
      data,
      selectedDocument,
      selectedFilterType,
      usageIndex,
    );
  }

  const uniqueItems = deduplicateAndEnrich(data, processedData, usageIndex);

  let dataWithUsageCounts = uniqueItems;
  if (selectedFolder) {
    dataWithUsageCounts = filterByFolder(
      uniqueItems,
      selectedFolder,
      usageIndex,
    );
  } else if (selectedDocument && usageIndex) {
    dataWithUsageCounts = filterByDocumentUsage(uniqueItems, selectedDocument, usageIndex);
  }

  if (selectedFilterType && selectedFilterType !== 'all') {
    return applyFilter(
      dataWithUsageCounts,
      selectedFilterType,
      selectedDocument,
    );
  }

  return dataWithUsageCounts;
}
