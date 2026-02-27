import { LitElement, html, nothing } from 'lit';
import { getRouteDetails } from '../../../utils/router.js';
import {
  fetchOrgConfig,
  addOrgUser,
  updateOrgUser,
  deleteOrgUser,
} from '../../../services/adminApi.js';
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

export class OrgUsers extends LitElement {
  static properties = {
    _org: { state: true },
    _users: { state: true },
    _loading: { state: true },
    _error: { state: true },
    _accessDenied: { state: true },
    _searchQuery: { state: true },
    _editUser: { state: true },
    _showAddDialog: { state: true },
    _showDeleteDialog: { state: true },
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
    this._users = [];
    this._loading = true;
    this._error = '';
    this._accessDenied = false;
    this._searchQuery = '';
    this._editUser = null;
    this._showAddDialog = false;
    this._showDeleteDialog = false;
    this._deleteUser = null;
    this._addEmail = '';
    this._addRoles = [];
    this._addSaving = false;
    this._addSaveError = '';
    this._editRoles = [];
    this._editSaving = false;
    this._editSaveError = '';
    this._deleteSaving = false;
  }

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [pageSheet, usersSheet, sharedSheet];
    const details = getRouteDetails();
    this._org = details.org || '';
    if (this._org) this._loadUsers();
  }

  updated(changedProperties) {
    super.updated?.(changedProperties);
    if (changedProperties.has('_org') && this._org) this._loadUsers();
  }

  async _loadUsers() {
    if (!this._org) return;
    this._loading = true;
    this._error = '';
    this._accessDenied = false;
    const { data, status, error } = await fetchOrgConfig(this._org);
    if (status === 403) this._accessDenied = true;
    const err = getApiError(status, 'load users', error);
    if (err) {
      this._error = err;
      this._loading = false;
      return;
    }
    this._users = data?.users ?? [];
    this._loading = false;
  }

  _handleRetry() {
    this._loadUsers();
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
    const exists = this._users.some(
      (u) => u.email?.toLowerCase() === this._addEmail.trim().toLowerCase(),
    );
    if (exists) {
      this._addSaveError = 'A user with this email already exists.';
      return;
    }
    this._addSaving = true;
    this._addSaveError = '';
    const { status, error } = await addOrgUser(this._org, {
      email: this._addEmail.trim(),
      roles: this._addRoles,
    });
    const err = getApiError(status, 'add user', error);
    if (err) {
      this._addSaveError = err;
      this._addSaving = false;
      return;
    }
    toast.positive('User added.');
    this._showAddDialog = false;
    this._addEmail = '';
    this._addRoles = [];
    this._loadUsers();
    this._addSaving = false;
  }

  async _handleEditSave() {
    if (!this._editUser || this._editRoles.length === 0) return;
    this._editSaving = true;
    this._editSaveError = '';
    const { status, error } = await updateOrgUser(this._org, this._editUser.id, {
      email: this._editUser.email,
      roles: this._editRoles,
    });
    const err = getApiError(status, 'update user', error);
    if (err) {
      this._editSaveError = err;
      this._editSaving = false;
      return;
    }
    toast.positive('User updated.');
    this._editUser = null;
    this._loadUsers();
    this._editSaving = false;
  }

  async _handleDelete() {
    if (!this._deleteUser) return;
    this._deleteSaving = true;
    const { status, error } = await deleteOrgUser(this._org, this._deleteUser.id);
    const err = getApiError(status, 'delete user', error);
    if (err) {
      toast.negative(err);
    } else {
      toast.positive('User deleted.');
    }
    this._showDeleteDialog = false;
    this._deleteUser = null;
    this._deleteSaving = false;
    this._loadUsers();
  }

  _handleUserAction(user, value) {
    if (value === 'edit') {
      this._editUser = user;
      this._editRoles = [...(user.roles ?? [])];
      this._editSaveError = '';
    }
    if (value === 'delete') {
      this._deleteUser = user;
      this._showDeleteDialog = true;
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
            <h1 class="page-title">Users</h1>
            <p class="page-subtitle">Manage users for ${this._org}</p>
          </div>
          ${!this._loading && !this._accessDenied && !this._error
            ? html`
                <eds-button variant="accent" @click=${() => { this._showAddDialog = true; this._addEmail = ''; this._addRoles = []; this._addSaveError = ''; }}>
                  <span slot="icon">${edsIcon('add', { size: 16 })}</span>
                  Add User
                </eds-button>
              `
            : nothing}
        </div>

        ${!this._accessDenied
          ? html`
              <input type="search" class="search-input" placeholder="Search users"
                .value=${this._searchQuery}
                @input=${(e) => { this._searchQuery = e.target.value ?? ''; }}
              />
            `
          : nothing}

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
                        @change=${(e) => this._handleUserAction(user, e.detail?.value ?? e.target?.value)}
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
      ${this._showDeleteDialog && this._deleteUser ? this._renderDeleteDialog() : nothing}
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
        <label class="field-label" for="add-user-email">Email</label>
        <eds-textfield
          id="add-user-email"
          label="Email"
          placeholder="user@example.com"
          type="email"
          .value=${this._addEmail}
          @input=${(e) => { this._addEmail = e.target.value ?? e.detail?.value ?? ''; this._addSaveError = ''; }}
          required
          .invalid=${!!this._addSaveError}
        ></eds-textfield>
        ${this._addSaveError ? html`<p class="dialog-error">${this._addSaveError}</p>` : nothing}
        <p class="roles-label">Roles</p>
        <div class="roles-list">
          ${ROLES.map(
            (role) => html`
              <div class="role-row">
                <label class="checkbox-label">
                  <input type="checkbox"
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
                  <input type="checkbox"
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
        @close=${() => { if (!this._deleteSaving) { this._showDeleteDialog = false; this._deleteUser = null; } }}
      >
        <p>Remove <strong>${this._deleteUser.email}</strong> from ${this._org}? This cannot be undone.</p>
        <div class="dialog-buttons">
          <eds-button variant="secondary" treatment="outline" ?disabled=${this._deleteSaving} @click=${() => { this._showDeleteDialog = false; this._deleteUser = null; }}>Cancel</eds-button>
          <eds-button variant="negative" ?disabled=${this._deleteSaving} @click=${this._handleDelete}>
            ${this._deleteSaving ? 'Deleting...' : 'Delete'}
          </eds-button>
        </div>
      </eds-dialog>
    `;
  }

}

customElements.define('org-users', OrgUsers);
