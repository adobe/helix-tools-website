/**
 * Get an admin client appropriate for the active API version.
 *
 * @returns {Promise<object|null>}
 */
export default async function getAdminClient() {
  const useH6 = window.localStorage.getItem('use-h6-api') !== null;
  const adminMod = await import(`../scripts/${useH6 ? 'aem' : 'helix'}-admin.js`);
  if (!adminMod?.default) {
    // eslint-disable-next-line no-console
    console.error('Failed to load admin client module');
    return null;
  }
  return adminMod.default;
}
