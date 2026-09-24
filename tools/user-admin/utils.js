/**
 * Adobe IMS groups are entered as `<ims-org-id>/<group-name>`, e.g.
 * `0123456789abcdef01234567/administrators`: a 24 character hex IMS org id, a
 * slash, and a group name that may contain any character.
 */
const IMS_GROUP_PATTERN = /^[a-f0-9]{24}\/.+$/i;
// deliberately lenient: the admin API also accepts wildcards like `*@example.com`
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Check whether an identity is an Adobe IMS group reference rather than an email.
 *
 * @param {string} identity
 * @returns {boolean}
 */
export function isImsGroup(identity) {
  return IMS_GROUP_PATTERN.test((identity || '').trim());
}

/**
 * Validate a user identity for the selected identity type.
 *
 * @param {string} identity
 * @param {'email'|'group'} [kind] identity type, defaults to email
 * @returns {string|null} an error message, or null when valid
 */
export function identityError(identity, kind = 'email') {
  const value = (identity || '').trim();
  const group = kind === 'group';
  if (!value) return 'Please enter a valid email or Adobe IMS group for each entity';
  if (group) return isImsGroup(value) ? null : `Invalid Adobe IMS group: ${value}`;
  return EMAIL_PATTERN.test(value) ? null : `Invalid email: ${value}`;
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
