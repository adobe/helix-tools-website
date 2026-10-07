const EMAIL_PATTERN = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i;
const IMS_GROUP_PATTERN = /^([a-f0-9]+)(?:@adobeorg)?\s*\/\s*(.+)$/i;

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
 * @param {string} value
 * @returns {boolean} true for an email, wildcard-domain email or IMS group
 */
export function isValidUser(value) {
  const trimmed = value.trim();
  return EMAIL_PATTERN.test(trimmed) || isImsGroup(trimmed);
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
