import { toClassName, loadCSS } from '../../scripts/aem.js';
import admin from '../../scripts/helix-admin.js';
import decorateConsole, { logResponse, logMessage } from '../../blocks/console/console.js';
import { parseUsersFromAccessConfig, buildAccessConfig } from '../../tools/user-admin/utils.js';
import {
  CONTENT_SOURCE_KINDS,
  kindSupportsSuffix,
  detectContentSourceKind,
  buildContentSource,
  diffOrgUsers,
  createUserRow,
  collectUsers,
} from './wizard.js';

const EMPTY_ACCESS = { admin: { role: {} } };
// Namespaced so it can't collide with other tools' session storage on the origin.
const TOKEN_KEY = 'bot-info-setup-token';

/**
 * Pull the one-time token out of the URL fragment (if present), stash it in
 * session storage, and scrub it from the visible URL. Returns the active token.
 */
function captureToken() {
  const hashParams = new URLSearchParams(window.location.hash.substring(1));
  const token = hashParams.get('token');
  if (token) {
    hashParams.delete('token');
    const url = new URL(window.location.href);
    url.hash = hashParams.toString();
    window.history.replaceState(null, '', url);
    sessionStorage.setItem(TOKEN_KEY, token);
  }
  return sessionStorage.getItem(TOKEN_KEY);
}

/** Admin client that authenticates every request with the setup token. */
function tokenClient(token) {
  return token
    ? admin.withRequestInit({ headers: { authorization: `token ${token}` } })
    : admin;
}

/** Await an admin response and log the request/result to the console block. */
async function logged(consoleBlock, promise) {
  const res = await promise;
  if (res && consoleBlock) {
    logResponse(consoleBlock, res.status, [res.request.method, res.request.url, res.error]);
  }
  return res;
}

/** Resolve an admin response, throwing a readable error on failure. */
async function must(promise, label) {
  const res = await promise;
  if (!res?.ok) {
    const detail = res?.error || res?.status || 'network error';
    throw new Error(`${label} failed: ${detail}`);
  }
  return res;
}

function setHidden(el, hidden) {
  if (el) el.setAttribute('aria-hidden', String(hidden));
}

function setText(widget, selector, value) {
  widget.querySelectorAll(selector).forEach((el) => { el.textContent = value; });
}

/** Populate the org/site/link fields shared by the wizard and summary. */
function populateStaticFields(widget, { org, site }) {
  setText(widget, '.bot-info-org', org);
  setText(widget, '.bot-info-site', site);

  const previewLink = widget.querySelector('.bot-info-preview');
  if (previewLink) {
    previewLink.href = `https://main--${site}--${org}.aem.page/`;
    previewLink.textContent = previewLink.href;
  }
  const liveLink = widget.querySelector('.bot-info-live');
  if (liveLink) {
    liveLink.href = `https://main--${site}--${org}.aem.live/`;
    liveLink.textContent = liveLink.href;
  }
}

/**
 * Load the site config and, for new orgs, the org users. The site access config
 * is part of the site config response (`access`), so it's not fetched separately.
 */
async function loadConfig(api, { org, site, newOrg }, consoleBlock) {
  const [orgRes, siteRes] = await Promise.all([
    newOrg ? logged(consoleBlock, api.config({ org }).read()) : Promise.resolve(null),
    logged(consoleBlock, api.config({ org, site }).read()),
  ]);

  if (newOrg && orgRes && !orgRes.ok && orgRes.status !== 404) {
    throw new Error(`Loading org users failed: ${orgRes.error || orgRes.status}`);
  }
  if (!siteRes.ok && siteRes.status !== 404) {
    throw new Error(`Loading site config failed: ${siteRes.error || siteRes.status}`);
  }

  const siteConfig = siteRes.ok ? await siteRes.json() : {};
  return {
    orgUsers: orgRes?.ok ? (await orgRes.json()).users || [] : [],
    access: siteConfig.access || EMPTY_ACCESS,
    siteConfig,
  };
}

