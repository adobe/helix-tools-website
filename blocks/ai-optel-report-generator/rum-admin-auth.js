/**
 * RUM Admin Authentication - Validates RUM token against bundles API
 */

const BUNDLES_API = 'https://bundles.aem.page';
const TOKEN_KEYS = ['rum-bundler-token', 'rum-admin-token'];

export const getAdminToken = () => TOKEN_KEYS.map((k) => localStorage.getItem(k)).find(Boolean);

export const hasAdminToken = () => !!getAdminToken();

export default async function checkRumAdminAccess() {
  const token = getAdminToken();
  if (!token) return { isAdmin: false };

  try {
    const res = await fetch(`${BUNDLES_API}/domains?suggested=true`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return { isAdmin: res.ok };
  } catch {
    return { isAdmin: false };
  }
}
