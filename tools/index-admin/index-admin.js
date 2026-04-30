import { registerToolReady } from '../../scripts/scripts.js';
import { initConfigField } from '../../utils/config/config.js';
import { toClassName } from '../../scripts/aem.js';
import admin from '../../scripts/helix-admin.js';
import { executeAdminRequest, AuthMode } from '../../utils/admin-request.js';
import { logResponse } from '../../blocks/console/console.js';
import deriveReindexPaths from './utils.js';

const adminForm = document.getElementById('admin-form');
const site = document.getElementById('site');
const org = document.getElementById('org');
const consoleBlock = document.querySelector('.console');
const addIndexButton = document.getElementById('add-index');
const fetchButton = document.getElementById('fetch');

let loadedIndices;
let YAML;

async function ensureYaml() {
  // eslint-disable-next-line import/no-unresolved
  YAML = YAML || await import('../../vendor/yaml/yaml.js');
}

function displayIndexDetails(indexName, indexDef, newIndex = false) {
  document.querySelector('dialog.index-details')?.remove();

  const fragment = document.querySelector('#index-details-dialog-template').content.cloneNode(true);
  const indexDetails = fragment.querySelector('dialog.index-details');
  document.body.append(fragment);

  indexDetails.querySelector('#index-name').value = indexName;
  if (!newIndex) {
    indexDetails.querySelector('#index-name').readOnly = true;
  }
  indexDetails.querySelector('#index-target').value = indexDef.target;
  indexDetails.querySelector('#index-include').value = indexDef?.include?.join('\n') || '';
  indexDetails.querySelector('#index-exclude').value = indexDef?.exclude?.join('\n') || '';

  const propertiesContainer = indexDetails.querySelector('.properties-container');
  Object.entries(indexDef.properties).forEach(([propName, propInfo]) => {
    propertiesContainer.append(document.querySelector('#index-property-row-template').content.cloneNode(true));
    const property = propertiesContainer.lastElementChild;

    const idSuffix = toClassName(propName);
    property.dataset.idSuffix = idSuffix;
    const nameField = property.querySelector('#index-property-name');
    const selectField = property.querySelector('#index-property-select');
    const selectFirstField = property.querySelector('#index-property-select-first');
    const valueTypeField = property.querySelector('#index-property-value-type');
    const valueField = property.querySelector('#index-property-value');

    nameField.id = `index-property-name-${idSuffix}`;
    selectField.id = `index-property-select-${idSuffix}`;
    selectFirstField.id = `index-property-select-first-${idSuffix}`;
    valueTypeField.id = `index-property-value-type-${idSuffix}`;
    valueField.id = `index-property-value-${idSuffix}`;

    nameField.value = propName;
    selectField.value = propInfo.select || '';
    selectFirstField.value = propInfo.selectFirst || '';
    valueTypeField.value = propInfo.value !== undefined ? 'value' : 'values';
    valueField.value = propInfo.value ?? propInfo.values?.join?.('\n') ?? propInfo.values ?? '';

    const nameFieldLabel = property.querySelector('label[for="index-property-name"]');
    const selectFieldLabel = property.querySelector('label[for="index-property-select"]');
    const selectFirstFieldLabel = property.querySelector('label[for="index-property-select-first"]');
    const valueTypeFieldLabel = property.querySelector('label[for="index-property-value-type"]');
    const valueFieldLabel = property.querySelector('label[for="index-property-value"]');

    nameFieldLabel.htmlFor = `index-property-name-${idSuffix}`;
    selectFieldLabel.htmlFor = `index-property-select-${idSuffix}`;
    selectFirstFieldLabel.htmlFor = `index-property-select-first-${idSuffix}`;
    valueTypeFieldLabel.htmlFor = `index-property-value-type-${idSuffix}`;
    valueFieldLabel.htmlFor = `index-property-value-${idSuffix}`;

    property.querySelector('.remove-property-btn').addEventListener('click', () => {
      property.remove();
    });
  });

  indexDetails.showModal();

  indexDetails.addEventListener('close', () => {
    indexDetails.remove();
  });

  // Add event listeners for add/remove property buttons
  const addPropertyBtn = indexDetails.querySelector('.add-property-btn');
  addPropertyBtn.addEventListener('click', () => {
    propertiesContainer.append(document.querySelector('#index-property-row-template').content.cloneNode(true));
    const property = propertiesContainer.lastElementChild;
    const idSuffix = Math.random().toString(36).substring(2, 12);
    property.dataset.idSuffix = idSuffix;

    const nameField = property.querySelector('#index-property-name');
    const selectField = property.querySelector('#index-property-select');
    const selectFirstField = property.querySelector('#index-property-select-first');
    const valueTypeField = property.querySelector('#index-property-value-type');
    const valueField = property.querySelector('#index-property-value');

    nameField.id = `index-property-name-${idSuffix}`;
    selectField.id = `index-property-select-${idSuffix}`;
    selectFirstField.id = `index-property-select-first-${idSuffix}`;
    valueTypeField.id = `index-property-value-type-${idSuffix}`;
    valueField.id = `index-property-value-${idSuffix}`;

    const nameFieldLabel = property.querySelector('label[for="index-property-name"]');
    const selectFieldLabel = property.querySelector('label[for="index-property-select"]');
    const selectFirstFieldLabel = property.querySelector('label[for="index-property-select-first"]');
    const valueTypeFieldLabel = property.querySelector('label[for="index-property-value-type"]');
    const valueFieldLabel = property.querySelector('label[for="index-property-value"]');

    nameFieldLabel.htmlFor = `index-property-name-${idSuffix}`;
    selectFieldLabel.htmlFor = `index-property-select-${idSuffix}`;
    selectFirstFieldLabel.htmlFor = `index-property-select-first-${idSuffix}`;
    valueTypeFieldLabel.htmlFor = `index-property-value-type-${idSuffix}`;
    valueFieldLabel.htmlFor = `index-property-value-${idSuffix}`;

    property.querySelector('.remove-property-btn').addEventListener('click', () => {
      property.remove();
    });
  });

  const cancel = indexDetails.querySelector('#cancel-index');
  indexDetails.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();

    // validate properties
    const properties = {};
    indexDetails.querySelectorAll('.index-property').forEach((property) => {
      const { idSuffix } = property.dataset;
      const name = property.querySelector(`#index-property-name-${idSuffix}`).value.trim();
      const select = property.querySelector(`#index-property-select-${idSuffix}`).value.trim();
      const selectFirst = property.querySelector(`#index-property-select-first-${idSuffix}`).value.trim();
      const valueType = property.querySelector(`#index-property-value-type-${idSuffix}`).value;
      const valueInput = property.querySelector(`#index-property-value-${idSuffix}`).value.trim();

      if (valueType === 'values') {
        const valueLines = valueInput.split('\n').map((line) => line.trim()).filter((line) => line);
        properties[name] = { values: valueLines.length > 0 ? valueLines : [valueInput] };
      } else {
        properties[name] = { value: valueInput };
      }

      if (select) {
        properties[name].select = select;
      }
      if (selectFirst) {
        properties[name].selectFirst = selectFirst;
      }
    });

    loadedIndices.indices[indexDetails.querySelector('#index-name').value.trim()] = {
      target: indexDetails.querySelector('#index-target').value.trim(),
      include: indexDetails.querySelector('#index-include').value.split('\n').map((line) => line.trim()),
      properties,
    };

    if (indexDetails.querySelector('#index-exclude').value) {
      loadedIndices.indices[indexDetails.querySelector('#index-name').value.trim()].exclude = indexDetails.querySelector('#index-exclude').value.split('\n').map((line) => line.trim());
    }

    await ensureYaml();
    const yamlText = YAML.stringify(loadedIndices);
    const result = await executeAdminRequest(
      () => admin.config({ org: org.value, site: site.value }).select('content/query.yaml').update(yamlText),
      { org: org.value, site: site.value },
    );
    if (!result) return;
    const { method, url } = result.request;
    logResponse(consoleBlock, result.status, [method, url, result.error]);

    if (result.ok) {
      indexDetails.close();

      const indexesList = document.getElementById('indexes-list');
      indexesList.innerHTML = '';
      adminForm.dispatchEvent(new Event('submit'));
    } else {
      // eslint-disable-next-line no-alert
      alert('Failed to save index, check console for details');
    }
  });

  cancel.addEventListener('click', (e) => {
    e.preventDefault();
    indexDetails.close();
  });

  // close on click outside modal
  indexDetails.addEventListener('click', (e) => {
    const {
      left, right, top, bottom,
    } = indexDetails.getBoundingClientRect();
    const { clientX, clientY } = e;
    if (clientX < left || clientX > right || clientY < top || clientY > bottom) {
      indexDetails.close();
    }
  });
}

