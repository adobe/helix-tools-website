/**
 * ProductBus Admin - Catalog page
 */

import { apiFetch } from './api.js';
import { showToast, createModal, createFormField } from './ui.js';

const AVAILABILITY_OPTIONS = [
  'BackOrder', 'Discontinued', 'InStock', 'InStoreOnly',
  'LimitedAvailability', 'OnlineOnly', 'OutOfStock',
  'PreOrder', 'PreSale', 'SoldOut',
];

const CONDITION_OPTIONS = [
  'NewCondition', 'DamagedCondition', 'RefurbishedCondition', 'UsedCondition',
];

const PATH_PATTERN = /^\/[a-z0-9-/]+$/;

function renderTable(container, products, ctx) {
  const tableWrap = container.querySelector('#catalog-table');
  if (products.length === 0) {
    tableWrap.innerHTML = `
      <div class="empty-state">
        <h3>No products found</h3>
        <p>Create your first product to get started</p>
      </div>
    `;
    return;
  }

  tableWrap.innerHTML = `
    <table class="data-table">
      <thead>
        <tr>
          <th>SKU</th>
          <th>Name</th>
          <th>Path</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        ${products.map((p) => `
          <tr>
            <td><code>${p.sku}</code></td>
            <td>${p.name || '—'}</td>
            <td><code>${p.path || '—'}</code></td>
            <td>
              <div class="actions">
                <button class="btn-icon" data-action="edit" data-path="${p.path}" title="Edit">Edit</button>
                <button class="btn-icon danger" data-action="delete" data-path="${p.path}" title="Delete">Delete</button>
              </div>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;

  tableWrap.querySelectorAll('[data-action="edit"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const { path } = btn.dataset;
      try {
        const jsonPath = path.endsWith('.json') ? path : `${path}.json`;
        const resp = await apiFetch(ctx.org, ctx.site, `catalog${jsonPath}`, { method: 'GET' });
        const product = await resp.json();
        // eslint-disable-next-line no-use-before-define
        openProductModal(ctx, product, () => render(container, ctx));
      } catch (err) {
        showToast(`Failed to load product: ${err.message}`, 'error');
      }
    });
  });

  tableWrap.querySelectorAll('[data-action="delete"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const { path } = btn.dataset;
      const jsonPath = path.endsWith('.json') ? path : `${path}.json`;
      // eslint-disable-next-line no-restricted-globals, no-alert
      if (!confirm(`Delete product at ${path}?`)) return;
      try {
        await apiFetch(ctx.org, ctx.site, `catalog${jsonPath}`, { method: 'DELETE' });
        showToast('Product deleted');
        // eslint-disable-next-line no-use-before-define
        render(container, ctx);
      } catch (err) {
        showToast(`Failed to delete: ${err.message}`, 'error');
      }
    });
  });
}

function buildFormHTML(product) {
  const p = product || {};
  const price = p.price || {};

  function opt(options, selected) {
    return options.map((o) => `<option value="${o}" ${o === selected ? 'selected' : ''}>${o}</option>`).join('');
  }

  return `
    <form class="form-view" id="product-form">
      <h4>Basic Information</h4>
      <div class="form-row">
        ${createFormField('sku', 'SKU', 'text', { required: true, value: p.sku || '' }).outerHTML}
        ${createFormField('name', 'Name', 'text', { required: true, value: p.name || '' }).outerHTML}
      </div>
      <div class="form-row">
        ${createFormField('path', 'Path', 'text', { required: true, value: p.path || '', placeholder: '/products/my-product' }).outerHTML}
        ${createFormField('url', 'URL', 'text', { value: p.url || '' }).outerHTML}
      </div>
      <div class="form-row">
        ${createFormField('brand', 'Brand', 'text', { value: p.brand || '' }).outerHTML}
        ${createFormField('type', 'Type', 'text', { value: p.type || '' }).outerHTML}
      </div>
      <div class="form-field">
        <label for="description">Description</label>
        <textarea id="description" name="description" rows="3">${p.description || ''}</textarea>
      </div>
      <div class="form-row">
        ${createFormField('metaTitle', 'Meta Title', 'text', { value: p.metaTitle || '' }).outerHTML}
        ${createFormField('metaDescription', 'Meta Description', 'text', { value: p.metaDescription || '' }).outerHTML}
      </div>
      <div class="form-row">
        ${createFormField('gtin', 'GTIN', 'text', { value: p.gtin || '' }).outerHTML}
        <div class="form-field">
          <label for="availability">Availability</label>
          <select id="availability" name="availability">
            <option value="">-- Select --</option>
            ${opt(AVAILABILITY_OPTIONS, p.availability)}
          </select>
        </div>
      </div>
      <div class="form-field">
        <label for="itemCondition">Item Condition</label>
        <select id="itemCondition" name="itemCondition">
          <option value="">-- Select --</option>
          ${opt(CONDITION_OPTIONS, p.itemCondition)}
        </select>
      </div>

      <h4>Price</h4>
      <div class="form-row">
        ${createFormField('price.currency', 'Currency', 'text', { value: price.currency || 'USD' }).outerHTML}
        ${createFormField('price.regular', 'Regular', 'number', { value: price.regular ?? '' }).outerHTML}
      </div>
      <div class="form-row">
        ${createFormField('price.final', 'Final', 'number', { value: price.final ?? '' }).outerHTML}
      </div>

      <h4>Images</h4>
      <div id="images-container">
        ${(p.images || []).map((img, i) => `
          <div class="image-row form-row" data-idx="${i}">
            ${createFormField(`images.${i}.url`, 'URL', 'text', { value: img.url || '' }).outerHTML}
            ${createFormField(`images.${i}.label`, 'Label', 'text', { value: img.label || '' }).outerHTML}
          </div>
        `).join('') || '<p class="field-hint">No images. Use JSON view to add images, variants, options, and custom fields.</p>'}
      </div>
    </form>
  `;
}

