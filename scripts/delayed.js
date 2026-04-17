// Record tool visits for recent tools on landing page
const normalize = (p) => p.replace(/\/index\.html$/, '/').replace(/^(\/tools\/[^/]+)\.html$/, '$1/');
const path = window.location.pathname;
if (path.startsWith('/tools/') && !window.isErrorPage) {
  try {
    const visits = JSON.parse(localStorage.getItem('aem-tool-visits') || '[]');
    const filtered = visits.filter((v) => normalize(v.path) !== normalize(path));
    filtered.unshift({ path, ts: Date.now() });
    localStorage.setItem('aem-tool-visits', JSON.stringify(filtered.slice(0, 5)));
  } catch (e) {
    // localStorage not available
  }
}
