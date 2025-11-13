import { initConfigField, updateConfig } from '../../utils/config/config.js';
import { ensureLogin } from '../../blocks/profile/profile.js';
import { logResponse } from '../../blocks/console/console.js';

const adminForm = document.getElementById('admin-form');
const site = document.getElementById('site');
const org = document.getElementById('org');
const consoleBlock = document.querySelector('.console');
const addSitemapButton = document.getElementById('add-sitemap');

let loadedSitemaps;
let YAML;

function isMultiLanguageSitemap(sitemapDef) {
  return sitemapDef?.languages !== undefined;
}

function displaySitemapDetails(sitemapName, sitemapDef, newSitemap = false) {
  const isMultiLang = isMultiLanguageSitemap(sitemapDef);
  const templateId = isMultiLang ? '#sitemap-multilang-dialog-template' : '#sitemap-details-dialog-template';
  document.body.append(document.querySelector(templateId).content.cloneNode(true));
  const sitemapDetails = document.querySelector('dialog.sitemap-details');

  sitemapDetails.querySelector('#sitemap-name').value = sitemapName;
  if (!newSitemap) {
    sitemapDetails.querySelector('#sitemap-name').readOnly = true;
  }

  sitemapDetails.querySelector('#sitemap-origin').value = sitemapDef.origin || '';
  sitemapDetails.querySelector('#sitemap-lastmod').value = sitemapDef.lastmod || '';
  sitemapDetails.querySelector('#sitemap-extension').value = sitemapDef.extension || '';

  if (isMultiLang) {
    sitemapDetails.querySelector('#sitemap-default').value = sitemapDef.default || '';
  } else {
    sitemapDetails.querySelector('#sitemap-source').value = sitemapDef.source || '';
    sitemapDetails.querySelector('#sitemap-destination').value = sitemapDef.destination || '';
  }

  sitemapDetails.showModal();

  // Show back button only for new sitemaps
  const backButtonWrapper = sitemapDetails.querySelector('.button-wrapper:has(#back-sitemap)');
  if (newSitemap && backButtonWrapper) {
    backButtonWrapper.style.display = '';
    const backButton = backButtonWrapper.querySelector('#back-sitemap');
    backButton.addEventListener('click', (e) => {
      e.preventDefault();
      sitemapDetails.close();
      sitemapDetails.remove();
      // eslint-disable-next-line no-use-before-define
      showTypeSelectionDialog();
    });
  }

  const cancel = sitemapDetails.querySelector('#cancel-sitemap');
  sitemapDetails.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();

    const name = sitemapDetails.querySelector('#sitemap-name').value.trim();

    if (isMultiLang) {
      const origin = sitemapDetails.querySelector('#sitemap-origin').value.trim();
      const defaultLang = sitemapDetails.querySelector('#sitemap-default').value.trim();
      const lastmod = sitemapDetails.querySelector('#sitemap-lastmod').value.trim();
      const extension = sitemapDetails.querySelector('#sitemap-extension').value.trim();

      // Preserve existing languages if editing, or create empty languages object if new
      const existingLanguages = loadedSitemaps.sitemaps[name]?.languages || {};

      loadedSitemaps.sitemaps[name] = {
        languages: existingLanguages,
      };

      if (origin) loadedSitemaps.sitemaps[name].origin = origin;
      if (defaultLang) loadedSitemaps.sitemaps[name].default = defaultLang;
      if (lastmod) loadedSitemaps.sitemaps[name].lastmod = lastmod;
      if (extension) loadedSitemaps.sitemaps[name].extension = extension;
    } else {
      // Build simple sitemap structure
      const source = sitemapDetails.querySelector('#sitemap-source').value.trim();
      const destination = sitemapDetails.querySelector('#sitemap-destination').value.trim();
      const origin = sitemapDetails.querySelector('#sitemap-origin').value.trim();
      const lastmod = sitemapDetails.querySelector('#sitemap-lastmod').value.trim();
      const extension = sitemapDetails.querySelector('#sitemap-extension').value.trim();

      loadedSitemaps.sitemaps[name] = {
        source,
        destination,
      };

      if (origin) loadedSitemaps.sitemaps[name].origin = origin;
      if (lastmod) loadedSitemaps.sitemaps[name].lastmod = lastmod;
      if (extension) loadedSitemaps.sitemaps[name].extension = extension;
    }

    const yamlText = YAML.stringify(loadedSitemaps);
    const resp = await fetch(`https://admin.hlx.page/config/${org.value}/sites/${site.value}/content/sitemap.yaml`, {
      method: 'POST',
      headers: {
        'content-type': 'text/yaml',
      },
      body: yamlText,
    });

    logResponse(consoleBlock, [resp.status, 'POST', `https://admin.hlx.page/config/${org.value}/sites/${site.value}/content/sitemap.yaml`, resp.headers.get('x-error') || '']);

    if (resp.ok) {
      sitemapDetails.close();
      sitemapDetails.remove();

      const sitemapsList = document.getElementById('sitemaps-list');
      sitemapsList.innerHTML = '';
      adminForm.dispatchEvent(new Event('submit'));
    } else {
      // eslint-disable-next-line no-alert
      alert('Failed to save sitemap, check console for details');
    }
  });

  cancel.addEventListener('click', (e) => {
    e.preventDefault();
    sitemapDetails.close();
    sitemapDetails.remove();
  });

  sitemapDetails.addEventListener('click', (e) => {
    const {
      left, right, top, bottom,
    } = sitemapDetails.getBoundingClientRect();
    const { clientX, clientY } = e;
    if (clientX < left || clientX > right || clientY < top || clientY > bottom) {
      sitemapDetails.close();
      sitemapDetails.remove();
    }
  });
}

