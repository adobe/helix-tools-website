const API = 'https://rum.fastly-aem.page';

let token;
const fetchAPI = async (path, opts = {}) => fetch(`${API}${path}`, {
  ...opts,
  headers: {
    Authorization: `Bearer ${token}`,
    ...(opts.headers || {}),
  },
});

/** @type {Console} */
const log = Object.fromEntries(
  Object.entries(console).map(([key, fn]) => {
    if (typeof fn !== 'function') {
      return [key, fn];
    }
    return [key, fn.bind(null, '[admin/orgs.js]')];
  }),
);

const store = new (class {
  /** @type {string[]} */
  orgs = [];

  /** @type {string} */
  selectedOrg = undefined;

  /** @type {boolean} */
  denied = false;

  /** @type {boolean} */
  error = false;

  /**
   * org => orgdata map
   * @type {Map<string, { domains:string[]; helixOrgs:string[]; }>}
   */
  orgDataMap = new Map();

  /** @type {Set<string>} */
  selectedDomains = new Set();

  /** @type {Map<string, string>} */
  orgkeyMap = new Map();

  get orgDomains() {
    return this.orgDataMap.get(this.selectedOrg)?.domains;
  }

  get orgHelixOrgs() {
    return this.orgDataMap.get(this.selectedOrg)?.helixOrgs;
  }

  async init() {
    token = localStorage.getItem('rum-admin-token');
    if (!token) {
      token = localStorage.getItem('rum-bundler-token');
    }
    if (!token) {
      // eslint-disable-next-line no-alert
      token = prompt('Please enter your key');
      if (!token) {
        this.denied = true;
        return;
      }
      localStorage.setItem('rum-admin-token', token);
    }

    const res = await fetchAPI('/orgs');
    if (!res.ok) {
      if ([401, 403].includes(res.status)) {
        this.denied = true;
        localStorage.setItem('rum-admin-token', '');
      } else {
        log.error(`failed to fetch (${res.status}): `, res);
        this.error = true;
      }
      return;
    }

    this.error = false;
    this.denied = false;
    const { orgs } = await res.json();
    this.orgs = orgs;
    log.debug('loaded orgs: ', orgs);

    // if org is selected, load it
    const selectedOrg = new URLSearchParams(window.location.search).get('org');
    if (selectedOrg) {
      await this.setSelectedOrg(selectedOrg);
    }
  }

  async setSelectedOrg(orgId) {
    this.selectedDomains.clear();
    try {
      await this.fetchOrgData(orgId);
    } catch (e) {
      this.error = e.message;
      this.selectedOrg = undefined;
      return false;
    }
    this.selectedOrg = orgId;
    return true;
  }

  selectDomain(domain, selected = true) {
    this.selectedDomains[selected ? 'add' : 'delete'](domain);
    return this.selectedDomains.size;
  }

  async getOrgkey(orgId) {
    if (this.orgkeyMap.has(orgId)) {
      return this.orgkeyMap.get(orgId);
    }

    const res = await fetchAPI(`/orgs/${orgId}/key`);
    if (!res.ok) {
      log.error(`failed to fetch orgkey (${res.status}): `, res);
      throw Error('failed to fetch orgkey');
    }

    const { orgkey } = await res.json();
    this.orgkeyMap.set(orgId, orgkey);
    return orgkey;
  }

  async fetchOrgData(orgId) {
    if (this.orgDataMap.has(orgId)) {
      return this.orgDataMap.get(orgId);
    }

    const res = await fetchAPI(`/orgs/${orgId}`);
    if (!res.ok) {
      log.error(`failed to fetch (${res.status}): `, res);
      throw Error('failed to fetch org');
    }

    // helixOrgs may be undefined until populated
    // rest doesn't have anything now, but maybe in future
    const { domains, helixOrgs = [], ...rest } = await res.json();
    log.debug(`loaded data for '${orgId}'`, domains, helixOrgs);
    this.orgDataMap.set(orgId, { domains, helixOrgs, ...rest });
    return domains;
  }

  /**
   * @param {string} orgId
   * @param {string[]} domains
   * @param {string[]} helixOrgs
   * @returns {Promise<string>} orgkey
   * @throws {Error}
   */
  async createOrg(orgId, domains = [], helixOrgs = []) {
    if (this.orgs.includes(orgId)) {
      throw Error('org already exists');
    }

    // eslint-disable-next-line no-param-reassign
    domains = [...new Set(domains)];
    const res = await fetchAPI('/orgs', {
      method: 'POST',
      body: JSON.stringify({ id: orgId, domains, helixOrgs }),
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) {
      log.error(`failed to create org (${res.status}): `, res);
      throw Error('failed to create org');
    }
    const { orgkey } = await res.json();
    this.orgs.push(orgId);
    this.orgDataMap.set(orgId, { domains, helixOrgs });
    this.orgkeyMap.set(orgId, orgkey);
    return orgkey;
  }

  async addDomainsAndOrgs(orgId, newDomains, newHelixOrgs) {
    const res = await fetchAPI(`/orgs/${orgId}`, {
      method: 'POST',
      body: JSON.stringify({ domains: newDomains, helixOrgs: newHelixOrgs }),
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) {
      log.error(`failed to add domains (${res.status}): `, res);
      throw Error('failed to add domains');
    }
    const { domains: currentDomains, helixOrgs: currentHelixOrgs } = this.orgDataMap.get(orgId);
    const domains = [...new Set([...currentDomains, ...newDomains])];
    const helixOrgs = [...new Set([...currentHelixOrgs, ...newHelixOrgs])];
    this.orgDataMap.set(orgId, { domains, helixOrgs });
    return { domains, helixOrgs };
  }

  async removeDomains(orgId, domains) {
    const removed = {};
    // eslint-disable-next-line no-restricted-syntax
    for (const domain of domains) {
      // eslint-disable-next-line no-await-in-loop
      const res = await fetchAPI(`/orgs/${orgId}/domains/${domain}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        log.error(`failed to remove domain '${domain}' (${res.status}): `, res);
      } else {
        removed[domain] = true;
        this.selectedDomains.delete(domain);
      }
    }
    const { domains: currentDomains, helixOrgs: currentHelixOrgs } = this.orgDataMap.get(orgId);
    const newDomains = currentDomains.filter((d) => !removed[d]);
    this.orgDataMap.set(orgId, { domains: newDomains, helixOrgs: currentHelixOrgs });
    return newDomains;
  }
})();

export { log, store, fetchAPI };