/** Render the editable user/content fields into the wizard form. */
function renderForm(widget, config, {
  org, site, user, url, newOrg,
}) {
  const orgList = widget.querySelector('.bot-info-user-list[data-scope="org"]');
  const siteList = widget.querySelector('.bot-info-user-list[data-scope="site"]');

  if (newOrg) {
    setHidden(widget.querySelector('.bot-info-org-users'), false);
    const orgUsers = config.orgUsers.length
      ? config.orgUsers
      : [{ email: user, roles: ['admin'] }].filter((u) => u.email);
    orgUsers.forEach((u) => orgList.append(createUserRow(u)));
  }

  const siteUsers = parseUsersFromAccessConfig(config.access);
  const seededSiteUsers = siteUsers.length
    ? siteUsers
    : [{ email: user, roles: ['admin'] }].filter((u) => u.email);
  seededSiteUsers.forEach((u) => siteList.append(createUserRow(u)));

  // wire up "add user/administrator" buttons
  widget.querySelectorAll('.bot-info-add-user').forEach((btn) => {
    const list = btn.dataset.scope === 'org' ? orgList : siteList;
    btn.addEventListener('click', () => {
      const row = createUserRow();
      list.append(row);
      row.querySelector('.bot-info-email').focus();
    });
  });

  // content source — DA is the default with a fixed, read-only URL; the
  // "use a different content source" checkbox reveals the non-DA options.
  widget.querySelector('.bot-info-da-url').value = `https://content.da.live/${org}/${site}`;

  const typeSelect = widget.querySelector('.bot-info-content-type');
  CONTENT_SOURCE_KINDS.filter((k) => k.value !== 'da').forEach(({ value, label }) => {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label;
    typeSelect.append(opt);
  });

  const advancedCheck = widget.querySelector('.bot-info-advanced-check');
  const advanced = widget.querySelector('.bot-info-advanced');
  const daDefault = widget.querySelector('.bot-info-da-default');
  const urlInput = widget.querySelector('.bot-info-content-url');
  const suffixField = widget.querySelector('.bot-info-suffix-field');
  const suffixInput = widget.querySelector('.bot-info-content-suffix');

  // suffix only applies to suffix-capable kinds (AEM Authoring, BYOM)
  const updateSuffix = () => setHidden(suffixField, !kindSupportsSuffix(typeSelect.value));

  const setAdvanced = (on) => {
    setHidden(advanced, !on);
    setHidden(daDefault, on);
    urlInput.required = on;
  };

  // prefill from the existing content source, opening "advanced" for non-DA
  const loadedUrl = config.siteConfig.content?.source?.url || url || '';
  const loadedKind = detectContentSourceKind(loadedUrl);
  if (loadedUrl && loadedKind !== 'da') {
    advancedCheck.checked = true;
    typeSelect.value = loadedKind;
    urlInput.value = loadedUrl;
  }
  if (config.siteConfig.content?.source?.suffix) {
    suffixInput.value = config.siteConfig.content.source.suffix;
  }
  setAdvanced(advancedCheck.checked);
  updateSuffix();

  advancedCheck.addEventListener('change', () => setAdvanced(advancedCheck.checked));
  typeSelect.addEventListener('change', updateSuffix);
  // keep the type in sync as the user edits the URL
  urlInput.addEventListener('change', () => {
    const kind = detectContentSourceKind(urlInput.value.trim());
    if (kind !== 'da') typeSelect.value = kind;
    updateSuffix();
  });
}

/**
 * Persist all gathered changes back to the admin API. Returns a summary of what
 * was saved so the confirmation screen can reflect the actual changes.
 */
