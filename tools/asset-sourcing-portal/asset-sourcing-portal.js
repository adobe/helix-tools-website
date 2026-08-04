/* eslint-disable no-use-before-define */
import { registerToolReady } from '../../scripts/scripts.js';
import {
  ForcePasswordRotationRequiredError,
  LoginLockedError,
  PortalApi,
  PortalApiError,
  SessionExpiredError,
} from './api.js';
import { loadPortalConfig } from './config.js';
import { createElement, replaceContent, setMessage } from './dom.js';
import {
  collectFilesFromDataTransfer,
  collectFilesFromFileList,
  readImageDimensions,
} from './files.js';
import {
  checkFileExtension,
  DEFAULT_UPLOAD_LIMITS,
  flattenPathCollisions,
  resolveUploadRelativePath,
  stripValidRelativePath,
  validateImageDimensions,
  validateUploadPath,
  vendorUploadPathEnabled,
} from './policies.js';
import {
  applyDocumentLocale,
  CatalogLoader,
  LOCALE_DEFINITIONS,
  localizeError,
  normalizePortalLocalization,
  persistLocale,
  replaceUrlLocale,
  resolveInitialLocale,
  resolveMetadataLabel,
  resolveVendorLocale,
} from './localization.js';

const CONCURRENCY = 3;
const POLL_INTERVAL_MS = 4000;
const POLL_MAX_ATTEMPTS = 75;

const elements = {
  shell: document.getElementById('asp-portal-shell'),
  title: document.querySelector('#asp-portal-title h1'),
  logo: document.querySelector('#asp-portal-logo img'),
  loginBanner: document.getElementById('asp-portal-banner'),
  loginView: document.getElementById('asp-portal-signin'),
  loginForm: document.getElementById('asp-login-form'),
  usernameLabel: document.getElementById('asp-username-label'),
  usernameInput: document.getElementById('username'),
  passwordLabel: document.getElementById('asp-password-label'),
  passwordInput: document.getElementById('password'),
  loginButton: document.getElementById('asp-login-button'),
  loginMessage: document.getElementById('asp-login-message'),
  loginLead: document.querySelector('.login-lead'),
  languageLabel: document.getElementById('asp-language-label'),
  languageSelect: document.getElementById('asp-language'),
  languageMessage: document.getElementById('asp-language-message'),
  uploadView: document.getElementById('asp-upload-view'),
  confirmationView: document.getElementById('asp-confirmation-view'),
  modalRoot: document.getElementById('asp-modal-root'),
};

const state = {
  config: null,
  api: null,
  catalogLoader: null,
  i18n: null,
  localeSource: 'default',
  localeLoading: false,
  session: null,
  groups: [],
  jobs: [],
  view: 'login',
  sessionGeneration: 0,
  sessionTimer: 0,
  verificationTimer: 0,
  bannerObjectUrls: [],
  confirmationSummary: null,
  loginBrandingTitle: '',
};

function safeString(value, fallback = '', maxLength = 500) {
  return typeof value === 'string' ? value.slice(0, maxLength) : fallback;
}

function t(key, values) {
  return state.i18n?.t(key, values) || '';
}

function technicalElement(tag, className, text) {
  return createElement(tag, {
    className: `${className} technical-value`,
    text,
    attrs: { dir: 'ltr' },
  });
}

function isolateTechnicalValue(value) {
  return `\u2066${value}\u2069`;
}

function normalizeMetadataSchema(value) {
  const input = value && typeof value === 'object' ? value : {};
  const editableInput = Array.isArray(input.editable) ? input.editable.slice(0, 100) : [];
  const editable = editableInput.filter((field) => (
    field && typeof field === 'object' && typeof field.id === 'string'
      && field.id.length > 0 && field.id.length <= 200
  )).map((field) => ({
    id: field.id,
    label: safeString(field.label, '', 200),
    labelByLocale: field.labelByLocale && typeof field.labelByLocale === 'object'
      && !Array.isArray(field.labelByLocale)
      ? Object.fromEntries(Object.entries(field.labelByLocale)
        .filter(([locale, label]) => (
          typeof locale === 'string' && typeof label === 'string'
        ))
        .slice(0, 20)) : undefined,
    required: field.required === true,
    type: field.type === 'date' ? 'date' : 'text',
    options: Array.isArray(field.options)
      ? field.options.filter((option) => typeof option === 'string').slice(0, 200)
      : [],
  }));
  const ids = new Set(editable.map((field) => field.id));
  const requiredInput = Array.isArray(input.required) ? input.required : [];
  const required = requiredInput.filter((id) => typeof id === 'string' && ids.has(id));
  editable.filter((field) => field.required).forEach((field) => required.push(field.id));
  const prepopulated = {};
  if (input.prepopulated && typeof input.prepopulated === 'object'
    && !Array.isArray(input.prepopulated)) {
    Object.entries(input.prepopulated).slice(0, 100).forEach(([key, metadataValue]) => {
      if (key.length <= 200
        && ['string', 'number', 'boolean'].includes(typeof metadataValue)) {
        prepopulated[key] = metadataValue;
      }
    });
  }
  return { editable, required: [...new Set(required)], prepopulated };
}

function normalizeSession(session) {
  const vendor = session.vendor && typeof session.vendor === 'object' ? session.vendor : {};
  const limits = session.limits && typeof session.limits === 'object' ? session.limits : {};
  return {
    username: safeString(session.username, '', 200),
    vendorName: safeString(vendor.name, t('upload.organizationFallback'), 200),
    expiresAt: session.expiresAt,
    metadataSchema: normalizeMetadataSchema(session.metadataSchema),
    portalLocalization: normalizePortalLocalization(session.portalLocalization),
    fileExtensions: session.fileExtensions && typeof session.fileExtensions === 'object'
      ? session.fileExtensions : undefined,
    uploadPathPolicy: session.uploadPathPolicy && typeof session.uploadPathPolicy === 'object'
      ? session.uploadPathPolicy : { mode: 'preserve' },
    ingestionPolicy: session.ingestionPolicy && typeof session.ingestionPolicy === 'object'
      ? session.ingestionPolicy : undefined,
    capabilities: session.capabilities && typeof session.capabilities === 'object'
      ? session.capabilities : {},
    portalBranding: session.portalBranding && typeof session.portalBranding === 'object'
      ? session.portalBranding : {},
    limits: {
      maxFileBytes: Number.isFinite(limits.maxFileBytes) && limits.maxFileBytes > 0
        ? limits.maxFileBytes : DEFAULT_UPLOAD_LIMITS.maxFileBytes,
      maxBatch: Number.isInteger(limits.maxBatch) && limits.maxBatch > 0
        ? limits.maxBatch : DEFAULT_UPLOAD_LIMITS.maxBatch,
    },
  };
}

