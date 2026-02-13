function labelFromPath(path) {
  const segment = path.split('/').filter(Boolean).find((s, i, a) => i > 0 && a[i - 1] === 'tools');
  if (!segment) return path;
  return segment.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function findTitle(path) {
  const toolCatalog = document.querySelector('.block.tool-catalog');
  const tool = toolCatalog?.querySelector(`a[href="${path}"]`);
  return tool ? tool.textContent : labelFromPath(path);
}

function buildRecentNav(visits, heading) {
  if (!heading) {
    // eslint-disable-next-line no-param-reassign
    heading = document.createElement('h2');
    heading.textContent = 'Recent tools';
  }
  heading.id = 'recent-tools-nav-heading';
  const nav = document.createElement('nav');
  nav.classList.add('recent-tools-nav');
  nav.setAttribute('aria-labelledby', heading.id);
  nav.append(heading);
  nav.innerHTML += `
    <ul>
      ${visits.map((v) => `<li><a href="${v.path}">${findTitle(v.path)}</a></li>`).join('')}
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
    .filter((item, index, arr) => arr.findIndex((i) => i.path === item.path) === index)
    .slice(0, 5);
  const heading = block.querySelector('h2');
  block.replaceChildren(buildRecentNav(merged, heading));
}
