export const DEFAULT_LOCALE = 'en';

export const LOCALE_DEFINITIONS = [
  ['en', 'English'],
  ['fr', 'Français'],
  ['de', 'Deutsch'],
  ['es', 'Español'],
  ['pt-BR', 'Português (Brasil)'],
  ['ja', '日本語'],
  ['ko', '한국어'],
  ['zh-Hans', '简体中文'],
  ['ar', 'العربية'],
  ['hi', 'हिन्दी'],
].map(([locale, nativeName]) => ({ locale, nativeName }));

export const SUPPORTED_LOCALES = LOCALE_DEFINITIONS.map(({ locale }) => locale);

const supported = new Set(SUPPORTED_LOCALES);
const aliases = new Map([
  ['pt', 'pt-BR'],
  ['pt-br', 'pt-BR'],
  ['zh', 'zh-Hans'],
  ['zh-cn', 'zh-Hans'],
  ['zh-sg', 'zh-Hans'],
  ['zh-hans', 'zh-Hans'],
]);

export function normalizeLocale(candidate) {
  const value = candidate?.trim();
  if (!value) return undefined;
  let locale;
  try {
    locale = new Intl.Locale(value);
  } catch {
    return undefined;
  }
  const canonical = locale.toString();
  if (supported.has(canonical)) return canonical;
  const alias = aliases.get(canonical.toLowerCase());
  if (alias) return alias;
  const { language } = locale;
  if (language === 'pt') return 'pt-BR';
  if (language === 'zh') return 'zh-Hans';
  if (supported.has(language)) return language;
  return undefined;
}

export function localeDirection(locale) {
  return locale === 'ar' ? 'rtl' : 'ltr';
}

export function localeStorageKey(org) {
  const normalizedOrg = org?.trim();
  return normalizedOrg ? `asp.locale.${normalizedOrg}` : 'asp.locale';
}

export function resolveInitialLocale({
  pageUrl,
  org,
  configuredLocale,
  documentLocale,
  browserLocales = [],
  storage = window.localStorage,
}) {
  const urlLocale = new URL(pageUrl).searchParams.get('lang');
  const orgKey = localeStorageKey(org);
  const persistedLocale = storage.getItem(orgKey)
    ?? (orgKey === localeStorageKey() ? null : storage.getItem(localeStorageKey()));
  const candidates = [
    ['url', urlLocale],
    ['persisted', persistedLocale],
    ['configured', configuredLocale],
    ['document', documentLocale],
    ...browserLocales.map((locale) => ['browser', locale]),
  ];
  const selected = candidates
    .map(([source, candidate]) => ({ source, locale: normalizeLocale(candidate) }))
    .find(({ locale }) => locale);
  return selected || { locale: DEFAULT_LOCALE, source: 'default' };
}

export function normalizePortalLocalization(value) {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const requested = Array.isArray(input.supportedLocales) ? input.supportedLocales : [];
  const supportedLocales = [DEFAULT_LOCALE];
  requested.forEach((candidate) => {
    const locale = normalizeLocale(typeof candidate === 'string' ? candidate : '');
    if (locale && !supportedLocales.includes(locale)) supportedLocales.push(locale);
  });
  const requestedDefault = normalizeLocale(input.defaultLocale);
  const defaultLocale = requestedDefault || DEFAULT_LOCALE;
  if (!supportedLocales.includes(defaultLocale)) supportedLocales.push(defaultLocale);
  return { supportedLocales, defaultLocale };
}

export function resolveVendorLocale(selectedLocale, selectionSource, localization) {
  const normalized = normalizePortalLocalization(localization);
  const preferred = normalizeLocale(selectedLocale);
  if (['url', 'persisted', 'user'].includes(selectionSource)
    && preferred && normalized.supportedLocales.includes(preferred)) {
    return preferred;
  }
  if (normalized.supportedLocales.includes(normalized.defaultLocale)) {
    return normalized.defaultLocale;
  }
  return DEFAULT_LOCALE;
}

