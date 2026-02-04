/**
 * Admin Context Manager
 * Manages the current admin context (org, site, ref) and provides
 * subscription mechanism for context changes.
 */

import { CONTEXT_STORAGE_KEY, PROJECTS_STORAGE_KEY } from './constants.js';

/**
 * @typedef {Object} AdminContext
 * @property {string} org - Organization name
 * @property {string} site - Site name
 * @property {string} ref - Git reference (branch), defaults to 'main'
 */

/**
 * @typedef {Object} ProjectsData
 * @property {string[]} orgs - List of organizations (most recent first)
 * @property {Object.<string, string[]>} sites - Map of org to site arrays (most recent first)
 */

// Event name for context changes
export const CONTEXT_CHANGE_EVENT = 'aem-context-change';

/**
 * Get context from legacy aem-projects storage format.
 * @returns {AdminContext}
 */
function getContextFromLegacyStorage() {
  try {
    const projects = JSON.parse(localStorage.getItem(PROJECTS_STORAGE_KEY));
    if (projects && projects.orgs && projects.orgs.length > 0) {
      const org = projects.orgs[0];
      const sites = projects.sites?.[org] || [];
      return {
        org,
        site: sites[0] || '',
        ref: 'main',
      };
    }
  } catch (e) {
    // Ignore parse errors
  }
  return { org: '', site: '', ref: 'main' };
}

/**
 * Update the legacy aem-projects storage format.
 * @param {string} org - Organization name
 * @param {string} site - Site name
 */
function updateLegacyStorage(org, site) {
  if (!org) return;

  try {
    let projects = JSON.parse(localStorage.getItem(PROJECTS_STORAGE_KEY));
    if (!projects) {
      projects = { orgs: [], sites: {} };
    }

    // Ensure org is most recent in orgs array
    projects.orgs = projects.orgs.filter((o) => o !== org);
    projects.orgs.unshift(org);

    // Ensure site is most recent in site array (only if site has a value)
    if (site) {
      if (!projects.sites[org]) {
        projects.sites[org] = [];
      }
      projects.sites[org] = projects.sites[org].filter((s) => s !== site);
      projects.sites[org].unshift(site);
    }

    localStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(projects));
  } catch (e) {
    // Ignore storage errors
  }
}

/**
 * Dispatch a context change event.
 * @param {AdminContext} context - The new context
 */
function dispatchContextChange(context) {
  const event = new CustomEvent(CONTEXT_CHANGE_EVENT, {
    detail: context,
    bubbles: true,
  });
  window.dispatchEvent(event);
}

/**
 * Get the current admin context from storage.
 * @returns {AdminContext}
 */
export function getContext() {
  try {
    const stored = localStorage.getItem(CONTEXT_STORAGE_KEY);
    if (stored) {
      const context = JSON.parse(stored);
      return {
        org: context.org || '',
        site: context.site || '',
        ref: context.ref || 'main',
      };
    }
  } catch (e) {
    // Ignore parse errors, return defaults
  }

  // Fall back to legacy aem-projects format
  return getContextFromLegacyStorage();
}

/**
 * Set the admin context and dispatch a change event.
 * @param {Partial<AdminContext>} context - Context values to update
 * @param {Object} [options] - Options
 * @param {boolean} [options.silent=false] - If true, don't dispatch change event
 */
export function setContext(context, options = {}) {
  const current = getContext();
  const updated = {
    org: context.org !== undefined ? context.org : current.org,
    site: context.site !== undefined ? context.site : current.site,
    ref: context.ref !== undefined ? context.ref : current.ref,
  };

  localStorage.setItem(CONTEXT_STORAGE_KEY, JSON.stringify(updated));

  // Also update legacy storage for backwards compatibility
  updateLegacyStorage(updated.org, updated.site);

  if (!options.silent) {
    dispatchContextChange(updated);
  }
}

/**
 * Subscribe to context changes.
 * @param {function(AdminContext): void} callback - Called when context changes
 * @returns {function(): void} Unsubscribe function
 */