function openProductModal(ctx, existing, onSaved) {
  const isNew = !existing;
  const title = isNew ? 'Create Product' : `Edit: ${existing.sku}`;

  const content = document.createElement('div');
  let currentView = 'form';

  function renderView() {
    if (currentView === 'form') {
      content.innerHTML = `
        <div class="view-switcher">
          <button type="button" class="active" data-view="form">Form</button>
          <button type="button" data-view="json">JSON</button>
        </div>
        ${buildFormHTML(existing)}
      `;
    } else {
      const jsonData = existing ? { ...existing } : {
        sku: '',
        name: '',
        path: '',
        description: '',
        price: {
          currency: 'USD',
          regular: 0,
          final: 0,
        },
        images: [],
      };
      // Remove read-only internal fields for editing
      delete jsonData.internal;

      content.innerHTML = `
        <div class="view-switcher">
          <button type="button" data-view="form">Form</button>
          <button type="button" class="active" data-view="json">JSON</button>
        </div>
        <textarea class="json-editor" id="json-editor">${JSON.stringify(jsonData, null, 2)}</textarea>
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
    <button type="button" class="button save-btn">${isNew ? 'Create' : 'Update'}</button>
  `;

  const dialog = createModal(title, content, footer);

  dialog.querySelector('.cancel-btn').addEventListener('click', () => {
    dialog.close();
    dialog.remove();
  });

  dialog.querySelector('.save-btn').addEventListener('click', async () => {
    const saveBtn = dialog.querySelector('.save-btn');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';

    try {
      let productData;
      if (currentView === 'json') {
        productData = JSON.parse(dialog.querySelector('#json-editor').value);
      } else {
        const form = dialog.querySelector('#product-form');
        const fd = new FormData(form);
        productData = { price: {}, images: [] };

        fd.forEach((val, key) => {
          if (key.startsWith('price.')) {
            const field = key.split('.')[1];
            productData.price[field] = field === 'currency' ? val : parseFloat(val) || 0;
          } else if (key.startsWith('images.')) {
            const parts = key.split('.');
            const idx = parseInt(parts[1], 10);
            if (!productData.images[idx]) productData.images[idx] = {};
            productData.images[idx][parts[2]] = val;
          } else if (val !== '') {
            productData[key] = val;
          }
        });

        // Clean empty images
        productData.images = productData.images.filter((img) => img && img.url);
      }

      // Validate path
      let { path } = productData;
      if (!path) throw new Error('Path is required');
      if (path.endsWith('.json')) path = path.slice(0, -5);
      if (!PATH_PATTERN.test(path)) {
        throw new Error('Path must start with / and contain only lowercase letters, numbers, hyphens, and slashes');
      }

      const jsonPath = `${path}.json`;
      productData.path = path;

      await apiFetch(ctx.org, ctx.site, `catalog${jsonPath}`, {
        method: 'PUT',
        body: JSON.stringify(productData),
      });
      showToast(isNew ? 'Product created' : 'Product updated');
      dialog.close();
      dialog.remove();
      onSaved();
    } catch (err) {
      showToast(`Failed to save: ${err.message}`, 'error');
      saveBtn.disabled = false;
      saveBtn.textContent = isNew ? 'Create' : 'Update';
    }
  });
}

export async function render(container, ctx) {
  container.innerHTML = `
    <div class="page-header">
      <h1>Catalog</h1>
    </div>
    <div class="page-actions">
      <input type="text" class="search-input" placeholder="Search products..." id="search-catalog">
      <button class="button" id="add-product-btn">+ Create Product</button>
    </div>
    <div id="catalog-table">
      <p class="loading">Loading catalog...</p>
    </div>
  `;

  try {
    const resp = await apiFetch(ctx.org, ctx.site, 'catalog', { method: 'GET' });
    const data = await resp.json();
    const products = data.products || [];

    renderTable(container, products, ctx);

    container.querySelector('#search-catalog').addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase();
      const filtered = products.filter((p) => (p.sku || '').toLowerCase().includes(q)
        || (p.name || '').toLowerCase().includes(q)
        || (p.path || '').toLowerCase().includes(q));
      renderTable(container, filtered, ctx);
    });

    container.querySelector('#add-product-btn').addEventListener('click', () => {
      openProductModal(ctx, null, () => render(container, ctx));
    });
  } catch (err) {
    container.querySelector('#catalog-table').innerHTML = `<p class="error">Failed to load catalog: ${err.message}</p>`;
  }
}

export function destroy() {}
