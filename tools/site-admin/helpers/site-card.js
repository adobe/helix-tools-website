import {
  icon,
  isFavorite,
  toggleFavorite,
  getFavorites,
  getContentSourceType,
  showToast,
} from './utils.js';
import { renderPsiScores, runPsiForCard } from './psi.js';
import {
  openEditSourceModal,
  openAuthModal,
  openSecretModal,
  openApiKeyModal,
  openAddSiteModal,
  deleteSiteAndRefresh,
} from './modals.js';

/* eslint-disable no-alert, no-restricted-globals */

/**
 * Create a site card element
 * @param {Object} site - Site object with name property
 * @param {string} orgValue - Organization value
 * @returns {HTMLElement} The site card element
 */
export default function createSiteCard(site, orgValue) {
  const card = document.createElement('div');
  card.className = 'site-card';
  card.dataset.site = site.name;

  const previewUrl = `https://main--${site.name}--${orgValue}.aem.page/`;
  const liveUrl = `https://main--${site.name}--${orgValue}.aem.live/`;
  const sourceType = getContentSourceType(null, null, true);
  const favorited = isFavorite(orgValue, site.name);
  if (favorited) card.classList.add('favorited');

  card.innerHTML = `
    <div class="site-card-top">
      <div class="site-card-header">
        <h3 class="site-card-name">${site.name}</h3>
        <span class="source-badge source-${sourceType.type}" title="Loading...">${sourceType.label}</span>
      </div>
      <div class="card-actions">
        <button type="button" class="favorite-btn ${favorited ? 'active' : ''}" aria-label="Favorite" title="${favorited ? 'Remove from favorites' : 'Add to favorites'}">${icon('star')}</button>
        <button type="button" class="menu-trigger" aria-label="Site actions">${icon('more-vertical')}</button>
        <div class="menu-dropdown">
          <button type="button" class="menu-item" data-action="clone">${icon('copy')}<span>Clone Site Config</span></button>
          <div class="menu-divider"></div>
          <button type="button" class="menu-item" data-action="lighthouse">${icon('activity')}<span>Run Lighthouse</span></button>
          <button type="button" class="menu-item" data-action="sitemap">${icon('document')}<span>Manage Sitemaps</span></button>
          <button type="button" class="menu-item" data-action="index">${icon('search')}<span>Manage Indexes</span></button>
          <button type="button" class="menu-item" data-action="robots">${icon('document')}<span>Manage robots.txt</span></button>
          <button type="button" class="menu-item" data-action="headers">${icon('code')}<span>HTTP Headers</span></button>
          <div class="menu-divider"></div>
          <button type="button" class="menu-item" data-action="users">${icon('user')}<span>Manage Users</span></button>
          <button type="button" class="menu-item" data-action="auth">${icon('shield')}<span>Authentication</span></button>
          <button type="button" class="menu-item" data-action="secret">${icon('lock')}<span>Manage Secrets</span></button>
          <button type="button" class="menu-item" data-action="apikey">${icon('key')}<span>Manage API Keys</span></button>
          <div class="menu-divider"></div>
          <button type="button" class="menu-item danger" data-action="delete">${icon('trash')}<span>Delete Site</span></button>
        </div>
      </div>
    </div>
    <a href="#" class="site-card-cdn" target="_blank"><span></span>${icon('external')}</a>
    <div class="site-card-body">
      <div class="site-card-info">
        <div class="site-card-sources">
          <a href="#" class="site-card-source" data-type="code" title="Loading..." target="_blank">
            ${icon('code')}
          </a>
          <a href="#" class="site-card-source" data-type="content" title="Loading..." target="_blank">
            ${icon('document')}
          </a>
        </div>
        <div class="site-card-links">
          <a href="${previewUrl}" target="_blank" class="site-card-link">Preview</a>
          <span class="auth-icon auth-preview" aria-hidden="true" title="Preview requires authentication">${icon('lock')}</span>
          <span class="site-card-links-divider">|</span>
          <a href="${liveUrl}" target="_blank" class="site-card-link">Live</a>
          <span class="auth-icon auth-live" aria-hidden="true" title="Live requires authentication">${icon('lock')}</span>
        </div>
        <div class="site-card-quick-actions">
          <button type="button" class="quick-action-btn" data-action="edit">${icon('edit')} Edit Sources</button>
          <button type="button" class="quick-action-btn" data-action="logs">${icon('search')} View Logs</button>
        </div>
      </div>
      <div class="site-card-right">
        <div class="psi-scores"></div>
      </div>
    </div>
  `;

  const menuTrigger = card.querySelector('.menu-trigger');
  const menuDropdown = card.querySelector('.menu-dropdown');
  const favoriteBtn = card.querySelector('.favorite-btn');

  favoriteBtn.addEventListener('click', (e) => {
    e.stopPropagation();

    const isNowFavorite = toggleFavorite(orgValue, site.name);
    favoriteBtn.classList.toggle('active', isNowFavorite);
    favoriteBtn.title = isNowFavorite ? 'Remove from favorites' : 'Add to favorites';
    card.classList.toggle('favorited', isNowFavorite);

    const grid = card.closest('.sites-grid');
    if (grid) {
      const cards = [...grid.querySelectorAll('.site-card')];
      const favorites = getFavorites(orgValue);

      cards.sort((a, b) => {
        const aFav = favorites.includes(a.dataset.site);
        const bFav = favorites.includes(b.dataset.site);
        if (aFav && !bFav) return -1;
        if (!aFav && bFav) return 1;
        return a.dataset.site.localeCompare(b.dataset.site);
      });

      cards.forEach((c) => grid.appendChild(c));
    }
  });

  menuTrigger.addEventListener('click', (e) => {
    e.stopPropagation();
    const wasOpen = menuDropdown.classList.contains('open');
    document.querySelectorAll('.menu-dropdown.open').forEach((m) => m.classList.remove('open'));
    if (!wasOpen) menuDropdown.classList.add('open');
  });

  document.addEventListener('click', () => menuDropdown.classList.remove('open'));

  const cardActions = card.querySelector('.card-actions');

  cardActions.addEventListener('focusout', (e) => {
    if (!cardActions.contains(e.relatedTarget)) {
      menuDropdown.classList.remove('open');
    }
  });

  const openEditConfig = () => openEditSourceModal(
    orgValue,
    site.name,
    card.dataset.codeUrl || '',
    card.dataset.contentUrl || '',
  );

  const openLogs = () => {
    const url = `/tools/log-viewer/index.html?org=${encodeURIComponent(orgValue)}&site=${encodeURIComponent(site.name)}`;
    window.open(url, '_blank');
  };

  const menuActions = {
    clone: () => openAddSiteModal(orgValue, card.dataset.codeUrl || '', card.dataset.contentUrl || ''),
    sitemap: () => {
      const url = `/tools/sitemap-admin/index.html?org=${encodeURIComponent(orgValue)}&site=${encodeURIComponent(site.name)}`;
      window.open(url, '_blank');
    },
    index: () => {
      const url = `/tools/index-admin/index.html?org=${encodeURIComponent(orgValue)}&site=${encodeURIComponent(site.name)}`;
      window.open(url, '_blank');
    },
    robots: () => {
      const url = `/tools/robots-edit/index.html?org=${encodeURIComponent(orgValue)}&site=${encodeURIComponent(site.name)}`;
      window.open(url, '_blank');
    },
    headers: () => {
      const url = `/tools/headers-edit/index.html?org=${encodeURIComponent(orgValue)}&site=${encodeURIComponent(site.name)}`;
      window.open(url, '_blank');
    },
    lighthouse: () => {
      if (!card.dataset.hasAuth) {
        runPsiForCard(card, site.name, orgValue);
      }
    },
    users: () => {
      const url = `/tools/user-admin/index.html?org=${encodeURIComponent(orgValue)}&site=${encodeURIComponent(site.name)}`;
      window.open(url, '_blank');
    },
    auth: () => openAuthModal(site.name, orgValue),
    secret: () => openSecretModal(site.name, orgValue),
    apikey: () => openApiKeyModal(site.name, orgValue),
    delete: async () => {
      if (confirm(`Delete site "${site.name}"? This cannot be undone.`)) {
        card.classList.add('deleting');
        const success = await deleteSiteAndRefresh(orgValue, site.name, () => {});
        if (success) {
          showToast(`Site "${site.name}" deleted`, 'error');
        } else {
          card.classList.remove('deleting');
          showToast('Failed to delete site', 'error');
        }
      }
    },
  };

  card.querySelectorAll('.quick-action-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (btn.dataset.action === 'edit') openEditConfig();
      if (btn.dataset.action === 'logs') openLogs();
    });
  });

  card.querySelectorAll('.menu-item').forEach((item) => {
    item.addEventListener('click', async (e) => {
      e.stopPropagation();
      menuDropdown.classList.remove('open');
      const handler = menuActions[item.dataset.action];
      if (handler) await handler(item);
    });
  });

  renderPsiScores(card, site.name, orgValue);

  return card;
}