function showJobStatus(jobDetails) {
  // Clone and append the status dialog template
  document.body.append(document.querySelector('#reindex-status-dialog-template').content.cloneNode(true));
  const statusDialog = document.querySelector('dialog.reindex-status-dialog');

  // Format and display the job details
  const jobDetailsEl = statusDialog.querySelector('.job-details');
  jobDetailsEl.textContent = JSON.stringify(jobDetails, null, 2);

  // Set up close button
  const closeBtn = statusDialog.querySelector('.close-status-btn');
  closeBtn.addEventListener('click', () => {
    statusDialog.close();
    statusDialog.remove();
  });

  // Close on click outside modal
  statusDialog.addEventListener('click', (e) => {
    const {
      left, right, top, bottom,
    } = statusDialog.getBoundingClientRect();
    const { clientX, clientY } = e;
    if (clientX < left || clientX > right || clientY < top || clientY > bottom) {
      statusDialog.close();
      statusDialog.remove();
    }
  });

  statusDialog.showModal();
}

async function reIndex(indexNames, paths) {
  const result = await executeAdminRequest(
    () => admin.index({ org: org.value, site: site.value }).bulk({ paths, indexNames }),
    { org: org.value, site: site.value },
  );
  if (!result) return { success: false };
  const { method, url } = result.request;
  logResponse(consoleBlock, result.status, [method, url, result.error]);

  if (result.status === 202) {
    const { job: jobInfo } = await result.json();
    return { success: true, topic: jobInfo?.topic, name: jobInfo?.name };
  }
  return { success: false, status: result.status, error: result.error };
}

