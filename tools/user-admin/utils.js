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
      const emailInput = document.createElement('input');
      emailInput.type = 'email';
      emailInput.value = input.value.trim();
      valid = valid && (emailInput.validity.valid || /^[a-f0-9]+\/[^/]+$/i.test(input.value.trim()));
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