async function submitConfig(api, widget, config, { org, site, newOrg }, consoleBlock) {
  let orgUsers = null;
  if (newOrg) {
    const orgList = widget.querySelector('.bot-info-user-list[data-scope="org"]');
    orgUsers = collectUsers(orgList);
    if (orgUsers.length === 0) {
      throw new Error('Add at least one organization user before saving.');
    }
    const { toAdd, toRemove, toUpdate } = diffOrgUsers(config.orgUsers, orgUsers);
    // run sequentially so a failure stops the rest with a clear error
    await toRemove.reduce(async (prev, u) => {
      await prev;
      await must(logged(consoleBlock, api.config({ org }).select(`users/${u.id}.json`).remove()), `Removing ${u.email}`);
    }, Promise.resolve());
    await toUpdate.reduce(async (prev, u) => {
      await prev;
      await must(logged(consoleBlock, api.config({ org }).select(`users/${u.id}.json`).update(JSON.stringify(u))), `Updating ${u.email}`);
    }, Promise.resolve());
    await toAdd.reduce(async (prev, u) => {
      await prev;
      await must(logged(consoleBlock, api.config({ org }).select('users.json').update(JSON.stringify(u))), `Adding ${u.email}`);
    }, Promise.resolve());
  }

  const siteList = widget.querySelector('.bot-info-user-list[data-scope="site"]');
  const siteUsers = collectUsers(siteList);
  const access = buildAccessConfig(config.access, siteUsers);
  await must(
    logged(consoleBlock, api.config({ org, site }).select('access.json').update(JSON.stringify(access))),
    'Saving site administrators',
  );

  const useDifferent = widget.querySelector('.bot-info-advanced-check').checked;
  const kind = useDifferent ? widget.querySelector('.bot-info-content-type').value : 'da';
  const contentUrl = useDifferent
    ? widget.querySelector('.bot-info-content-url').value.trim()
    : `https://content.da.live/${org}/${site}`;
  const suffix = widget.querySelector('.bot-info-content-suffix').value.trim();
  const source = buildContentSource(contentUrl, kind, suffix);
  const siteConfig = { ...config.siteConfig, content: { ...config.siteConfig.content, source } };
  await must(
    logged(consoleBlock, api.config({ org, site }).update(JSON.stringify(siteConfig))),
    'Saving content source',
  );

  return {
    orgUsers, siteUsers, contentUrl, contentKind: kind,
  };
}

/**
 * Point the "create your content" link at the DA editor for DA sources,
 * otherwise straight at the content source URL.
 */
function setCreateContentLink(widget, org, site, kind, contentUrl) {
  const editUrl = kind === 'da' ? `https://da.live/#/${org}/${site}` : contentUrl;
  const contentSource = widget.querySelector('.bot-info-content-source');
  if (!contentSource) return;
  const link = document.createElement('a');
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.href = editUrl;
  link.textContent = editUrl;
  contentSource.textContent = '';
  contentSource.append(link);
}

/** Render the "what we did" list from the saved changes. */
function renderDidList(widget, { org, site }, summary) {
  const did = widget.querySelector('.bot-info-did');
  did.textContent = '';

  const addItem = (text) => {
    const li = document.createElement('li');
    li.textContent = text;
    did.append(li);
    return li;
  };

  const addUsers = (label, users) => {
    const li = addItem(`${label}:`);
    const sub = document.createElement('ul');
    sub.className = 'bot-info-user-summary';
    users.forEach((u) => {
      const item = document.createElement('li');
      item.textContent = u.roles.length ? `${u.email} — ${u.roles.join(', ')}` : u.email;
      sub.append(item);
    });
    li.append(sub);
  };

  addItem(`Set up AEM for ${org} / ${site}.`);
  if (summary.orgUsers) {
    const n = summary.orgUsers.length;
    addUsers(`Configured ${n} organization user${n === 1 ? '' : 's'}`, summary.orgUsers);
  }
  const sn = summary.siteUsers.length;
  addUsers(`Configured ${sn} site user${sn === 1 ? '' : 's'}`, summary.siteUsers);
  const kind = CONTENT_SOURCE_KINDS.find((k) => k.value === summary.contentKind);
  addItem(`Set the content source to ${summary.contentUrl}${kind ? ` (${kind.label})` : ''}.`);
  addItem('Started AEM Code Sync for your GitHub repository.');
}