function showTypeSelectionDialog() {
  document.body.append(document.querySelector('#sitemap-type-dialog-template').content.cloneNode(true));
  const typeDialog = document.querySelector('dialog.sitemap-type-dialog');
  typeDialog.showModal();

  typeDialog.querySelector('#simple-sitemap-btn').addEventListener('click', (e) => {
    e.preventDefault();
    typeDialog.close();
    typeDialog.remove();
    displaySitemapDetails('', {
      source: '/query-index.json',
      destination: '/sitemap.xml',
      lastmod: 'YYYY-MM-DD',
    }, true);
  });

  typeDialog.querySelector('#multilang-sitemap-btn').addEventListener('click', (e) => {
    e.preventDefault();
    typeDialog.close();
    typeDialog.remove();
    displaySitemapDetails('', {
      lastmod: 'YYYY-MM-DD',
      languages: {},
    }, true);
  });

  typeDialog.querySelector('#cancel-type-btn').addEventListener('click', (e) => {
    e.preventDefault();
    typeDialog.close();
    typeDialog.remove();
  });

  typeDialog.addEventListener('click', (e) => {
    const {
      left, right, top, bottom,
    } = typeDialog.getBoundingClientRect();
    const { clientX, clientY } = e;
    if (clientX < left || clientX > right || clientY < top || clientY > bottom) {
      typeDialog.close();
      typeDialog.remove();
    }
  });
}

function displayLanguageEditDialog(sitemapName, langCode, langDef, isNew = false) {
  document.body.append(document.querySelector('#language-edit-dialog-template').content.cloneNode(true));
  const langDialog = document.querySelector('dialog.language-edit-dialog');

  const langCodeInput = langDialog.querySelector('#lang-code');
  langCodeInput.value = langCode;
  if (!isNew) {
    langCodeInput.readOnly = true;
  }

  langDialog.querySelector('#lang-source').value = langDef.source || '';
  langDialog.querySelector('#lang-destination').value = langDef.destination || '';
  langDialog.querySelector('#lang-hreflang').value = Array.isArray(langDef.hreflang)
    ? langDef.hreflang.join(', ')
    : (langDef.hreflang || '');
  langDialog.querySelector('#lang-alternate').value = langDef.alternate || '';

  langDialog.showModal();

  const cancel = langDialog.querySelector('#cancel-language');
  langDialog.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();

    const newLangCode = langCodeInput.value.trim();
    const source = langDialog.querySelector('#lang-source').value.trim();
    const destination = langDialog.querySelector('#lang-destination').value.trim();
    const hreflang = langDialog.querySelector('#lang-hreflang').value.trim();
    const alternate = langDialog.querySelector('#lang-alternate').value.trim();

    if (!newLangCode || !source || !destination) {
      // eslint-disable-next-line no-alert
      alert('Language code, source, and destination are required');
      return;
    }

    // If editing and language code changed, remove old one
    if (!isNew && newLangCode !== langCode) {
      delete loadedSitemaps.sitemaps[sitemapName].languages[langCode];
    }

    // Add or update language
    loadedSitemaps.sitemaps[sitemapName].languages[newLangCode] = {
      source,
      destination,
    };

    if (hreflang) {
      const hreflangs = hreflang.split(',').map((h) => h.trim()).filter((h) => h);
      if (hreflangs.length > 1) {
        loadedSitemaps.sitemaps[sitemapName].languages[newLangCode].hreflang = hreflangs;
      } else if (hreflangs.length === 1) {
        const [firstLang] = hreflangs;
        loadedSitemaps.sitemaps[sitemapName].languages[newLangCode].hreflang = firstLang;
      }
    }

    if (alternate) {
      loadedSitemaps.sitemaps[sitemapName].languages[newLangCode].alternate = alternate;
    }

    const yamlText = YAML.stringify(loadedSitemaps);
    const resp = await fetch(`https://admin.hlx.page/config/${org.value}/sites/${site.value}/content/sitemap.yaml`, {
      method: 'POST',
      headers: {
        'content-type': 'text/yaml',
      },
      body: yamlText,
    });

    logResponse(consoleBlock, [resp.status, 'POST', `https://admin.hlx.page/config/${org.value}/sites/${site.value}/content/sitemap.yaml`, resp.headers.get('x-error') || '']);

    if (resp.ok) {
      langDialog.close();
      langDialog.remove();

      const sitemapsList = document.getElementById('sitemaps-list');
      sitemapsList.innerHTML = '';
      adminForm.dispatchEvent(new Event('submit'));
    } else {
      // eslint-disable-next-line no-alert
      alert('Failed to save language, check console for details');
    }
  });

  cancel.addEventListener('click', (e) => {
    e.preventDefault();
    langDialog.close();
    langDialog.remove();
  });

  langDialog.addEventListener('click', (e) => {
    const {
      left, right, top, bottom,
    } = langDialog.getBoundingClientRect();
    const { clientX, clientY } = e;
    if (clientX < left || clientX > right || clientY < top || clientY > bottom) {
      langDialog.close();
      langDialog.remove();
    }
  });
}

