/**
 * ProductBus Admin - Indices page
 */

import { apiFetch } from './api.js';
import {
  showToast, createModal, createFormField, getUrlParam, setUrlParam,
} from './ui.js';

const DIR_PATH_PATTERN = /^\/[a-z0-9-/]+$/;

function renderTable(container, indices, ctx) {
  const tableWrap = container.querySelector('#indices-table');
  if (indices.length === 0) {
    tableWrap.innerHTML = `
      <div class="empty-state">
        <h3>No indices found</h3>
        <p>Create your first index to get started</p>
      </div>
    `;
    return;
  }

  tableWrap.innerHTML = `
    <table class="data-table">
      <thead>
        <tr>
          <th>Path</th>
          <th>Last Modified</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        ${indices.map((idx) => `
          <tr>
            <td><code>${idx.path}</code></td>
            <td>${idx.lastModified ? new Date(idx.lastModified).toLocaleDateString() : '—'}</td>
            <td>
              <div class="actions">
                <button class="btn-icon danger" data-action="delete" data-path="${idx.path}" title="Delete">Delete</button>
              </div>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;

  tableWrap.querySelectorAll('[data-action="delete"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const { path } = btn.dataset;
      // eslint-disable-next-line no-restricted-globals, no-alert
      if (!confirm(`Delete index at ${path}?`)) return;
      try {
        await apiFetch(ctx.org, ctx.site, `index${path}`, { method: 'DELETE' });
        showToast('Index deleted');
        // eslint-disable-next-line no-use-before-define
        render(container, ctx);
      } catch (err) {
        showToast(`Failed to delete: ${err.message}`, 'error');
      }
    });
  });
}

function openCreateModal(ctx, onCreated) {
  const content = document.createElement('form');
  content.id = 'index-form';
  content.innerHTML = `
    ${createFormField('path', 'Path', 'text', {
    required: true,
    placeholder: '/products/index.json',
  }).outerHTML}
    <p class="field-hint">Must start with /, contain only lowercase letters, numbers, hyphens, and slashes, and end with /index.json</p>
  `;

  const footer = document.createElement('div');
  footer.innerHTML = `
    <button type="button" class="button outline cancel-btn">Cancel</button>
    <button type="submit" class="button save-btn">Create Index</button>
  `;

  const dialog = createModal('Create Index', content, footer);

  dialog.querySelector('.cancel-btn').addEventListener('click', () => {
    dialog.close();
    dialog.remove();
  });

  content.addEventListener('submit', async (e) => {
    e.preventDefault();
    const saveBtn = dialog.querySelector('.save-btn');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Creating...';

    try {
      let path = content.querySelector('#path').value.trim();

      // Normalize: strip trailing /index.json if provided, validate base path
      if (path.endsWith('/index.json')) {
        path = path.slice(0, -'/index.json'.length);
      }
      path = path.replace(/\/+$/, '');

      if (!DIR_PATH_PATTERN.test(path)) {
        throw new Error('Invalid path. Must start with / and contain only lowercase letters, numbers, hyphens, and slashes.');
      }

      const indexPath = `${path}/index.json`;
      await apiFetch(ctx.org, ctx.site, `index${indexPath}`, { method: 'POST' });
      showToast('Index created');
      dialog.close();
      dialog.remove();
      onCreated();
    } catch (err) {
      showToast(`Failed to create index: ${err.message}`, 'error');
      saveBtn.disabled = false;
      saveBtn.textContent = 'Create Index';
    }
  });
}

export async function render(container, ctx) {
  const initialQ = getUrlParam('q');
  container.innerHTML = `
    <div class="page-header">
      <h1>Indices</h1>
    </div>
    <div class="page-actions">
      <input type="text" class="search-input" placeholder="Search indices..." id="search-indices" value="${initialQ.replace(/"/g, '&quot;')}">
      <button class="button" id="add-index-btn">+ Create Index</button>
    </div>
    <div id="indices-table">
      <p class="loading">Loading indices...</p>
    </div>
  `;

  function filterIndices(indices, q) {
    if (!q) return indices;
    const needle = q.toLowerCase();
    return indices.filter((idx) => idx.path.toLowerCase().includes(needle));
  }

  try {
    const resp = await apiFetch(ctx.org, ctx.site, 'index', { method: 'GET' });
    const data = await resp.json();
    const indices = data.indices || [];

    renderTable(container, filterIndices(indices, initialQ), ctx);

    container.querySelector('#search-indices').addEventListener('input', (e) => {
      const q = e.target.value;
      setUrlParam('q', q);
      renderTable(container, filterIndices(indices, q), ctx);
    });

    container.querySelector('#add-index-btn').addEventListener('click', () => {
      openCreateModal(ctx, () => render(container, ctx));
    });
  } catch (err) {
    container.querySelector('#indices-table').innerHTML = `<p class="error">Failed to load indices: ${err.message}</p>`;
  }
}

export function destroy() {}
