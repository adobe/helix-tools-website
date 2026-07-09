/**
 * Pure helpers and DOM builders for the bot-info setup wizard.
 *
 * The functions in the first half are side-effect free (no DOM, no fetch) so
 * they can be unit-tested; the DOM builders in the second half render the
 * editable user rows and content-source fields used by the single-page form.
 */

// Mirror of the roles offered by the user-admin tool. Duplicated here (rather
// than imported) so the wizard stays decoupled from that tool's UI module.
export const ROLES = ['admin', 'author', 'publish', 'develop', 'basic_author', 'basic_publish', 'config', 'config_admin'];

// UI-facing content-source kinds. `configType` is what the admin API stores in
// `content.source.type`; the granular DA/AEM/BYOM kinds all map to `markup`.
// `suffix: true` marks kinds whose markup is addressed with a path suffix.
export const CONTENT_SOURCE_KINDS = [
  { value: 'da', label: 'Document Authoring (DA)', configType: 'markup' },
  { value: 'onedrive', label: 'SharePoint', configType: 'onedrive' },
  { value: 'google', label: 'Google Drive', configType: 'google' },
  {
    value: 'aem', label: 'AEM', configType: 'markup', suffix: true,
  },
  {
    value: 'byom', label: 'Other (bring your own markup)', configType: 'markup', suffix: true,
  },
];

/**
 * Guess the UI content-source kind from a content URL. Mirrors the detection in
 * site-admin's `buildSiteConfig`/`getContentSourceType`.
 *
 * @param {string} url
 * @returns {'da'|'aem'|'google'|'onedrive'|'byom'}
 */
export function detectContentSourceKind(url) {
  if (!url) return 'da';
  if (url.startsWith('https://drive.google.com/drive')) return 'google';
  if (url.includes('sharepoint.com/')) return 'onedrive';
  if (url.startsWith('https://content.da.live')) return 'da';
  if (url.startsWith('https://api.aem.live/') || url.includes('adobeaemcloud')) return 'aem';
  return 'byom';
}

/**
 * Build a `content.source` object for the site config from a URL and the chosen
 * UI kind. Google Drive URLs carry their folder id in the trailing path
 * segment.
 *
 * @param {string} url
 * @param {string} kind one of {@link CONTENT_SOURCE_KINDS} values
 * @param {string} [suffix] path suffix, applied only to suffix-capable kinds
 * @returns {{type: string, url: string, id?: string, suffix?: string}}
 */
export function buildContentSource(url, kind, suffix) {
  const entry = CONTENT_SOURCE_KINDS.find((k) => k.value === kind);
  const type = entry ? entry.configType : 'markup';
  const source = { type, url };
  if (type === 'google') {
    try {
      source.id = new URL(url).pathname.split('/').filter(Boolean).pop();
    } catch {
      // leave id unset for an unparseable URL
    }
  }
  if (entry?.suffix && suffix) source.suffix = suffix;
  return source;
}

const sameRoles = (a = [], b = []) => a.length === b.length
  && [...a].sort().join(',') === [...b].sort().join(',');

/**
 * Diff the originally-loaded org users against the current form state, matching
 * by email (case-insensitive). Returns the org-user writes to perform.
 *
 * @param {{email: string, id: string, roles: string[]}[]} original
 * @param {{email: string, id?: string, roles: string[]}[]} current
 * @returns {{
 *   toAdd: {email: string, roles: string[]}[],
 *   toRemove: {email: string, id: string, roles: string[]}[],
 *   toUpdate: {email: string, id: string, roles: string[]}[]
 * }}
 */
export function diffOrgUsers(original = [], current = []) {
  const key = (e) => (e || '').trim().toLowerCase();
  const originalByEmail = new Map(original.map((u) => [key(u.email), u]));
  const currentByEmail = new Map(current.map((u) => [key(u.email), u]));

  const toAdd = [];
  const toUpdate = [];
  current.forEach((u) => {
    const existing = originalByEmail.get(key(u.email));
    if (!existing) {
      toAdd.push({ email: u.email, roles: u.roles });
    } else if (!sameRoles(existing.roles, u.roles)) {
      toUpdate.push({ ...existing, roles: u.roles });
    }
  });

  const toRemove = original.filter((u) => !currentByEmail.has(key(u.email)));
  return { toAdd, toRemove, toUpdate };
}