/**
 * Reveal the confirmation screen. With a `summary` it reflects the saved
 * changes; without one (e.g. the user skipped setup after a load error) it
 * shows an adapted screen with just the next-steps and DA defaults.
 */
function showConfirmation(widget, ctx, summary) {
  const { org, site } = ctx;
  const saved = !!summary;

  setHidden(widget.querySelector('.bot-info-welcome-saved'), !saved);
  setHidden(widget.querySelector('.bot-info-welcome-unsaved'), saved);
  setHidden(widget.querySelector('.bot-info-did-section'), !saved);

  if (saved) {
    renderDidList(widget, ctx, summary);
    setCreateContentLink(widget, org, site, summary.contentKind, summary.contentUrl);
  } else {
    setCreateContentLink(widget, org, site, 'da', `https://content.da.live/${org}/${site}`);
  }

  setHidden(widget.querySelector('.bot-info-loading'), true);
  setHidden(widget.querySelector('.bot-info-wizard'), true);
  setHidden(widget.querySelector('.bot-info-alert'), true);
  setHidden(widget.querySelector('.bot-info-success'), false);
}

export default async function decorate(widget) {
  const loading = widget.querySelector('.bot-info-loading');
  const form = widget.querySelector('.bot-info-wizard');
  const success = widget.querySelector('.bot-info-success');
  const alert = widget.querySelector('.bot-info-alert');
  const errorEl = widget.querySelector('.bot-info-error');

  // build the request log console (mirrors the other admin tools)
  const consoleBlock = widget.querySelector('.console');
  loadCSS(`${window.hlx.codeBasePath}/blocks/console/console.css`);
  decorateConsole(consoleBlock);

  const fail = (error) => {
    // eslint-disable-next-line no-console
    console.error(error);
    if (consoleBlock) logMessage(consoleBlock, 'error', ['setup', error.message]);
    setHidden(loading, true);
    setHidden(form, true);
    setHidden(success, true);
    setHidden(alert, false);
  };

  try {
    const token = captureToken();
    const params = new URLSearchParams(window.location.search);
    const ctx = {
      org: toClassName(params.get('org')),
      site: toClassName(params.get('site')),
      user: params.get('user') || '',
      url: params.get('url') || '',
      newOrg: params.get('new_org') === 'true',
    };

    populateStaticFields(widget, ctx);

    // let the user skip to the next-steps screen if config can't be loaded
    widget.querySelector('.bot-info-continue')?.addEventListener('click', () => {
      showConfirmation(widget, ctx, null);
    });

    const api = tokenClient(token);
    logMessage(consoleBlock, 'info', ['setup', `Loading configuration for ${ctx.org}/${ctx.site}…`]);
    const config = await loadConfig(api, ctx, consoleBlock);
    renderForm(widget, config, ctx);

    setHidden(loading, true);
    setHidden(form, false);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const submitBtn = widget.querySelector('.bot-info-submit');
      setHidden(errorEl, true);
      submitBtn.disabled = true;
      submitBtn.textContent = 'Saving…';
      logMessage(consoleBlock, 'info', ['setup', 'Saving configuration…']);
      try {
        const summary = await submitConfig(api, widget, config, ctx, consoleBlock);
        logMessage(consoleBlock, 'success', ['setup', 'Setup complete']);
        showConfirmation(widget, ctx, summary);
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error(error);
        logMessage(consoleBlock, 'error', ['setup', error.message]);
        errorEl.textContent = error.message;
        setHidden(errorEl, false);
        submitBtn.disabled = false;
        submitBtn.textContent = 'Finish setup';
      }
    });
  } catch (error) {
    fail(error);
  }
}
