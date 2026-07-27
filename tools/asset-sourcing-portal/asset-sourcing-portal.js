/* eslint-disable no-use-before-define */
import { registerToolReady } from '../../scripts/scripts.js';
import {
  ForceRotateRequiredError,
  LoginLockedError,
  PortalApi,
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
  uploadPathPolicyHint,
  validateImageDimensions,
  validateUploadPath,
  vendorUploadPathEnabled,
} from './policies.js';

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
  accountInput: document.getElementById('account'),
  keyInput: document.getElementById('key'),
  loginButton: document.getElementById('asp-login-button'),
  loginMessage: document.getElementById('asp-login-message'),
  uploadView: document.getElementById('asp-upload-view'),
  confirmationView: document.getElementById('asp-confirmation-view'),
  modalRoot: document.getElementById('asp-modal-root'),
};

const state = {
  config: null,
  api: null,
  session: null,
  groups: [],
  jobs: [],
  view: 'login',
  sessionGeneration: 0,
  sessionTimer: 0,
  verificationTimer: 0,
  bannerObjectUrls: [],
};

function safeString(value, fallback = '', maxLength = 500) {
  return typeof value === 'string' ? value.slice(0, maxLength) : fallback;
}

function normalizeMetadataSchema(value) {
  const input = value && typeof value === 'object' ? value : {};
  const editableInput = Array.isArray(input.editable) ? input.editable.slice(0, 100) : [];
  const editable = editableInput.filter((field) => (
    field && typeof field === 'object' && typeof field.id === 'string'
      && field.id.length > 0 && field.id.length <= 200
  )).map((field) => ({
    id: field.id,
    label: safeString(field.label, field.id, 200),
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
  const account = session.account && typeof session.account === 'object' ? session.account : {};
  const vendor = session.vendor && typeof session.vendor === 'object' ? session.vendor : {};
  const accountName = safeString(account.name || vendor.name, 'your organization', 200);
  const limits = session.limits && typeof session.limits === 'object' ? session.limits : {};
  return {
    accountName,
    expiresAt: session.expiresAt,
    metadataSchema: normalizeMetadataSchema(session.metadataSchema),
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
  elements.accountInput.value = '';
  elements.keyInput.value = '';
  showView('login');
  setMessage(elements.loginMessage, message, message ? 'notice' : '');
  elements.accountInput.focus();
}

function handleRequestError(error) {
  if (error instanceof SessionExpiredError) {
    endSession(error.message || 'Your session has expired. Please sign in again.');
    return true;
  }
  return false;
}

function scheduleSessionExpiry() {
  const milliseconds = state.session.expiresAt < 1_000_000_000_000
    ? state.session.expiresAt * 1000 : state.session.expiresAt;
  const delay = Math.max(0, milliseconds - Date.now());
  window.clearTimeout(state.sessionTimer);
  state.sessionTimer = window.setTimeout(() => {
    endSession('Your session has expired. Please sign in again.');
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
    return `${field?.label || missing} is required before uploading.`;
  }
  return validateUploadPath(group.uploadPath, uploadPathPolicy);
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function extensionHint() {
  const policy = state.session.fileExtensions;
  if (!policy?.allow?.length && !policy?.deny?.length) return '';
  if (policy.allow?.length) return `Allowed file types: ${policy.allow.map((item) => `.${item}`).join(', ')}`;
  return `Blocked file types: ${policy.deny.map((item) => `.${item}`).join(', ')}`;
}

function minimumDimensionHint() {
  const policy = state.session.ingestionPolicy?.imageValidation;
  if (!policy) return '';
  const requirements = [];
  if (policy.minDimensionPx) requirements.push(`at least ${policy.minDimensionPx}px on the shortest side`);
  if (policy.minWidthPx) requirements.push(`at least ${policy.minWidthPx}px wide`);
  if (policy.minHeightPx) requirements.push(`at least ${policy.minHeightPx}px tall`);
  return requirements.length ? `Images must be ${requirements.join(' and ')}.` : '';
}

function renderPrepopulated(container, schema) {
  const entries = Object.entries(schema.prepopulated);
  if (!entries.length) return;
  const details = createElement('details', { className: 'asp-prepopulated' });
  details.append(createElement('summary', { text: 'Account-provided metadata' }));
  const list = createElement('dl');
  entries.forEach(([key, value]) => {
    list.append(
      createElement('dt', { text: key }),
      createElement('dd', { text: String(value) }),
    );
  });
  details.append(list);
  container.append(details);
}

function renderMetadataForm(group, locked) {
  const container = createElement('div', { className: `metadata-form${locked ? ' locked' : ''}` });
  container.append(
    createElement('h2', { className: 'panel-heading', text: 'Metadata' }),
    createElement('p', {
      className: 'panel-sub',
      text: locked ? 'Locked — uploads have started for this batch.' : 'Applies to every file in this batch.',
    }),
  );
  const policy = state.session.uploadPathPolicy;
  if (vendorUploadPathEnabled(policy)) {
    const labelText = `${policy.vendorPath.label || 'Upload path'}${policy.vendorPath.required ? ' *' : ''}`;
    const id = `${group.id}-upload-path`;
    const input = createElement('input', {
      attrs: {
        id,
        type: 'text',
        value: group.uploadPath,
        placeholder: '/campaigns/2026',
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
        text: 'Relative path under the intake folder. Must start with /.',
      }),
    );
  }

  state.session.metadataSchema.editable.forEach((field) => {
    const id = `${group.id}-${field.id}`;
    const required = state.session.metadataSchema.required.includes(field.id);
    const label = createElement('label', {
      text: `${field.label}${required ? ' *' : ''}`,
      attrs: { for: id },
    });
    let input;
    if (field.options.length) {
      input = createElement('select', { attrs: { id } });
      const placeholder = createElement('option', {
        text: '— Select —',
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
      text: `Minimum image dimensions: ${dimensionHint}`,
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
      createElement('span', { className: 'file-name', text: job.uploadPath }),
      createElement('span', { className: 'file-size', text: formatBytes(job.file.size) }),
    );
    if (job.clientPath !== job.uploadPath) {
      main.insertBefore(createElement('span', {
        className: 'file-source',
        text: `from ${job.clientPath}`,
      }), main.lastChild);
    }
    const status = createElement('div', {
      className: 'status',
      text: `${job.status}${job.error ? ` — ${job.error}` : ''}`,
    });
    const item = createElement('li', { className }, main, status);
    if (job.status === 'uploading' || job.status === 'completing') {
      const progress = Math.max(0, Math.min(100, job.progress));
      item.append(createElement('progress', {
        className: 'progress',
        attrs: {
          max: '100',
          value: String(progress),
          'aria-label': `Upload progress for ${job.uploadPath}`,
        },
      }));
    }
    list.append(item);
  });
  return list;
}

function setDropZoneDisabled(zone, disabled, reason) {
  zone.classList.toggle('disabled', disabled);
  zone.setAttribute('aria-disabled', String(disabled));
  zone.tabIndex = disabled ? -1 : 0;
  zone.dataset.disabled = String(disabled);
  const title = zone.querySelector('.drop-zone-title');
  const hint = zone.querySelector('.drop-zone-hint');
  title.textContent = disabled ? 'Upload unavailable' : 'Drop files or folders here';
  hint.textContent = reason || [
    uploadPathPolicyHint(state.session.uploadPathPolicy),
    extensionHint(),
  ].filter(Boolean).join(' — ') || 'or click to browse files';
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
    text: 'Select folder…',
    attrs: { type: 'button' },
  });
  const zone = createElement(
    'div',
    {
      className: 'drop-zone',
      attrs: {
        role: 'button',
        tabindex: '0',
        'aria-label': 'Upload files or folders — click or drag and drop',
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
  const disabledReason = group.running ? 'This batch is currently uploading.' : validationError;
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
      group.validationError = error instanceof Error ? error.message : 'Invalid file path';
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
    text: `Signed in as ${state.session.accountName}`,
  }));
  if (state.session.capabilities.rotateKeyAllowed === true) {
    const rotate = createElement('button', {
      className: 'account-menu-item',
      text: 'Rotate API key',
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
    text: 'Sign out',
    attrs: { type: 'button', role: 'menuitem' },
  });
  signOut.addEventListener('click', () => endSession());
  menu.append(signOut);
  const trigger = createElement('button', {
    className: 'account-menu-trigger',
    text: '☰',
    attrs: {
      type: 'button',
      'aria-label': 'Account menu',
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
      headers: { Authorization: `Bearer ${state.api.getSessionToken()}` },
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
        text: safeString(branding.title, 'Upload assets', 200).trim() || 'Upload assets',
      }),
    ),
  );
  renderBackendBanner(hero, branding);
  const header = createElement(
    'div',
    { className: 'upload-header' },
    createElement('p', {
      className: 'status',
      text: `Signed in as ${state.session.accountName}`,
    }),
  );
  renderAccountMenu(header);
  const list = createElement('div', { className: 'batch-list' });
  state.groups.forEach((group, index) => {
    const groupJobs = state.jobs.filter((job) => job.groupId === group.id);
    const locked = groupJobs.some((job) => job.status !== 'queued' && job.status !== 'rejected');
    const card = createElement('section', {
      className: 'batch-card card',
      attrs: { 'aria-label': `Upload batch ${index + 1}` },
    });
    const label = createElement('div', {
      className: 'batch-label',
      text: `Batch ${index + 1}${group.batchId ? ` — ${group.batchId}` : ''}`,
    });
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
    text: '+ Add another batch',
    attrs: { type: 'button', 'aria-label': 'Add another upload batch' },
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
      error: error instanceof Error ? error.message : 'Could not validate image dimensions',
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
        ? `File exceeds the ${formatBytes(state.session.limits.maxFileBytes)} limit.` : '';
      if (extensionError || sizeError) {
        rejected.push(rejectedJob(group, item, uploadPath, extensionError || sizeError));
      } else {
        accepted.push(item);
      }
    } catch (error) {
      rejected.push(rejectedJob(
        group,
        item,
        uploadPath,
        error instanceof Error ? error.message : 'Invalid file path',
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
    group.validationError = collision;
    renderUpload();
    return;
  }
  if (existing.length + accepted.length > state.session.limits.maxBatch) {
    group.validationError = `This batch allows up to ${state.session.limits.maxBatch} files (${existing.length} already added).`;
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
    group.validationError = error instanceof Error ? error.message : 'Could not start upload batch';
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
        error: safeString(duplicate.message, 'Already uploaded to AEM'),
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
      error: error instanceof Error ? error.message : 'Upload failed',
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
    group.validationError = error instanceof Error ? error.message : 'Could not complete the upload batch';
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
    accountName: state.session.accountName,
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
      text: 'Checking image dimensions… this can take a moment while your assets are processed.',
    }));
  } else if (phase === 'timeout') {
    section.append(createElement('p', {
      className: 'portal-message notice',
      text: 'Still checking image dimensions. Assets that do not meet the minimum size will be removed.',
    }));
  } else if (rejected.length) {
    section.append(createElement('p', {
      className: 'portal-message error',
      text: `${rejected.length} ${rejected.length === 1 ? 'file was' : 'files were'} rejected for not meeting minimum image dimensions:`,
    }));
    const list = createElement('ul', { className: 'verification-rejected-list' });
    rejected.forEach((item) => {
      list.append(createElement('li', {
        className: 'error',
        text: `${safeString(item.path, 'Unknown asset')} — ${safeString(item.reason, 'Below minimum dimensions')}`,
      }));
    });
    section.append(list);
  } else if (phase === 'done') {
    section.append(createElement('p', {
      className: 'panel-sub',
      text: 'All images met the minimum dimensions.',
    }));
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
  showView('confirmation');
  const panel = createElement(
    'section',
    { className: 'confirmation-panel card' },
    createElement('h1', { className: 'panel-heading', text: 'Thank you' }),
    createElement('p', {
      className: 'panel-sub',
      text: `Your files were submitted to ${summary.accountName}.`,
    }),
  );
  const stats = createElement(
    'ul',
    { className: 'confirmation-stats' },
    createElement('li', { text: `${summary.succeeded} uploaded successfully` }),
    createElement('li', { text: `${summary.failed} failed or skipped` }),
    createElement('li', { text: `${summary.total} total` }),
  );
  summary.batchIds.forEach((batchId) => {
    stats.append(createElement('li', { text: `Batch ID: ${batchId}` }));
  });
  const more = createElement('button', {
    className: 'primary',
    text: 'Upload more files',
    attrs: { type: 'button' },
  });
  more.addEventListener('click', () => {
    window.clearTimeout(state.verificationTimer);
    state.groups = [newGroup()];
    state.jobs = [];
    showView('upload');
    renderUpload();
  });
  panel.append(stats, more);
  replaceContent(
    elements.confirmationView,
    createElement(
      'section',
      { className: 'portal-hero confirmation-hero' },
      createElement('h1', { className: 'portal-title', text: 'Upload complete' }),
    ),
    panel,
  );
  pollVerification(summary, panel);
}

function lockoutMessage(error) {
  const base = 'Your account is temporarily locked because of too many failed sign-in attempts.';
  if (!error.retryAfterSeconds) return `${base} Try again later.`;
  const minutes = Math.ceil(error.retryAfterSeconds / 60);
  const duration = minutes >= 60
    ? `about ${Math.ceil(minutes / 60)} hour${minutes >= 120 ? 's' : ''}`
    : `about ${minutes} minute${minutes === 1 ? '' : 's'}`;
  return `${base} Try again in ${duration}.`;
}

async function applyLoginBranding() {
  let branding;
  try {
    branding = await state.api.getLoginBranding();
  } catch {
    return;
  }

  const title = safeString(branding.title, '', 200).trim();
  if (title) elements.title.textContent = title;

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

async function signIn(accountName, apiKey) {
  const sessionResponse = await state.api.createSession(accountName, apiKey);
  state.sessionGeneration += 1;
  state.session = normalizeSession(sessionResponse);
  state.groups = [newGroup()];
  state.jobs = [];
  elements.keyInput.value = '';
  setMessage(elements.loginMessage, '');
  showView('upload');
  scheduleSessionExpiry();
  renderUpload();
}

function closeDialog(dialog) {
  dialog.close();
  dialog.remove();
}

function showRotateResult(dialog, body, result, forced, accountName) {
  const keyCode = createElement('code', { text: result.apiKey });
  const copy = createElement('button', {
    className: 'secondary',
    text: 'Copy',
    attrs: { type: 'button' },
  });
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(result.apiKey);
      copy.textContent = 'Copied';
    } catch {
      copy.textContent = 'Copy unavailable';
    }
  });
  const done = createElement('button', {
    text: forced ? 'Continue to sign in' : 'Done',
    attrs: { type: 'button' },
  });
  done.addEventListener('click', async () => {
    const mintedKey = result.apiKey;
    keyCode.textContent = '';
    result.apiKey = '';
    if (!forced) {
      closeDialog(dialog);
      return;
    }
    done.disabled = true;
    try {
      await signIn(accountName, mintedKey);
      closeDialog(dialog);
    } catch (error) {
      setMessage(elements.loginMessage, error instanceof Error ? error.message : 'Sign-in failed', 'error');
      closeDialog(dialog);
      showView('login');
    }
  });
  replaceContent(
    body,
    createElement('h2', { text: 'New API key' }),
    createElement('p', {
      className: 'field-hint',
      text: `Save this key now — it is shown only once. ${safeString(result.message)}`,
    }),
    createElement('div', { className: 'key-reveal' }, keyCode, copy),
    createElement('div', { className: 'modal-actions' }, done),
  );
}

function showRotateDialog({
  forced,
  accountName = state.session?.accountName || elements.accountInput.value.trim(),
  initialKey = '',
  message = '',
}) {
  const dialog = createElement('dialog', {
    className: 'asp-key-dialog card',
    attrs: { 'aria-label': 'Rotate API key' },
  });
  const body = createElement('div');
  const form = createElement('form');
  const currentKey = createElement('input', {
    attrs: {
      id: 'rotate-current-key',
      type: 'password',
      autocomplete: 'off',
      required: '',
      value: initialKey,
    },
  });
  const grace = createElement('select', { attrs: { id: 'rotate-grace' } });
  [
    ['Revoke old key immediately (compromised)', 0],
    ['Keep old key for 1 hour', 1],
    ['Keep old key for 24 hours', 24],
    ['Keep old key for 7 days', 168],
  ].forEach(([label, hours]) => {
    grace.append(createElement('option', {
      text: label,
      attrs: { value: String(hours) },
    }));
  });
  const errorMessage = createElement('p', {
    className: 'portal-message error',
    attrs: { role: 'alert' },
  });
  errorMessage.hidden = true;
  const actions = createElement('div', { className: 'modal-actions' });
  if (!forced) {
    const cancel = createElement('button', {
      className: 'secondary',
      text: 'Cancel',
      attrs: { type: 'button' },
    });
    cancel.addEventListener('click', () => {
      currentKey.value = '';
      closeDialog(dialog);
    });
    actions.append(cancel);
  }
  const rotate = createElement('button', { text: 'Rotate key', attrs: { type: 'submit' } });
  actions.append(rotate);
  form.append(
    createElement('h2', { text: forced ? 'Rotate required to continue' : 'Rotate API key' }),
    createElement('p', {
      className: 'field-hint',
      text: message || (forced
        ? 'Your administrator requires this key to be rotated before sign-in.'
        : 'Enter your current key. The replacement is shown only once.'),
    }),
    createElement('label', { text: 'Current API key', attrs: { for: 'rotate-current-key' } }),
    currentKey,
  );
  if (!forced) {
    form.append(
      createElement('label', { text: 'Old key expiry', attrs: { for: 'rotate-grace' } }),
      grace,
    );
  }
  form.append(errorMessage, actions);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    rotate.disabled = true;
    const rawKey = currentKey.value.trim();
    try {
      const result = await state.api.rotateKey(
        accountName,
        rawKey,
        forced ? 0 : Number(grace.value),
      );
      currentKey.value = '';
      showRotateResult(dialog, body, result, forced, accountName);
    } catch (error) {
      setMessage(errorMessage, error instanceof Error ? error.message : 'Key rotation failed', 'error');
    } finally {
      rotate.disabled = false;
    }
  });
  body.append(form);
  dialog.append(body);
  dialog.addEventListener('cancel', (event) => {
    if (forced) event.preventDefault();
    else currentKey.value = '';
  });
  elements.modalRoot.append(dialog);
  dialog.showModal();
  currentKey.focus();
}

async function handleLogin(event) {
  event.preventDefault();
  const accountName = elements.accountInput.value.trim();
  const apiKey = elements.keyInput.value.trim();
  setMessage(elements.loginMessage, '');
  elements.loginButton.disabled = true;
  try {
    await signIn(accountName, apiKey);
  } catch (error) {
    elements.keyInput.value = '';
    if (error instanceof ForceRotateRequiredError) {
      showRotateDialog({
        forced: true,
        accountName,
        initialKey: apiKey,
        message: error.message,
      });
    } else if (error instanceof LoginLockedError) {
      setMessage(elements.loginMessage, lockoutMessage(error), 'locked');
    } else {
      setMessage(elements.loginMessage, error instanceof Error ? error.message : 'Sign-in failed', 'error');
    }
  } finally {
    elements.loginButton.disabled = false;
  }
}

async function init() {
  try {
    state.config = await loadPortalConfig();
    state.api = new PortalApi(state.config);
    elements.title.textContent = state.config.branding.title;
    elements.logo.src = state.config.branding.logoSrc;
    elements.logo.alt = '';
    elements.loginForm.addEventListener('submit', handleLogin);
    showView('login');
    elements.accountInput.focus();
    await applyLoginBranding();
  } catch (error) {
    elements.loginButton.disabled = true;
    setMessage(
      elements.loginMessage,
      error instanceof Error ? error.message : 'Portal configuration is invalid.',
      'error',
    );
  }
}

registerToolReady(init());
