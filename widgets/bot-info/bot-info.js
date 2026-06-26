import { toClassName } from '../../scripts/aem.js';
import admin from '../../scripts/helix-admin.js';
import { parseUsersFromAccessConfig, buildAccessConfig } from '../../tools/user-admin/utils.js';
import {
  CONTENT_SOURCE_KINDS,
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

/** Load org users (new orgs only), site access, and site config in parallel. */
async function loadConfig(api, { org, site, newOrg }) {
  const [orgRes, accessRes, siteRes] = await Promise.all([
    newOrg ? api.config({ org }).read() : Promise.resolve(null),
    api.config({ org, site }).select('access.json').read(),
    api.config({ org, site }).read(),
  ]);

  if (newOrg && orgRes && !orgRes.ok && orgRes.status !== 404) {
    throw new Error(`Loading org users failed: ${orgRes.error || orgRes.status}`);
  }
  if (!accessRes.ok && accessRes.status !== 404) {
    throw new Error(`Loading site access failed: ${accessRes.error || accessRes.status}`);
  }
  if (!siteRes.ok && siteRes.status !== 404) {
    throw new Error(`Loading site config failed: ${siteRes.error || siteRes.status}`);
  }

  return {
    orgUsers: orgRes?.ok ? (await orgRes.json()).users || [] : [],
    access: accessRes.ok ? await accessRes.json() : EMPTY_ACCESS,
    siteConfig: siteRes.ok ? await siteRes.json() : {},
  };
}

/** Render the editable user/content fields into the wizard form. */
function renderForm(widget, config, { user, url, newOrg }) {
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

  // wire up "add user/administrator" buttons. New org users default to the
  // least-privileged 'author' role; new site rows default to 'admin'.
  widget.querySelectorAll('.bot-info-add-user').forEach((btn) => {
    const isOrg = btn.dataset.scope === 'org';
    const list = isOrg ? orgList : siteList;
    const defaultRole = isOrg ? 'author' : 'admin';
    btn.addEventListener('click', () => {
      const row = createUserRow({}, defaultRole);
      list.append(row);
      row.querySelector('.bot-info-email').focus();
    });
  });

  // content source
  const typeSelect = widget.querySelector('.bot-info-content-type');
  CONTENT_SOURCE_KINDS.forEach(({ value, label }) => {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label;
    typeSelect.append(opt);
  });
  const contentUrl = config.siteConfig.content?.source?.url || url || '';
  const urlInput = widget.querySelector('.bot-info-content-url');
  urlInput.value = contentUrl;
  typeSelect.value = detectContentSourceKind(contentUrl);
  // keep the type in sync as the user edits the URL
  urlInput.addEventListener('change', () => {
    typeSelect.value = detectContentSourceKind(urlInput.value.trim());
  });
}

/**
 * Persist all gathered changes back to the admin API. Returns a summary of what
 * was saved so the confirmation screen can reflect the actual changes.
 */
async function submitConfig(api, widget, config, { org, site, newOrg }) {
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
      await must(api.config({ org }).select(`users/${u.id}.json`).remove(), `Removing ${u.email}`);
    }, Promise.resolve());
    await toUpdate.reduce(async (prev, u) => {
      await prev;
      await must(api.config({ org }).select(`users/${u.id}.json`).update(JSON.stringify(u)), `Updating ${u.email}`);
    }, Promise.resolve());
    await toAdd.reduce(async (prev, u) => {
      await prev;
      await must(api.config({ org }).select('users.json').update(JSON.stringify(u)), `Adding ${u.email}`);
    }, Promise.resolve());
  }

  const siteList = widget.querySelector('.bot-info-user-list[data-scope="site"]');
  const siteUsers = collectUsers(siteList);
  const access = buildAccessConfig(config.access, siteUsers);
  await must(
    api.config({ org, site }).select('access.json').update(JSON.stringify(access)),
    'Saving site administrators',
  );

  const urlInput = widget.querySelector('.bot-info-content-url');
  const kind = widget.querySelector('.bot-info-content-type').value;
  const contentUrl = urlInput.value.trim();
  const source = buildContentSource(contentUrl, kind);
  const siteConfig = { ...config.siteConfig, content: { ...config.siteConfig.content, source } };
  await must(
    api.config({ org, site }).update(JSON.stringify(siteConfig)),
    'Saving content source',
  );

  return {
    orgUsers, siteUsers, contentUrl, contentKind: kind,
  };
}

/** Render the "what we did" list from the saved changes. */
function populateSummary(widget, { org, site }, summary) {
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
  addUsers(`Configured ${sn} site administrator${sn === 1 ? '' : 's'}`, summary.siteUsers);
  const kind = CONTENT_SOURCE_KINDS.find((k) => k.value === summary.contentKind);
  addItem(`Set the content source to ${summary.contentUrl}${kind ? ` (${kind.label})` : ''}.`);
  addItem('Started AEM Code Sync for your GitHub repository.');

  // point the "create your content" link at the DA editor for this site
  const editUrl = `https://da.live/#/${org}/${site}`;
  const contentSource = widget.querySelector('.bot-info-content-source');
  if (contentSource) {
    const link = document.createElement('a');
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.href = editUrl;
    link.textContent = editUrl;
    contentSource.textContent = '';
    contentSource.append(link);
  }
}

export default async function decorate(widget) {
  const loading = widget.querySelector('.bot-info-loading');
  const form = widget.querySelector('.bot-info-wizard');
  const success = widget.querySelector('.bot-info-success');
  const alert = widget.querySelector('.bot-info-alert');
  const errorEl = widget.querySelector('.bot-info-error');

  const fail = (error) => {
    // eslint-disable-next-line no-console
    console.error(error);
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

    const api = tokenClient(token);
    const config = await loadConfig(api, ctx);
    renderForm(widget, config, ctx);

    setHidden(loading, true);
    setHidden(form, false);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const submitBtn = widget.querySelector('.bot-info-submit');
      setHidden(errorEl, true);
      submitBtn.disabled = true;
      submitBtn.textContent = 'Saving…';
      try {
        const summary = await submitConfig(api, widget, config, ctx);
        populateSummary(widget, ctx, summary);
        setHidden(form, true);
        setHidden(success, false);
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error(error);
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
