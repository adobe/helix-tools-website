/**
 * ProductBus Admin - Admins page (superuser only)
 */

import { apiFetch } from './api.js';
import { showToast, createModal } from './ui.js';

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
            <td>${a.email}</td>
            <td>${a.dateAdded ? new Date(a.dateAdded).toLocaleDateString() : '—'}</td>
            <td>${a.addedBy || '—'}</td>
            <td>
              <div class="actions">
                <button class="btn-icon danger" data-action="delete" data-email="${a.email}" title="Remove">Remove</button>
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
      // eslint-disable-next-line no-alert
      // eslint-disable-next-line no-restricted-globals, no-alert
      if (!confirm(`Remove admin ${email}?`)) return;
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
    <button type="submit" class="button save-btn">Add Admin</button>
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
  container.innerHTML = `
    <div class="page-header">
      <h1>Admins</h1>
    </div>
    <div class="page-actions">
      <input type="text" class="search-input" placeholder="Search admins..." id="search-admins">
      <button class="button" id="add-admin-btn">+ Add Admin</button>
    </div>
    <div id="admins-table">
      <p class="loading">Loading admins...</p>
    </div>
  `;

  try {
    const resp = await apiFetch(ctx.org, ctx.site, 'auth/admins', { method: 'GET' });
    const data = await resp.json();
    const admins = data.admins || data || [];

    renderTable(container, admins, ctx);

    container.querySelector('#search-admins').addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase();
      const filtered = admins.filter((a) => a.email.toLowerCase().includes(q));
      renderTable(container, filtered, ctx);
    });

    container.querySelector('#add-admin-btn').addEventListener('click', () => {
      openAddModal(ctx, () => render(container, ctx));
    });
  } catch (err) {
    container.querySelector('#admins-table').innerHTML = `<p class="error">Failed to load admins: ${err.message}</p>`;
  }
}

export function destroy() {}
