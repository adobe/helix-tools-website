const VIEWS_BASE = '/tools/media-library/views';

export function loadCSS(href) {
  return new Promise((resolve, reject) => {
    if (!document.querySelector(`link[href="${href}"]`)) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      link.onload = () => resolve();
      link.onerror = () => reject(new Error(`Failed to load CSS: ${href}`));
      document.head.append(link);
    } else {
      resolve();
    }
  });
}

export async function loadView(viewName, container) {
  if (!container) {
    // eslint-disable-next-line no-console
    console.error(`[loadView] Container not found for view: ${viewName}`);
    return;
  }

  try {
    const cssPath = `${VIEWS_BASE}/${viewName}/${viewName}.css`;
    const jsPath = `${VIEWS_BASE}/${viewName}/${viewName}.js`;

    const [, viewModule] = await Promise.all([
      loadCSS(cssPath),
      import(jsPath),
    ]);

    if (viewModule.default) {
      await viewModule.default(container);
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(`[loadView] Failed to load view ${viewName}:`, error);
  }
}
