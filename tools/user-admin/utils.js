const EMAIL_PATTERN = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i;
const IMS_GROUP_PATTERN = /^([a-f0-9]+)(?:@adobeorg)?\s*\/\s*(.+)$/i;

const IMS_GROUP_HINT = 'IMS groups only work on sites using api.aem.live. Contact Adobe via your Slack or Teams channel for details.';
let imsGroupHintCount = 0;

/**
 * Normalize a user identifier. IMS groups become `ORG_ID/group`.
 * @param {string} value
 * @returns {string}
 */
export function normalizeUser(value) {
  const trimmed = value.trim();
  const match = trimmed.match(IMS_GROUP_PATTERN);
  return match ? `${match[1]}/${match[2]}` : trimmed;
}

/**
 * @param {string} value
 * @returns {boolean}
 */
export function isImsGroup(value) {
  return IMS_GROUP_PATTERN.test(value.trim());
}

/**
 * Create a hint that is shown while the input holds an IMS group.
 * @param {HTMLInputElement} input
 * @param {string} className
 * @returns {HTMLParagraphElement}
 */
export function createImsGroupHint(input, className) {
  imsGroupHintCount += 1;
  const hint = document.createElement('p');
  hint.className = className;
  hint.id = `ims-group-hint-${imsGroupHintCount}`;
  hint.textContent = IMS_GROUP_HINT;
  const update = () => {
    hint.hidden = !isImsGroup(input.value);
    if (hint.hidden) input.removeAttribute('aria-describedby');
    else input.setAttribute('aria-describedby', hint.id);
  };
  input.addEventListener('input', update);
  update();
  return hint;
}

/**
 * Return invalid email inputs, optionally allowing IMS groups, in input order.
 * Blank optional inputs represent unused new rows and are ignored.
 * @param {Iterable<HTMLInputElement>} inputs
 * @returns {{input: HTMLInputElement, message: string}[]}
 */
export function userEmailErrors(inputs, { allowGroups = false } = {}) {
  return [...inputs].flatMap((input) => {
    if (!input.required && !input.value.trim()) return [];
    const identifier = allowGroups ? 'email or IMS group' : 'email';
    let { valid } = input.validity;
    if (allowGroups) {
      const value = input.value.trim();
      valid = valid && (EMAIL_PATTERN.test(value) || isImsGroup(value));
    }
    let message;
    if (!input.value.trim()) message = `Enter an ${identifier} for each user, or remove the empty user.`;
    else if (!valid) message = `Enter a valid ${identifier} for each user.`;
    return message ? [{ input, message }] : [];
  });
}

/**
 * Convert an access config's role map into a flat user array.
 *
 * Input:  { admin: { role: { admin: ['a@b.com'], author: ['a@b.com', 'c@d.com'] } } }
 * Output: [{ email: 'a@b.com', roles: ['admin', 'author'] },
 *          { email: 'c@d.com', roles: ['author'] }]
 *
 * @param {object} config - Access config from the admin API
 * @returns {{ email: string, roles: string[] }[]}
 */
export function parseUsersFromAccessConfig(config) {
  const users = [];
  const roleMap = config?.admin?.role || {};
  Object.entries(roleMap).forEach(([role, emails]) => {
    (emails || []).forEach((email) => {
      const existing = users.find((u) => u.email === email);
      if (existing) existing.roles.push(role);
      else users.push({ email, roles: [role] });
    });
  });
  return users;
}

/**
 * Rebuild an access config from the current user list. Shallow-clones
 * `originalAccess` so the original is not mutated.
 *
 * @param {object} originalAccess - The last-read access config from the API
 * @param {{ email: string, roles: string[] }[]} users
 * @returns {object} Updated access config ready to POST back
 */
export function buildAccessConfig(originalAccess, users) {
  const access = { ...originalAccess, admin: { ...originalAccess?.admin, role: {}, requireAuth: 'auto' } };
  users.forEach((user) => {
    user.roles.forEach((role) => {
      if (!access.admin.role[role]) access.admin.role[role] = [user.email];
      else access.admin.role[role].push(user.email);
    });
  });
  return access;
}
