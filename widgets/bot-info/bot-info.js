import { toClassName, loadCSS } from '../../scripts/aem.js';
import admin from '../../scripts/helix-admin.js';
import decorateConsole, { logResponse, logMessage } from '../../blocks/console/console.js';
import { parseUsersFromAccessConfig, buildAccessConfig } from '../../tools/user-admin/utils.js';
import {
  CONTENT_SOURCE_KINDS,
  detectContentSourceKind,
  buildContentSource,
  diffOrgUsers,
  createUserRow,
  collectUsers,
  validateContentSelection,
  usersError,
} from './wizard.js';

const EMPTY_ACCESS = { admin: { role: {} } };
// Namespaced so they can't collide with other tools' session storage on the origin.
const TOKEN_KEY = 'bot-info-setup-token';
const TOKEN_ID_KEY = 'bot-info-setup-token-id';

// Example content source URLs shown per editable type (AEM has a fixed URL).
const CONTENT_URL_PLACEHOLDERS = {
  onedrive: 'https://example.sharepoint.com/sites/website',
  google: 'https://drive.google.com/drive/folders/FOLDER_ID',
  byom: 'https://your-markup-host.example.com',
};

/** Fixed content source URL for AEM sources. */
const aemContentUrl = (org, site) => `https://api.aem.live/${org}/sites/${site}/source`;

/**
 * Pull the one-time token and its api-key id out of the URL fragment (if
 * present), stash them in session storage, and scrub them from the visible URL.
 *
 * @returns {{token: string|null, tokenId: string|null}}
 */
function captureToken() {
  const hashParams = new URLSearchParams(window.location.hash.substring(1));
  const token = hashParams.get('token');
  const tokenId = hashParams.get('token_id');
  if (token || tokenId) {
    hashParams.delete('token');
    hashParams.delete('token_id');
    const url = new URL(window.location.href);
    url.hash = hashParams.toString();
    window.history.replaceState(null, '', url);
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    if (tokenId) sessionStorage.setItem(TOKEN_ID_KEY, tokenId);
  }
  return {
    token: sessionStorage.getItem(TOKEN_KEY),
    tokenId: sessionStorage.getItem(TOKEN_ID_KEY),
  };
}

