import { decorateIcons, toClassName } from '../../scripts/aem.js';
import {
  DATA_TYPES, observeData, provideData, CDN_MAP, UNKNOWN_CDN,
} from '../results/results-data.js';

const errorState = (e, blockInner) => {
  // eslint-disable-next-line no-console
  console.error('Data element failed to load!', e);
  blockInner.classList.remove('loading');
  blockInner.classList.add('error');
  blockInner.innerHTML = '<p>Error!</p>';
};

const updateUrlHash = (paramName, paramValue) => {
  const { hash } = window.location;
  const params = new URLSearchParams(hash.substring(1));
  params.set(paramName, paramValue);
  window.location.hash = params.toString();
};

const createSlider = (dataType, initialValue, changeCallback) => {
  const sliderContainer = document.createElement('div');
  sliderContainer.className = 'slider-container';

  const id = dataType.description ? dataType.description : dataType;
  sliderContainer.innerHTML = `
    <input type="range" min="1" max="100" value="${initialValue}" class="slider" id="${toClassName(id)}-slider"></input>
    <span class="slider-current-value">${initialValue}</span>
  `;

  const slider = sliderContainer.querySelector('.slider');
  slider.addEventListener('input', () => {
    sliderContainer.querySelector('.slider-current-value').textContent = slider.value;
  });
  slider.addEventListener('change', () => {
    sliderContainer.querySelector('.slider-current-value').textContent = slider.value;
    changeCallback(Number(slider.value));
  });

  return sliderContainer;
};

const renderPsiGuage = (score, category) => {
  let level = 'good';
  if (score < 90) level = 'improve';
  if (score < 50) level = 'poor';
  const psiScore = document.createElement('div');
  psiScore.classList.add('psi-score');
  psiScore.classList.add(`psi-${level}`);
  psiScore.classList.add(`psi-${toClassName(category)}`);

  const guage = document.createElement('div');
  guage.classList.add('guage');
  guage.textContent = score;
  guage.style.setProperty('--psi-score', `${score}%`);
  psiScore.append(guage);

  const cat = document.createElement('p');
  cat.textContent = category;
  psiScore.append(cat);
  return psiScore;
};

const renderPsi = (blockInner, psiData, dataType, { isCalculator, initialRender }) => {
  if (initialRender) blockInner.innerHTML = '';

  ['Performance', 'Accessibility', 'Best-Practices', 'SEO'].forEach((category) => {
    if (psiData.lighthouseResult.categories[category.toLowerCase()]) {
      const { score } = psiData.lighthouseResult.categories[category.toLowerCase()];
      const roundedScore = Math.round(score * 100);
      const guage = renderPsiGuage(
        roundedScore,
        category
          .split('-').join(' '),
      );
      if (initialRender) {
        blockInner.append(guage);
        if (isCalculator) {
          const slider = createSlider(`${dataType.description}-${category}`, roundedScore, (value) => {
            const updatedData = psiData;
            updatedData.lighthouseResult.categories[category.toLowerCase()].score = value / 100;
            provideData(dataType, updatedData);
            updateUrlHash('mobilePerf', value / 100);
          });
          guage.append(slider);
        }
      } else {
        const existing = blockInner.querySelector(`.psi-${toClassName(category.split('-').join(' '))}`);
        [...existing.children].forEach((child) => {
          if (!child.classList.contains('slider-container')) {
            child.remove();
          }
        });
        existing.prepend(...guage.children);
        existing.className = guage.className;
      }
    }
  });
};