export function resolveMetadataLabel(field, locale) {
  const labels = field?.labelByLocale && typeof field.labelByLocale === 'object'
    ? field.labelByLocale : {};
  const exact = typeof labels[locale] === 'string' ? labels[locale].trim() : '';
  if (exact) return exact;
  const language = locale.toLowerCase().split('-')[0];
  const languageEntry = Object.entries(labels).find(([candidate, label]) => (
    candidate.toLowerCase().split('-')[0] === language
      && typeof label === 'string' && label.trim()
  ));
  if (languageEntry) return languageEntry[1].trim();
  const english = typeof labels.en === 'string' ? labels.en.trim() : '';
  if (english) return english;
  return field?.label?.trim() || field?.id || '';
}

function matchingBrace(value, start) {
  let depth = 0;
  for (let index = start; index < value.length; index += 1) {
    if (value[index] === '{') depth += 1;
    else if (value[index] === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function splitArgument(argument) {
  const parts = [];
  let start = 0;
  let depth = 0;
  for (let index = 0; index < argument.length; index += 1) {
    if (argument[index] === '{') depth += 1;
    else if (argument[index] === '}') depth -= 1;
    else if (argument[index] === ',' && depth === 0 && parts.length < 2) {
      parts.push(argument.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(argument.slice(start).trim());
  return parts;
}

function pluralOptions(value) {
  const options = new Map();
  let index = 0;
  while (index < value.length) {
    while (/\s/.test(value[index] || '')) index += 1;
    const keyStart = index;
    while (index < value.length && !/\s|\{/.test(value[index])) index += 1;
    const key = value.slice(keyStart, index);
    while (/\s/.test(value[index] || '')) index += 1;
    if (!key || value[index] !== '{') break;
    const end = matchingBrace(value, index);
    if (end < 0) break;
    options.set(key, value.slice(index + 1, end));
    index = end + 1;
  }
  return options;
}

function formatDate(value, locale, kind, style) {
  const date = value instanceof Date ? value : new Date(value);
  if (kind === 'time') {
    return new Intl.DateTimeFormat(locale, { timeStyle: style || 'short' }).format(date);
  }
  return new Intl.DateTimeFormat(locale, { dateStyle: style || 'medium' }).format(date);
}

function formatArgument(argument, values, locale) {
  const [name, type, detail] = splitArgument(argument);
  const value = values[name];
  if (!type) return value ?? '';
  if (type === 'number') return new Intl.NumberFormat(locale).format(Number(value));
  if (type === 'date' || type === 'time') return formatDate(value, locale, type, detail);
  if (type === 'plural') {
    const count = Number(value);
    const options = pluralOptions(detail);
    const exact = options.get(`=${count}`);
    const category = new Intl.PluralRules(locale).select(count);
    const selected = exact ?? options.get(category) ?? options.get('other') ?? '';
    // Plural branches recurse through the formatter.
    // eslint-disable-next-line no-use-before-define
    return formatPattern(selected, values, locale).replaceAll(
      '#',
      new Intl.NumberFormat(locale).format(count),
    );
  }
  return value ?? '';
}

export function formatPattern(pattern, values = {}, locale = DEFAULT_LOCALE) {
  let output = '';
  let index = 0;
  while (index < pattern.length) {
    if (pattern[index] === '{') {
      const end = matchingBrace(pattern, index);
      if (end < 0) {
        output += pattern.slice(index);
        break;
      }
      output += formatArgument(pattern.slice(index + 1, end), values, locale);
      index = end + 1;
    } else {
      output += pattern[index];
      index += 1;
    }
  }
  return output;
}

export function createI18n(locale, catalog) {
  return {
    locale,
    direction: localeDirection(locale),
    t(key, values) {
      const pattern = catalog[key];
      return typeof pattern === 'string' ? formatPattern(pattern, values, locale) : '';
    },
    formatNumber(value, options) {
      return new Intl.NumberFormat(locale, options).format(value);
    },
    formatDate(value, options) {
      return new Intl.DateTimeFormat(locale, options).format(new Date(value));
    },
    formatBytes(value) {
      if (!Number.isFinite(value) || value < 0) return '';
      const units = ['byte', 'kilobyte', 'megabyte', 'gigabyte'];
      let amount = value;
      let unitIndex = 0;
      while (amount >= 1024 && unitIndex < units.length - 1) {
        amount /= 1024;
        unitIndex += 1;
      }
      return new Intl.NumberFormat(locale, {
        style: 'unit',
        unit: units[unitIndex],
        unitDisplay: 'short',
        maximumFractionDigits: unitIndex === 0 ? 0 : 1,
      }).format(amount);
    },
  };
}

async function fetchJson(fetchImpl, url) {
  const response = await fetchImpl(url, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`Translation request failed (${response.status})`);
  return {
    data: await response.json(),
    url: response.url || url,
  };
}

export class CatalogLoader {
  constructor(manifestUrl, fetchImpl = window.fetch.bind(window)) {
    this.manifestUrl = manifestUrl;
    this.fetchImpl = fetchImpl;
    this.manifestPromise = null;
    this.resolvedManifestUrl = manifestUrl;
    this.catalogPromises = new Map();
  }

  async manifest() {
    if (!this.manifestPromise) {
      this.manifestPromise = fetchJson(this.fetchImpl, this.manifestUrl);
    }
    const result = await this.manifestPromise;
    const manifest = result.data;
    this.resolvedManifestUrl = result.url;
    if (!manifest || typeof manifest !== 'object' || !manifest.catalogs
      || typeof manifest.catalogs !== 'object') {
      throw new Error('The translation manifest is invalid.');
    }
    return manifest;
  }

  async catalog(locale, manifest) {
    const descriptor = manifest.catalogs[locale];
    if (!descriptor || typeof descriptor.url !== 'string') {
      throw new Error(`Translation catalog unavailable for ${locale}`);
    }
    if (!this.catalogPromises.has(locale)) {
      const url = new URL(descriptor.url, this.resolvedManifestUrl).toString();
      const promise = fetchJson(this.fetchImpl, url).then(({ data }) => data);
      this.catalogPromises.set(locale, promise);
    }
    try {
      return await this.catalogPromises.get(locale);
    } catch (error) {
      this.catalogPromises.delete(locale);
      throw error;
    }
  }

  async load(locale) {
    const manifest = await this.manifest();
    try {
      const catalog = await this.catalog(locale, manifest);
      return createI18n(locale, catalog);
    } catch (error) {
      if (locale === DEFAULT_LOCALE) throw error;
      const catalog = await this.catalog(DEFAULT_LOCALE, manifest);
      return createI18n(DEFAULT_LOCALE, catalog);
    }
  }
}

export function applyDocumentLocale(i18n) {
  document.documentElement.lang = i18n.locale;
  document.documentElement.dir = i18n.direction;
}

export function persistLocale(locale, org, storage = window.localStorage) {
  storage.setItem(localeStorageKey(org), locale);
}

export function replaceUrlLocale(
  locale,
  pageUrl = window.location.href,
  historyImpl = window.history,
) {
  const url = new URL(pageUrl);
  url.searchParams.set('lang', locale);
  historyImpl.replaceState(historyImpl.state, '', url);
  return url.toString();
}

export const ERROR_MESSAGE_KEYS = {
  AUTH_REQUIRED: 'error.auth.required',
  INVALID_PASSWORD: 'error.auth.invalidPassword',
  PASSWORD_EXPIRED: 'error.auth.expiredPassword',
  FORCE_PASSWORD_ROTATION_REQUIRED: 'error.auth.forcePasswordRotation',
  LOGIN_LOCKED: 'error.auth.locked',
  USERNAME_PASSWORD_MISMATCH: 'error.auth.usernamePasswordMismatch',
  VENDOR_NOT_FOUND: 'error.vendor.notFound',
  VENDOR_UNAVAILABLE: 'error.vendor.unavailable',
  INVALID_ORGANIZATION: 'error.organization.invalid',
  INVALID_SESSION: 'error.auth.invalidSession',
  PASSWORD_ROTATION_NOT_ALLOWED: 'error.passwordRotation.notAllowed',
  INVALID_REQUEST: 'error.request.invalid',
  INVALID_METADATA: 'error.metadata.invalid',
  INVALID_UPLOAD_PATH: 'error.upload.invalidPath',
  FILE_TYPE_NOT_ALLOWED: 'error.upload.fileType',
  FILE_TOO_LARGE: 'error.upload.fileTooLarge',
  DUPLICATE_FILE: 'error.upload.duplicate',
  UPLOAD_SESSION_EXPIRED: 'error.upload.sessionExpired',
  UPLOAD_FAILED: 'error.upload.failed',
  SERVICE_UNAVAILABLE: 'error.service.unavailable',
};

export function localizeError(i18n, error) {
  const key = ERROR_MESSAGE_KEYS[error?.code] || 'error.generic';
  return i18n.t(key, error?.params);
}
