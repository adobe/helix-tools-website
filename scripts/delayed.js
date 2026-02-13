// Record tool visits for recent tools on landing page
const path = window.location.pathname;
if (path.startsWith('/tools/')) {
  try {
    const visits = JSON.parse(localStorage.getItem('aem-tool-visits') || '[]');
    const title = document.title.split('|')[0].trim();
    const filtered = visits.filter((v) => v.path !== path);
    filtered.unshift({ path, title, ts: Date.now() });
    localStorage.setItem('aem-tool-visits', JSON.stringify(filtered.slice(0, 5)));
  } catch (e) {
    // localStorage not available
  }
}
