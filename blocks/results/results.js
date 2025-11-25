import {
  buildBlock, decorateBlock, loadBlock,
} from '../../scripts/aem.js';
import {
  initCalculations,
  loadData,
  loadCalculatorData,
} from './results-data.js';

const buildUi = async (isCalculator) => {
  const blockLoaders = [];
  const overallScore = document.createElement('div');
  overallScore.className = 'overall-score result-section';
  const heading = document.createElement('h1');
  heading.textContent = 'Website Insights';

  const powerScore = buildBlock('power-score', '');
  overallScore.append(powerScore);
  decorateBlock(powerScore);
  await loadBlock(powerScore);

  const componentScores = document.createElement('div');
  componentScores.className = 'result-section data-elements';
  const subHeading = document.createElement('h2');
  subHeading.textContent = 'Insights Data';

  const uiDef = {
    crawl: ['pages', 'layouts', 'blocks', 'integrations'],
    psi: ['psi-mobile', 'psi-desktop'],
    traffic: ['cdn', 'traffic'],
  };
  if (isCalculator) {
    subHeading.textContent = 'Powerscore Factors';
    uiDef.sliders = ['customer-complexity', 'customer-urgency'];
    uiDef.psi = ['psi-mobile'];
  }
  Object.values(uiDef).forEach((value) => {
    const group = document.createElement('div');
    group.className = 'data-group';
    componentScores.append(group);
    value.forEach((metric) => {
      const dataEl = buildBlock('data-element', '');
      if (isCalculator) dataEl.classList.add('calculator');
      dataEl.dataset.metric = metric;
      group.append(dataEl);
      decorateBlock(dataEl);
      blockLoaders.push(loadBlock(dataEl));
    });
  });

  await Promise.all(blockLoaders);

  return [heading, overallScore, subHeading, componentScores];
};

/**
 * decorate the block
 * @param {Element} block the block element
 */
export default async function decorate(block) {
  initCalculations();
  const isCalculator = block.classList.contains('calculator');
  const link = block.querySelector('a');

  const ui = await buildUi(isCalculator);
  block.replaceChildren(...ui);

  if (!isCalculator) {
    const url = new URL(link.href);

    const { filterPath, sitemapUrl, forceUpdate } = block.dataset;
    loadData(url, forceUpdate === 'true', sitemapUrl, filterPath);
  } else {
    let params = {};
    const { hash } = window.location;
    if (hash) {
      const urlParams = new URLSearchParams(hash.substring(1));
      params = [...urlParams.entries()].reduce((prev, [k, v]) => ({
        ...prev,
        [k]: v,
      }), {});
    }
    loadCalculatorData(params);
  }
}