async function fetchJobDetails(topic, name) {
  const result = await executeAdminRequest(
    () => admin.job({ org: org.value, site: site.value }).details(topic, name),
    { org: org.value, site: site.value },
  );
  if (!result) return null;
  const { method, url } = result.request;
  logResponse(consoleBlock, result.status, [method, url, result.error]);
  return result.ok ? result.json() : null;
}

async function removeIndex(name) {
  // eslint-disable-next-line no-alert, no-restricted-globals
  if (!confirm(`Remove index configuration "${name}"?`)) {
    return;
  }

  delete loadedIndices.indices[name];

  await ensureYaml();
  const yamlText = YAML.stringify(loadedIndices);
  const result = await executeAdminRequest(
    () => admin.config({ org: org.value, site: site.value }).select('content/query.yaml').update(yamlText),
    { org: org.value, site: site.value },
  );
  if (!result) return;
  const { method, url } = result.request;
  logResponse(consoleBlock, result.status, [method, url, result.error]);

  if (result.ok) {
    const indexesList = document.getElementById('indexes-list');
    indexesList.innerHTML = '';
    adminForm.dispatchEvent(new Event('submit'));
  } else {
    // eslint-disable-next-line no-alert
    alert('Failed to remove index, check console for details');
  }
}

function populateIndexes(indexes) {
  const indexesList = document.getElementById('indexes-list');
  indexesList.innerHTML = '';

  Object.entries(indexes).forEach(([name, indexDef], index) => {
    indexesList.append(document.querySelector('#index-card-template').content.cloneNode(true));

    const indexItem = indexesList.lastElementChild;
    indexItem.style.setProperty('--animation-order', index);
    indexItem.querySelector('.index-name').textContent = name;
    indexItem.querySelector('.index-attribute-value-target').textContent = indexDef.target;
    indexItem.querySelector('.index-attribute-value-include').innerHTML = indexDef?.include?.join('<br>') || 'n/a';
    indexItem.querySelector('.index-attribute-value-exclude').innerHTML = indexDef?.exclude?.join('<br>') || 'n/a';

    indexItem.querySelector('.edit-index-btn').addEventListener('click', (e) => {
      e.preventDefault();
      displayIndexDetails(name, indexDef);
    });

    indexItem.querySelector('.remove-index-btn').addEventListener('click', async (e) => {
      e.preventDefault();
      const btn = e.target;
      btn.disabled = true;
      await removeIndex(name);
      btn.disabled = false;
    });

    const reindexBtn = indexItem.querySelector('.reindex-btn');
    let activeJob = null;
    let jobStatusPoll = null;

    reindexBtn.addEventListener('click', async (e) => {
      e.preventDefault();

      if (activeJob) {
        const jobDetails = await fetchJobDetails(activeJob.topic, activeJob.name);
        if (jobDetails) {
          showJobStatus(jobDetails);
        }
        return;
      }

      // Determine paths based on include patterns
      const paths = deriveReindexPaths(indexDef.include);
      const pathsDisplay = paths.join(', ');

      // eslint-disable-next-line no-alert, no-restricted-globals
      const confirmed = confirm(`Start a Bulk Reindex Job for Index: ${name}?\n\nPaths: ${pathsDisplay}`);
      if (!confirmed) return;

      reindexBtn.textContent = 'Starting...';
      reindexBtn.disabled = true;

      const result = await reIndex([name], paths);

      if (result.success && result.topic && result.name) {
        activeJob = { topic: result.topic, name: result.name };

        jobStatusPoll = window.setInterval(async () => {
          try {
            const jobDetails = await fetchJobDetails(activeJob.topic, activeJob.name);
            if (jobDetails) {
              const {
                state,
                progress: {
                  processed = 0,
                  total = 0,
                } = {},
                startTime,
                stopTime,
              } = jobDetails;

              if (state === 'stopped') {
                window.clearInterval(jobStatusPoll);
                jobStatusPoll = null;
                activeJob = null;

                const duration = stopTime && startTime
                  ? ((new Date(stopTime) - new Date(startTime)) / 1000).toFixed(1)
                  : 'unknown';

                reindexBtn.textContent = 'Reindex Complete';
                reindexBtn.disabled = false;

                logResponse(consoleBlock, [200, 'JOB', `Index "${name}" reindexed: ${processed}/${total} in ${duration}s`, '']);
              } else if (state === 'failed') {
                window.clearInterval(jobStatusPoll);
                jobStatusPoll = null;
                activeJob = null;

                reindexBtn.textContent = 'Reindex Failed';
                reindexBtn.disabled = false;

                logResponse(consoleBlock, [500, 'JOB', `Index "${name}" reindex failed`, '']);
              } else {
                reindexBtn.textContent = `Reindexing... ${processed}/${total}`;
              }
            }
          } catch (error) {
            // eslint-disable-next-line no-console
            console.error(`Failed to get status for index ${name}: ${error}`);
            window.clearInterval(jobStatusPoll);
            jobStatusPoll = null;
            reindexBtn.textContent = 'Reindex';
            reindexBtn.disabled = false;
            activeJob = null;
          }
        }, 10000);

        reindexBtn.textContent = 'Reindexing... 0/0';
      } else {
        reindexBtn.textContent = 'Reindex Failed';
        reindexBtn.disabled = false;
        logResponse(consoleBlock, [result.status || 500, 'POST', `Index "${name}"`, result.error || 'Unknown error']);
      }
    });
  });
}