function clearTimers() {
  window.clearTimeout(state.sessionTimer);
  window.clearTimeout(state.verificationTimer);
  state.sessionTimer = 0;
  state.verificationTimer = 0;
}

function revokeBannerUrls() {
  state.bannerObjectUrls.forEach((url) => URL.revokeObjectURL(url));
  state.bannerObjectUrls = [];
}

function showView(view) {
  state.view = view;
  elements.loginView.hidden = view !== 'login';
  elements.uploadView.hidden = view !== 'upload';
  elements.confirmationView.hidden = view !== 'confirmation';
  elements.shell.classList.toggle('asp-portal-wide', view !== 'login');
  if (state.i18n) document.title = t(`app.title.${view}`);
}

function updateLanguageSelector() {
  const supportedLocales = state.session
    ? state.session.portalLocalization.supportedLocales
    : LOCALE_DEFINITIONS.map(({ locale }) => locale);
  const selected = state.i18n.locale;
  replaceContent(elements.languageSelect);
  LOCALE_DEFINITIONS.filter(({ locale }) => supportedLocales.includes(locale))
    .forEach(({ locale, nativeName }) => {
      const option = createElement('option', {
        text: nativeName,
        attrs: { value: locale, lang: locale, dir: locale === 'ar' ? 'rtl' : 'ltr' },
      });
      option.selected = locale === selected;
      elements.languageSelect.append(option);
    });
  elements.languageSelect.value = selected;
  elements.languageSelect.disabled = state.localeLoading;
}

function updateStaticTranslations() {
  applyDocumentLocale(state.i18n);
  document.title = t(`app.title.${state.view}`);
  elements.languageLabel.textContent = t('app.language.label');
  elements.loginLead.textContent = t('login.lead');
  elements.usernameLabel.textContent = t('login.form.username.label');
  elements.usernameInput.placeholder = t('login.form.username.placeholder');
  elements.usernameInput.dir = 'ltr';
  elements.passwordLabel.textContent = t('login.form.password.label');
  elements.passwordInput.placeholder = t('login.form.password.placeholder');
  elements.passwordInput.dir = 'ltr';
  elements.loginButton.textContent = t('login.continue');
  elements.title.textContent = state.loginBrandingTitle
    || state.config?.branding.title || t('app.title.login');
  updateLanguageSelector();
}

function captureFocus() {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || !active.id) return undefined;
  return {
    id: active.id,
    start: 'selectionStart' in active ? active.selectionStart : undefined,
    end: 'selectionEnd' in active ? active.selectionEnd : undefined,
  };
}

function restoreFocus(focus) {
  if (!focus) return;
  const target = document.getElementById(focus.id);
  if (!(target instanceof HTMLElement)) return;
  target.focus();
  if ('setSelectionRange' in target
    && Number.isInteger(focus.start) && Number.isInteger(focus.end)) {
    target.setSelectionRange(focus.start, focus.end);
  }
}

function rerenderCurrentView(focus) {
  updateStaticTranslations();
  if (state.view === 'upload') renderUpload();
  else if (state.view === 'confirmation' && state.confirmationSummary) {
    showConfirmation(state.confirmationSummary);
  }
  restoreFocus(focus);
}

async function changeLocale(locale, source = 'user') {
  if (state.localeLoading) return;
  let requested = locale;
  if (state.session) {
    requested = resolveVendorLocale(locale, source, state.session.portalLocalization);
  }
  const focus = captureFocus();
  state.localeLoading = true;
  elements.languageSelect.disabled = true;
  try {
    state.i18n = await state.catalogLoader.load(requested);
    state.localeSource = source;
    persistLocale(state.i18n.locale, state.config.org);
    replaceUrlLocale(state.i18n.locale);
    setMessage(elements.languageMessage, '');
    rerenderCurrentView(focus);
  } finally {
    state.localeLoading = false;
    elements.languageSelect.disabled = false;
  }
}

function endSession(message = '') {
  state.sessionGeneration += 1;
  clearTimers();
  revokeBannerUrls();
  state.api?.clearSession();
  state.session = null;
  state.groups = [];
  state.jobs = [];
  replaceContent(elements.uploadView);
  replaceContent(elements.confirmationView);
  replaceContent(elements.modalRoot);
  state.confirmationSummary = null;
  elements.usernameInput.value = '';
  elements.passwordInput.value = '';
  showView('login');
  setMessage(elements.loginMessage, message, message ? 'notice' : '');
  updateStaticTranslations();
  elements.usernameInput.focus();
}

function handleRequestError(error) {
  if (error instanceof SessionExpiredError) {
    endSession(localizeError(state.i18n, error));
    return true;
  }
  return false;
}

function errorMessage(error, fallbackKey) {
  if (error instanceof PortalApiError) return localizeError(state.i18n, error);
  return t(fallbackKey);
}

function scheduleSessionExpiry() {
  const milliseconds = state.session.expiresAt < 1_000_000_000_000
    ? state.session.expiresAt * 1000 : state.session.expiresAt;
  const delay = Math.max(0, milliseconds - Date.now());
  window.clearTimeout(state.sessionTimer);
  state.sessionTimer = window.setTimeout(() => {
    endSession(t('upload.error.sessionExpired'));
  }, Math.min(delay, 2_147_483_647));
}

function emptyMetadata(schema) {
  return Object.fromEntries(schema.editable.map((field) => {
    const prepopulated = schema.prepopulated[field.id];
    return [field.id, prepopulated === undefined ? '' : String(prepopulated)];
  }));
}

function newGroup() {
  return {
    id: `group-${crypto.randomUUID()}`,
    metadata: emptyMetadata(state.session.metadataSchema),
    uploadPath: '/',
    nextSequence: 1,
    batchId: undefined,
    running: false,
    completed: false,
    verificationPending: false,
    validationError: '',
  };
}

function metadataPayload(group) {
  const payload = {};
  Object.entries(group.metadata).forEach(([key, value]) => {
    if (value.trim()) payload[key] = value.trim();
  });
  return payload;
}

function pathPrefixForGroup(group) {
  if (!vendorUploadPathEnabled(state.session.uploadPathPolicy)) return undefined;
  const value = group.uploadPath.trim() || '/';
  return stripValidRelativePath(value) ? value : undefined;
}