/** Drop the stored setup token and key id once setup is complete. */
function clearStoredToken() {
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(TOKEN_ID_KEY);
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
  const repoLink = widget.querySelector('.bot-info-repo');
  if (repoLink) {
    repoLink.href = `https://github.com/${org}/${site}`;
    repoLink.textContent = repoLink.href;
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

  // only BYOM takes a suffix; every other type (incl. AEM) has none
  const updateSuffix = () => setHidden(suffixField, typeSelect.value !== 'byom');

  // hint the expected URL format for the selected content source type
  const updatePlaceholder = () => {
    urlInput.placeholder = CONTENT_URL_PLACEHOLDERS[typeSelect.value] || '';
  };

  // AEM sources use a fixed, non-editable URL derived from the org/site
  const updateUrlField = () => {
    const isAem = typeSelect.value === 'aem';
    urlInput.readOnly = isAem;
    if (isAem) urlInput.value = aemContentUrl(org, site);
    else if (urlInput.value === aemContentUrl(org, site)) urlInput.value = '';
  };

  // BYOM brings its own markup, so start its suffix empty for the user to fill
  const applySuffixDefault = () => {
    if (typeSelect.value === 'byom') suffixInput.value = '';
  };

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
  updatePlaceholder();
  updateUrlField();

  advancedCheck.addEventListener('change', () => setAdvanced(advancedCheck.checked));
  typeSelect.addEventListener('change', () => {
    applySuffixDefault();
    updateSuffix();
    updatePlaceholder();
    updateUrlField();
  });
}

/**
 * Read the current content-source selection from the form. DA is the default
 * with a fixed URL; the advanced options override it. Shared by the review step
 * and the save so both reflect the same live form state.
 *
 * @returns {{kind: string, contentUrl: string, suffix: string}}
 */
function readContentSelection(widget, org, site) {
  const useDifferent = widget.querySelector('.bot-info-advanced-check').checked;
  const kind = useDifferent ? widget.querySelector('.bot-info-content-type').value : 'da';
  const contentUrl = useDifferent
    ? widget.querySelector('.bot-info-content-url').value.trim()
    : `https://content.da.live/${org}/${site}`;
  const suffix = widget.querySelector('.bot-info-content-suffix').value.trim();
  return { kind, contentUrl, suffix };
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

  const { kind, contentUrl, suffix } = readContentSelection(widget, org, site);
  const source = buildContentSource(contentUrl, kind, suffix);
  // update only the content sub-config; POSTing the whole site config would
  // overwrite the access.json we just wrote with the stale copy read on load
  const content = { source };
  await must(
    logged(consoleBlock, api.config({ org, site }).select('content.json').update(JSON.stringify(content))),
    'Saving content source',
  );

  return {
    orgUsers, siteUsers, contentUrl, contentKind: kind,
  };
}

/**
 * Revoke the one-time setup api key once the config has been saved. The key
 * lives at org level for new orgs, otherwise at site level. Best-effort: a
 * failure is logged but does not fail the setup (the config is already saved).
 */
async function deleteApiKey(api, { org, site, newOrg }, tokenId, consoleBlock) {
  if (!tokenId) return;
  const node = newOrg ? api.config({ org }) : api.config({ org, site });
  const safeTokenId = tokenId.replace(/\//g, '_').replace(/\+/g, '-');
  const res = await logged(consoleBlock, node.select(`apiKeys/${safeTokenId}.json`).remove());
  if (!res?.ok) {
    logMessage(consoleBlock, 'warning', ['setup', `Could not remove setup API key: ${res?.error || res?.status || 'network error'}`]);
  }
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
 * Render the read-only summary of the selected config on the Finish step. Each
 * item's title mirrors the step it summarises and links back to that step (the
 * click is wired via delegation in `decorate`).
 */
function renderReview(widget, { org, site, newOrg }) {
  const review = widget.querySelector('.bot-info-review');
  review.textContent = '';

  const addItem = (label, stepIndex) => {
    const li = document.createElement('li');
    const title = document.createElement('button');
    title.type = 'button';
    title.className = 'bot-info-review-link';
    title.dataset.stepIndex = String(stepIndex);
    title.textContent = label;
    li.append(title);
    review.append(li);
    return li;
  };

  const addLink = (li, url) => {
    const link = document.createElement('a');
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.href = url;
    link.textContent = url;
    li.append(link);
  };

  const addUsers = (li, label, users) => {
    const sublabel = document.createElement('div');
    sublabel.className = 'bot-info-review-sublabel';
    sublabel.textContent = `${label} (${users.length})`;
    li.append(sublabel);
    const sub = document.createElement('ul');
    sub.className = 'bot-info-user-summary';
    users.forEach((u) => {
      const item = document.createElement('li');
      item.textContent = u.roles.length ? `${u.email} — ${u.roles.join(', ')}` : u.email;
      sub.append(item);
    });
    li.append(sub);
  };

  // 1. Code — the GitHub repo (fixed for this org/site)
  const codeLi = addItem('Code', 0);
  const codeType = document.createElement('div');
  codeType.textContent = 'GitHub';
  codeLi.append(codeType);
  addLink(codeLi, `https://github.com/${org}/${site}`);

  // 2. Content — type on its own line, then the URL
  const { kind, contentUrl } = readContentSelection(widget, org, site);
  const entry = CONTENT_SOURCE_KINDS.find((k) => k.value === kind);
  const contentLi = addItem('Content', 1);
  if (entry) {
    const type = document.createElement('div');
    type.textContent = entry.label;
    contentLi.append(type);
  }
  addLink(contentLi, contentUrl);

  // 3. Users — organization (new org only) and site users
  const usersLi = addItem('Users', 2);
  if (newOrg) {
    const orgUsers = collectUsers(widget.querySelector('.bot-info-user-list[data-scope="org"]'));
    addUsers(usersLi, 'Organization', orgUsers);
  }
  const siteUsers = collectUsers(widget.querySelector('.bot-info-user-list[data-scope="site"]'));
  addUsers(usersLi, 'Site', siteUsers);
}

/**
 * Reveal the confirmation ("done") panel. With a `summary` it reflects the saved
 * changes; without one (e.g. the user skipped setup after a load error) it
 * shows an adapted view with just the next-steps and DA defaults.
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

  // setup is done, so the step hash is no longer meaningful — drop it
  const url = new URL(window.location.href);
  url.hash = '';
  window.history.replaceState(null, '', url);

  setHidden(widget.querySelector('.bot-info-loading'), true);
  setHidden(widget.querySelector('.bot-info-alert'), true);
  // reveal the wizard form (it may never have shown on the load-failure path)
  // and collapse it to only the terminal "done" panel
  setHidden(widget.querySelector('.bot-info-wizard'), false);
  setHidden(widget.querySelector('.bot-info-steps'), true);
  setHidden(widget.querySelector('.bot-info-nav'), true);
  widget.querySelectorAll('.bot-info-panel').forEach((panel) => {
    setHidden(panel, panel.dataset.step !== 'done');
  });
}

export default async function decorate(widget) {
  const loading = widget.querySelector('.bot-info-loading');
  const form = widget.querySelector('.bot-info-wizard');
  const alert = widget.querySelector('.bot-info-alert');
  const errorEl = widget.querySelector('.bot-info-error');
  // the Users step shows its error in its own slot (below the org section)
  const usersErrorEl = widget.querySelector('.bot-info-users-error');

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
    setHidden(alert, false);
  };

  try {
    const { token, tokenId } = captureToken();
    const params = new URLSearchParams(window.location.search);
    const ctx = {
      org: toClassName(params.get('org')),
      site: toClassName(params.get('site')),
      user: params.get('user') || '',
      url: params.get('url') || '',
      newOrg: params.get('new_org') === 'true',
    };

    populateStaticFields(widget, ctx);

    // Warn before leaving mid-wizard: the setup token is one-time, so navigating
    // away without clicking "Finish setup" can strand the site configuration.
    // Most browsers show their own generic prompt and ignore this text, but
    // set it for the older browsers that still honour a custom message.
    const leaveMessage = 'Leaving this page without finishing the setup wizard can result in an incomplete configuration. Are you sure?';
    const warnBeforeUnload = (e) => {
      e.preventDefault();
      e.returnValue = leaveMessage;
      return leaveMessage;
    };
    const stopWarning = () => window.removeEventListener('beforeunload', warnBeforeUnload);

    // let the user skip to the next-steps screen if config can't be loaded
    widget.querySelector('.bot-info-continue')?.addEventListener('click', () => {
      stopWarning();
      showConfirmation(widget, ctx, null);
    });

    const api = tokenClient(token);
    logMessage(consoleBlock, 'info', ['setup', `Loading configuration for ${ctx.org}/${ctx.site}…`]);
    const config = await loadConfig(api, ctx, consoleBlock);
    renderForm(widget, config, ctx);

    // step state machine — one panel visible at a time, driven by Back/Next
    const steps = ['code', 'content', 'users', 'finish'];
    const panels = [...widget.querySelectorAll('.bot-info-panel')];
    const stepItems = [...widget.querySelectorAll('.bot-info-steps-item')];
    const backBtn = widget.querySelector('.bot-info-back');
    const nextBtn = widget.querySelector('.bot-info-next');
    const submitBtn = widget.querySelector('.bot-info-submit');
    let current = 0;

    // reflect the active step in the URL hash (#1, #2, …) so it can be linked to
    const setStepHash = (index) => {
      const url = new URL(window.location.href);
      url.hash = String(index + 1);
      window.history.replaceState(null, '', url);
    };

    // per-step validation, reusing the wizard's pure validators
    const validateStep = (step) => {
      if (step === 'content') {
        return validateContentSelection({
          advanced: widget.querySelector('.bot-info-advanced-check').checked,
          url: widget.querySelector('.bot-info-content-url').value,
        });
      }
      if (step === 'users') {
        const orgList = widget.querySelector('.bot-info-user-list[data-scope="org"]');
        return usersError(collectUsers(orgList), ctx.newOrg);
      }
      return null;
    };

    const goToStep = (index) => {
      current = index;
      const step = steps[index];
      setStepHash(index);
      panels.forEach((panel) => setHidden(panel, panel.dataset.step !== step));
      stepItems.forEach((item, i) => {
        item.classList.toggle('is-active', i === index);
        // the first step (Code) has no action, so it always reads as complete
        item.classList.toggle('is-complete', i < index || i === 0);
        if (i === index) item.setAttribute('aria-current', 'step');
        else item.removeAttribute('aria-current');
        const status = item.querySelector('.bot-info-steps-status');
        let statusText = '';
        if (i < index) statusText = 'completed';
        else if (i === index) statusText = 'current step';
        status.textContent = statusText;
      });
      setHidden(backBtn, index === 0);
      setHidden(nextBtn, step === 'finish');
      setHidden(submitBtn, step !== 'finish');
      if (step === 'finish') {
        renderReview(widget, ctx);
        // keep Save disabled until the content source and users are provided
        // (guards the deep-link path that can jump straight to Finish)
        submitBtn.disabled = !!(validateStep('content') || validateStep('users'));
      }
    };

    // the users error sits in its own slot; every other step uses the main one
    const errorFor = (step) => (step === 'users' ? usersErrorEl : errorEl);
    const clearErrors = () => {
      setHidden(errorEl, true);
      setHidden(usersErrorEl, true);
    };

    // navigate to a target step; moving forward validates every step passed
    // through and stops on the first invalid one so mandatory steps can't be
    // skipped (going back is always allowed)
    const goTo = (target) => {
      for (let i = current; i < target; i += 1) {
        const error = validateStep(steps[i]);
        if (error) {
          const el = errorFor(steps[i]);
          el.textContent = error;
          setHidden(el, false);
          goToStep(i);
          return;
        }
      }
      clearErrors();
      goToStep(target);
    };
    const goNext = () => goTo(current + 1);
    nextBtn.addEventListener('click', goNext);
    backBtn.addEventListener('click', () => goTo(current - 1));

    // clicking a step in the progress bar jumps to it
    stepItems.forEach((item, i) => {
      item.querySelector('.bot-info-steps-btn').addEventListener('click', () => goTo(i));
    });

    // summary titles link back to their step (delegated: the list re-renders)
    widget.querySelector('.bot-info-review').addEventListener('click', (e) => {
      const link = e.target.closest('.bot-info-review-link');
      if (link) goTo(Number(link.dataset.stepIndex));
    });

    // unchecking "use a different content source" makes the step valid again
    // (DA default), so drop any pending content-source error
    widget.querySelector('.bot-info-advanced-check').addEventListener('change', (e) => {
      if (!e.target.checked) setHidden(errorEl, true);
    });

    setHidden(loading, true);
    setHidden(form, false);
    // honour a #<n> hash (1-based) so a specific step can be linked to
    const linkedStep = parseInt(window.location.hash.substring(1), 10);
    const startIndex = Number.isNaN(linkedStep)
      ? 0
      : Math.min(Math.max(linkedStep - 1, 0), steps.length - 1);
    goToStep(startIndex);
    window.addEventListener('beforeunload', warnBeforeUnload);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      // Enter in a field on an earlier step must advance, not save
      if (steps[current] !== 'finish') {
        goNext();
        return;
      }
      setHidden(errorEl, true);
      submitBtn.disabled = true;
      backBtn.disabled = true;
      submitBtn.textContent = 'Saving…';
      logMessage(consoleBlock, 'info', ['setup', 'Saving configuration…']);
      try {
        const summary = await submitConfig(api, widget, config, ctx, consoleBlock);
        // revoke the one-time setup key now that the config is saved, then
        // drop the stored credentials
        await deleteApiKey(api, ctx, tokenId, consoleBlock);
        clearStoredToken();
        stopWarning();
        logMessage(consoleBlock, 'success', ['setup', 'Setup complete']);
        showConfirmation(widget, ctx, summary);
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error(error);
        logMessage(consoleBlock, 'error', ['setup', error.message]);
        errorEl.textContent = error.message;
        setHidden(errorEl, false);
        submitBtn.disabled = false;
        backBtn.disabled = false;
        submitBtn.textContent = 'Save';
      }
    });
  } catch (error) {
    fail(error);
  }
}
