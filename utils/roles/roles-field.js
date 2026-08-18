/**
 * Shared role-editing UI: a set of toggleable role pills used by the
 * user-admin tool and the bot-info setup wizard. Consumers are responsible for
 * loading `roles-field.css`.
 */
import { ROLES, ROLE_DESCRIPTIONS, getCoveredRoles } from './roles.js';

/**
 * Enforce the role hierarchy within a checkbox container: whenever a more
 * privileged role is selected, the roles it already includes are unchecked and
 * disabled so authors cannot assign redundant roles.
 * @param {Element} container element holding the role checkboxes
 */
export function applyRoleHierarchy(container) {
  const checkboxes = [...container.querySelectorAll('input[type="checkbox"]')];
  const covered = getCoveredRoles(checkboxes.filter((cb) => cb.checked).map((cb) => cb.value));
  checkboxes.forEach((cb) => {
    if (covered.has(cb.value)) {
      cb.checked = false;
      cb.disabled = true;
    } else {
      cb.disabled = false;
    }
  });
}

/**
 * Build a role picker: one toggleable pill per role, wired to enforce the role
 * hierarchy on every change (and once on creation).
 *
 * @param {string[]} [selectedRoles] roles pre-selected
 * @returns {HTMLElement} the `.roles-field` container
 */
export function createRolesField(selectedRoles = []) {
  const container = document.createElement('div');
  container.className = 'roles-field';
  ROLES.forEach((role) => {
    const roleInfo = ROLE_DESCRIPTIONS[role];
    const label = document.createElement('label');
    label.className = 'role-pill';
    label.title = roleInfo.description;
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = role;
    if (selectedRoles.includes(role)) checkbox.checked = true;
    const span = document.createElement('span');
    span.textContent = roleInfo.label;
    label.appendChild(checkbox);
    label.appendChild(span);
    container.appendChild(label);
  });
  container.addEventListener('change', () => applyRoleHierarchy(container));
  applyRoleHierarchy(container);
  return container;
}