function validateGroup(group) {
  const { metadataSchema, uploadPathPolicy } = state.session;
  const missing = metadataSchema.required.find((fieldId) => !group.metadata[fieldId]?.trim());
  if (missing) {
    const field = metadataSchema.editable.find((entry) => entry.id === missing);
    return t('upload.metadata.required', {
      label: resolveMetadataLabel(field, state.i18n.locale) || missing,
    });
  }
  const pathError = validateUploadPath(group.uploadPath, uploadPathPolicy);
  if (!pathError) return undefined;
  const label = uploadPathPolicy?.vendorPath?.label || t('upload.path.label');
  return uploadPathPolicy?.vendorPath?.required && !(group.uploadPath.trim() || '/').replaceAll('/', '')
    ? t('upload.path.required', { label })
    : t('upload.path.invalid');
}

function extensionHint() {
  const policy = state.session.fileExtensions;
  if (!policy?.allow?.length && !policy?.deny?.length) return '';
  const extensions = (policy.allow || policy.deny).map((item) => `.${item}`).join(', ');
  return t(policy.allow?.length ? 'upload.extensions.allowed' : 'upload.extensions.blocked', {
    extensions,
  });
}

function minimumDimensionHint() {
  const policy = state.session.ingestionPolicy?.imageValidation;
  if (!policy) return '';
  const values = {
    minimum: policy.minDimensionPx,
    width: policy.minWidthPx,
    height: policy.minHeightPx,
  };
  if (policy.minDimensionPx && policy.minWidthPx && policy.minHeightPx) {
    return t('upload.image.minimum.all', values);
  }
  if (policy.minDimensionPx && policy.minWidthPx) {
    return t('upload.image.minimum.shortestWidth', values);
  }
  if (policy.minDimensionPx && policy.minHeightPx) {
    return t('upload.image.minimum.shortestHeight', values);
  }
  if (policy.minWidthPx && policy.minHeightPx) {
    return t('upload.image.minimum.widthHeight', values);
  }
  if (policy.minDimensionPx) return t('upload.image.minimum.shortest', values);
  if (policy.minWidthPx) return t('upload.image.minimum.width', values);
  if (policy.minHeightPx) return t('upload.image.minimum.height', values);
  return '';
}

function renderPrepopulated(container, schema) {
  const entries = Object.entries(schema.prepopulated);
  if (!entries.length) return;
  const details = createElement('details', { className: 'asp-prepopulated' });
  details.append(createElement('summary', { text: t('upload.metadata.title') }));
  const list = createElement('dl');
  entries.forEach(([key, value]) => {
    list.append(
      technicalElement('dt', 'metadata-field-id', key),
      technicalElement('dd', 'metadata-value', String(value)),
    );
  });
  details.append(list);
  container.append(details);
}

function renderMetadataForm(group, locked) {
  const container = createElement('div', { className: `metadata-form${locked ? ' locked' : ''}` });
  container.append(
    createElement('h2', { className: 'panel-heading', text: t('upload.metadata.title') }),
    createElement('p', {
      className: 'panel-sub',
      text: t(locked ? 'upload.metadata.locked' : 'upload.metadata.appliesToBatch'),
    }),
  );
  const policy = state.session.uploadPathPolicy;
  if (vendorUploadPathEnabled(policy)) {
    const labelText = `${policy.vendorPath.label || t('upload.path.label')}${policy.vendorPath.required ? ' *' : ''}`;
    const id = `${group.id}-upload-path`;
    const input = createElement('input', {
      attrs: {
        id,
        type: 'text',
        value: group.uploadPath,
        placeholder: t('upload.path.placeholder'),
        dir: 'ltr',
      },
    });
    input.disabled = locked;
    input.addEventListener('input', () => {
      group.uploadPath = input.value;
      group.validationError = '';
    });
    container.append(
      createElement('label', { text: labelText, attrs: { for: id } }),
      input,
      createElement('p', {
        className: 'field-hint',
        text: t('upload.path.description'),
      }),
    );
  }

  state.session.metadataSchema.editable.forEach((field) => {
    const id = `${group.id}-${field.id}`;
    const required = state.session.metadataSchema.required.includes(field.id);
    const label = createElement('label', {
      text: `${resolveMetadataLabel(field, state.i18n.locale)}${required ? ' *' : ''}`,
      attrs: { for: id },
    });
    let input;
    if (field.options.length) {
      input = createElement('select', { attrs: { id } });
      const placeholder = createElement('option', {
        text: t('upload.metadata.select'),
        attrs: { value: '' },
      });
      placeholder.selected = !group.metadata[field.id];
      placeholder.disabled = required;
      input.append(placeholder);
      field.options.forEach((option) => {
        const item = createElement('option', { text: option, attrs: { value: option } });
        item.selected = group.metadata[field.id] === option;
        input.append(item);
      });
    } else {
      input = createElement('input', {
        attrs: {
          id,
          type: field.type,
          value: group.metadata[field.id] || '',
        },
      });
    }
    input.required = required;
    input.disabled = locked;
    input.addEventListener('input', () => {
      group.metadata[field.id] = input.value;
      group.validationError = '';
    });
    container.append(label, input);
  });

  renderPrepopulated(container, state.session.metadataSchema);
  const dimensionHint = minimumDimensionHint();
  if (dimensionHint) {
    container.append(createElement('p', {
      className: 'metadata-dimension-note',
      text: `${t('upload.image.minimum.heading')} ${dimensionHint}`,
    }));
  }
  return container;
}

function jobRank(job) {
  if (job.status === 'error' || job.status === 'rejected') return 0;
  if (job.status === 'duplicate') return 1;
  return 2;
}

function renderJobs(group) {
  const groupJobs = state.jobs.filter((job) => job.groupId === group.id)
    .map((job, index) => ({ job, index }))
    .sort((a, b) => jobRank(a.job) - jobRank(b.job) || a.index - b.index)
    .map((entry) => entry.job);
  if (!groupJobs.length) return null;
  const list = createElement('ul', { className: 'file-list' });
  groupJobs.forEach((job) => {
    let className = 'file-row';
    if (jobRank(job) === 0) className = 'file-row file-row-rejected';
    else if (job.status === 'duplicate') className = 'file-row file-row-skipped';
    const main = createElement(
      'div',
      { className: 'file-row-main' },
      technicalElement('bdi', 'file-name', job.uploadPath),
      technicalElement('span', 'file-size', state.i18n.formatBytes(job.file.size)),
    );
    if (job.clientPath !== job.uploadPath) {
      main.insertBefore(createElement('span', {
        className: 'file-source',
        text: t('upload.file.from', { path: isolateTechnicalValue(job.clientPath) }),
        attrs: { dir: 'auto' },
      }), main.lastChild);
    }
    const status = createElement('div', {
      className: 'status',
      text: `${t(`upload.file.status.${job.status}`)}${job.error ? ` — ${job.error}` : ''}`,
    });
    const item = createElement('li', { className }, main, status);
    if (job.status === 'uploading' || job.status === 'completing') {
      const progress = Math.max(0, Math.min(100, job.progress));
      item.append(createElement('progress', {
        className: 'progress',
        attrs: {
          max: '100',
          value: String(progress),
          'aria-label': t('upload.file.progress', {
            path: isolateTechnicalValue(job.uploadPath),
          }),
        },
      }));
    }
    list.append(item);
  });
  return list;
}

