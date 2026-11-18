import { registerToolReady } from '../../scripts/scripts.js';
import { initConfigField, updateConfig } from '../../utils/config/config.js';
import { saveDownload } from '../../utils/zip-download.js';
import { planCodeZip } from '../code-browser/code-api.js';
import { codeRoot } from '../code-browser/utils.js';
import { isSourceFolder, planSourceDownload } from './source.js';

const form = document.getElementById('zipper-form');
const fields = document.getElementById('zipper-fields');
const org = document.getElementById('org');
const site = document.getElementById('site');
const mode = document.getElementById('download-type');
const branch = document.getElementById('branch');
const sourcePath = document.getElementById('source-path');
const status = document.getElementById('zipper-status');
const error = document.getElementById('zipper-error');
const preview = document.getElementById('zipper-preview');
const previewTitle = document.getElementById('preview-title');
const previewPaths = document.getElementById('preview-paths');
const previewSkipped = document.getElementById('preview-skipped');
const downloadZip = document.getElementById('download-zip');
const submitButton = document.getElementById('zipper-submit');

let zip;

function showMode() {
  const code = mode.value === 'code';
  document.getElementById('branch-field').hidden = !code;
  document.getElementById('source-field').hidden = code;
  branch.disabled = !code;
  sourcePath.disabled = code;
}

function progress(message) {
  status.textContent = message;
}

function clearPreview() {
  zip = null;
  preview.hidden = true;
  previewPaths.replaceChildren();
}

function onInput() {
  clearPreview();
  progress('');
  error.hidden = true;
  submitButton.textContent = mode.value === 'code' || isSourceFolder(sourcePath.value)
    ? 'Preview ZIP'
    : 'Download file';
}

function pathItems(paths) {
  const list = document.createDocumentFragment();
  paths.forEach((path) => {
    const item = document.createElement('li');
    item.textContent = path;
    list.append(item);
  });
  return list;
}

function showPreview(plan) {
  const { filename, fileCount, skipped } = plan;
  const folderCount = plan.paths.length - fileCount;
  document.getElementById('preview-summary').textContent = `${filename}: ${fileCount} ${fileCount === 1 ? 'file' : 'files'}, ${folderCount} ${folderCount === 1 ? 'folder' : 'folders'}`;
  previewPaths.replaceChildren(pathItems(plan.paths));
  previewSkipped.hidden = !skipped.length;
  previewSkipped.open = false;
  previewSkipped.querySelector('summary').textContent = `Incomplete export: ${skipped.length} folder ${skipped.length === 1 ? 'listing' : 'listings'} failed`;
  previewSkipped.querySelector('ul').replaceChildren(pathItems(skipped));
  downloadZip.textContent = skipped.length ? 'Download partial ZIP' : 'Download ZIP';
  zip = plan;
  preview.hidden = false;
  previewTitle.focus();
}

async function run(action) {
  if (fields.disabled) return;
  fields.disabled = true;
  downloadZip.disabled = true;
  error.hidden = true;
  try {
    await action();
  } catch (err) {
    progress('');
    error.textContent = err.message;
    error.hidden = false;
  } finally {
    fields.disabled = false;
    downloadZip.disabled = !zip || (zip.skipped.length > 0 && zip.fileCount === 0);
  }
}

async function save(plan) {
  const blob = await plan.download(progress);
  saveDownload(blob, plan.filename);
  progress(`Download started: ${plan.filename}`);
}

function submit(event) {
  event.preventDefault();
  run(async () => {
    clearPreview();
    progress('Preparing...');
    org.value = org.value.trim();
    site.value = site.value.trim();
    let plan;
    if (mode.value === 'code') {
      const ref = branch.value.trim();
      if (!/^[a-z0-9][a-z0-9-]*$/i.test(ref)) {
        throw new Error('Enter a CodeBus branch name (letters, numbers, and hyphens).');
      }
      const root = codeRoot(org.value, site.value);
      plan = await planCodeZip(root, `${root}${ref}/`, progress, { bestEffort: true });
    } else {
      plan = await planSourceDownload(org.value, site.value, sourcePath.value, progress);
    }
    if (plan.paths) {
      if (!plan.skipped.length) progress('ZIP preview ready.');
      else if (plan.fileCount) progress('Partial ZIP preview ready.');
      else progress('No files found in the accessible listings.');
      showPreview(plan);
    } else {
      await save(plan);
    }
    updateConfig();
  });
}

async function init() {
  form.addEventListener('submit', submit);
  form.addEventListener('input', onInput);
  form.addEventListener('change', onInput);
  mode.addEventListener('change', showMode);
  downloadZip.addEventListener('click', () => {
    if (zip) run(() => save(zip));
  });
  org.addEventListener('input', () => { site.disabled = !org.value.trim(); });
  showMode();
  await initConfigField();
}

registerToolReady(init());
