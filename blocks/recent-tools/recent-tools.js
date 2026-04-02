function dedupKey(path) {
  return path.replace(/\/index\.html$/, '/').replace(/^(\/tools\/[^/]+)\.html$/, '$1/');
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

function buildRecentNav(merged, heading, hasStoredVisits) {
  if (!heading) {
    // eslint-disable-next-line no-param-reassign
    heading = document.createElement('h2');
    heading.textContent = 'Recent tools';
  }
  if (!hasStoredVisits) heading.textContent = 'Quick Access';

  heading.id = 'recent-tools-nav-heading';
  const nav = document.createElement('nav');
  nav.classList.add('recent-tools-nav');
  nav.setAttribute('aria-labelledby', heading.id);
  nav.append(heading);
  nav.innerHTML += `
    <ul>
      ${merged.map((v) => `<li><a href="${v.path}">${findTitle(v.path)}</a></li>`).join('')}
    </ul>
  `;
  return nav;
}

export default async function decorate(block) {
  const visits = JSON.parse(localStorage.getItem('aem-tool-visits') || '[]');
  const links = [...block.querySelectorAll('a')].map((a) => {
    const path = new URL(a.href).pathname;
    return { path, ts: Date.now() };
  });
  const merged = [...visits, ...links]
    .map((item) => ({ ...item, key: dedupKey(item.path) }))
    .filter((item, i, arr) => arr.findIndex((v) => v.key === item.key) === i)
    .slice(0, 5);
  const heading = block.querySelector('h2');
  block.replaceChildren(buildRecentNav(merged, heading, visits.length > 0));
}
