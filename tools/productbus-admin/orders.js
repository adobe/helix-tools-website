/**
 * ProductBus Admin - Orders page
 */

import { apiFetch } from './api.js';
import { showToast, createModal, createFormField } from './ui.js';

function renderTable(container, orders, ctx) {
  const tableWrap = container.querySelector('#orders-table');
  if (orders.length === 0) {
    tableWrap.innerHTML = `
      <div class="empty-state">
        <h3>No orders found</h3>
        <p>Create your first order to get started</p>
      </div>
    `;
    return;
  }

  tableWrap.innerHTML = `
    <table class="data-table">
      <thead>
        <tr>
          <th>Order ID</th>
          <th>State</th>
          <th>Customer</th>
          <th>Items</th>
          <th>Created</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        ${orders.map((o) => `
          <tr data-id="${o.id}">
            <td><code>${o.id}</code></td>
            <td><span class="badge ${o.state === 'completed' ? 'success' : 'info'}">${o.state || 'pending'}</span></td>
            <td>${o.customer?.email || o.customMetadata?.customerEmail || 'N/A'}</td>
            <td>${o.items?.length ?? '—'}</td>
            <td>${o.createdAt ? new Date(o.createdAt).toLocaleDateString() : 'N/A'}</td>
            <td>
              <div class="actions">
                <button class="btn-icon" data-action="view" data-id="${o.id}" title="View">View</button>
              </div>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;

  tableWrap.querySelectorAll('[data-action="view"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        const resp = await apiFetch(ctx.org, ctx.site, `orders/${btn.dataset.id}`, { method: 'GET' });
        const order = await resp.json();
        // eslint-disable-next-line no-use-before-define
        viewOrderModal(order);
      } catch (err) {
        showToast(`Failed to load order: ${err.message}`, 'error');
      }
    });
  });
}

