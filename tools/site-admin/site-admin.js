import { registerToolReady } from '../../scripts/scripts.js';
import { initConfigField } from '../../utils/config/config.js';
import { logResponse } from '../../blocks/console/console.js';
import { ensureLogin } from '../../blocks/profile/profile.js';
import { VIEW_STORAGE_KEY } from './helpers/constants.js';
import { fetchSites, fetchSiteDetails } from './helpers/api-helper.js';
import {
  loadIcon,
  icon,
  getFavorites,
  getContentSourceType,
  getDAEditorURL,
  escapeHtml,
} from './helpers/utils.js';
import { openAddSiteModal } from './helpers/modals.js';
import createSiteCard from './helpers/site-card.js';

const org = document.getElementById('org');
const site = document.getElementById('site');
const consoleBlock = document.querySelector('.console');
const sitesElem = document.querySelector('div#sites');

// Logging wrapper for API calls
const logFn = (status, details) => logResponse(consoleBlock, status, details);

const populateCardDetails = (card, orgValue) => {
  const siteName = card.dataset.site;
  fetchSiteDetails(orgValue, siteName).then((details) => {
    if (!details) return;

    const contentUrl = details.content?.source?.url || '';
    const contentSourceType = details.content?.source?.type || '';
    const codeUrl = details.code?.source?.url || '';
    const sourceType = getContentSourceType(contentUrl, contentSourceType);

    const badge = card.querySelector('.source-badge');
    if (badge) {
      badge.textContent = sourceType.label;
      badge.className = `source-badge source-${sourceType.type}`;
      badge.title = sourceType.type.toUpperCase();
    }

    const codeSource = card.querySelector('.site-card-source[data-type="code"]');
    const contentSource = card.querySelector('.site-card-source[data-type="content"]');
    const contentEditorUrl = getDAEditorURL(contentUrl);

    if (codeSource) {
      codeSource.title = codeUrl || 'Not configured';
      if (codeUrl) codeSource.href = codeUrl;
      else codeSource.removeAttribute('href');
    }
    if (contentSource) {
      contentSource.title = contentUrl || 'Not configured';
      if (contentEditorUrl) contentSource.href = contentEditorUrl;
      else contentSource.removeAttribute('href');
    }

    card.dataset.codeUrl = codeUrl;
    card.dataset.contentUrl = contentUrl;

    const isByogit = details.code?.source?.type === 'byogit'
      || codeUrl.includes('cm-repo.adobe.io');
    if (isByogit) {
      card.dataset.byogitOwner = details.code?.source?.owner || details.code?.owner || '';
      card.dataset.byogitRepo = details.code?.source?.repo || details.code?.repo || '';
    }

    const hasPreviewAuth = details.access?.site || details.access?.preview;
    const hasLiveAuth = details.access?.site || details.access?.live;
    const hasAnyAuth = hasPreviewAuth || hasLiveAuth;

    const lighthouseBtn = card.querySelector('.menu-item[data-action="lighthouse"]');
    if (hasAnyAuth) {
      card.dataset.hasAuth = 'true';
      if (lighthouseBtn) {
        lighthouseBtn.disabled = true;
        lighthouseBtn.title = 'Lighthouse unavailable for authenticated sites';
      }
      if (hasPreviewAuth) {
        card.querySelector('.auth-icon.auth-preview').removeAttribute('aria-hidden');
      }
      if (hasLiveAuth) {
        card.querySelector('.auth-icon.auth-live').removeAttribute('aria-hidden');
      }
    } else {
      delete card.dataset.hasAuth;
      if (lighthouseBtn) {
        lighthouseBtn.disabled = false;
        lighthouseBtn.title = '';
      }
      card.querySelector('.auth-icon.auth-preview')?.setAttribute('aria-hidden', 'true');
      card.querySelector('.auth-icon.auth-live')?.setAttribute('aria-hidden', 'true');
    }

    const cdnHost = details.cdn?.prod?.host || details.cdn?.host;
    const cdnEl = card.querySelector('.site-card-cdn');
    if (cdnHost && cdnEl) {
      cdnEl.querySelector('span').textContent = cdnHost;
      cdnEl.href = `https://${cdnHost}`;
      cdnEl.classList.add('visible');
    } else if (cdnEl) {
      cdnEl.classList.remove('visible');
    }
  });
};

const findCardBySite = (name) => sitesElem.querySelector(`.site-card[data-site="${CSS.escape(name)}"]`);

const updateSiteCount = () => {
  const countEl = sitesElem.querySelector('.sites-count');
  const total = sitesElem.querySelectorAll('.site-card').length;
  if (countEl) countEl.textContent = `${total} site${total !== 1 ? 's' : ''}`;
};

let detailsObserver;