export function subscribeToContext(callback) {
  const handler = (event) => {
    callback(event.detail);
  };
  window.addEventListener(CONTEXT_CHANGE_EVENT, handler);
  return () => window.removeEventListener(CONTEXT_CHANGE_EVENT, handler);
}

/**
 * Get the list of known organizations (from legacy storage).
 * @returns {string[]}
 */
export function getKnownOrgs() {
  try {
    const projects = JSON.parse(localStorage.getItem(PROJECTS_STORAGE_KEY));
    return projects?.orgs || [];
  } catch (e) {
    return [];
  }
}

/**
 * Get the list of known sites for an organization (from legacy storage).
 * @param {string} org - Organization name
 * @returns {string[]}
 */
export function getKnownSites(org) {
  try {
    const projects = JSON.parse(localStorage.getItem(PROJECTS_STORAGE_KEY));
    return projects?.sites?.[org] || [];
  } catch (e) {
    return [];
  }
}

/**
 * Add organizations and sites from sidekick to the known projects.
 * @param {Array<{org: string, site: string}>} projects - Projects from sidekick
 */
export function addProjectsFromSidekick(projects) {
  if (!Array.isArray(projects) || projects.length === 0) return;

  try {
    let aemProjects = JSON.parse(localStorage.getItem(PROJECTS_STORAGE_KEY));
    if (!aemProjects) {
      aemProjects = { orgs: [], sites: {} };
    }

    projects.forEach(({ org, site }) => {
      if (!aemProjects.orgs.includes(org)) {
        aemProjects.orgs.push(org);
      }

      if (!aemProjects.sites[org]) {
        aemProjects.sites[org] = [];
      }

      if (!aemProjects.sites[org].includes(site)) {
        aemProjects.sites[org].push(site);
      }
    });

    localStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(aemProjects));
  } catch (e) {
    // Ignore storage errors
  }
}

/**
 * Check if context has required values.
 * @param {AdminContext} context - Context to check
 * @param {Object} [requirements] - What fields are required
 * @param {boolean} [requirements.org=true] - Require org
 * @param {boolean} [requirements.site=true] - Require site
 * @param {boolean} [requirements.ref=false] - Require ref
 * @returns {boolean}
 */
export function isContextValid(context, requirements = {}) {
  const { org = true, site = true, ref = false } = requirements;
  if (org && !context.org) return false;
  if (site && !context.site) return false;
  if (ref && !context.ref) return false;
  return true;
}

/**
 * Get context from URL parameters (for tool-specific overrides).
 * @param {URLSearchParams} [params] - URL params (defaults to current URL)
 * @returns {Partial<AdminContext>}
 */
export function getContextFromParams(params = new URLSearchParams(window.location.search)) {
  const context = {};
  const org = params.get('org');
  const site = params.get('site');
  const ref = params.get('ref');

  if (org) context.org = org;
  if (site) context.site = site;
  if (ref) context.ref = ref;

  return context;
}

/**
 * Get effective context (URL params override stored context).
 * @returns {AdminContext}
 */
export function getEffectiveContext() {
  const stored = getContext();
  const params = getContextFromParams();

  return {
    org: params.org || stored.org,
    site: params.site || stored.site,
    ref: params.ref || stored.ref,
  };
}

/**
 * Update URL parameters to reflect context.
 * @param {AdminContext} context - Context to reflect in URL
 * @param {Object} [options] - Options
 * @param {boolean} [options.replace=true] - Use replaceState instead of pushState
 */
export function updateUrlParams(context, options = {}) {
  const { replace = true } = options;
  const url = new URL(window.location.href);

  // Clear existing params
  url.searchParams.delete('org');
  url.searchParams.delete('site');
  url.searchParams.delete('ref');

  // Set new params
  if (context.org) url.searchParams.set('org', context.org);
  if (context.site) url.searchParams.set('site', context.site);
  if (context.ref && context.ref !== 'main') {
    url.searchParams.set('ref', context.ref);
  }

  if (replace) {
    window.history.replaceState({}, document.title, url.href);
  } else {
    window.history.pushState({}, document.title, url.href);
  }
}