function uploadPolicyHint() {
  const policy = state.session.uploadPathPolicy;
  const mode = policy?.mode || 'preserve';
  if (mode === 'flatten') return t('upload.pathPolicy.flatten');
  if (mode === 'fixed' && policy?.subPath) {
    return t('upload.pathPolicy.fixed', { subPath: policy.subPath });
  }
  if (mode === 'preserve' && policy?.vendorPath?.enabled) {
    return t('upload.pathPolicy.preserveWithField', {
      label: policy.vendorPath.label || t('upload.path.label'),
    });
  }
  return mode === 'preserve' ? t('upload.pathPolicy.preserve') : '';
}

function setDropZoneDisabled(zone, disabled, reason) {
  zone.classList.toggle('disabled', disabled);
  zone.setAttribute('aria-disabled', String(disabled));
  zone.tabIndex = disabled ? -1 : 0;
  zone.dataset.disabled = String(disabled);
  const title = zone.querySelector('.drop-zone-title');
  const hint = zone.querySelector('.drop-zone-hint');
  title.textContent = disabled ? t('upload.dropZone.required') : t('upload.dropZone.prompt');
  hint.textContent = reason || [
    uploadPolicyHint(),
    extensionHint(),
  ].filter(Boolean).join(' — ') || t('upload.dropZone.browse');
}

function renderDropZone(group) {
  const fileInput = createElement('input', { attrs: { type: 'file', multiple: '', hidden: '' } });
  const folderInput = createElement('input', {
    attrs: {
      type: 'file',
      multiple: '',
      hidden: '',
      webkitdirectory: '',
    },
  });
  const folderButton = createElement('button', {
    className: 'drop-zone-folder-btn secondary',
    text: t('upload.dropZone.selectFolder'),
    attrs: { type: 'button' },
  });
  const zone = createElement(
    'div',
    {
      className: 'drop-zone',
      attrs: {
        role: 'button',
        tabindex: '0',
        id: `${group.id}-drop-zone`,
        'aria-label': t('upload.dropZone.label'),
      },
    },
    fileInput,
    folderInput,
    createElement('div', { className: 'drop-zone-icon', text: '↑', attrs: { 'aria-hidden': 'true' } }),
    createElement('p', { className: 'drop-zone-title' }),
    createElement('p', { className: 'drop-zone-hint' }),
    folderButton,
  );
  const validationError = validateGroup(group);
  const disabledReason = group.running ? t('upload.metadata.locked') : validationError;
  setDropZoneDisabled(zone, Boolean(disabledReason), disabledReason || '');

  const ingest = async (items) => {
    if (zone.dataset.disabled === 'true' || !items.length) return;
    await onFilesAdded(group, items);
  };
  fileInput.addEventListener('change', () => {
    if (fileInput.files?.length) ingest(collectFilesFromFileList(fileInput.files));
    fileInput.value = '';
  });
  folderInput.addEventListener('change', () => {
    if (folderInput.files?.length) ingest(collectFilesFromFileList(folderInput.files));
    folderInput.value = '';
  });
  folderButton.addEventListener('click', (event) => {
    event.stopPropagation();
    folderInput.click();
  });
  zone.addEventListener('click', () => {
    if (zone.dataset.disabled !== 'true') fileInput.click();
  });
  zone.addEventListener('keydown', (event) => {
    if ((event.key === 'Enter' || event.key === ' ') && zone.dataset.disabled !== 'true') {
      event.preventDefault();
      fileInput.click();
    }
  });
  zone.addEventListener('dragover', (event) => {
    event.preventDefault();
    if (zone.dataset.disabled !== 'true') zone.classList.add('drag-over');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', async (event) => {
    event.preventDefault();
    zone.classList.remove('drag-over');
    if (zone.dataset.disabled === 'true') return;
    try {
      await ingest(await collectFilesFromDataTransfer(event.dataTransfer));
    } catch (error) {
      group.validationError = t('upload.error.invalidFilePath');
      renderUpload();
    }
  });
  return zone;
}

function renderAccountMenu(container) {
  const menu = createElement('div', { className: 'account-menu-dropdown', attrs: { role: 'menu' } });
  menu.hidden = true;
  menu.append(createElement('p', {
    className: 'account-menu-header',
    text: t('user.menu.signedInAs', {
      username: isolateTechnicalValue(state.session.username),
    }),
    attrs: { dir: 'auto' },
  }));
  if (state.session.capabilities.rotatePasswordAllowed === true) {
    const rotate = createElement('button', {
      className: 'account-menu-item',
      text: t('user.menu.rotatePassword'),
      attrs: { type: 'button', role: 'menuitem' },
    });
    rotate.addEventListener('click', () => {
      menu.hidden = true;
      showRotateDialog({ forced: false });
    });
    menu.append(rotate);
  }
  const signOut = createElement('button', {
    className: 'account-menu-item',
    text: t('user.menu.signOut'),
    attrs: { type: 'button', role: 'menuitem' },
  });
  signOut.addEventListener('click', () => endSession());
  menu.append(signOut);
  const trigger = createElement('button', {
    className: 'account-menu-trigger',
    text: '☰',
    attrs: {
      type: 'button',
      'aria-label': t('user.menu.label'),
      'aria-haspopup': 'menu',
      'aria-expanded': 'false',
    },
  });
  const closeMenu = () => {
    menu.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
  };
  trigger.addEventListener('click', () => {
    menu.hidden = !menu.hidden;
    trigger.setAttribute('aria-expanded', String(!menu.hidden));
    if (!menu.hidden) {
      window.setTimeout(() => {
        document.addEventListener('pointerdown', (event) => {
          if (!wrapper.contains(event.target)) closeMenu();
        }, { once: true });
      }, 0);
    }
  });
  const wrapper = createElement('div', { className: 'account-menu' }, trigger, menu);
  wrapper.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeMenu();
      trigger.focus();
    } else if (!menu.hidden && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
      event.preventDefault();
      const items = [...menu.querySelectorAll('[role="menuitem"]')];
      const current = items.indexOf(document.activeElement);
      const offset = event.key === 'ArrowDown' ? 1 : -1;
      items[(current + offset + items.length) % items.length]?.focus();
    }
  });
  container.append(wrapper);
}

