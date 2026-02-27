const PROJECTS_KEY = 'aem-projects';
const THEME_KEY = 'aem-theme-preference';
const FAVORITES_KEY_PREFIX = 'aem-favorites-';
const SIDEBAR_KEY = 'aem-sidebar-collapsed';

export function getProjects() {
  try {
    const raw = localStorage.getItem(PROJECTS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        orgs: parsed.orgs || [],
        sites: parsed.sites || {},
      };
    }
  } catch {
    // ignore
  }
  return { orgs: [], sites: {} };
}

export function saveProjects(projects) {
  localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects));
}

export function addProject(org, site) {
  const projects = getProjects();
  projects.orgs = [org, ...projects.orgs.filter((o) => o !== org)];
  if (site) {
    if (!projects.sites[org]) {
      projects.sites[org] = [];
    }
    projects.sites[org] = [site, ...projects.sites[org].filter((s) => s !== site)];
  }
  saveProjects(projects);
  return projects;
}

export function removeProject(org, site) {
  const projects = getProjects();
  if (projects.sites[org]) {
    projects.sites[org] = projects.sites[org].filter((s) => s !== site);
    if (projects.sites[org].length === 0) {
      delete projects.sites[org];
      projects.orgs = projects.orgs.filter((o) => o !== org);
    }
  }
  saveProjects(projects);
  return projects;
}

export function removeOrg(org) {
  const projects = getProjects();
  projects.orgs = projects.orgs.filter((o) => o !== org);
  delete projects.sites[org];
  saveProjects(projects);
  return projects;
}

export function clearProjects() {
  localStorage.removeItem(PROJECTS_KEY);
}

export function getLastOrg() {
  const projects = getProjects();
  return projects.orgs[0] || null;
}

export function getLocalSites(org) {
  const projects = getProjects();
  return projects.sites[org] || [];
}

export function getThemePreference() {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    // ignore
  }
  return null;
}

export function setThemePreference(theme) {
  try {
    if (theme === null || theme === 'system') {
      localStorage.removeItem(THEME_KEY);
    } else {
      localStorage.setItem(THEME_KEY, theme);
    }
  } catch {
    // ignore
  }
}

export function getFavorites(org) {
  try {
    const raw = localStorage.getItem(`${FAVORITES_KEY_PREFIX}${org}`);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function toggleFavorite(org, site) {
  const favs = getFavorites(org);
  const idx = favs.indexOf(site);
  if (idx >= 0) {
    favs.splice(idx, 1);
  } else {
    favs.push(site);
  }
  localStorage.setItem(`${FAVORITES_KEY_PREFIX}${org}`, JSON.stringify(favs));
  return favs;
}

export function getSidebarCollapsed() {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setSidebarCollapsed(collapsed) {
  try {
    if (collapsed) {
      localStorage.setItem(SIDEBAR_KEY, 'true');
    } else {
      localStorage.removeItem(SIDEBAR_KEY);
    }
  } catch {
    // ignore
  }
}

const CDN_HEALTH_KEY_PREFIX = 'aem-cdn-health-';

export function getCdnHealthResult(org, site) {
  try {
    const raw = localStorage.getItem(`${CDN_HEALTH_KEY_PREFIX}${org}-${site}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveCdnHealthResult(org, site, result) {
  try {
    localStorage.setItem(`${CDN_HEALTH_KEY_PREFIX}${org}-${site}`, JSON.stringify({
      ...result,
      timestamp: Date.now(),
    }));
  } catch {
    // ignore
  }
}
