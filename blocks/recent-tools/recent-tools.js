const EXCLUDE_TOOLS = ['/tools/optel/'];

const TITLE_ID = 'recent-tools-title';

function dedupKey(path) {
  return path.replace(/\/index\.html$/, '/').replace(/^(\/tools\/[^/]+)\.html$/, '$1/');
}

function isExcluded(path) {
  return EXCLUDE_TOOLS.some((prefix) => path.startsWith(prefix));
}

function labelFromPath(path) {
  const parts = path.split('/').filter(Boolean);
  const toolIdx = parts.indexOf('tools');
  if (toolIdx < 0 || toolIdx + 1 >= parts.length) return path;
  const stripExt = (s) => s.replace(/\.[^.]+$/, '');
  const toolName = stripExt(parts[toolIdx + 1]);
  const subParts = parts.slice(toolIdx + 2)
    .map(stripExt)
    .filter((s) => s && s !== 'index');
  const label = [toolName, ...subParts].join(' – ');
  return label.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function findTitle(path) {
  const toolCatalog = document.querySelector('.block.tool-catalog');
  const tool = toolCatalog?.querySelector(`a[href="${path}"]`);
  return tool ? tool.textContent : labelFromPath(path);
}

function buildRecentNav(merged) {
  const nav = document.createElement('nav');
  nav.classList.add('recent-tools-nav');
  nav.setAttribute('aria-labelledby', TITLE_ID);
  nav.innerHTML = `
    <ul>
      ${merged.map((v) => `<li><a href="${v.path}">${findTitle(v.path)}</a></li>`).join('')}
    </ul>
  `;
  return nav;
}

export default async function decorate(block) {
  const visits = JSON.parse(localStorage.getItem('aem-tool-visits') || '[]');
  const hasVisits = visits.length > 0;
  const links = [...block.querySelectorAll('a')].map((a) => {
    const path = new URL(a.href).pathname;
    return { path, ts: Date.now() };
  });
  const merged = [...visits, ...links]
    .filter((item) => !isExcluded(item.path))
    .map((item) => ({ ...item, key: dedupKey(item.path) }))
    .filter((item, i, arr) => arr.findIndex((v) => v.key === item.key) === i)
    .slice(0, 5);

  const title = document.createElement('h1');
  title.id = TITLE_ID;
  title.className = 'recent-tools-title';
  title.textContent = hasVisits ? 'Continue where you left off' : 'Quick access';

  block.replaceChildren(title, buildRecentNav(merged));
}
