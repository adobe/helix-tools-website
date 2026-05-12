import { messageSidekick } from '../sidekick.js';

const STORAGE_KEY = 'aem-projects';

/**
 * Reads the stored projects from localStorage.
 * The `aem-projects` key has shape `{ orgs: string[], sites: { [org]: string[] } }`.
 * @returns {{ orgs: string[], sitesByOrg: Record<string, string[]> }}
 */
function cleanList(arr) {
  return Array.isArray(arr) ? arr.filter((v) => typeof v === 'string' && v.trim() !== '') : [];
}

export function readStoredProjects() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (parsed && Array.isArray(parsed.orgs)) {
      const orgs = cleanList(parsed.orgs);
      const sitesByOrg = {};
      orgs.forEach((org) => { sitesByOrg[org] = cleanList(parsed.sites?.[org]); });
      return { orgs, sitesByOrg };
    }
  } catch (e) {
    // ignore parse errors and fall through to the default
  }
  return { orgs: [], sitesByOrg: {} };
}

/**
 * Merges sidekick-provided projects into the `aem-projects` localStorage entry.
 * New orgs are appended; new sites are appended under their org.
 * @param {{ org: string, site: string }[]} projects
 */
function mergeSidekickProjects(projects) {
  let stored = null;
  try {
    stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
  } catch (e) {
    stored = null;
  }
  if (!stored || !Array.isArray(stored.orgs)) {
    stored = { orgs: [], sites: {} };
  }
  if (!stored.sites) stored.sites = {};

  projects.forEach(({ org, site }) => {
    if (!org) return;
    if (!stored.orgs.includes(org)) stored.orgs.push(org);
    if (!stored.sites[org]) stored.sites[org] = [];
    if (site && !stored.sites[org].includes(site)) stored.sites[org].push(site);
  });

  localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
}

/**
 * Loads the known org/site projects: reads localStorage, then merges in any projects
 * reported by the AEM Sidekick extension (`getSites`), and returns the merged result.
 * @returns {Promise<{ orgs: string[], sitesByOrg: Record<string, string[]> }>}
 */
export async function loadProjects() {
  const sidekickProjects = await messageSidekick({ action: 'getSites' });
  if (Array.isArray(sidekickProjects) && sidekickProjects.length > 0) {
    mergeSidekickProjects(sidekickProjects);
  }
  return readStoredProjects();
}

/**
 * Updates local storage with most recently used org and site.
 * @param {string} org - Organization name.
 * @param {string} site - Site name within org.
 */
export function updateStorage(org, site) {
  const projects = JSON.parse(localStorage.getItem(STORAGE_KEY));
  if (projects) {
    // ensure org is most recent in orgs array
    if (projects.orgs.includes(org)) {
      projects.orgs = projects.orgs.filter((o) => o !== org);
    }
    projects.orgs.unshift(org);
    // ensure site is most recent in site array (only if site has a value)
    if (site) {
      if (projects.sites[org]) {
        if (projects.sites[org].includes(site)) {
          projects.sites[org] = projects.sites[org].filter((s) => s !== site);
        }
        projects.sites[org].unshift(site);
      } else {
        projects.sites[org] = [site];
      }
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
  } else {
    // init project org and site storage
    const project = {
      orgs: [org],
      sites: site ? { [org]: [site] } : {},
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
  }
}

export function getProjectFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return { org: params.get('org') || '', site: params.get('site') || '' };
}
