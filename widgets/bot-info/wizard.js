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
export const CONTENT_SOURCE_KINDS = [
  { value: 'da', label: 'Document Authoring (DA)', configType: 'markup' },
  { value: 'onedrive', label: 'SharePoint', configType: 'onedrive' },
  { value: 'google', label: 'Google Drive', configType: 'google' },
  { value: 'aem', label: 'AEM', configType: 'markup' },
  { value: 'byom', label: 'Other (bring your own markup)', configType: 'markup' },
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
  if (url.includes('adobeaemcloud')) return 'aem';
  return 'byom';
}

/**
 * Build a `content.source` object for the site config from a URL and the chosen
 * UI kind. Google Drive URLs carry their folder id in the trailing path
 * segment.
 *
 * @param {string} url
 * @param {string} kind one of {@link CONTENT_SOURCE_KINDS} values
 * @returns {{type: string, url: string, id?: string}}
 */
export function buildContentSource(url, kind) {
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

function createRolePills(selectedRoles = []) {
  const container = document.createElement('div');
  container.className = 'bot-info-roles';
  ROLES.forEach((role) => {
    const label = document.createElement('label');
    label.className = 'bot-info-role-pill';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = role;
    checkbox.checked = selectedRoles.includes(role);
    const span = document.createElement('span');
    span.textContent = role;
    label.append(checkbox, span);
    container.append(label);
  });
  return container;
}

/**
 * Build an editable user row (email + role pills + remove button). The original
 * user id, when present, is stashed on the row so the diff can target it.
 *
 * @param {{email?: string, id?: string, roles?: string[]}} user
 * @returns {HTMLElement}
 */
export function createUserRow(user = {}) {
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

  const pills = createRolePills(user.roles && user.roles.length ? user.roles : ['admin']);

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'bot-info-remove';
  removeBtn.title = 'Remove';
  removeBtn.setAttribute('aria-label', 'Remove user');
  removeBtn.textContent = '✕';
  removeBtn.addEventListener('click', () => row.remove());

  row.append(emailField, pills, removeBtn);
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