async function renderBackendBanner(hero, branding) {
  const source = safeString(branding?.bannerSrc, '', 1000).trim();
  if (!source || !state.session) return;
  let url;
  try {
    url = new URL(source, state.config.apiBaseUrl);
  } catch {
    return;
  }
  if (url.protocol !== 'https:'
    && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) return;
  const image = createElement('img', {
    className: 'portal-banner',
    attrs: { alt: '', decoding: 'async' },
  });
  const placeholder = hero.querySelector('.portal-banner-placeholder');
  if (url.origin !== new URL(state.config.apiBaseUrl).origin) {
    image.src = url.href;
    placeholder?.replaceWith(image);
    return;
  }
  try {
    const response = await fetch(url.href, {
      /*
      headers: { Authorization: `Bearer ${state.api.getSessionToken()}` },
      */
      headers: { Authorization: ['Bearer', state.api.getSessionToken()].join(' ') },
    });
    if (response.status === 401) throw new SessionExpiredError();
    if (!response.ok) return;
    const objectUrl = URL.createObjectURL(await response.blob());
    state.bannerObjectUrls.push(objectUrl);
    image.src = objectUrl;
    placeholder?.replaceWith(image);
  } catch (error) {
    handleRequestError(error);
  }
}

function renderUpload() {
  if (!state.session || state.view !== 'upload') return;
  revokeBannerUrls();
  const branding = state.session.portalBranding.upload || {};
  const hero = createElement(
    'section',
    { className: 'portal-hero' },
    createElement('div', {
      className: 'portal-banner portal-banner-placeholder',
      attrs: { 'aria-hidden': 'true' },
    }),
    createElement(
      'div',
      { className: 'portal-hero-brand' },
      createElement('img', {
        className: 'portal-logo',
        attrs: { src: state.config.branding.logoSrc, alt: '' },
      }),
      createElement('h1', {
        className: 'portal-title',
        text: safeString(branding.title, t('app.title.upload'), 200).trim()
          || t('app.title.upload'),
      }),
    ),
  );
  renderBackendBanner(hero, branding);
  const header = createElement(
    'div',
    { className: 'upload-header' },
    createElement('p', {
      className: 'status',
      text: t('upload.signedInAs', {
        username: isolateTechnicalValue(state.session.username),
      }),
      attrs: { dir: 'auto' },
    }),
  );
  renderAccountMenu(header);
  const list = createElement('div', { className: 'batch-list' });
  state.groups.forEach((group, index) => {
    const groupJobs = state.jobs.filter((job) => job.groupId === group.id);
    const locked = groupJobs.some((job) => job.status !== 'queued' && job.status !== 'rejected');
    const card = createElement('section', {
      className: 'batch-card card',
      attrs: { 'aria-label': t('upload.batch.accessibleLabel', { number: index + 1 }) },
    });
    const label = createElement('div', {
      className: 'batch-label',
      text: t('upload.batch.label', { number: index + 1 }),
    });
    if (group.batchId) {
      label.append(' — ', technicalElement('bdi', 'batch-id', group.batchId));
    }
    card.append(label, createElement(
      'div',
      { className: 'batch-row' },
      renderMetadataForm(group, locked),
      renderDropZone(group),
    ));
    if (group.validationError) {
      card.append(createElement('p', {
        className: 'portal-message error batch-error',
        text: group.validationError,
        attrs: { role: 'alert' },
      }));
    }
    const jobs = renderJobs(group);
    if (jobs) card.append(jobs);
    list.append(card);
  });
  const addGroup = createElement('button', {
    className: 'add-batch-btn',
    text: `+ ${t('upload.batch.add')}`,
    attrs: { type: 'button', 'aria-label': t('upload.batch.add') },
  });
  addGroup.addEventListener('click', () => {
    state.groups.push(newGroup());
    renderUpload();
  });
  replaceContent(elements.uploadView, hero, header, list, addGroup);
}

function updateJob(job, patch) {
  Object.assign(job, patch);
  renderUpload();
}

function rejectedJob(group, item, uploadPath, error) {
  return {
    id: crypto.randomUUID(),
    file: item.file,
    clientPath: item.relativePath,
    uploadPath,
    groupId: group.id,
    status: 'rejected',
    progress: 0,
    error,
  };
}

async function prepareImageJob(job) {
  try {
    const dimensions = await readImageDimensions(job.file);
    validateImageDimensions(
      state.session.ingestionPolicy?.imageValidation,
      job.file.type,
      dimensions?.width,
      dimensions?.height,
    );
    job.imageWidth = dimensions?.width;
    job.imageHeight = dimensions?.height;
    return job;
  } catch (error) {
    updateJob(job, {
      status: 'rejected',
      error: t('upload.error.minimumImageSize'),
    });
    return null;
  }
}