async function removeLanguage(sitemapName, langCode) {
  // eslint-disable-next-line no-alert, no-restricted-globals
  if (!confirm(`Remove language "${langCode}" from sitemap "${sitemapName}"?`)) {
    return;
  }

  delete loadedSitemaps.sitemaps[sitemapName].languages[langCode];

  const yamlText = YAML.stringify(loadedSitemaps);
  const resp = await fetch(`https://admin.hlx.page/config/${org.value}/sites/${site.value}/content/sitemap.yaml`, {
    method: 'POST',
    headers: {
      'content-type': 'text/yaml',
    },
    body: yamlText,
  });

  logResponse([resp.status, 'POST', `https://admin.hlx.page/config/${org.value}/sites/${site.value}/content/sitemap.yaml`, resp.headers.get('x-error') || '']);

  if (resp.ok) {
    const sitemapsList = document.getElementById('sitemaps-list');
    sitemapsList.innerHTML = '';
    adminForm.dispatchEvent(new Event('submit'));
  } else {
    // eslint-disable-next-line no-alert
    alert('Failed to remove language, check console for details');
  }
}

async function generateSitemap(destination) {
  const sitemapUrl = `https://admin.hlx.page/sitemap/${org.value}/${site.value}/main${destination}`;
  const resp = await fetch(sitemapUrl, { method: 'POST' });
  logResponse([resp.status, 'POST', sitemapUrl, resp.headers.get('x-error') || '']);

  if (resp.ok) {
    const result = await resp.json();
    logResponse(consoleBlock, [200, 'INFO', `Generated sitemap(s): ${result.paths?.join(', ') || destination}`, '']);
  } else if (resp.status === 204) {
    logResponse(consoleBlock, [204, 'WARN', 'Path is not a destination for any configured sitemap', '']);
  }
}

async function removeSitemap(name) {
  // eslint-disable-next-line no-alert, no-restricted-globals
  if (!confirm(`Remove sitemap configuration "${name}"?`)) {
    return;
  }

  delete loadedSitemaps.sitemaps[name];

  const yamlText = YAML.stringify(loadedSitemaps);
  const resp = await fetch(`https://admin.hlx.page/config/${org.value}/sites/${site.value}/content/sitemap.yaml`, {
    method: 'POST',
    headers: {
      'content-type': 'text/yaml',
    },
    body: yamlText,
  });

  logResponse([resp.status, 'POST', `https://admin.hlx.page/config/${org.value}/sites/${site.value}/content/sitemap.yaml`, resp.headers.get('x-error') || '']);

  if (resp.ok) {
    const sitemapsList = document.getElementById('sitemaps-list');
    sitemapsList.innerHTML = '';
    adminForm.dispatchEvent(new Event('submit'));
  } else {
    // eslint-disable-next-line no-alert
    alert('Failed to remove sitemap, check console for details');
  }
}

