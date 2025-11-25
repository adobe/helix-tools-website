import { DATA_TYPES, observeData } from '../results/results-data.js';

const errorState = (e, blockInner) => {
  // eslint-disable-next-line no-console
  console.error('sub-score failed to load!', e);
  blockInner.querySelector('.calculated-score').classList.remove('loading');
  blockInner.querySelector('.calculated-score').textContent = 'ERR!';
  blockInner.classList.add('error');
};

const metrics = {
  'code-complexity': {
    label: 'Code Complexity',
    depends: [DATA_TYPES.CODE_COMPLEXITY],
  },
  'import-complexity': {
    label: 'Import Complexity',
    depends: [DATA_TYPES.IMPORT_COMPLEXITY],
  },
  'site-complexity': {
    label: 'Site Complexity',
    depends: [DATA_TYPES.SITE_COMPLEXITY],
  },
};

/**
 * decorate the block
 * @param {Element} block the block element
 */
export default async function decorate(block) {
  block.innerHTML = '';
  const { metric } = block.dataset;
  const { depends, label } = metrics[metric];
  const title = label || metric;
  const heading = document.createElement('h3');
  heading.textContent = title;
  block.append(heading);

  const inner = document.createElement('div');
  inner.className = 'sub-score-inner';
  block.append(inner);
  inner.innerHTML = `
    <svg class="meter" viewBox="0 0 120 120">
      <circle class="outer" cx="60" cy="60" r="55"></circle>
      <circle class="inner" cx="60" cy="60" r="52"></circle>
      <polygon class="pointer" points="57,80 63,80 60,40"></polygon>
    </svg>
    <div class="calculated-score loading"></div>
    `;

  const pointer = inner.querySelector('.pointer');
  observeData(depends, (score, err) => {
    if (err) {
      errorState(err, inner);
      return;
    }

    setTimeout(() => {
      // 0 = -100deg
      // 100 = 100deg
      const rotate = (score * 2) - 100;
      pointer.style.transform = `rotate(${rotate}deg)`;
      inner.querySelector('.calculated-score').classList.remove('loading');
      inner.querySelector('.calculated-score').textContent = Math.round(score);
    }, 1);
  });
}