async function init() {
  await initConfigField();

  addIndexButton.addEventListener('click', () => {
    displayIndexDetails('', {
      target: '/query-index.json',
      include: ['/**'],
      exclude: [
        '**/fragments/**',
        '**/drafts/**',
        '**/*.json',
      ],
      properties: {
        title: {
          selectFirst: 'meta[property="og:title"]',
          value: 'attribute(el, "content")',
        },
        date: {
          selectFirst: 'meta[name="publication-date"]',
          value: 'attribute(el, "content")',
        },
        description: {
          selectFirst: 'meta[property="og:description"]',
          value: 'attribute(el, "content")',
        },
        image: {
          selectFirst: 'meta[property="og:image"]',
          value: 'attribute(el, "content")',
        },
      },
    }, true);
  });

  adminForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!org.value || !site.value) {
      // eslint-disable-next-line no-alert
      alert('Please select an organization and site first');
      return;
    }

    // Set loading state
    fetchButton.classList.add('loading');
    fetchButton.disabled = true;

    try {
      // Preflight on the fetch (entry point); the resulting session covers later saves.
      const result = await executeAdminRequest(
        () => admin.config({ org: org.value, site: site.value }).select('content/query.yaml').read(),
        { org: org.value, site: site.value, policy: AuthMode.PREFLIGHT_AND_RETRY },
      );
      if (!result) return;
      const { method, url } = result.request;
      logResponse(consoleBlock, result.status, [method, url, result.error]);

      if (result.ok) {
        await ensureYaml();
        const yamlText = await result.text();
        loadedIndices = YAML.parse(yamlText);
        populateIndexes(loadedIndices.indices);
        addIndexButton.disabled = false;
      } else if (result.status === 404) {
        // No index exists yet, but allow creating one
        loadedIndices = { indices: {} };
        populateIndexes(loadedIndices.indices);
        addIndexButton.disabled = false;
      }
    } finally {
      // Restore button state
      fetchButton.classList.remove('loading');
      fetchButton.disabled = false;
    }
  });
}

registerToolReady(init());