function populateSitemaps(sitemaps) {
  const sitemapsList = document.getElementById('sitemaps-list');
  sitemapsList.innerHTML = '';

  Object.entries(sitemaps).forEach(([name, sitemapDef]) => {
    const isMultiLang = isMultiLanguageSitemap(sitemapDef);
    const templateId = isMultiLang ? '#sitemap-multilang-card-template' : '#sitemap-card-template';
    sitemapsList.append(document.querySelector(templateId).content.cloneNode(true));

    const sitemapItem = sitemapsList.lastElementChild;
    sitemapItem.querySelector('.sitemap-name').textContent = name;

    if (isMultiLang) {
      // Display multi-language sitemap info
      const languageCount = Object.keys(sitemapDef.languages).length;
      sitemapItem.querySelector('.sitemap-attribute-value-languages').textContent = `${languageCount} language${languageCount !== 1 ? 's' : ''}`;
      sitemapItem.querySelector('.sitemap-attribute-value-origin').textContent = sitemapDef.origin || 'n/a';
      sitemapItem.querySelector('.sitemap-attribute-value-default').textContent = sitemapDef.default || 'n/a';

      // Show list of languages with edit/remove buttons
      const languagesList = sitemapItem.querySelector('.languages-list');
      Object.entries(sitemapDef.languages).forEach(([langCode, langDef]) => {
        languagesList.append(document.querySelector('#language-item-template').content.cloneNode(true));
        const langItem = languagesList.lastElementChild;

        langItem.querySelector('.lang-code').textContent = langCode;
        langItem.querySelector('.lang-destination').textContent = langDef.destination;

        // Edit language button
        langItem.querySelector('.edit-language-btn').addEventListener('click', (e) => {
          e.preventDefault();
          displayLanguageEditDialog(name, langCode, langDef, false);
        });

        // Remove language button
        langItem.querySelector('.remove-language-btn').addEventListener('click', async (e) => {
          e.preventDefault();
          await removeLanguage(name, langCode);
        });
      });

      // Add language button
      sitemapItem.querySelector('.add-language-btn').addEventListener('click', (e) => {
        e.preventDefault();
        displayLanguageEditDialog(name, '', {}, true);
      });
    } else {
      // Display simple sitemap info
      sitemapItem.querySelector('.sitemap-attribute-value-source').textContent = sitemapDef.source || 'n/a';
      sitemapItem.querySelector('.sitemap-attribute-value-destination').textContent = sitemapDef.destination || 'n/a';
      sitemapItem.querySelector('.sitemap-attribute-value-origin').textContent = sitemapDef.origin || 'n/a';
    }

    sitemapItem.querySelector('.edit-sitemap-btn').addEventListener('click', (e) => {
      e.preventDefault();
      displaySitemapDetails(name, sitemapDef);
    });

    sitemapItem.querySelector('.generate-sitemap-btn').addEventListener('click', async (e) => {
      e.preventDefault();
      const btn = e.target;
      btn.disabled = true;
      btn.textContent = 'Generating...';

      let destPath = '';
      if (sitemapDef.destination) {
        destPath = sitemapDef.destination;
      } else if (isMultiLang && sitemapDef.default && sitemapDef.languages[sitemapDef.default]) {
        destPath = sitemapDef.languages[sitemapDef.default].destination;
      } else if (isMultiLang && Object.keys(sitemapDef.languages).length > 0) {
        destPath = sitemapDef.languages[Object.keys(sitemapDef.languages)[0]].destination;
      }

      if (!destPath) {
        // eslint-disable-next-line no-alert
        alert('No destination configured for this sitemap');
        btn.disabled = false;
        btn.textContent = 'Generate';
        return;
      }

      await generateSitemap(destPath);

      btn.disabled = false;
      btn.textContent = 'Generate';
    });

    sitemapItem.querySelector('.remove-sitemap-btn').addEventListener('click', async (e) => {
      e.preventDefault();
      const btn = e.target;
      btn.disabled = true;
      await removeSitemap(name);
      btn.disabled = false;
    });
  });
}

async function init() {
  await initConfigField();

  addSitemapButton.addEventListener('click', () => {
    showTypeSelectionDialog();
  });

  adminForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!org.value || !site.value) {
      // eslint-disable-next-line no-alert
      alert('Please select an organization and site first');
      return;
    }

    const sitemapUrl = `https://admin.hlx.page/config/${org.value}/sites/${site.value}/content/sitemap.yaml`;
    const resp = await fetch(sitemapUrl);
    logResponse(consoleBlock, [resp.status, 'GET', sitemapUrl, resp.headers.get('x-error') || '']);

    if (resp.ok) {
      updateConfig();
      // eslint-disable-next-line import/no-unresolved
      YAML = YAML || await import('https://unpkg.com/yaml@2.8.1/browser/index.js');

      const yamlText = await resp.text();
      loadedSitemaps = YAML.parse(yamlText);

      populateSitemaps(loadedSitemaps.sitemaps || {});
      addSitemapButton.disabled = false;
    } else if (resp.status === 404) {
      updateConfig();
      // eslint-disable-next-line import/no-unresolved
      YAML = YAML || await import('https://unpkg.com/yaml@2.8.1/browser/index.js');

      loadedSitemaps = { version: 1, sitemaps: {} };
      populateSitemaps({});
      addSitemapButton.disabled = false;
    } else if (resp.status === 401) {
      ensureLogin(org.value, site.value);
    }
  });
}

const initPromise = init();

// eslint-disable-next-line import/prefer-default-export
export function ready() {
  return initPromise;
}
