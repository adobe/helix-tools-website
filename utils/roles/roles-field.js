/**
 * Shared role-editing UI: a set of toggleable role pills used by the
 * user-admin tool and the bot-info setup wizard. Consumers are responsible for
 * loading `roles-field.css`.
 */
import { ROLES, ROLE_DESCRIPTIONS, getCoveredRoles } from './roles.js';

/**
 * Mark included roles as covered without disabling them. Selecting a covered
 * role replaces the selected roles that include it.
 * @param {Element} container element holding the role checkboxes
 * @param {string} [selectedRole] role just selected by the user
 */
export function applyRoleHierarchy(container, selectedRole) {
  const checkboxes = [...container.querySelectorAll('input[type="checkbox"]')];
  if (selectedRole) {
    checkboxes.forEach((cb) => {
      if (cb.checked && getCoveredRoles([cb.value]).has(selectedRole)) cb.checked = false;
    });
  }
  const covered = getCoveredRoles(checkboxes.filter((cb) => cb.checked).map((cb) => cb.value));
  checkboxes.forEach((cb) => {
    const isCovered = covered.has(cb.value);
    if (isCovered) cb.checked = false;
    const label = cb.closest('.role-pill');
    const roleInfo = ROLE_DESCRIPTIONS[cb.value];
    label.classList.toggle('is-covered', isCovered);
    label.title = isCovered
      ? `${roleInfo.description}. Select ${roleInfo.label} to replace roles that already include it.`
      : roleInfo.description;
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
  container.addEventListener('change', (e) => {
    applyRoleHierarchy(container, e.target.checked ? e.target.value : undefined);
  });
  applyRoleHierarchy(container);
  return container;
}
