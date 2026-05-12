/**
 * OpTel dashboard domain key from URL or incognito-checkbox (browser context only).
 */

const BUNDLES_API = 'https://bundles.aem.page';

export function getEffectiveDomainKey() {
  const fromUrl = new URLSearchParams(window.location.search).get('domainkey');
  if (fromUrl && fromUrl !== 'incognito') return fromUrl;
  const checkbox = document.querySelector('incognito-checkbox');
  const fromEl = checkbox?.getAttribute('domainkey');
  if (fromEl && fromEl !== 'incognito') return fromEl;
  return '';
}

/** Dashboard could not issue a key (e.g. domain not entitled). */
function isIncognitoCheckboxError() {
  return document.querySelector('incognito-checkbox')?.getAttribute('mode') === 'error';
}

export function hasValidDomainKey() {
  const key = getEffectiveDomainKey();
  if (!key) return false;
  if (isIncognitoCheckboxError()) return false;
  return true;
}

export function getPageDomain() {
  return new URLSearchParams(window.location.search).get('domain') || '';
}

/** Same day-bundle URL shape as OpTel loader / incognito-checkbox probe. */
function buildDayBundleProbeUrl(domain, domainKey) {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const datePath = `${y}/${m}/${d}`;
  if (domain.endsWith(':all') && domain !== 'aem.live:all') {
    const [org] = domain.split(':');
    return `${BUNDLES_API}/orgs/${org}/bundles/${datePath}?domainkey=${encodeURIComponent(domainKey)}`;
  }
  return `${BUNDLES_API}/bundles/${domain}/${datePath}?domainkey=${encodeURIComponent(domainKey)}`;
}

/**
 * True if bundles API accepts this domain key for the current domain (today’s slice).
 * Catches wrong keys pasted into the URL while still non-incognito.
 */
export async function validateDomainKeyWithBundles() {
  const domain = getPageDomain();
  const domainKey = getEffectiveDomainKey();
  if (!domainKey) return false;
  try {
    const res = await fetch(buildDayBundleProbeUrl(domain, domainKey));
    return res.ok;
  } catch {
    return false;
  }
}
