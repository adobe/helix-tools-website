import { registerToolReady } from '../../scripts/scripts.js';
import { initConfigField } from '../../utils/config/config.js';
import { logResponse } from '../../blocks/console/console.js';
import { ensureLogin } from '../../blocks/profile/profile.js';
import { VIEW_STORAGE_KEY } from './helpers/constants.js';
import { fetchSites, getSitePath, adminFetch } from './helpers/api-helper.js';
import {
  loadIcon,
  icon,
  getFavorites,
  getContentSourceType,
  getDAEditorURL,
} from './helpers/utils.js';
import { openAddSiteModal } from './helpers/modals.js';
import createSiteCard from './helpers/site-card.js';

const org = document.getElementById('org');
const site = document.getElementById('site');
const consoleBlock = document.querySelector('.console');
const sitesElem = document.querySelector('div#sites');
const siteNotFoundHint = document.querySelector('.site-not-found-hint');

// Logging wrapper for API calls
const logFn = (status, details) => logResponse(consoleBlock, status, details);

const hideSiteNotFoundHint = () => {
  siteNotFoundHint.hidden = true;
  siteNotFoundHint.textContent = '';
};

const showSiteNotFoundHint = (siteName, orgValue) => {
  siteNotFoundHint.textContent = `Site "${siteName}" not found in Organization "${orgValue}"`;
  siteNotFoundHint.hidden = false;
};

const applyDetailsToCard = (card, details) => {
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
      card.querySelector('.auth-icon.auth-preview')?.removeAttribute('aria-hidden');
    }
    if (hasLiveAuth) {
      card.querySelector('.auth-icon.auth-live')?.removeAttribute('aria-hidden');
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
};

const populateCardDetails = async (card, orgValue) => {
  const siteName = card.dataset.site;
  const resp = await adminFetch(getSitePath(orgValue, siteName), {}, logFn);
  if (!resp.ok) return;
  const details = await resp.json();
  applyDetailsToCard(card, details);
};

const findCardBySite = (name) => sitesElem.querySelector(`.site-card[data-site="${CSS.escape(name)}"]`);

const updateSiteCount = () => {
  const countEl = sitesElem.querySelector('.sites-count');
  const total = sitesElem.querySelectorAll('.site-card').length;
  if (countEl) countEl.textContent = `${total} site${total !== 1 ? 's' : ''}`;
};

let detailsObserver;

const displaySites = (sites, { limitedAccess = false } = {}) => {
  sitesElem.removeAttribute('aria-hidden');
  sitesElem.textContent = '';

  const selectedSite = new URLSearchParams(window.location.search).get('site');
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
    if (selectedSite) {
      if (a.name === selectedSite) return -1;
      if (b.name === selectedSite) return 1;
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
    const card = createSiteCard(s, org.value, { limitedAccess });
    grid.appendChild(card);
    if (s.details) {
      applyDetailsToCard(card, s.details);
    } else {
      detailsObserver.observe(card);
    }
  });

  sitesElem.appendChild(grid);

  if (selectedSite) {
    const selectedCard = findCardBySite(selectedSite);
    if (selectedCard) {
      selectedCard.classList.add('selected');
    } else {
      showSiteNotFoundHint(selectedSite, org.value);
    }
  }
};

const showAccessMessage = (text) => {
  sitesElem.removeAttribute('aria-hidden');
  const msg = document.createElement('p');
  msg.className = 'access-message';
  msg.textContent = text;
  sitesElem.appendChild(msg);
};

const displaySitesForOrg = async (orgValue) => {
  sitesElem.setAttribute('aria-hidden', 'true');
  sitesElem.replaceChildren();
  hideSiteNotFoundHint();

  const selectedSite = new URLSearchParams(window.location.search).get('site');
  const { sites, status } = await fetchSites(orgValue, logFn);

  if (status === 200 && sites) {
    displaySites(sites);
  } else if (status === 401) {
    const loggedIn = await ensureLogin(orgValue);
    if (loggedIn) {
      return displaySitesForOrg(orgValue);
    }
  } else if (status === 403 && selectedSite) {
    const siteResp = await adminFetch(getSitePath(orgValue, selectedSite), {}, logFn);
    if (siteResp.ok) {
      const details = await siteResp.json();
      displaySites([{ name: selectedSite, details }], { limitedAccess: true });
    } else if (siteResp.status === 401) {
      const loggedIn = await ensureLogin(orgValue, selectedSite);
      if (loggedIn) {
        return displaySitesForOrg(orgValue);
      }
    } else if (siteResp.status === 403 || siteResp.status === 404) {
      showAccessMessage(`Site "${selectedSite}" isn't available in org "${orgValue}". It may not exist, or you may not have access to it.`);
    } else {
      showAccessMessage(`Failed to load site "${selectedSite}" (HTTP ${siteResp.status}).`);
    }
  } else if (status === 403) {
    showAccessMessage("You're not an admin of this org. Enter a site name above to manage just that site.");
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

  displaySitesForOrg(orgValue);
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

  const form = document.getElementById('site-admin-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const { submitter } = e;

    const orgValue = org.value;
    if (!orgValue) return;

    const url = new URL(window.location.href);
    url.searchParams.set('org', orgValue);
    const siteValue = site.value.trim() || '';
    if (siteValue) url.searchParams.set('site', siteValue);
    else url.searchParams.delete('site');
    window.history.replaceState({}, document.title, url.href);

    const loggedIn = await ensureLogin(orgValue, siteValue || undefined);
    if (!loggedIn) {
      window.addEventListener('profile-update', ({ detail: loginInfo }) => {
        if (loginInfo.includes(orgValue)) submitter?.click();
      }, { once: true });
      return;
    }

    displaySitesForOrg(orgValue);
  });

  form.addEventListener('reset', hideSiteNotFoundHint);

  const params = new URLSearchParams(window.location.search);
  if (params.get('org')) {
    org.value = params.get('org');
    if (params.get('site')) site.value = params.get('site');
    document.getElementById('list').click();
  }
};

registerToolReady(initSiteAdmin());
