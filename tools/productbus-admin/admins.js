/**
 * ProductBus Admin - Admins page (superuser only)
 */

import { apiFetch } from './api.js';
import {
  showToast, createModal, getUrlParam, setUrlParam, confirmModal, escapeHtml,
} from './ui.js';

function renderTable(container, admins, ctx) {
  const tableWrap = container.querySelector('#admins-table');
  if (admins.length === 0) {
    tableWrap.innerHTML = `
      <div class="empty-state">
        <h3>No admins found</h3>
        <p>Add your first admin to get started</p>
      </div>
    `;
    return;
  }

  tableWrap.innerHTML = `
    <table class="data-table">
      <thead>
        <tr>
          <th>Email</th>
          <th>Date Added</th>
          <th>Added By</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        ${admins.map((a) => `
          <tr>
            <td>${escapeHtml(a.email)}</td>
            <td>${a.dateAdded ? new Date(a.dateAdded).toLocaleDateString() : '—'}</td>
            <td>${escapeHtml(a.addedBy || '—')}</td>
            <td>
              <div class="actions">
                <button class="btn-icon danger" data-action="delete" data-email="${escapeHtml(a.email)}" title="Remove">Remove</button>
              </div>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;

  tableWrap.querySelectorAll('[data-action="delete"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const { email } = btn.dataset;
      const ok = await confirmModal(`Remove admin ${email}?`, {
        title: 'Remove admin',
        confirmLabel: 'Remove',
        destructive: true,
      });
      if (!ok) return;
      try {
        await apiFetch(ctx.org, ctx.site, `auth/admins/${encodeURIComponent(email)}`, { method: 'DELETE' });
        showToast('Admin removed');
        // eslint-disable-next-line no-use-before-define
        render(container, ctx);
      } catch (err) {
        showToast(`Failed to remove: ${err.message}`, 'error');
      }
    });
  });
}

function openAddModal(ctx, onAdded) {
  const content = document.createElement('form');
  content.id = 'add-admin-form';
  content.innerHTML = `
    <div class="form-field">
      <label for="admin-email">Email</label>
      <input type="email" id="admin-email" name="email" required placeholder="admin@example.com">
    </div>
  `;

  const footer = document.createElement('div');
  footer.innerHTML = `
    <button type="button" class="button outline cancel-btn">Cancel</button>
    <button type="submit" form="add-admin-form" class="button save-btn">Add Admin</button>
  `;

  const dialog = createModal('Add Admin', content, footer);

  dialog.querySelector('.cancel-btn').addEventListener('click', () => {
    dialog.close();
    dialog.remove();
  });

  content.addEventListener('submit', async (e) => {
    e.preventDefault();
    const saveBtn = dialog.querySelector('.save-btn');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Adding...';

    try {
      const email = content.querySelector('#admin-email').value;
      await apiFetch(ctx.org, ctx.site, `auth/admins/${encodeURIComponent(email)}`, { method: 'PUT' });
      showToast('Admin added');
      dialog.close();
      dialog.remove();
      onAdded();
    } catch (err) {
      showToast(`Failed to add admin: ${err.message}`, 'error');
      saveBtn.disabled = false;
      saveBtn.textContent = 'Add Admin';
    }
  });
}

export async function render(container, ctx) {
  const initialQ = getUrlParam('q');
  container.innerHTML = `
    <div class="page-header">
      <h1>Admins</h1>
    </div>
    <div class="page-actions">
      <input type="text" class="search-input" placeholder="Search admins..." id="search-admins" value="${escapeHtml(initialQ)}">
      <button class="button" id="add-admin-btn">+ Add Admin</button>
    </div>
    <div id="admins-table">
      <p class="loading">Loading admins...</p>
    </div>
  `;

  function filterAdmins(admins, q) {
    if (!q) return admins;
    const needle = q.toLowerCase();
    return admins.filter((a) => a.email.toLowerCase().includes(needle));
  }

  try {
    const resp = await apiFetch(ctx.org, ctx.site, 'auth/admins', { method: 'GET' });
    const data = await resp.json();
    const admins = data.admins || data || [];

    renderTable(container, filterAdmins(admins, initialQ), ctx);

    container.querySelector('#search-admins').addEventListener('input', (e) => {
      const q = e.target.value;
      setUrlParam('q', q);
      renderTable(container, filterAdmins(admins, q), ctx);
    });

    container.querySelector('#add-admin-btn').addEventListener('click', () => {
      openAddModal(ctx, () => render(container, ctx));
    });
  } catch (err) {
    container.querySelector('#admins-table').innerHTML = `<p class="error">Failed to load admins: ${err.message}</p>`;
  }
}

export function destroy() {}
