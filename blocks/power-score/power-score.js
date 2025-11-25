import { DATA_TYPES, observeData } from '../results/results-data.js';

const errorState = (e, diagram) => {
  // eslint-disable-next-line no-console
  console.error('power-score failed to load!', e);
  diagram.classList.remove('loading');
  diagram.innerHTML = '<div class="powerscore-label">ERR!</div>';
  diagram.classList.add('error');
  diagram.style.setProperty('--slice1-start', '0deg');
  diagram.style.setProperty('--slice1-end', '120deg');
  diagram.style.setProperty('--slice2-start', '120deg');
  diagram.style.setProperty('--slice2-end', '240deg');
  diagram.style.setProperty('--slice3-start', '240deg');
  diagram.style.setProperty('--slice3-end', '360deg');
};

/**
 * decorate the block
 * @param {Element} block the block element
 */
export default async function decorate(block) {
  // todo setup loading ui
  block.innerHTML = '';
  const heading = document.createElement('h2');
  heading.textContent = 'Powerscore';
  block.append(heading);

  const inner = document.createElement('div');
  inner.className = 'power-score-inner';

  const diagram = document.createElement('div');
  diagram.className = 'loading power-score-diagram';
  inner.append(diagram);

  const calc = document.createElement('div');
  calc.className = 'view-calculator';
  inner.append(calc);

  block.append(inner);

  observeData([
    DATA_TYPES.CODE_COMPLEXITY,
    DATA_TYPES.IMPORT_COMPLEXITY,
    DATA_TYPES.SITE_COMPLEXITY,
  ], ([codeComplexity, importComplexity, siteComplexity], err) => {
    if (err) {
      errorState(err, diagram);
      return;
    }

    const update = () => {
      const total = codeComplexity + importComplexity + siteComplexity;
      const totalDegrees = 360;
      const degreeRatio = totalDegrees / total;
      const codeStart = 0;
      const codeEnd = codeComplexity * degreeRatio;
      const importStart = codeEnd;
      const importEnd = importStart + (importComplexity * degreeRatio);
      const siteStart = importEnd;
      const siteEnd = siteStart + (siteComplexity * degreeRatio);
      diagram.style.setProperty('--slice1-start', `${codeStart}deg`);
      diagram.style.setProperty('--slice1-end', `${codeEnd}deg`);
      diagram.style.setProperty('--slice2-start', `${importStart}deg`);
      diagram.style.setProperty('--slice2-end', `${importEnd}deg`);
      diagram.style.setProperty('--slice3-start', `${siteStart}deg`);
      diagram.style.setProperty('--slice3-end', `${siteEnd}deg`);
      const overallScore = Math.round(total / 3);
      diagram.style.setProperty('--overall-score', `${overallScore}%`);
      diagram.innerHTML = `<div class="powerscore-label">${overallScore}</div>`;
      diagram.classList.remove('loading');
    };
    if (document.startViewTransition) {
      document.startViewTransition(update);
    } else {
      update();
    }
  });

  const pageIsCalculator = document.querySelector('.results.calculator');
  if (!pageIsCalculator) {
    observeData([
      DATA_TYPES.SETUP,
      DATA_TYPES.SITEMAP,
      DATA_TYPES.TEMPLATES,
      DATA_TYPES.BLOCKS,
      DATA_TYPES.CDN,
      DATA_TYPES.PSI,
      DATA_TYPES.TRAFFIC,
      DATA_TYPES.INTEGRATIONS,
    ], ([
      setupData,
      sitemapData,
      templateData,
      blockData,
      cdnData,
      psiData,
      trafficData,
      integrationData,
    ], err) => {
      if (!err) {
        const params = new URLSearchParams({
          id: setupData.id,
          url: setupData.origin,
          pages: sitemapData.totalUrlCnt,
          langs: sitemapData.languages || 1,
          layouts: templateData.templates.numTemplates,
          blocks: blockData.blockCount,
          cdn: cdnData.id,
          mobilePerf: psiData.mobile.lighthouseResult.categories.performance.score,
          trafficRank: trafficData.popularity.number,
          auth: integrationData.authentication,
          commerce: integrationData.commerce,
          forms: integrationData.forms,
        });
        calc.innerHTML = `
          <p>View in <a target="_blank" href="/tools/powerscore/calculator#${params.toString()}">calculator</a></p>
        `;
      }
    });
  }
}
