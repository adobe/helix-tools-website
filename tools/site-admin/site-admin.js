import { registerToolReady } from '../../scripts/scripts.js';
import { onConfigReady, getConsoleLogger } from '../../utils/tool-config.js';
import { VIEW_STORAGE_KEY } from './helpers/constants.js';
import { fetchSites, fetchSiteDetails } from './helpers/api-helper.js';
import {
  loadIcon,
  icon,
  getFavorites,
  getContentSourceType,
  getDAEditorURL,
} from './helpers/utils.js';
import { openAddSiteModal } from './helpers/modals.js';
import createSiteCard from './helpers/site-card.js';

const sitesElem = document.querySelector('div#sites');
const logFn = getConsoleLogger();

const displaySites = (sites, orgValue) => {
  sitesElem.ariaHidden = false;
  sitesElem.textContent = '';

  const savedView = localStorage.getItem(VIEW_STORAGE_KEY) || 'grid';

  const header = document.createElement('div');
  header.className = 'sites-header';
  header.innerHTML = `
    <span class="sites-count">${sites.length} site${sites.length !== 1 ? 's' : ''}</span>
    <div class="sites-actions">
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
      <button class="button add-site-btn">+ Add Site</button>
    </div>
  `;

  header.querySelector('.add-site-btn').addEventListener('click', () => openAddSiteModal(orgValue, '', '', logFn));

  sitesElem.appendChild(header);

  const grid = document.createElement('div');
  grid.className = `sites-grid ${savedView === 'list' ? 'list-view' : ''}`;

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

  const favorites = getFavorites(orgValue);
  const sortedSites = [...sites].sort((a, b) => {
    const aFav = favorites.includes(a.name);
    const bFav = favorites.includes(b.name);
    if (aFav && !bFav) return -1;
    if (!aFav && bFav) return 1;
    return a.name.localeCompare(b.name);
  });

  sortedSites.forEach((site) => {
    const card = createSiteCard(site, orgValue);
    grid.appendChild(card);

    fetchSiteDetails(orgValue, site.name).then((details) => {
      if (details) {
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

        const hasPreviewAuth = details.access?.site || details.access?.preview;
        const hasLiveAuth = details.access?.site || details.access?.live;
        const hasAnyAuth = hasPreviewAuth || hasLiveAuth;

        if (hasAnyAuth) {
          card.dataset.hasAuth = 'true';
          const lighthouseBtn = card.querySelector('.menu-item[data-action="lighthouse"]');
          lighthouseBtn.disabled = true;
          lighthouseBtn.title = 'Lighthouse unavailable for authenticated sites';

          if (hasPreviewAuth) {
            card.querySelector('.auth-icon.auth-preview').removeAttribute('aria-hidden');
          }
          if (hasLiveAuth) {
            card.querySelector('.auth-icon.auth-live').removeAttribute('aria-hidden');
          }
        }

        const cdnHost = details.cdn?.prod?.host || details.cdn?.host;
        if (cdnHost) {
          const cdnEl = card.querySelector('.site-card-cdn');
          cdnEl.querySelector('span').textContent = cdnHost;
          cdnEl.href = `https://${cdnHost}`;
          cdnEl.classList.add('visible');
        }
      }
    });
  });

  sitesElem.appendChild(grid);
};

const displaySitesForOrg = async (orgValue) => {
  sitesElem.setAttribute('aria-hidden', 'true');
  sitesElem.replaceChildren();

  const { sites, status } = await fetchSites(orgValue, logFn);

  if (status === 200 && sites) {
    displaySites(sites, orgValue);
  } else {
    sitesElem.removeAttribute('aria-hidden');
    const wrapper = document.createElement('div');
    wrapper.className = 'sites-error';
    wrapper.textContent = `Failed to load sites for "${orgValue}" (HTTP ${status}). Check the activity log for details.`;
    sitesElem.appendChild(wrapper);
  }
};

window.addEventListener('sites-refresh', (e) => {
  displaySitesForOrg(e.detail.orgValue);
});

const initSiteAdmin = async () => {
  const neededIcons = [
    'code', 'document', 'edit', 'copy', 'external', 'trash', 'key',
    'check', 'more-vertical', 'shield', 'lock', 'activity',
    'user', 'search', 'grid', 'list', 'star',
  ];
  await Promise.all(neededIcons.map(loadIcon));

  onConfigReady(({ org, authenticated }) => {
    if (org && authenticated) displaySitesForOrg(org);
  }, { orgOnly: true, authRequired: true });
};

registerToolReady(initSiteAdmin());