function viewOrderModal(order) {
  const pre = document.createElement('pre');
  pre.className = 'json-display';
  pre.textContent = JSON.stringify(order, null, 2);
  createModal(`Order: ${order.id}`, pre);
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
        <form class="form-view" id="order-form">
          <h4>Customer</h4>
          <div class="form-row">
            ${createFormField('customer.firstName', 'First Name', 'text', { required: true }).outerHTML}
            ${createFormField('customer.lastName', 'Last Name', 'text', { required: true }).outerHTML}
          </div>
          <div class="form-row">
            ${createFormField('customer.email', 'Email', 'email', { required: true }).outerHTML}
            ${createFormField('customer.phone', 'Phone').outerHTML}
          </div>
          <h4>Shipping</h4>
          <div class="form-row">
            ${createFormField('shipping.name', 'Name', 'text', { required: true }).outerHTML}
            ${createFormField('shipping.email', 'Email', 'email').outerHTML}
          </div>
          <div class="form-row">
            ${createFormField('shipping.address1', 'Address 1', 'text', { required: true }).outerHTML}
            ${createFormField('shipping.address2', 'Address 2').outerHTML}
          </div>
          <div class="form-row">
            ${createFormField('shipping.city', 'City', 'text', { required: true }).outerHTML}
            ${createFormField('shipping.region', 'State/Region', 'text', { required: true }).outerHTML}
          </div>
          <div class="form-row">
            ${createFormField('shipping.postcode', 'Zip/Postal', 'text', { required: true }).outerHTML}
            ${createFormField('shipping.country', 'Country', 'text', { required: true }).outerHTML}
          </div>
          <h4>Items</h4>
          <div id="items-list">
            <div class="item-row">
              <div class="form-row">
                ${createFormField('items.0.sku', 'SKU', 'text', { required: true }).outerHTML}
                ${createFormField('items.0.name', 'Name', 'text', { required: true }).outerHTML}
              </div>
              <div class="form-row">
                ${createFormField('items.0.urlKey', 'URL Key').outerHTML}
                ${createFormField('items.0.quantity', 'Qty', 'number', { value: '1', required: true }).outerHTML}
              </div>
              <div class="form-row">
                ${createFormField('items.0.price.currency', 'Currency', 'text', { value: 'USD' }).outerHTML}
                ${createFormField('items.0.price.regular', 'Regular Price', 'number').outerHTML}
              </div>
              <div class="form-row">
                ${createFormField('items.0.price.final', 'Final Price', 'number').outerHTML}
              </div>
            </div>
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
    customer: {
      firstName: '',
      lastName: '',
      email: '',
      phone: '',
    },
    shipping: {
      name: '',
      email: '',
      address1: '',
      city: '',
      region: '',
      postcode: '',
      country: '',
    },
    items: [{
      sku: '',
      urlKey: '',
      name: '',
      quantity: 1,
      price: {
        currency: 'USD',
        regular: 0,
        final: 0,
      },
    }],
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
    <button type="button" class="button save-btn">Create Order</button>
  `;

  const dialog = createModal('Create Order', content, footer);

  dialog.querySelector('.cancel-btn').addEventListener('click', () => {
    dialog.close();
    dialog.remove();
  });

  dialog.querySelector('.save-btn').addEventListener('click', async () => {
    const saveBtn = dialog.querySelector('.save-btn');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Creating...';

    try {
      let orderData;
      if (currentView === 'json') {
        orderData = JSON.parse(dialog.querySelector('#json-editor').value);
      } else {
        const form = dialog.querySelector('#order-form');
        const fd = new FormData(form);
        orderData = { customer: {}, shipping: {}, items: [{}] };
        fd.forEach((val, key) => {
          const parts = key.split('.');
          if (parts[0] === 'items') {
            const idx = parseInt(parts[1], 10);
            if (!orderData.items[idx]) orderData.items[idx] = {};
            if (parts.length === 4) {
              if (!orderData.items[idx][parts[2]]) orderData.items[idx][parts[2]] = {};
              orderData.items[idx][parts[2]][parts[3]] = val;
            } else {
              orderData.items[idx][parts[2]] = val;
            }
          } else if (parts.length === 2) {
            orderData[parts[0]][parts[1]] = val;
          }
        });
      }

      await apiFetch(ctx.org, ctx.site, 'orders', {
        method: 'POST',
        body: JSON.stringify(orderData),
      });
      showToast('Order created');
      dialog.close();
      dialog.remove();
      onCreated();
    } catch (err) {
      showToast(`Failed to create order: ${err.message}`, 'error');
      saveBtn.disabled = false;
      saveBtn.textContent = 'Create Order';
    }
  });
}

export async function render(container, ctx) {
  container.innerHTML = `
    <div class="page-header">
      <h1>Orders</h1>
    </div>
    <div class="page-actions">
      <input type="text" class="search-input" placeholder="Search orders..." id="search-orders">
      <button class="button" id="add-order-btn">+ Create Order</button>
    </div>
    <div id="orders-table">
      <p class="loading">Loading orders...</p>
    </div>
  `;

  try {
    const resp = await apiFetch(ctx.org, ctx.site, 'orders', { method: 'GET' });
    const data = await resp.json();
    const orders = data.orders || data || [];

    renderTable(container, orders, ctx);

    container.querySelector('#search-orders').addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase();
      const filtered = orders.filter((o) => (o.id || '').toLowerCase().includes(q)
        || (o.customer?.email || '').toLowerCase().includes(q)
        || (o.state || '').toLowerCase().includes(q));
      renderTable(container, filtered, ctx);
    });

    container.querySelector('#add-order-btn').addEventListener('click', () => {
      openCreateModal(ctx, () => render(container, ctx));
    });
  } catch (err) {
    container.querySelector('#orders-table').innerHTML = `<p class="error">Failed to load orders: ${err.message}</p>`;
  }
}

export function destroy() {}