const metrics = {
  pages: {
    depends: [DATA_TYPES.SITEMAP],
    label: 'Page Stats',
    render: async (blockInner, [sitemapData], { isCalculator, initialRender }) => {
      const dataCopy = sitemapData;
      if (initialRender) {
        const pageCount = sitemapData.totalUrlCnt;
        const langCount = sitemapData.languages;
        blockInner.innerHTML = `<div>
          <div class="page-count">
            <p><span data-param-name="pages" data-name="totalUrlCnt">${pageCount}</span> Pages</p>
            <button type="button">
              <span class="icon icon-copy"></span>
              <span class="label">Copy URLs</span>
            </button>
          </div>
          <p><span data-param-name="langs" data-name="languages">${langCount}</span> Language(s)</p>
        </div>`;
        decorateIcons(blockInner);
        const copyButton = blockInner.querySelector('.page-count button');
        if (isCalculator) {
          copyButton.remove();
          blockInner.querySelectorAll('[data-name]').forEach((dv) => {
            const input = document.createElement('input');
            input.setAttribute('type', 'number');
            input.dataset.name = dv.dataset.name;
            input.dataset.paramName = dv.dataset.paramName;
            dv.replaceWith(input);
            input.addEventListener('change', () => {
              dataCopy[input.dataset.name] = input.value;
              provideData(DATA_TYPES.SITEMAP, dataCopy);
              updateUrlHash(input.dataset.paramName, input.value);
            });
          });
        } else {
          copyButton.addEventListener('click', () => {
            const urls = [];
            sitemapData.pages.forEach((sitemap) => {
              sitemap.urls.forEach((u) => urls.push(u));
            });
            navigator.clipboard.writeText(urls.join('\n'));
            copyButton.setAttribute('disabled', true);
            copyButton.querySelector('.label').textContent = 'URLs Copied!';
          });
        }
        blockInner.classList.remove('loading');
      }
      blockInner.querySelectorAll('[data-name]').forEach((dv) => {
        if (!isCalculator) {
          dv.textContent = dataCopy[dv.dataset.name];
        } else {
          dv.value = dataCopy[dv.dataset.name];
        }
      });
    },
  },
  layouts: {
    depends: [DATA_TYPES.TEMPLATES],
    label: 'Layouts (approx.)',
    render: async (blockInner, [templateData], { isCalculator, initialRender }) => {
      const dataCopy = templateData;
      const templateCount = dataCopy.templates.numTemplates;
      if (initialRender) {
        if (isCalculator) {
          blockInner.innerHTML = `<input 
            type="number" 
            data-name="numTemplates"
            data-param-name="layouts"></input>`;
          const input = blockInner.querySelector('input');
          input.addEventListener('change', () => {
            dataCopy.templates.numTemplates = Number(input.value);
            provideData(DATA_TYPES.TEMPLATES, dataCopy);
            updateUrlHash(input.dataset.paramName, input.value);
          });
        } else {
          blockInner.innerHTML = `<p><span data-name="numTemplates">${templateCount}</span></p>`;
        }
        blockInner.classList.remove('loading');
      }
      const dataEl = blockInner.querySelector('[data-name="numTemplates"]');
      if (!isCalculator) {
        dataEl.textContent = templateCount;
      } else {
        dataEl.value = templateCount;
      }
    },
  },
  blocks: {
    depends: [DATA_TYPES.BLOCKS],
    label: 'Blocks (approx.)',
    render: async (blockInner, [blockData], { isCalculator, initialRender }) => {
      const dataCopy = blockData;
      const { blockCount } = dataCopy;
      const roundedBlockCount = Math.round((blockCount * 100) / 100);
      if (initialRender) {
        if (isCalculator) {
          blockInner.innerHTML = `<input 
            type="number" 
            data-name="blockCount"
            data-param-name="blocks"></input>`;
          const input = blockInner.querySelector('input');
          input.addEventListener('change', () => {
            dataCopy[input.dataset.name] = input.value;
            provideData(DATA_TYPES.BLOCKS, dataCopy);
            updateUrlHash(input.dataset.paramName, input.value);
          });
        } else {
          blockInner.innerHTML = '<p><span data-name="blockCount"></span></p>';
        }
        blockInner.classList.remove('loading');
      }
      const dataEl = blockInner.querySelector('[data-name="blockCount"]');
      if (!isCalculator) {
        dataEl.textContent = roundedBlockCount;
      } else {
        dataEl.value = roundedBlockCount;
      }
    },
  },
  integrations: {
    depends: [DATA_TYPES.INTEGRATIONS],
    label: 'Integrations',
    render: async (blockInner, [integrations], { isCalculator, initialRender }) => {
      const dataCopy = integrations;
      const integrationData = {
        commerce: {
          enabled: dataCopy.commerce,
        },
        authentication: {
          enabled: dataCopy.authentication,
        },
        forms: {
          enabled: dataCopy.forms,
        },
      };
      if (initialRender) {
        blockInner.innerHTML = `
          <div class="integration-commerce integration-icon">
            <span class="icon icon-cart"></span>
            <p id="label-commerce">Commerce</p>
          </div>
          <div class="integration-authentication integration-icon">
            <span class="icon icon-user"></span>
            <p id="label-authentication">Authentication</p>
          </div>
          <div class="integration-forms integration-icon">
            <span class="icon icon-forms"></span>
            <p id="label-forms">Forms</p>
          </div>`;

        Object.keys(integrationData).forEach((k) => {
          const el = blockInner.querySelector(`.integration-${k}`);
          if (isCalculator) {
            const cbx = document.createElement('input');
            cbx.type = 'checkbox';
            cbx.setAttribute('aria-labelledby', `label-${k}`);
            el.append(cbx);
            cbx.addEventListener('change', () => {
              dataCopy[k] = cbx.checked;
              provideData(DATA_TYPES.INTEGRATIONS, dataCopy);
              updateUrlHash(k, cbx.checked);
            });
          }
        });
        decorateIcons(blockInner);
        blockInner.classList.remove('loading');
      }
      let count = 0;
      Object.entries(integrationData).forEach(([k, v]) => {
        const el = blockInner.querySelector(`.integration-${k}`);
        if (isCalculator) {
          count += 1;
          const cbx = el.querySelector('input');
          cbx.checked = v.enabled;
        } else if (v.enabled) {
          count += 1;
        } else {
          el.remove();
        }
      });
      if (count === 0 && !isCalculator) {
        blockInner.innerHTML = '<p>None</p>';
      }
    },
  },
  cdn: {
    depends: [DATA_TYPES.CDN],
    label: 'CDN',
    render: async (blockInner, [cdnData], { isCalculator, initialRender }) => {
      const dataCopy = cdnData;
      let icon;
      let label;
      if (initialRender) {
        icon = document.createElement('span');
        icon.className = 'icon';
        blockInner.append(icon);

        if (isCalculator) {
          label = document.createElement('select');
          Object.values(CDN_MAP).forEach((cdn) => {
            const opt = document.createElement('option');
            opt.value = cdn.id;
            opt.textContent = cdn.label;
            label.append(opt);
          });
          const unknownOpt = document.createElement('option');
          unknownOpt.value = UNKNOWN_CDN.id;
          unknownOpt.textContent = UNKNOWN_CDN.label;
          label.prepend(unknownOpt);

          label.addEventListener('change', () => {
            let cdn = CDN_MAP[label.value];
            if (!cdn) cdn = UNKNOWN_CDN;
            provideData(DATA_TYPES.CDN, cdn);
            updateUrlHash('cdn', cdn.id);
          });
        } else {
          label = document.createElement('p');
        }
        label.className = 'label';
        blockInner.append(label);
      } else {
        icon = blockInner.querySelector('.icon');
        label = blockInner.querySelector('.label');
      }

      icon.className = `icon icon-${dataCopy.icon}`;
      icon.innerHTML = '';
      decorateIcons(blockInner);
      if (dataCopy.cname) {
        blockInner.querySelector('.icon img').setAttribute('title', `CNAME: ${dataCopy.cname}`);
      }
      if (isCalculator) {
        label.value = dataCopy.id;
      } else {
        label.textContent = dataCopy.label;
      }

      blockInner.classList.remove('loading');
    },
  },
  traffic: {
    depends: [DATA_TYPES.TRAFFIC],
    label: 'Traffic',
    render: async (blockInner, [trafficData], { isCalculator, initialRender }) => {
      const dataCopy = trafficData;
      if (initialRender) {
        blockInner.innerHTML = '<p class="traffic-rank"></p>';
        if (isCalculator) {
          const select = document.createElement('select');
          [10000, 100000, 250000, 500000, 1000000, 5000000].forEach((t) => {
            const opt = document.createElement('option');
            opt.value = t;
            opt.textContent = `Top ${Number(t).toLocaleString()}`;
            select.append(opt);
          });

          select.addEventListener('change', () => {
            provideData(DATA_TYPES.TRAFFIC, {
              popularity: {
                number: Number(select.value),
              },
            });
            updateUrlHash('trafficRank', select.value);
          });
          blockInner.append(select);
        } else {
          blockInner.innerHTML += `
          <div>
            <p><span class="traffic-split-mobile"></span> Mobile</p>
            <p><span class="traffic-split-desktop"></span> Desktop</p>
          </div>
          <p class="traffic-source"></p>
          `;
        }
      }
      if (dataCopy.source) {
        blockInner.querySelector('.traffic-source').innerHTML = `Source <a target="_blank" href="${dataCopy.source.url}">${dataCopy.source.label}</a>`;
      }
      const { popularity } = dataCopy;
      const popularityNumber = popularity.number; // e.g. 1000
      const popularityRank = popularity.rank || `Top ${popularityNumber.toLocaleString()}`; // e.g. 'Top 1,000'
      let trafficRank = 'high-traffic';
      if (!Number.isNaN(popularityNumber)) {
        if (popularityNumber >= 100000) trafficRank = 'med-traffic';
        if (popularityNumber >= 5000000) trafficRank = 'low-traffic';
      } else {
        trafficRank = 'low-traffic';
      }
      const rankEl = blockInner.querySelector('.traffic-rank');
      rankEl.className = `traffic-rank ${trafficRank}`;
      rankEl.textContent = popularityRank;
      if (isCalculator) {
        const select = blockInner.querySelector('select');
        select.value = popularityNumber;
      } else {
        blockInner.querySelector('.traffic-split-mobile').textContent = dataCopy.formFactors.Mobile;
        blockInner.querySelector('.traffic-split-desktop').textContent = dataCopy.formFactors.Desktop;
      }
      blockInner.classList.remove('loading');
    },
  },
  'psi-mobile': {
    depends: [DATA_TYPES.PSI_MOBILE],
    label: 'Mobile PSI',
    render: async (blockInner, [psiData], { isCalculator, initialRender }) => {
      renderPsi(blockInner, psiData, DATA_TYPES.PSI_MOBILE, { isCalculator, initialRender });
      blockInner.classList.remove('loading');
    },
  },
  'psi-desktop': {
    depends: [DATA_TYPES.PSI_DESKTOP],
    label: 'Desktop PSI',
    render: async (blockInner, [psiData], { isCalculator, initialRender }) => {
      renderPsi(blockInner, psiData, DATA_TYPES.PSI_DESKTOP, { isCalculator, initialRender });
      blockInner.classList.remove('loading');
    },
  },
  'customer-complexity': {
    depends: [DATA_TYPES.CUSTOMER_COMPLEXITY],
    label: 'Customer Complexity',
    render: async (blockInner, [customerComplexity], { initialRender }) => {
      if (initialRender) {
        const slider = createSlider(
          DATA_TYPES.CUSTOMER_COMPLEXITY,
          customerComplexity,
          (value) => {
            provideData(DATA_TYPES.CUSTOMER_COMPLEXITY, value);
            updateUrlHash('customerComplexity', value);
          },
        );
        blockInner.append(slider);
        blockInner.classList.remove('loading');
      }
    },
  },
  'customer-urgency': {
    depends: [DATA_TYPES.CUSTOMER_URGENCY],
    label: 'Customer Urgency',
    render: async (blockInner, [customerUrgency], { initialRender }) => {
      if (initialRender) {
        const slider = createSlider(DATA_TYPES.CUSTOMER_URGENCY, customerUrgency, (value) => {
          provideData(DATA_TYPES.CUSTOMER_URGENCY, value);
          updateUrlHash('customerUrgency', value);
        });
        blockInner.append(slider);
        blockInner.classList.remove('loading');
      }
    },
  },
};

/**
 * decorate the block
 * @param {Element} block the block element
 */
export default async function decorate(block) {
  block.innerHTML = '';

  const { metric } = block.dataset;
  const { depends, render, label } = metrics[metric];
  const title = label || metric;
  const heading = document.createElement('h3');
  heading.textContent = title;
  block.append(heading);
  const inner = document.createElement('div');
  inner.className = 'data-element-inner loading';
  block.append(inner);

  let initialRender = true;
  observeData(depends, (results, err) => {
    if (err) {
      errorState(err, inner);
      return;
    }
    render(inner, results, {
      isCalculator: block.classList.contains('calculator'),
      initialRender,
    });
    if (initialRender) {
      initialRender = false;
    }
  });
}
