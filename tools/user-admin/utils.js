/**
 * Roles are hierarchical: a more privileged role implicitly grants the
 * permissions of the less privileged roles it lists here (transitive closure).
 * See https://www.aem.live/docs/authentication-setup-authoring#admin-roles
 */
export const ROLE_INCLUDES = {
  admin: ['author', 'publish', 'develop', 'config', 'config_admin'],
  config_admin: ['author', 'publish', 'config'],
  publish: ['author'],
  develop: ['author'],
  author: [],
  config: [],
};

/**
 * Given a set of selected roles, return the roles that are made obsolete
 * because a more privileged selected role already includes them.
 *
 * @param {string[]} selectedRoles
 * @returns {Set<string>}
 */
export function getCoveredRoles(selectedRoles) {
  const covered = new Set();
  (selectedRoles || []).forEach((role) => {
    (ROLE_INCLUDES[role] || []).forEach((included) => covered.add(included));
  });
  return covered;
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
