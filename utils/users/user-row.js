/**
 * Shared user-editing UI: a compact row (user + IMS group hint + role pills +
 * remove) used by the user-admin tool and the bot-info setup wizard.
 * Consumers are responsible for loading `user-row.css` and
 * `../roles/roles-field.css`.
 */
import { createRolesField } from '../roles/roles-field.js';
import { normalizeUser, isImsGroup, isValidUser } from './users.js';

const IMS_GROUP_HINT = 'IMS groups only work on sites using api.aem.live. Contact Adobe via your Slack or Teams channel for details.';
let rowCount = 0;

/**
 * Build an editable user row. Rows for existing users (with an email or id)
 * are required; blank new rows are ignored by validation and collection.
 *
 * @param {{email?: string, id?: string, roles?: string[]}} [user]
 * @param {{onChange?: Function}} [options] called on input and after removal
 * @returns {HTMLElement} the `.user-row` element
 */
export function createUserRow(user = {}, { onChange } = {}) {
  rowCount += 1;
  const row = document.createElement('div');
  row.className = 'user-row';
  if (user.id) row.dataset.userId = user.id;

  const field = document.createElement('div');
  field.className = 'user-row-field';
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'user-row-email';
  input.required = Object.hasOwn(user, 'email') || !!user.id;
  input.placeholder = 'name@example.com or IMS_ORG_ID/group';
  input.setAttribute('aria-label', 'Email or IMS group');
  input.value = user.email || '';

  const hint = document.createElement('p');
  hint.className = 'user-row-hint';
  hint.id = `user-row-hint-${rowCount}`;
  hint.textContent = IMS_GROUP_HINT;
  const updateHint = () => {
    hint.hidden = !isImsGroup(input.value);
    if (hint.hidden) input.removeAttribute('aria-describedby');
    else input.setAttribute('aria-describedby', hint.id);
  };
  updateHint();
  input.addEventListener('input', () => {
    updateHint();
    onChange?.();
  });
  field.append(input, hint);

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'user-row-remove';
  removeBtn.title = 'Remove';
  removeBtn.setAttribute('aria-label', 'Remove user');
  removeBtn.textContent = '✕';
  removeBtn.addEventListener('click', () => {
    row.remove();
    onChange?.();
  });

  const roles = createRolesField(user.roles || []);
  roles.setAttribute('role', 'group');
  roles.setAttribute('aria-label', 'Roles');

  row.append(field, removeBtn, roles);
  return row;
}

const rowsOf = (container) => [...container.querySelectorAll('.user-row')];
const rowRoles = (row) => [...row.querySelectorAll('.roles-field input:checked')].map((c) => c.value);

/**
 * Read the non-blank users from a container of user rows.
 *
 * @param {Element} container
 * @returns {{email: string, id?: string, roles: string[]}[]}
 */
export function collectUsers(container) {
  return rowsOf(container).map((row) => {
    const email = normalizeUser(row.querySelector('.user-row-email').value);
    const roles = rowRoles(row);
    const { userId } = row.dataset;
    return userId ? { email, id: userId, roles } : { email, roles };
  }).filter((u) => u.email);
}

/**
 * Validate the user rows in a container, in row order. Blank new rows are
 * ignored; every other row needs a valid user, at least one role, and a user
 * not repeated in the container or present in `existing`.
 *
 * @param {Element} container
 * @param {{existing?: {email: string}[]}} [options]
 * @returns {{row: HTMLElement, input: HTMLInputElement, message: string}[]}
 */
export function userRowErrors(container, { existing = [] } = {}) {
  const seen = new Set();
  const known = new Set(existing.map((u) => u.email.toLowerCase()));
  return rowsOf(container).flatMap((row) => {
    const input = row.querySelector('.user-row-email');
    const email = normalizeUser(input.value);
    if (!input.required && !email) return [];
    const key = email.toLowerCase();
    let message;
    if (!email) message = 'Enter an email or IMS group for each user, or remove the empty user.';
    else if (!input.validity.valid || !isValidUser(email)) message = 'Enter a valid email or IMS group for each user.';
    else if (!rowRoles(row).length) message = 'Select at least one role for each user.';
    else if (seen.has(key)) message = `Duplicate user: ${email}`;
    else if (known.has(key)) message = `User already exists: ${email}`;
    seen.add(key);
    return message ? [{ row, input, message }] : [];
  });
}