async function onFilesAdded(group, incoming) {
  if (!state.session || group.running) return;
  const groupError = validateGroup(group);
  if (groupError) {
    group.validationError = groupError;
    renderUpload();
    return;
  }
  const existing = state.jobs.filter((job) => job.groupId === group.id && job.status !== 'rejected');
  const accepted = [];
  const rejected = [];
  const pathPrefix = pathPrefixForGroup(group);
  incoming.forEach((item) => {
    let uploadPath = item.relativePath;
    try {
      uploadPath = resolveUploadRelativePath(
        state.session.uploadPathPolicy,
        item.relativePath,
        pathPrefix,
      );
      const extensionError = checkFileExtension(state.session.fileExtensions, uploadPath);
      const sizeError = item.file.size > state.session.limits.maxFileBytes
        ? t('error.upload.fileTooLarge', {
          maxFileBytes: state.session.limits.maxFileBytes,
        }) : '';
      if (extensionError || sizeError) {
        rejected.push(rejectedJob(
          group,
          item,
          uploadPath,
          extensionError ? t('error.upload.fileType') : sizeError,
        ));
      } else {
        accepted.push(item);
      }
    } catch (error) {
      rejected.push(rejectedJob(
        group,
        item,
        uploadPath,
        t('upload.error.invalidFilePath'),
      ));
    }
  });
  state.jobs.push(...rejected);
  if (!accepted.length) {
    renderUpload();
    return;
  }
  const collision = flattenPathCollisions(
    state.session.uploadPathPolicy,
    [...existing.map((job) => job.clientPath), ...accepted.map((item) => item.relativePath)],
    pathPrefix,
  );
  if (collision) {
    group.validationError = t('upload.error.invalidPath');
    renderUpload();
    return;
  }
  if (existing.length + accepted.length > state.session.limits.maxBatch) {
    group.validationError = t('upload.batch.limit', {
      limit: state.session.limits.maxBatch,
      existing: existing.length,
    });
    renderUpload();
    return;
  }
  const jobs = accepted.map((item) => ({
    id: crypto.randomUUID(),
    file: item.file,
    clientPath: item.relativePath,
    uploadPath: resolveUploadRelativePath(
      state.session.uploadPathPolicy,
      item.relativePath,
      pathPrefix,
    ),
    groupId: group.id,
    status: 'queued',
    progress: 0,
  }));
  state.jobs.push(...jobs);
  group.running = true;
  group.validationError = '';
  renderUpload();
  const generation = state.sessionGeneration;
  try {
    if (state.session.ingestionPolicy?.batchId?.enabled && group.batchId === undefined) {
      const started = await state.api.startBatch(metadataPayload(group));
      group.batchId = typeof started.batchId === 'string' ? started.batchId : null;
    }
    const prepared = (await Promise.all(jobs.map(prepareImageJob))).filter(Boolean);
    if (generation !== state.sessionGeneration) return;
    if (!prepared.length) {
      group.running = false;
      renderUpload();
      return;
    }
    await runQueue(group, prepared, generation);
  } catch (error) {
    group.running = false;
    group.validationError = errorMessage(error, 'upload.error.startBatch');
    if (!handleRequestError(error)) renderUpload();
  }
}

async function processJob(job, group, options, sequenceIndex, generation) {
  if (generation !== state.sessionGeneration) return;
  const mimeType = job.file.type || 'application/octet-stream';
  const ingest = {
    ...options,
    sequenceIndex,
    mimeType,
    imageWidth: job.imageWidth,
    imageHeight: job.imageHeight,
  };
  try {
    const duplicate = await state.api.checkDuplicate(job.clientPath, job.file.size, ingest);
    if (duplicate.duplicate) {
      updateJob(job, {
        status: 'duplicate',
        error: t('error.upload.duplicate'),
      });
      return;
    }
    updateJob(job, { status: 'uploading', progress: 0 });
    const initiation = await state.api.initiateUpload(
      job.clientPath,
      job.file.size,
      mimeType,
      ingest,
    );
    job.resolvedPath = safeString(initiation.fileName, job.uploadPath, 1000);
    job.affinityToken = safeString(initiation.affinityToken, '') || null;
    await state.api.uploadFileBlocks(job.file, initiation, (progress) => {
      if (generation === state.sessionGeneration) updateJob(job, { progress });
    });
    updateJob(job, { status: 'completing', progress: 100 });
    await state.api.completeUpload({
      clientRelativePath: job.clientPath,
      uploadToken: initiation.uploadToken,
      mimeType,
      metadata: options.metadata,
      affinityToken: initiation.affinityToken,
      pathPrefix: options.pathPrefix,
      batchId: options.batchId,
      sequenceIndex,
      imageWidth: job.imageWidth,
      imageHeight: job.imageHeight,
    });
    updateJob(job, { status: 'done' });
  } catch (error) {
    updateJob(job, {
      status: 'error',
      error: errorMessage(error, 'upload.error.failed'),
    });
    handleRequestError(error);
  }
}

async function runQueue(group, pending, generation) {
  const queue = [...pending];
  let sequence = group.nextSequence;
  const pathPrefix = pathPrefixForGroup(group);
  const options = {
    pathPrefix,
    metadata: metadataPayload(group),
    batchId: group.batchId || undefined,
  };
  const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    while (queue.length && generation === state.sessionGeneration) {
      const job = queue.shift();
      const sequenceIndex = state.session.ingestionPolicy?.filenameTemplate?.sequenceSuffix
        ? sequence : undefined;
      if (sequenceIndex !== undefined) sequence += 1;
      // File jobs are intentionally consumed by a bounded worker pool.
      // eslint-disable-next-line no-await-in-loop
      await processJob(job, group, options, sequenceIndex, generation);
    }
  });
  await Promise.all(workers);
  if (generation !== state.sessionGeneration) return;
  group.nextSequence = sequence;
  const groupJobs = state.jobs.filter((job) => (
    job.groupId === group.id && job.status !== 'rejected'
  ));
  const doneJobs = groupJobs.filter((job) => job.status === 'done');
  const assets = doneJobs.map((job) => ({
    path: job.resolvedPath || job.uploadPath,
    mimeType: job.file.type || 'application/octet-stream',
  }));
  try {
    const completion = await state.api.completeBatch({
      batchId: group.batchId || undefined,
      succeeded: doneJobs.length,
      failed: groupJobs.length - doneJobs.length,
      total: groupJobs.length,
      assets,
    });
    group.verificationPending = completion.verificationPending === true;
    group.completed = true;
  } catch (error) {
    group.validationError = errorMessage(error, 'upload.error.failed');
    handleRequestError(error);
  } finally {
    group.running = false;
  }
  if (state.session) {
    renderUpload();
    maybeShowConfirmation();
  }
}

function maybeShowConfirmation() {
  const groupsWithJobs = state.groups.filter((group) => (
    state.jobs.some((job) => job.groupId === group.id && job.status !== 'rejected')
  ));
  const unfinished = groupsWithJobs.some((group) => group.running || !group.completed);
  if (!groupsWithJobs.length || unfinished) return;
  const jobs = state.jobs.filter((job) => job.status !== 'rejected');
  const succeeded = jobs.filter((job) => job.status === 'done').length;
  const pendingBatchIds = groupsWithJobs
    .filter((group) => group.verificationPending && group.batchId)
    .map((group) => group.batchId);
  showConfirmation({
    vendorName: state.session.vendorName,
    total: jobs.length,
    succeeded,
    failed: jobs.length - succeeded,
    batchIds: groupsWithJobs.map((group) => group.batchId).filter(Boolean),
    pendingBatchIds,
  });
}

