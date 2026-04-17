// dom elements
const BADGE = document.querySelector('.badge-preview');
const CHECKS = document.getElementById('quality-checks');

/**
 * Cycles the badge preview through the three real badge states on an interval.
 * @param {HTMLElement} badge - Badge preview element
 */
function initBadgeCycling(badge) {
  const states = [
    {
      state: 'needs-improvement',
      message: 'Content could be improved',
      action: 'Review suggestions',
      count: '0 errors · 3 warnings',
    },
    {
      state: 'poor',
      message: 'Content issues found',
      action: 'Review errors',
      count: '2 errors · 1 warning',
    },
    {
      state: 'good',
      message: 'No content issues found',
      action: null,
      count: '0 errors · 0 warnings',
    },
  ];
  let i = 0;
  setInterval(() => {
    i = (i + 1) % states.length;
    const {
      state, message, action, count,
    } = states[i];
    badge.dataset.state = state;
    badge.querySelector('.badge-message').textContent = message;
    const headline = badge.querySelector('.badge-headline');
    let actionEl = headline.querySelector('.badge-action');
    if (action) {
      if (!actionEl) {
        actionEl = document.createElement('span');
        actionEl.className = 'badge-action';
        headline.append(actionEl);
      }
      actionEl.textContent = action;
    } else if (actionEl) actionEl.remove();

    badge.querySelector('.badge-count').textContent = count;
  }, 8000);
}

if (BADGE && CHECKS) {
  BADGE.addEventListener('click', () => {
    CHECKS.scrollIntoView({ behavior: 'smooth' });
  });
}

if (BADGE && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
  initBadgeCycling(BADGE);
}

/**
 * Appends a copy button absolutely positioned within the figure.
 */
function initCopyButtons() {
  document.querySelectorAll('.content-score-snippet pre code').forEach((block) => {
    const figure = block.closest('.content-score-snippet');
    if (!figure) return;
    if (figure.querySelector('button.content-score-copy')) return;
    const button = document.createElement('button');
    button.className = 'button content-score-copy';
    button.type = 'button';
    button.textContent = 'Copy';
    button.addEventListener('click', async () => {
      await navigator.clipboard.writeText(block.textContent);
      button.textContent = 'Copied!';
      setTimeout(() => { button.textContent = 'Copy'; }, 2000);
    });
    figure.append(button);
  });
}

initCopyButtons();
window.addEventListener('load', initCopyButtons);
