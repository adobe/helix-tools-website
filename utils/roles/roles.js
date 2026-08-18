/**
 * Shared admin-role definitions used by the user-admin tool and the bot-info
 * setup wizard.
 *
 * Role definitions from
 * https://www.aem.live/docs/authentication-setup-authoring#admin-roles
 */
export const ROLES = ['admin', 'author', 'publish', 'develop', 'config', 'config_admin'];

export const ROLE_DESCRIPTIONS = {
  admin: {
    label: 'Admin',
    description: 'Full access to all permissions',
  },
  author: {
    label: 'Author',
    description: 'Full authoring capabilities',
  },
  publish: {
    label: 'Publish',
    description: 'Full authoring and publishing capabilities',
  },
  develop: {
    label: 'Develop',
    description: 'Author permissions plus code management',
  },
  config: {
    label: 'Config',
    description: 'Read-only access to redacted configuration',
  },
  config_admin: {
    label: 'Config Admin',
    description: 'Full publishing and configuration management',
  },
};

/**
 * Roles are hierarchical: a more privileged role implicitly grants the
 * permissions of the less privileged roles it lists here (transitive closure).
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
 * Given a set of selected roles, return the roles made obsolete because a more
 * privileged selected role already includes them.
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
