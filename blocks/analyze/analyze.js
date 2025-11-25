import {
  buildBlock, decorateBlock, decorateIcons, loadBlock,
} from '../../scripts/aem.js';

const createResults = async (block) => {
  const section = block.closest('.section');
  if (section.querySelector('.results-wrapper')) {
    section.querySelector('.results-wrapper').remove();
  }

  const v = block.querySelector('.analyze-box').value;
  const a = document.createElement('a');
  a.textContent = v;
  a.href = v;
  const results = buildBlock('results', a);
  results.dataset.forceUpdate = block.querySelector('.force-update').checked;
  results.dataset.sitemapUrl = block.querySelector('.sitemap-box').value;
  results.dataset.filterPath = block.querySelector('.path-box').value;
  const wrapper = document.createElement('div');
  wrapper.style.display = 'none';
  wrapper.append(results);
  section.append(wrapper);
  decorateBlock(results);
  await loadBlock(results);
  wrapper.style.display = null;
};

function restoreFormState(form, powerScoreParams) {
  const analyzeBox = form.querySelector('#analyze-box');
  analyzeBox.value = powerScoreParams.origin;

  const forceCbox = form.querySelector('#force-cbox');
  forceCbox.checked = powerScoreParams.forceUpdate;
  const sitemapBox = form.querySelector('#sitemap-box');
  sitemapBox.value = powerScoreParams.sitemapUrl;
  const pathBox = form.querySelector('#path-box');
  pathBox.value = powerScoreParams.path;

  if (powerScoreParams.forceUpdate || powerScoreParams.sitemapUrl || powerScoreParams.path) {
    const settings = form.querySelector('.advanced-settings');
    settings.setAttribute('aria-expanded', true);
  }
}

function restoreState(form) {
  const urlParams = new URLSearchParams(window.location.search);
  const powerScoreUrl = urlParams.get('powerScoreUrl');
  if (powerScoreUrl) {
    const powerScoreParams = {
      origin: powerScoreUrl,
      sitemapUrl: urlParams.get('sitemapUrl'),
      forceUpdate: urlParams.get('forceUpdate') === 'true',
      path: urlParams.get('filterPath'),
    };
    restoreFormState(form, powerScoreParams);

    // start if query parameter
    if (powerScoreUrl) {
      setTimeout(() => {
        form.submit();
      }, 500);
    }
    return;
  }

  const sessionStorageState = sessionStorage.getItem('powerScoreParams');
  if (sessionStorageState) {
    const powerScoreParams = JSON.parse(sessionStorageState);
    restoreFormState(form, powerScoreParams);
  }
}

/**
 * decorate the block
 * @param {Element} block the block element
 */
export default function decorate(block) {
  block.innerHTML = `
    <form id="analyze-url-form">
      <div class="field-wrapper input-field-wrapper analyze-box-wrapper">
          <input id="analyze-box" aria-label="URL" class="analyze-box" type="url" required placeholder="Enter site root URL"></input>
        <div class="input-error">
          <p>Please enter a valid URL</p>
        </div>
      </div>
      <div class="field-wrapper submit-wrapper">
        <button type="submit">Analyze</button>
      </div>
      <fieldset class="advanced-settings" aria-expanded="false">
        <legend><span class="icon icon-settings"></span><span>Settings</span></legend>
        <div class="settings-wrapper">
          <div class="field-wrapper force-wrapper">
            <label for="force-cbox">Force Update?</label>
            <input id="force-cbox" class="force-update" type="checkbox"></input>
          </div>
          <div class="field-wrapper input-field-wrapper sitemap-box-wrapper">
            <label for="sitemap-box">Custom Sitemap URL</label>
            <input id="sitemap-box" class="sitemap-box" type="url" placeholder="enter sitemap url if not mentioned in robots.txt"></input>
          </div>
          <div class="field-wrapper input-field-wrapper path-box-wrapper">
            <label for="path-box">Filter Path</label>
            <input id="path-box" class="path-box" type="text" placeholder="e.g. /blog"></input>
          </div>
        </div>
      </fieldset>
    </div>

    </form>
  `;
  const form = block.querySelector('form');
  const analyzeBox = form.querySelector('#analyze-box');
  const settings = form.querySelector('.advanced-settings');
  const sitemapBox = form.querySelector('#sitemap-box');

  decorateIcons(form);
  settings.querySelector('legend').addEventListener('click', () => {
    const expanded = settings.getAttribute('aria-expanded') === 'true';
    settings.setAttribute('aria-expanded', !expanded);
  });

  const urlBoxBlur = (e) => {
    const box = e.target;
    if (
      box.value && box.value.trim()
      && !(
        box.value.startsWith('http://')
        || box.value.startsWith('https://')
      )
    ) {
      box.value = `https://${box.value}`;
    }
    box.classList.add('visited');
  };
  analyzeBox.addEventListener('blur', urlBoxBlur);
  sitemapBox.addEventListener('blur', urlBoxBlur);
  analyzeBox.addEventListener('keyup', (e) => {
    if (e.code === 'Enter') {
      urlBoxBlur(e);
    }
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (form.checkValidity()) {
      createResults(block);
    }
  });
  restoreState(form);
  block.scrollIntoView();
}
