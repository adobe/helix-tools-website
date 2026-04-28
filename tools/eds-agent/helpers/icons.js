const iconCache = new Map();

/**
 * Loads a Spectrum SVG icon from /icons/<name>.svg as an inline SVG element.
 * Caches the parsed SVG (concurrent loads share one fetch).
 * Returns a clone, so callers can freely append to the DOM.
 */
export async function loadIcon(name) {
  if (!iconCache.has(name)) {
    const promise = fetch(`/icons/${name}.svg`)
      .then((r) => {
        if (!r.ok) throw new Error(`icon ${name} not found`);
        return r.text();
      })
      .then((txt) => {
        const tmpl = document.createElement('template');
        tmpl.innerHTML = txt.trim();
        return tmpl.content.firstElementChild;
      });
    iconCache.set(name, promise);
  }
  const svg = await iconCache.get(name);
  return svg.cloneNode(true);
}

export async function injectCopyButtons(root) {
  const pres = root.querySelectorAll('pre');
  if (!pres.length) return;
  const copyIcon = await loadIcon('S2_Icon_Copy_20_N');
  const checkIcon = await loadIcon('S2_Icon_Checkmark_20_N');
  pres.forEach((pre) => {
    if (pre.querySelector('.eds-copy-btn')) return;
    const btn = document.createElement('button');
    btn.className = 'eds-copy-btn';
    btn.title = 'Copy';
    btn.setAttribute('aria-label', 'Copy');
    btn.dataset.copyIdle = copyIcon.outerHTML;
    btn.dataset.copyDone = checkIcon.outerHTML;
    btn.innerHTML = btn.dataset.copyIdle;
    pre.appendChild(btn);
  });
}

export function attachCopyDelegation(messagesEl) {
  messagesEl.addEventListener('click', async (e) => {
    const btn = e.target.closest('.eds-copy-btn');
    if (!btn) return;
    const pre = btn.closest('pre');
    const code = pre?.querySelector('code')?.textContent ?? pre?.textContent ?? '';
    try {
      await navigator.clipboard.writeText(code);
      btn.innerHTML = btn.dataset.copyDone;
      setTimeout(() => { btn.innerHTML = btn.dataset.copyIdle; }, 1200);
    } catch {
      /* clipboard unavailable; ignore */
    }
  });
}
