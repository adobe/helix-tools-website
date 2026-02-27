import { LitElement, html, nothing } from 'lit';
import { getRouteDetails } from '../../../utils/router.js';
import { fetchSiteAccess, updateSiteAccess } from '../../../services/adminApi.js';
import { getApiError } from '../../../utils/apiErrors.js';
import { toast } from '../../../controllers/toast-controller.js';
import '../../../blocks/error-alert/error-alert.js';
import '../../../blocks/admin-card/admin-card.js';
import '../../../blocks/eds-button/eds-button.js';
import '../../../blocks/eds-dialog/eds-dialog.js';
import '../../../blocks/eds-textfield/eds-textfield.js';
import '../../../blocks/eds-menu/eds-menu.js';
import { edsIcon } from '../../../utils/icons.js';

import getSheet from '../../../utils/sheet.js';
import { pageSheet, sharedSheet } from '../../../styles/page-sheets.js';
const usersSheet = await getSheet(new URL('../../../styles/users.css', import.meta.url).pathname);

const ROLE_DESCRIPTIONS = {
  admin: { label: 'Admin', desc: 'Full access to all permissions' },
  basic_author: { label: 'Basic Author', desc: 'Basic authoring capabilities, no publishing' },
  basic_publish: { label: 'Basic Publish', desc: 'Basic authoring with publishing capabilities' },
  author: { label: 'Author', desc: 'Full authoring including previewing, editing, snapshots, and job management' },
  publish: { label: 'Publish', desc: 'Full authoring and publishing to live, including forced operations' },
  develop: { label: 'Develop', desc: 'Full authoring plus code management (write, delete, forced delete)' },
  config: { label: 'Config', desc: 'Read-only access to redacted configuration' },
  config_admin: { label: 'Config Admin', desc: 'Full publishing plus configuration read and write access' },
};

const ROLES = Object.keys(ROLE_DESCRIPTIONS);

/**
 * Parse users from the site access config.
 * API response structure: { admin: { role: { roleName: ["email1", "email2"] } } }
 * On 404 (no config): data is null → return empty array.
 */
function parseUsersFromAccess(data) {
  const emailToRoles = new Map();
  if (!data || typeof data !== 'object') return [];

  const roleMap = data?.admin?.role;
  if (!roleMap || typeof roleMap !== 'object') return [];

  for (const role of ROLES) {
    const emails = roleMap[role];
    if (!Array.isArray(emails)) continue;
    for (const e of emails) {
      const email = typeof e === 'string' ? e.trim().toLowerCase() : '';
      if (!email) continue;
      if (!emailToRoles.has(email)) emailToRoles.set(email, new Set());
      emailToRoles.get(email).add(role);
    }
  }

  const users = [];
  for (const [email, rolesSet] of emailToRoles) {
    users.push({ email, roles: Array.from(rolesSet) });
  }
  return users.sort((a, b) => a.email.localeCompare(b.email));
}

/**
 * Build access object from users array.
 * Matches helix-tools-website structure: preserves originalAccess,
 * rebuilds admin.role from scratch.
 */
function buildAccessFromUsers(users, existingAccess = {}) {
  const access = structuredClone(existingAccess);

  if (!access.admin) access.admin = {};
  access.admin.role = {};

  for (const user of users) {
    for (const role of (user.roles || [])) {
      if (!access.admin.role[role]) access.admin.role[role] = [];
      access.admin.role[role].push(user.email);
    }
  }

  if (Object.keys(access.admin.role).length === 0) {
    delete access.admin.role;
    if (Object.keys(access.admin).length === 0) delete access.admin;
  }

  return access;
}

