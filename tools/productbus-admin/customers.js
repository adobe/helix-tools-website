/**
 * ProductBus Admin - Customers page
 */

import { apiFetch } from './api.js';
import { showToast, createModal, createFormField } from './ui.js';

function renderTable(container, customers, ctx) {
  const tableWrap = container.querySelector('#customers-table');
  if (customers.length === 0) {
    tableWrap.innerHTML = `
      <div class="empty-state">
        <h3>No customers found</h3>
        <p>Create your first customer to get started</p>
      </div>
    `;
    return;
  }

  tableWrap.innerHTML = `
    <table class="data-table">
      <thead>
        <tr>
          <th>Email</th>
          <th>First Name</th>
          <th>Last Name</th>
          <th>Phone</th>
          <th>Created</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        ${customers.map((c) => `
          <tr>
            <td>${c.email}</td>
            <td>${c.firstName || '—'}</td>
            <td>${c.lastName || '—'}</td>
            <td>${c.phone || '—'}</td>
            <td>${c.createdAt ? new Date(c.createdAt).toLocaleDateString() : '—'}</td>
            <td>
              <div class="actions">
                <button class="btn-icon danger" data-action="delete" data-email="${c.email}" title="Delete">Delete</button>
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
      if (!confirm(`Delete customer ${email}? This will also remove their orders and addresses.`)) return;
      try {
        await apiFetch(ctx.org, ctx.site, `customers/${encodeURIComponent(email)}`, { method: 'DELETE' });
        showToast('Customer deleted');
        // eslint-disable-next-line no-use-before-define
        render(container, ctx);
      } catch (err) {
        showToast(`Failed to delete: ${err.message}`, 'error');
      }
    });
  });
}

function openCreateModal(ctx, onCreated) {
  const content = document.createElement('div');
  let currentView = 'form';

  function renderView() {
    if (currentView === 'form') {
      content.innerHTML = `
        <div class="view-switcher">
          <button type="button" class="active" data-view="form">Form</button>
          <button type="button" data-view="json">JSON</button>
        </div>
        <form class="form-view" id="customer-form">
          <div class="form-row">
            ${createFormField('firstName', 'First Name', 'text', { required: true }).outerHTML}
            ${createFormField('lastName', 'Last Name', 'text', { required: true }).outerHTML}
          </div>
          <div class="form-row">
            ${createFormField('email', 'Email', 'email', { required: true }).outerHTML}
            ${createFormField('phone', 'Phone').outerHTML}
          </div>
        </form>
      `;
    } else {
      content.innerHTML = `
        <div class="view-switcher">
          <button type="button" data-view="form">Form</button>
          <button type="button" class="active" data-view="json">JSON</button>
        </div>
        <textarea class="json-editor" id="json-editor">${JSON.stringify({
    firstName: '', lastName: '', email: '', phone: '',
  }, null, 2)}</textarea>
      `;
    }

    content.querySelectorAll('.view-switcher button').forEach((btn) => {
      btn.addEventListener('click', () => {
        currentView = btn.dataset.view;
        renderView();
      });
    });
  }

  renderView();

  const footer = document.createElement('div');
  footer.innerHTML = `
    <button type="button" class="button outline cancel-btn">Cancel</button>
    <button type="button" class="button save-btn">Create Customer</button>
  `;

  const dialog = createModal('Create Customer', content, footer);

  dialog.querySelector('.cancel-btn').addEventListener('click', () => {
    dialog.close();
    dialog.remove();
  });

  dialog.querySelector('.save-btn').addEventListener('click', async () => {
    const saveBtn = dialog.querySelector('.save-btn');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Creating...';

    try {
      let customerData;
      if (currentView === 'json') {
        customerData = JSON.parse(dialog.querySelector('#json-editor').value);
      } else {
        const form = dialog.querySelector('#customer-form');
        customerData = Object.fromEntries(new FormData(form));
      }

      await apiFetch(ctx.org, ctx.site, 'customers', {
        method: 'POST',
        body: JSON.stringify(customerData),
      });
      showToast('Customer created');
      dialog.close();
      dialog.remove();
      onCreated();
    } catch (err) {
      showToast(`Failed to create customer: ${err.message}`, 'error');
      saveBtn.disabled = false;
      saveBtn.textContent = 'Create Customer';
    }
  });
}

export async function render(container, ctx) {
  container.innerHTML = `
    <div class="page-header">
      <h1>Customers</h1>
    </div>
    <div class="page-actions">
      <input type="text" class="search-input" placeholder="Search customers..." id="search-customers">
      <button class="button" id="add-customer-btn">+ Create Customer</button>
    </div>
    <div id="customers-table">
      <p class="loading">Loading customers...</p>
    </div>
  `;

  try {
    const resp = await apiFetch(ctx.org, ctx.site, 'customers', { method: 'GET' });
    const data = await resp.json();
    const customers = data.customers || data || [];

    renderTable(container, customers, ctx);

    container.querySelector('#search-customers').addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase();
      const filtered = customers.filter((c) => c.email.toLowerCase().includes(q)
        || (c.firstName || '').toLowerCase().includes(q)
        || (c.lastName || '').toLowerCase().includes(q));
      renderTable(container, filtered, ctx);
    });

    container.querySelector('#add-customer-btn').addEventListener('click', () => {
      openCreateModal(ctx, () => render(container, ctx));
    });
  } catch (err) {
    container.querySelector('#customers-table').innerHTML = `<p class="error">Failed to load customers: ${err.message}</p>`;
  }
}

export function destroy() {}
