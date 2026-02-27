const ORG_PAGES = new Set(['users', 'secrets', 'api-keys', 'versions']);

const ORG_VIEW_MAP = {
  users: 'org-users',
  secrets: 'org-secrets',
  'api-keys': 'org-api-keys',
  versions: 'org-versions',
};

const SITE_VIEW_MAP = {
  users: 'site-users',
  secrets: 'site-secrets',
  'api-keys': 'site-api-keys',
  versions: 'site-versions',
  cdn: 'site-cdn',
  config: 'site-config',
  access: 'site-access',
  index: 'site-index',
  sitemaps: 'site-sitemaps',
  headers: 'site-headers',
  robots: 'site-robots',
  sidekick: 'site-sidekick',
  status: 'site-status',
  snapshots: 'site-snapshots',
  bulk: 'site-bulk',
  logs: 'site-logs',
};

export function getRouteDetails() {
  const hash = window.location.hash.replace('#', '') || '/';
  const parts = hash.split('/').filter(Boolean);

  if (parts.length === 0) {
    return { view: 'landing', org: null, site: null, page: null };
  }

  const [org, second, third] = parts;

  if (!second) {
    return { view: 'org-dashboard', org, site: null, page: null };
  }

  if (ORG_PAGES.has(second)) {
    return { view: ORG_VIEW_MAP[second], org, site: null, page: second };
  }

  const site = second;
  const page = third;

  if (!page) {
    return { view: 'site-overview', org, site, page: null };
  }

  return {
    view: SITE_VIEW_MAP[page] || 'site-overview',
    org,
    site,
    page,
  };
}

export function navigate(path) {
  window.location.hash = path.startsWith('#') ? path : `#${path}`;
}