function verificationMessage(container, phase, rejected = []) {
  const existing = container.querySelector('.verification-status');
  if (existing) existing.remove();
  const section = createElement('div', { className: 'verification-status' });
  if (phase === 'checking') {
    section.append(createElement('p', {
      className: 'verification-checking',
      text: t('confirmation.verification.checking'),
    }));
  } else if (phase === 'timeout') {
    section.append(
      createElement('h2', {
        className: 'panel-heading',
        text: t('confirmation.verification.running.heading'),
      }),
      createElement('p', {
        className: 'portal-message notice',
        text: t('confirmation.verification.running.body'),
      }),
    );
  } else if (rejected.length) {
    section.append(
      createElement('h2', {
        className: 'panel-heading',
        text: t('confirmation.verification.rejected.heading', { count: rejected.length }),
      }),
      createElement('p', {
        className: 'portal-message error',
        text: t('confirmation.verification.rejected.body', { count: rejected.length }),
      }),
    );
    const list = createElement('ul', { className: 'verification-rejected-list' });
    rejected.forEach((item) => {
      list.append(createElement(
        'li',
        { className: 'error' },
        technicalElement('bdi', 'file-path', safeString(item.path)),
        document.createTextNode(` — ${t('upload.error.minimumImageSize')}`),
      ));
    });
    section.append(list, createElement('p', {
      className: 'panel-sub',
      text: t('confirmation.verification.reupload'),
    }));
  } else if (phase === 'done') {
    section.append(
      createElement('h2', {
        className: 'panel-heading',
        text: t('confirmation.verification.complete.heading'),
      }),
      createElement('p', {
        className: 'panel-sub',
        text: t('confirmation.verification.complete.body'),
      }),
    );
  }
  container.append(section);
}

async function pollVerification(summary, container) {
  if (!summary.pendingBatchIds.length) return;
  verificationMessage(container, 'checking');
  let attempts = 0;
  const generation = state.sessionGeneration;
  const tick = async () => {
    if (generation !== state.sessionGeneration || state.view !== 'confirmation') return;
    attempts += 1;
    try {
      const results = await Promise.all(summary.pendingBatchIds.map(
        (batchId) => state.api.getBatchVerification(batchId),
      ));
      if (results.every((result) => result.status === 'done')) {
        const rejected = results.flatMap((result) => (
          Array.isArray(result.rejected) ? result.rejected : []
        ));
        verificationMessage(container, 'done', rejected);
        return;
      }
    } catch (error) {
      if (handleRequestError(error)) return;
    }
    if (attempts >= POLL_MAX_ATTEMPTS) {
      verificationMessage(container, 'timeout');
      return;
    }
    state.verificationTimer = window.setTimeout(tick, POLL_INTERVAL_MS);
  };
  await tick();
}

function showConfirmation(summary) {
  state.confirmationSummary = summary;
  showView('confirmation');
  const panel = createElement(
    'section',
    { className: 'confirmation-panel card' },
    createElement('h1', { className: 'panel-heading', text: t('confirmation.thankYou') }),
    createElement('p', {
      className: 'panel-sub',
      text: t('confirmation.submitted', { organization: summary.vendorName }),
    }),
  );
  const stats = createElement(
    'ul',
    { className: 'confirmation-stats' },
    createElement('li', {
      text: t('confirmation.summary.uploaded', { count: summary.succeeded }),
    }),
    createElement('li', {
      text: t('confirmation.summary.failed', { count: summary.failed }),
    }),
    createElement('li', {
      text: t('confirmation.summary.total', { count: summary.total }),
    }),
  );
  summary.batchIds.forEach((batchId) => {
    const item = createElement('li', {
      text: t('confirmation.batchId', { batchId: isolateTechnicalValue(batchId) }),
      attrs: { dir: 'auto' },
    });
    stats.append(item);
  });
  const more = createElement('button', {
    className: 'primary',
    text: t('confirmation.uploadMore'),
    attrs: { type: 'button' },
  });
  more.addEventListener('click', () => {
    window.clearTimeout(state.verificationTimer);
    state.groups = [newGroup()];
    state.jobs = [];
    state.confirmationSummary = null;
    showView('upload');
    renderUpload();
    updateStaticTranslations();
  });
  panel.append(stats, more);
  replaceContent(
    elements.confirmationView,
    createElement(
      'section',
      { className: 'portal-hero confirmation-hero' },
      createElement('h1', { className: 'portal-title', text: t('app.title.confirmation') }),
    ),
    panel,
  );
  pollVerification(summary, panel);
}

function lockoutMessage(error) {
  const base = t('login.locked.base');
  if (!error.retryAfterSeconds) return t('login.locked.later', { base });
  const minutes = Math.ceil(error.retryAfterSeconds / 60);
  return minutes >= 60
    ? t('login.locked.retryHours', { base, count: Math.ceil(minutes / 60) })
    : t('login.locked.retryMinutes', { base, count: minutes });
}

async function applyLoginBranding() {
  let branding;
  try {
    branding = await state.api.getLoginBranding();
  } catch {
    return;
  }

  const title = safeString(branding.title, '', 200).trim();
  if (title) {
    state.loginBrandingTitle = title;
    elements.title.textContent = title;
  }

  const source = safeString(branding.bannerSrc, '', 1000).trim();
  if (!source) return;
  let url;
  try {
    url = new URL(source, state.config.apiBaseUrl);
  } catch {
    return;
  }
  const localHttp = url.protocol === 'http:'
    && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !localHttp) return;
  replaceContent(elements.loginBanner, createElement('img', {
    className: 'portal-banner',
    attrs: { src: url.href, alt: '', decoding: 'async' },
  }));
}

async function signIn(username, password) {
  const sessionResponse = await state.api.createSession(username, password);
  state.sessionGeneration += 1;
  state.session = normalizeSession(sessionResponse);
  const vendorLocale = resolveVendorLocale(
    state.i18n.locale,
    state.localeSource,
    state.session.portalLocalization,
  );
  await changeLocale(vendorLocale, state.localeSource);
  state.groups = [newGroup()];
  state.jobs = [];
  elements.passwordInput.value = '';
  setMessage(elements.loginMessage, '');
  showView('upload');
  scheduleSessionExpiry();
  renderUpload();
  updateStaticTranslations();
}

function closeDialog(dialog) {
  dialog.close();
  dialog.remove();
}