/* ------------------------------------------------------------------ */
/* DOM builders (not unit-tested)                                     */
/* ------------------------------------------------------------------ */

function createRolePill(role, checked) {
  const label = document.createElement('label');
  label.className = 'bot-info-role-pill';
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.value = role;
  checkbox.checked = checked;
  const span = document.createElement('span');
  span.textContent = role;
  label.append(checkbox, span);
  return label;
}

/**
 * Build the role pills for a user. The primary `admin` pill is always visible;
 * the remaining roles stay tucked behind a `…` link unless one of them is
 * already selected.
 *
 * @param {string[]} selectedRoles
 * @returns {HTMLElement}
 */
function createRolePills(selectedRoles = []) {
  const [primary, ...others] = ROLES;
  const container = document.createElement('div');
  container.className = 'bot-info-roles';

  container.append(createRolePill(primary, selectedRoles.includes(primary)));

  const rest = document.createElement('div');
  rest.className = 'bot-info-roles-rest';
  others.forEach((role) => rest.append(createRolePill(role, selectedRoles.includes(role))));
  // reveal the rest up-front if any of those roles is already selected
  const expanded = others.some((role) => selectedRoles.includes(role));
  rest.setAttribute('aria-hidden', String(!expanded));
  container.append(rest);

  const more = document.createElement('button');
  more.type = 'button';
  more.className = 'bot-info-roles-more';
  more.setAttribute('aria-expanded', String(expanded));
  more.title = 'Show more roles';
  more.textContent = expanded ? '‹' : '…';
  more.addEventListener('click', () => {
    const isExpanded = rest.getAttribute('aria-hidden') === 'false';
    rest.setAttribute('aria-hidden', String(isExpanded));
    more.setAttribute('aria-expanded', String(!isExpanded));
    more.textContent = isExpanded ? '…' : '‹';
  });
  container.append(more);

  return container;
}

/**
 * Build an editable user row (email + role pills + remove button). The original
 * user id, when present, is stashed on the row so the diff can target it.
 *
 * @param {{email?: string, id?: string, roles?: string[]}} user
 * @param {string} [defaultRole] role pre-selected when the user has none
 * @returns {HTMLElement}
 */
export function createUserRow(user = {}, defaultRole = 'admin') {
  const row = document.createElement('div');
  row.className = 'bot-info-user-row';
  if (user.id) row.dataset.userId = user.id;

  const emailField = document.createElement('div');
  emailField.className = 'bot-info-field';
  const emailInput = document.createElement('input');
  emailInput.type = 'email';
  emailInput.required = true;
  emailInput.placeholder = 'name@example.com';
  emailInput.className = 'bot-info-email';
  emailInput.value = user.email || '';
  emailField.append(emailInput);

  const pills = createRolePills(user.roles && user.roles.length ? user.roles : [defaultRole]);

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'bot-info-remove';
  removeBtn.title = 'Remove';
  removeBtn.setAttribute('aria-label', 'Remove user');
  removeBtn.textContent = '✕';
  removeBtn.addEventListener('click', () => row.remove());

  row.append(emailField, removeBtn, pills);
  return row;
}

/**
 * Read the current user entries from a list container.
 *
 * @param {HTMLElement} listEl container holding `.bot-info-user-row` elements
 * @returns {{email: string, id?: string, roles: string[]}[]}
 */
export function collectUsers(listEl) {
  return [...listEl.querySelectorAll('.bot-info-user-row')].map((row) => {
    const email = row.querySelector('.bot-info-email').value.trim();
    const roles = [...row.querySelectorAll('.bot-info-roles input:checked')].map((c) => c.value);
    const { userId } = row.dataset;
    return userId ? { email, id: userId, roles } : { email, roles };
  }).filter((u) => u.email);
}
