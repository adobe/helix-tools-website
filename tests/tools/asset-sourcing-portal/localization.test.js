import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CatalogLoader,
  createI18n,
  formatPattern,
  localeStorageKey,
  localizeError,
  normalizeLocale,
  persistLocale,
  replaceUrlLocale,
  resolveInitialLocale,
  resolveMetadataLabel,
  resolveVendorLocale,
} from '../../../tools/asset-sourcing-portal/localization.js';

describe('portal localization', () => {
  it('resolves URL, org-scoped persistence, configured, page, and browser locales in order', () => {
    const storage = new Map([[localeStorageKey('customer'), 'fr']]);
    const resolve = (pageUrl, configuredLocale = 'de') => resolveInitialLocale({
      pageUrl,
      org: 'customer',
      configuredLocale,
      documentLocale: 'es',
      browserLocales: ['hi'],
      storage: { getItem: (key) => storage.get(key) ?? null },
    });
    assert.deepEqual(resolve('https://portal.example/?org=customer&lang=ar'), {
      locale: 'ar',
      source: 'url',
    });
    assert.deepEqual(resolve('https://portal.example/?org=customer'), {
      locale: 'fr',
      source: 'persisted',
    });
    storage.clear();
    assert.deepEqual(resolve('https://portal.example/?org=customer'), {
      locale: 'de',
      source: 'configured',
    });
    assert.equal(normalizeLocale('pt-PT'), 'pt-BR');
    assert.equal(normalizeLocale('zh-CN'), 'zh-Hans');
  });

  it('uses vendor defaults unless an explicit supported preference exists', () => {
    const config = { supportedLocales: ['en', 'fr', 'ar'], defaultLocale: 'fr' };
    assert.equal(resolveVendorLocale('ar', 'url', config), 'ar');
    assert.equal(resolveVendorLocale('hi', 'url', config), 'fr');
    assert.equal(resolveVendorLocale('ar', 'browser', config), 'fr');
    assert.equal(resolveVendorLocale('de', 'persisted', {
      supportedLocales: ['en'],
      defaultLocale: 'de',
    }), 'de');
  });

  it('resolves localized metadata labels without changing values', () => {
    const field = {
      id: 'dc:title',
      label: 'Configured title',
      labelByLocale: { en: 'Title', fr: 'Titre', 'pt-BR': 'Título' },
    };
    assert.equal(resolveMetadataLabel(field, 'fr'), 'Titre');
    assert.equal(resolveMetadataLabel(field, 'pt-BR'), 'Título');
    assert.equal(resolveMetadataLabel(field, 'de'), 'Title');
    assert.equal(resolveMetadataLabel({ id: 'campaign' }, 'hi'), 'campaign');
  });

  it('formats ICU plurals, localized numbers, and dates', () => {
    assert.equal(
      formatPattern(
        '{count, plural, one {# file} other {# files}}',
        { count: 2 },
        'fr',
      ),
      '2 files',
    );
    const i18n = createI18n('hi', {
      count: '{count, plural, one {# फ़ाइल} other {# फ़ाइलें}}',
      limit: '{limit, number}',
    });
    assert.equal(i18n.t('count', { count: 3 }), '3 फ़ाइलें');
    assert.equal(i18n.t('limit', { limit: 1000 }), '1,000');
    assert.equal(createI18n('ar', {}).direction, 'rtl');
  });

  it('persists only the org locale and preserves URL organization parameters', () => {
    const stored = new Map();
    persistLocale('fr', 'customer/one', {
      setItem: (key, value) => stored.set(key, value),
    });
    assert.deepEqual([...stored], [['asp.locale.customer/one', 'fr']]);
    const result = replaceUrlLocale(
      'hi',
      'https://portal.example/index.html?org=customer%2Fone&campaign=spring',
      { state: null, replaceState: () => {} },
    );
    const url = new URL(result);
    assert.equal(url.searchParams.get('org'), 'customer/one');
    assert.equal(url.searchParams.get('campaign'), 'spring');
    assert.equal(url.searchParams.get('lang'), 'hi');
  });

  it('maps structured errors to localized catalog messages', () => {
    const i18n = createI18n('fr', {
      'error.auth.invalidPassword': 'Mot de passe non valide',
      'error.upload.fileTooLarge': 'Maximum {maxFileBytes, number}',
      'error.generic': 'Erreur générique',
    });
    assert.equal(localizeError(i18n, {
      code: 'INVALID_PASSWORD',
      error: 'Raw backend English',
    }), 'Mot de passe non valide');
    assert.equal(localizeError(i18n, {
      code: 'FILE_TOO_LARGE',
      params: { maxFileBytes: 1000 },
    }), 'Maximum 1 000');
  });

  it('loads one selected hashed catalog and retries English only after failure', async () => {
    const requests = [];
    const responses = new Map([
      ['https://api.example/i18n/manifest.json', {
        catalogs: {
          en: { url: './en.hash.json', sha256: 'one' },
          fr: { url: './fr.hash.json', sha256: 'two' },
        },
      }],
      ['https://api.example/i18n/fr.hash.json', { hello: 'Bonjour' }],
      ['https://api.example/i18n/en.hash.json', { hello: 'Hello' }],
    ]);
    const fetchImpl = async (url) => {
      requests.push(url);
      return new Response(JSON.stringify(responses.get(url)), {
        status: responses.has(url) ? 200 : 404,
        headers: { 'content-type': 'application/json' },
      });
    };
    const loader = new CatalogLoader(
      'https://api.example/i18n/manifest.json',
      fetchImpl,
    );
    const french = await loader.load('fr');
    assert.equal(french.t('hello'), 'Bonjour');
    assert.deepEqual(requests, [
      'https://api.example/i18n/manifest.json',
      'https://api.example/i18n/fr.hash.json',
    ]);

    responses.delete('https://api.example/i18n/fr.hash.json');
    const retryLoader = new CatalogLoader(
      'https://api.example/i18n/manifest.json',
      fetchImpl,
    );
    requests.length = 0;
    const fallback = await retryLoader.load('fr');
    assert.equal(fallback.locale, 'en');
    assert.equal(fallback.t('hello'), 'Hello');
    assert.deepEqual(requests, [
      'https://api.example/i18n/manifest.json',
      'https://api.example/i18n/fr.hash.json',
      'https://api.example/i18n/en.hash.json',
    ]);
  });

  it('resolves hashed catalogs relative to the final manifest URL', async () => {
    const requests = [];
    const fetchImpl = async (url) => {
      requests.push(url);
      if (url === 'https://api.example/i18n/manifest.json') {
        return {
          ok: true,
          url: 'https://cdn.example/catalogs/manifest.json',
          json: async () => ({
            catalogs: {
              fr: { url: './fr.hash.json', sha256: 'hash' },
              en: { url: './en.hash.json', sha256: 'hash' },
            },
          }),
        };
      }
      return {
        ok: true,
        url,
        json: async () => ({ hello: 'Bonjour' }),
      };
    };
    const loader = new CatalogLoader(
      'https://api.example/i18n/manifest.json',
      fetchImpl,
    );
    assert.equal((await loader.load('fr')).t('hello'), 'Bonjour');
    assert.deepEqual(requests, [
      'https://api.example/i18n/manifest.json',
      'https://cdn.example/catalogs/fr.hash.json',
    ]);
  });
});