export class SiteUsers extends LitElement {
  static properties = {
    _org: { state: true },
    _site: { state: true },
    _users: { state: true },
    _accessData: { state: true },
    _loading: { state: true },
    _error: { state: true },
    _searchQuery: { state: true },
    _showAddDialog: { state: true },
    _editUser: { state: true },
    _deleteUser: { state: true },
    _addEmail: { state: true },
    _addRoles: { state: true },
    _addSaving: { state: true },
    _addSaveError: { state: true },
    _editRoles: { state: true },
    _editSaving: { state: true },
    _editSaveError: { state: true },
    _deleteSaving: { state: true },
  };

  constructor() {
    super();
    this._org = '';
    this._site = '';
    this._users = [];
    this._accessData = null;
    this._loading = true;
    this._error = '';
    this._searchQuery = '';
    this._showAddDialog = false;
    this._editUser = null;
    this._deleteUser = null;
    this._addEmail = '';
    this._addRoles = [];
    this._addSaving = false;
    this._addSaveError = '';
    this._editRoles = [];
    this._editSaving = false;
    this._editSaveError = '';
    this._deleteSaving = false;
    this._loaded = false;
  }

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [pageSheet, sharedSheet, usersSheet];
    const details = getRouteDetails();
    this._org = details.org || '';
    this._site = details.site || '';
  }

  updated(changedProperties) {
    super.updated?.(changedProperties);
    if ((changedProperties.has('_org') || changedProperties.has('_site')) && this._org && this._site) {
      this._loaded = false;
      this._loadData();
    }
  }

  async _loadData() {
    if (!this._org || !this._site || this._loaded) return;
    this._loaded = true;
    this._loading = true;
    this._error = '';

    const { data, status, error } = await fetchSiteAccess(this._org, this._site);

    if (status === 404) {
      this._accessData = { admin: { role: {} } };
      this._users = [];
      this._loading = false;
      return;
    }

    const err = getApiError(status, 'load site users', error);
    if (err) {
      this._error = err;
      this._loading = false;
      return;
    }

    this._accessData = data || { admin: { role: {} } };
    this._users = parseUsersFromAccess(data);
    this._loading = false;
  }

  _handleRetry() {
    this._loaded = false;
    this._loadData();
  }

  _toggleAddRole(role) {
    this._addRoles = this._addRoles.includes(role)
      ? this._addRoles.filter((r) => r !== role)
      : [...this._addRoles, role];
    this._addSaveError = '';
  }

  _toggleEditRole(role) {
    this._editRoles = this._editRoles.includes(role)
      ? this._editRoles.filter((r) => r !== role)
      : [...this._editRoles, role];
    this._editSaveError = '';
  }

  async _handleAddSave() {
    if (this._addRoles.length === 0 || !this._addEmail.trim()) return;
    const email = this._addEmail.trim().toLowerCase();
    const exists = this._users.some((u) => u.email?.toLowerCase() === email);
    if (exists) {
      this._addSaveError = 'A user with this email already exists.';
      return;
    }
    this._addSaving = true;
    this._addSaveError = '';
    const newUsers = [...this._users, { email, roles: [...this._addRoles] }];
    const accessData = buildAccessFromUsers(newUsers, this._accessData);
    const { status, error } = await updateSiteAccess(this._org, this._site, accessData);
    this._addSaving = false;
    const err = getApiError(status, 'add user', error);
    if (err) {
      this._addSaveError = err;
      return;
    }
    toast.positive('User added.');
    this._showAddDialog = false;
    this._addEmail = '';
    this._addRoles = [];
    this._loaded = false;
    this._loadData();
  }

  async _handleEditSave() {
    if (!this._editUser || this._editRoles.length === 0) return;
    this._editSaving = true;
    this._editSaveError = '';
    const newUsers = this._users.map((u) => (u.email?.toLowerCase() === this._editUser.email?.toLowerCase()
      ? { ...u, roles: [...this._editRoles] }
      : u));
    const accessData = buildAccessFromUsers(newUsers, this._accessData);
    const { status, error } = await updateSiteAccess(this._org, this._site, accessData);
    this._editSaving = false;
    const err = getApiError(status, 'update user', error);
    if (err) {
      this._editSaveError = err;
      return;
    }
    toast.positive('User updated.');
    this._editUser = null;
    this._loaded = false;
    this._loadData();
  }

  async _handleDelete() {
    if (!this._deleteUser) return;
    this._deleteSaving = true;
    this._error = '';
    const newUsers = this._users.filter(
      (u) => u.email?.toLowerCase() !== this._deleteUser.email?.toLowerCase(),
    );
    const accessData = buildAccessFromUsers(newUsers, this._accessData);
    const { status, error } = await updateSiteAccess(this._org, this._site, accessData);
    this._deleteSaving = false;
    const err = getApiError(status, 'delete user', error);
    if (err) {
      this._error = err;
    } else {
      toast.positive('User deleted.');
    }
    this._deleteUser = null;
    this._loaded = false;
    this._loadData();
  }

  _handleUserAction(user, value) {
    if (value === 'edit') {
      this._editUser = user;
      this._editRoles = [...(user.roles ?? [])];
      this._editSaveError = '';
    }
    if (value === 'delete') {
      this._deleteUser = user;
    }
  }

  get _filteredUsers() {
    const q = (this._searchQuery ?? '').toLowerCase();
    return (this._users ?? [])
      .filter((u) => u.email?.toLowerCase().includes(q))
      .sort((a, b) => (a.email ?? '').localeCompare(b.email ?? ''));
  }

  render() {
    return html`
      <div class="page">
        <div class="page-header">
          <div>
            <h1 class="page-title">Site Users</h1>
            <p class="page-subtitle">Manage users and roles for ${this._org}/${this._site}</p>
          </div>
          ${!this._loading && !this._error ? html`
            <eds-button variant="accent" @click=${() => { this._showAddDialog = true; this._addEmail = ''; this._addRoles = []; this._addSaveError = ''; }}>
              <span slot="icon">${edsIcon('add', { size: 16 })}</span>
              Add User
            </eds-button>
          ` : nothing}
        </div>

        <input
          type="search"
          class="search-input"
          placeholder="Search users"
          .value=${this._searchQuery}
          @input=${(e) => { this._searchQuery = (e.detail?.value ?? e.target.value ?? ''); }}
        />

        <error-alert .error=${this._error} @retry=${this._handleRetry}></error-alert>

        ${this._loading
          ? html`<div class="card-grid">${[1, 2, 3].map(() => html`<admin-card loading horizontal></admin-card>`)}</div>`
          : nothing}

        ${!this._loading && !this._error
          ? html`
              <div class="card-grid">
                ${this._filteredUsers.map(
                  (user) => html`
                    <admin-card horizontal heading=${user.email}>
                      <span slot="subheading" class="user-roles">
                        ${(user.roles ?? []).map((r) => ROLE_DESCRIPTIONS[r]?.label ?? r).join(', ')}
                      </span>
                      <eds-menu
                        quiet
                        slot="actions"
                        label="Actions"
                        placement="bottom-end"
                        @change=${(e) => this._handleUserAction(user, e.detail?.value)}
                      >
                        <span slot="trigger">${edsIcon('more', { size: 18 })}</span>
                        <button role="menuitem" data-value="edit">Edit roles</button>
                        <button role="menuitem" data-value="delete">Delete user</button>
                      </eds-menu>
                    </admin-card>
                  `,
                )}
              </div>
            `
          : nothing}

        ${!this._loading && !this._error && this._filteredUsers.length === 0 && !this._searchQuery
          ? html`<p class="empty">No users found. Add users to get started.</p>`
          : nothing}
      </div>

      ${this._showAddDialog ? this._renderAddDialog() : nothing}
      ${this._editUser ? this._renderEditDialog() : nothing}
      ${this._deleteUser ? this._renderDeleteDialog() : nothing}
    `;
  }

  _renderAddDialog() {
    return html`
      <eds-dialog
        open
        headline="Add User"
        size="m"
        @close=${() => { this._showAddDialog = false; }}
      >
        <label class="field-label" for="site-users-add-email">Email</label>
        <eds-textfield
          id="site-users-add-email"
          label="Email"
          placeholder="user@example.com"
          type="email"
          .value=${this._addEmail}
          @input=${(e) => { this._addEmail = (e.detail?.value ?? e.target?.value ?? ''); this._addSaveError = ''; }}
          ?required=${true}
          .invalid=${!!this._addSaveError}
        ></eds-textfield>
        ${this._addSaveError ? html`<p class="dialog-error">${this._addSaveError}</p>` : nothing}
        <p class="roles-label">Roles</p>
        <div class="roles-list">
          ${ROLES.map(
            (role) => html`
              <div class="role-row">
                <label class="checkbox-label">
                  <input
                    type="checkbox"
                    .checked=${this._addRoles.includes(role)}
                    @change=${() => this._toggleAddRole(role)}
                  />
                  ${ROLE_DESCRIPTIONS[role]?.label ?? role}
                </label>
                <p class="role-desc">${ROLE_DESCRIPTIONS[role]?.desc ?? ''}</p>
              </div>
            `,
          )}
        </div>
        <div class="dialog-buttons">
          <eds-button variant="secondary" treatment="outline" @click=${() => { this._showAddDialog = false; }}>Cancel</eds-button>
          <eds-button
            variant="accent"
            @click=${this._handleAddSave}
            ?disabled=${this._addRoles.length === 0 || !this._addEmail.trim() || this._addSaving}
          >
            ${this._addSaving ? 'Adding...' : 'Add User'}
          </eds-button>
        </div>
      </eds-dialog>
    `;
  }

  _renderEditDialog() {
    if (!this._editUser) return html``;
    return html`
      <eds-dialog
        open
        headline="Edit: ${this._editUser.email}"
        size="m"
        @close=${() => { this._editUser = null; }}
      >
        <p class="roles-label">Roles</p>
        <div class="roles-list">
          ${ROLES.map(
            (role) => html`
              <div class="role-row">
                <label class="checkbox-label">
                  <input
                    type="checkbox"
                    .checked=${this._editRoles.includes(role)}
                    @change=${() => this._toggleEditRole(role)}
                  />
                  ${ROLE_DESCRIPTIONS[role]?.label ?? role}
                </label>
                <p class="role-desc">${ROLE_DESCRIPTIONS[role]?.desc ?? ''}</p>
              </div>
            `,
          )}
        </div>
        ${this._editSaveError ? html`<p class="dialog-error">${this._editSaveError}</p>` : nothing}
        <div class="dialog-buttons">
          <eds-button variant="secondary" treatment="outline" @click=${() => { this._editUser = null; }}>Cancel</eds-button>
          <eds-button
            variant="accent"
            @click=${this._handleEditSave}
            ?disabled=${this._editRoles.length === 0 || this._editSaving}
          >
            ${this._editSaving ? 'Saving...' : 'Save'}
          </eds-button>
        </div>
      </eds-dialog>
    `;
  }

  _renderDeleteDialog() {
    if (!this._deleteUser) return html``;
    return html`
      <eds-dialog
        open
        headline="Delete User"
        size="s"
        @close=${() => { if (!this._deleteSaving) { this._deleteUser = null; } }}
      >
        <p>Remove <strong>${this._deleteUser.email}</strong> from ${this._site}? This cannot be undone.</p>
        <div class="dialog-buttons">
          <eds-button variant="secondary" treatment="outline" ?disabled=${this._deleteSaving} @click=${() => { this._deleteUser = null; }}>Cancel</eds-button>
          <eds-button variant="negative" ?disabled=${this._deleteSaving} @click=${this._handleDelete}>
            ${this._deleteSaving ? 'Deleting...' : 'Delete'}
          </eds-button>
        </div>
      </eds-dialog>
    `;
  }
}

customElements.define('site-users', SiteUsers);