const displaySites = (sites, { limitedAccess = false, pinnedSite = '' } = {}) => {
  sitesElem.ariaHidden = false;
  sitesElem.textContent = '';

  const savedView = localStorage.getItem(VIEW_STORAGE_KEY) || 'grid';

  const header = document.createElement('div');
  header.className = 'sites-header';
  header.innerHTML = `
    <span class="sites-count">${sites.length} site${sites.length !== 1 ? 's' : ''}</span>
    <div class="sites-actions">
      ${sites.length > 1 ? `
        <div class="sites-search">
          <input type="text" placeholder="Search sites..." class="search-input" />
        </div>
        <div class="view-toggle">
          <button type="button" class="view-btn ${savedView === 'grid' ? 'active' : ''}" data-view="grid" title="Grid view">
            ${icon('grid')}
          </button>
          <button type="button" class="view-btn ${savedView === 'list' ? 'active' : ''}" data-view="list" title="List view">
            ${icon('list')}
          </button>
        </div>
      ` : ''}
      ${limitedAccess ? '' : '<button class="button add-site-btn">+ Add Site</button>'}
    </div>
  `;

  if (!limitedAccess) {
    header.querySelector('.add-site-btn').addEventListener('click', () => openAddSiteModal(org.value, '', '', logFn));
  }

  sitesElem.appendChild(header);

  const grid = document.createElement('div');
  grid.className = `sites-grid ${sites.length > 1 && savedView === 'list' ? 'list-view' : ''}`;

  if (sites.length > 1) {
    const searchInput = header.querySelector('.search-input');
    searchInput.addEventListener('input', (e) => {
      const query = e.target.value.toLowerCase().trim();
      grid.querySelectorAll('.site-card').forEach((card) => {
        const siteName = card.dataset.site.toLowerCase();
        card.setAttribute('aria-hidden', !siteName.includes(query));
      });
    });

    header.querySelectorAll('.view-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const { view } = btn.dataset;
        header.querySelectorAll('.view-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        grid.classList.toggle('list-view', view === 'list');
        localStorage.setItem(VIEW_STORAGE_KEY, view);
      });
    });
  }

  const favorites = getFavorites(org.value);
  const sortedSites = [...sites].sort((a, b) => {
    if (pinnedSite) {
      if (a.name === pinnedSite) return -1;
      if (b.name === pinnedSite) return 1;
    }
    const aFav = favorites.includes(a.name);
    const bFav = favorites.includes(b.name);
    if (aFav && !bFav) return -1;
    if (!aFav && bFav) return 1;
    return a.name.localeCompare(b.name);
  });

  if (detailsObserver) detailsObserver.disconnect();
  detailsObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        populateCardDetails(entry.target, org.value);
        detailsObserver.unobserve(entry.target);
      }
    });
  }, { rootMargin: '200px' });

  sortedSites.forEach((s) => {
    const card = createSiteCard(s, org.value, {
      limitedAccess,
      pinned: pinnedSite && s.name === pinnedSite,
    });
    grid.appendChild(card);
    detailsObserver.observe(card);
  });

  sitesElem.appendChild(grid);
};

const displaySitesForOrg = async (orgValue, pinnedSite = '') => {
  sitesElem.setAttribute('aria-hidden', 'true');
  sitesElem.replaceChildren();

  const { sites, status } = await fetchSites(orgValue, logFn);

  if (status === 200 && sites) {
    displaySites(sites, { pinnedSite });
  } else if (status === 401) {
    const loggedIn = await ensureLogin(orgValue);
    if (loggedIn) {
      return displaySitesForOrg(orgValue, pinnedSite);
    }
  } else if (status === 403 && pinnedSite) {
    displaySites([{ name: pinnedSite }], { limitedAccess: true, pinnedSite });
  } else if (status === 403) {
    sitesElem.ariaHidden = false;
    const msg = document.createElement('p');
    msg.className = 'access-message';
    msg.textContent = 'You do not have org admin access. Enter a site name above to manage just that site.';
    sitesElem.appendChild(msg);
  }
  return null;
};

window.addEventListener('sites-refresh', (e) => {
  const { orgValue, action, siteName } = e.detail;

  if (action === 'delete' && siteName) {
    const card = findCardBySite(siteName);
    if (card) card.remove();
    updateSiteCount();
    return;
  }

  if (action === 'update' && siteName) {
    const card = findCardBySite(siteName);
    if (card) populateCardDetails(card, orgValue);
    return;
  }

  if (action === 'add' && siteName) {
    const grid = sitesElem.querySelector('.sites-grid');
    if (grid) {
      const card = createSiteCard({ name: siteName }, orgValue);
      const favorites = getFavorites(orgValue);
      const isFav = favorites.includes(siteName);
      const insertBefore = [...grid.querySelectorAll('.site-card')].find((c) => {
        const cFav = favorites.includes(c.dataset.site);
        if (isFav && !cFav) return true;
        if (!isFav && cFav) return false;
        return c.dataset.site.localeCompare(siteName) > 0;
      });
      if (insertBefore) grid.insertBefore(card, insertBefore);
      else grid.appendChild(card);
      populateCardDetails(card, orgValue);
      updateSiteCount();
    }
    return;
  }

  displaySitesForOrg(orgValue, escapeHtml(site.value || ''));
});

const initSiteAdmin = async () => {
  const neededIcons = [
    'code', 'document', 'edit', 'copy', 'external', 'trash', 'key',
    'check', 'more-vertical', 'shield', 'lock', 'activity',
    'user', 'search', 'grid', 'list', 'star',
  ];
  await Promise.all(neededIcons.map(loadIcon));
  await initConfigField();
  if (!org.value) org.value = localStorage.getItem('org') || 'adobe';
  if (org.value) {
    const pinnedSite = escapeHtml(site.value || '');
    const loggedIn = await ensureLogin(org.value, pinnedSite || undefined);
    if (loggedIn) {
      displaySitesForOrg(org.value, pinnedSite);
    }
  }
};

registerToolReady(initSiteAdmin());