function showRotateResult(dialog, body, result, forced, username) {
  const passwordCode = technicalElement('code', 'password-value', result.password);
  const copy = createElement('button', {
    className: 'secondary',
    text: t('password.rotate.copy'),
    attrs: { type: 'button' },
  });
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(result.password);
      copy.textContent = t('password.rotate.copied');
    } catch {
      copy.textContent = t('password.rotate.copy');
    }
  });
  const done = createElement('button', {
    text: t(forced ? 'password.rotate.continue' : 'password.rotate.done'),
    attrs: { type: 'button' },
  });
  done.addEventListener('click', async () => {
    const mintedPassword = result.password;
    passwordCode.textContent = '';
    result.password = '';
    if (!forced) {
      closeDialog(dialog);
      return;
    }
    done.disabled = true;
    try {
      await signIn(username, mintedPassword);
      closeDialog(dialog);
    } catch (error) {
      setMessage(
        elements.loginMessage,
        errorMessage(error, 'login.failed.afterPasswordRotation'),
        'error',
      );
      closeDialog(dialog);
      showView('login');
    }
  });
  replaceContent(
    body,
    createElement('h2', { text: t('password.rotate.title.newPassword') }),
    createElement('p', {
      className: 'field-hint',
      text: t('password.rotate.saveNow', {
        message: result.graceHours > 0
          ? t('password.rotate.result.oldPasswordGrace', { hours: result.graceHours })
          : t('password.rotate.result.oldPasswordImmediate'),
      }),
    }),
    createElement('div', { className: 'password-reveal' }, passwordCode, copy),
    result.expiresAt ? createElement('p', {
      className: 'field-hint',
      text: t('password.rotate.expires', { expiresAt: new Date(result.expiresAt) }),
    }) : document.createTextNode(''),
    createElement('div', { className: 'modal-actions' }, done),
  );
}

function showRotateDialog({
  forced,
  username = state.session?.username || elements.usernameInput.value.trim(),
  initialPassword = '',
}) {
  const dialog = createElement('dialog', {
    className: 'asp-password-dialog card',
    attrs: { 'aria-label': t('password.rotate.title') },
  });
  const body = createElement('div');
  const form = createElement('form');
  const currentPassword = createElement('input', {
    attrs: {
      id: 'rotate-current-password',
      type: 'password',
      autocomplete: 'current-password',
      required: '',
      value: initialPassword,
      dir: 'ltr',
    },
  });
  const grace = createElement('select', { attrs: { id: 'rotate-grace' } });
  [
    [t('password.rotate.expiry.immediately'), 0],
    [t('password.rotate.expiry.oneHour'), 1],
    [t('password.rotate.expiry.oneDay'), 24],
    [t('password.rotate.expiry.sevenDays'), 168],
  ].forEach(([label, hours]) => {
    grace.append(createElement('option', {
      text: label,
      attrs: { value: String(hours) },
    }));
  });
  const rotateError = createElement('p', {
    className: 'portal-message error',
    attrs: { role: 'alert' },
  });
  rotateError.hidden = true;
  const actions = createElement('div', { className: 'modal-actions' });
  if (!forced) {
    const cancel = createElement('button', {
      className: 'secondary',
      text: t('password.rotate.cancel'),
      attrs: { type: 'button' },
    });
    cancel.addEventListener('click', () => {
      currentPassword.value = '';
      closeDialog(dialog);
    });
    actions.append(cancel);
  }
  const rotate = createElement('button', {
    text: t('password.rotate.submit'),
    attrs: { type: 'submit' },
  });
  actions.append(rotate);
  form.append(
    createElement('h2', {
      text: t(forced ? 'password.rotate.title.required' : 'password.rotate.title'),
    }),
    createElement('p', {
      className: 'field-hint',
      text: t(forced ? 'password.rotate.requiredIntro' : 'password.rotate.intro'),
    }),
    createElement('label', {
      text: t('password.rotate.currentPassword.label'),
      attrs: { for: 'rotate-current-password' },
    }),
    currentPassword,
  );
  if (!forced) {
    form.append(
      createElement('label', {
        text: t('password.rotate.expiry.label'),
        attrs: { for: 'rotate-grace' },
      }),
      grace,
    );
  }
  form.append(rotateError, actions);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    rotate.disabled = true;
    const rawPassword = currentPassword.value;
    try {
      const result = await state.api.rotatePassword(
        username,
        rawPassword,
        forced ? 0 : Number(grace.value),
      );
      currentPassword.value = '';
      showRotateResult(dialog, body, result, forced, username);
    } catch (error) {
      setMessage(
        rotateError,
        errorMessage(error, 'password.rotate.failed.generic'),
        'error',
      );
    } finally {
      rotate.disabled = false;
    }
  });
  body.append(form);
  dialog.append(body);
  dialog.addEventListener('cancel', (event) => {
    if (forced) event.preventDefault();
    else currentPassword.value = '';
  });
  elements.modalRoot.append(dialog);
  dialog.showModal();
  currentPassword.focus();
}

async function handleLogin(event) {
  event.preventDefault();
  const username = elements.usernameInput.value.trim();
  const password = elements.passwordInput.value;
  setMessage(elements.loginMessage, '');
  elements.loginButton.disabled = true;
  try {
    await signIn(username, password);
  } catch (error) {
    elements.passwordInput.value = '';
    if (error instanceof ForcePasswordRotationRequiredError) {
      showRotateDialog({
        forced: true,
        username,
        initialPassword: password,
      });
    } else if (error instanceof LoginLockedError) {
      setMessage(elements.loginMessage, lockoutMessage(error), 'locked');
    } else {
      setMessage(elements.loginMessage, errorMessage(error, 'login.failed.generic'), 'error');
    }
  } finally {
    elements.loginButton.disabled = false;
  }
}

async function init() {
  try {
    state.config = await loadPortalConfig();
    state.api = new PortalApi(state.config);
    state.catalogLoader = new CatalogLoader(state.api.getI18nManifestUrl());
    const resolution = resolveInitialLocale({
      pageUrl: window.location.href,
      org: state.config.org,
      configuredLocale: state.config.locale,
      documentLocale: document.documentElement.lang,
      browserLocales: navigator.languages?.length ? navigator.languages : [navigator.language],
    });
    state.localeSource = resolution.source;
    state.i18n = await state.catalogLoader.load(resolution.locale);
    elements.logo.src = state.config.branding.logoSrc;
    elements.logo.alt = '';
    elements.loginForm.addEventListener('submit', handleLogin);
    showView('login');
    updateStaticTranslations();
    elements.languageSelect.addEventListener('change', async () => {
      try {
        await changeLocale(elements.languageSelect.value);
      } catch {
        setMessage(elements.languageMessage, t('error.translations.load'), 'error');
        updateLanguageSelector();
      }
    });
    elements.usernameInput.focus();
    await applyLoginBranding();
  } catch (error) {
    elements.loginButton.disabled = true;
    setMessage(
      elements.loginMessage,
      state.i18n ? t('error.translations.load') : safeString(error?.message),
      'error',
    );
  }
}

registerToolReady(init());
