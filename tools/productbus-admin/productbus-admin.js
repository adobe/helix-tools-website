/**
 * ProductBus Admin - Main entry
 * Handles routing, sidebar, and auth guard
 */

import { registerToolReady } from '../../scripts/scripts.js';
import { getAuthState, clearAuthState, apiFetch } from './api.js';

// ============================================================================
// Query Params
// ============================================================================

function getParams() {
  const p = new URLSearchParams(window.location.search);
  return {
    page: p.get('page') || '',
    org: p.get('org') || '',
    site: p.get('site') || '',
    redirect: p.get('redirect') || '',
  };
}

function setParams(updates) {
  const p = new URLSearchParams(window.location.search);
  Object.entries(updates).forEach(([k, v]) => {
    if (v) p.set(k, v);
    else p.delete(k);
  });
  window.history.pushState({}, '', `${window.location.pathname}?${p.toString()}`);
}

// ============================================================================
// Page modules map (dynamic imports to avoid cycles)
// ============================================================================

const PAGE_MODULES = {
  login: () => import('./login.js'),
  orders: () => import('./orders.js'),
  customers: () => import('./customers.js'),
  indices: () => import('./indices.js'),
  catalog: () => import('./catalog.js'),
  config: () => import('./config.js'),
  journals: () => import('./journals.js'),
  'service-tokens': () => import('./service-tokens.js'),
  admins: () => import('./admins.js'),
};

// ============================================================================
// Sidebar
// ============================================================================

// Forward-declared so renderSidebar and bindConnectForm can reference renderApp
let renderApp;

function bindConnectForm() {
  const form = document.getElementById('connect-form');
  if (!form) return;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const org = form.querySelector('#connect-org').value.trim();
    const site = form.querySelector('#connect-site').value.trim();
    if (!org || !site) return;

    setParams({ org, site });

    const auth = getAuthState(org, site);
    if (!auth) {
      setParams({ page: 'login', org, site });
    } else {
      const params = getParams();
      if (!params.page || params.page === 'login') {
        setParams({ page: 'orders' });
      }
    }
    renderApp();
  });
}

function renderSidebar(org, site, currentPage) {
  const sidebar = document.getElementById('sidebar');
  const auth = getAuthState(org, site);

  const connectForm = `
    <div class="sidebar-connect">
      <h2>ProductBus Admin</h2>
      <form id="connect-form">
        <div class="form-field">
          <label for="connect-org">Organization</label>
          <input type="text" id="connect-org" name="org" required placeholder="my-org" autocomplete="off">
        </div>
        <div class="form-field">
          <label for="connect-site">Site</label>
          <input type="text" id="connect-site" name="site" required placeholder="my-site" autocomplete="off">
        </div>
        <button type="submit" class="button connect-btn">Connect</button>
      </form>
    </div>
  `;

  if (!auth || !org || !site) {
    sidebar.innerHTML = connectForm;
    bindConnectForm();
    return;
  }

  const navLinks = [
    { id: 'orders', label: 'Orders' },
    { id: 'customers', label: 'Customers' },
    { id: 'indices', label: 'Indices' },
    { id: 'catalog', label: 'Catalog' },
    { id: 'config', label: 'Config' },
  ];

  const isAdmin = auth.roles && (auth.roles.includes('admin') || auth.roles.includes('superuser'));
  if (isAdmin) {
    navLinks.push({ id: 'journals', label: 'Journals' });
    navLinks.push({ id: 'service-tokens', label: 'Service Tokens' });
  }

  if (auth.roles && auth.roles.includes('superuser')) {
    navLinks.push({ id: 'admins', label: 'Admins' });
  }

  sidebar.innerHTML = `
    ${connectForm}
    <ul class="sidebar-nav">
      ${navLinks.map((link) => `
        <li>
          <a href="?page=${link.id}&org=${org}&site=${site}"
             class="${currentPage === link.id ? 'active' : ''}"
             data-page="${link.id}">
            <span>${link.label}</span>
          </a>
        </li>
      `).join('')}
    </ul>
    <div class="sidebar-footer">
      <span class="sidebar-email">${auth.email}</span>
      <button type="button" class="button outline" id="logout-btn">Logout</button>
    </div>
  `;

  bindConnectForm();

  sidebar.querySelectorAll('a[data-page]').forEach((link) => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      // Switching pages wipes view-specific query params so shared URLs only
      // carry the state the target view itself writes back in.
      const p = new URLSearchParams();
      if (org) p.set('org', org);
      if (site) p.set('site', site);
      p.set('page', link.dataset.page);
      window.history.pushState({}, '', `${window.location.pathname}?${p.toString()}`);
      renderApp();
    });
  });

  sidebar.querySelector('#logout-btn').addEventListener('click', async () => {
    try {
      await apiFetch(org, site, 'auth/logout', { method: 'POST' });
    } catch (e) {
      // ignore
    }
    clearAuthState(org, site);
    setParams({ page: 'login', redirect: '' });
    renderApp();
  });
}

// ============================================================================
// Router
// ============================================================================

let currentModule = null;

async function renderPage(page, org, site) {
  const mainContent = document.getElementById('main-content');

  if (currentModule && currentModule.destroy) {
    currentModule.destroy();
  }

  const loader = PAGE_MODULES[page];
  if (!loader) {
    mainContent.innerHTML = '<p class="error">Page not found</p>';
    return;
  }

  try {
    currentModule = await loader();
    await currentModule.render(mainContent, { org, site });
  } catch (err) {
    mainContent.innerHTML = `<p class="error">Failed to load page: ${err.message}</p>`;
  }
}

// ============================================================================
// Main render
// ============================================================================

renderApp = function renderAppFn() {
  const { page, org, site } = getParams();

  if (!org || !site) {
    renderSidebar('', '', '');
    document.getElementById('main-content').innerHTML = `
      <div class="empty-state">
        <h3>Welcome to ProductBus Admin</h3>
        <p>Enter your organization and site in the sidebar to get started</p>
      </div>
    `;
    return;
  }

  const auth = getAuthState(org, site);

  if (!auth && page !== 'login') {
    const currentUrl = window.location.href;
    setParams({ page: 'login', redirect: currentUrl });
    renderSidebar(org, site, 'login');
    renderPage('login', org, site);
    return;
  }

  const activePage = page || (auth ? 'orders' : 'login');
  if (!page) {
    setParams({ page: activePage });
  }

  renderSidebar(org, site, activePage);
  renderPage(activePage, org, site);
};

// ============================================================================
// Init
// ============================================================================

async function init() {
  const stageParam = new URLSearchParams(window.location.search).get('stage');
  if (stageParam === 'true') {
    sessionStorage.setItem('productbus-stage', 'true');
  } else if (stageParam === 'false') {
    sessionStorage.removeItem('productbus-stage');
  }

  const container = document.getElementById('app-container');

  const sidebar = document.createElement('nav');
  sidebar.id = 'sidebar';
  sidebar.setAttribute('aria-label', 'ProductBus Admin');

  const mainContent = document.createElement('div');
  mainContent.id = 'main-content';

  container.append(sidebar, mainContent);

  renderApp();
  window.addEventListener('popstate', () => renderApp());
}

registerToolReady(init());
