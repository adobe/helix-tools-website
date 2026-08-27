import inspectZip from './zip.js';
import { wacApi } from './session.js';
import { createModal, showConfirmDialog, promptForSecret } from './modal.js';
import { showToast } from '../../utils/card-ui/card-ui.js';
import {
  kebabFromZipName, formatBytes, escapeHtml, toApiPath, displayPath, isZipFile,
} from './utils.js';

function resetDropzone(dropzone, title, sub, fileLabel) {
  dropzone.classList.remove('has-file', 'dragover');
  title.textContent = 'Drop a .zip here';
  sub.textContent = 'or click to choose';
  fileLabel.hidden = true;
  fileLabel.textContent = '';
}

/**
 * Open the upload modal. Resolves with the uploaded container's path on
 * success, or null if the user cancelled.
 *
 * Uploads always go into `pathPrefix` — the folder currently visible in
 * the browse list — and the container is always named after the zip
 * file itself (no manual naming step). If the resulting path matches an
 * existing container (`existingPaths`), the user is asked to confirm
 * before it's overwritten — there's no separate "replace" flow; the
 * worker's upload endpoint always overwrites whatever was at that path.
 * @param {{ org: string, site: string, email: string, secret: string }} session
 * @param {{ pathPrefix?: string, existingPaths?: string[], initialFile?: File }} [opts]
 *   `pathPrefix` (e.g. the current browse folder + "/", or "" for the
 *   root) is where the upload lands. `existingPaths` is the list of
 *   container paths already present, used to prompt before overwriting.
 *   `initialFile` pre-loads a file dropped outside the modal (e.g.
 *   directly onto the browse list) as if it had been dropped here.
 * @returns {Promise<string|null>}
 */
export default function openUploadModal(session, {
  pathPrefix = '', existingPaths = [], initialFile = null,
} = {}) {
  return new Promise((resolve) => {
    let pendingZip = null;

    const { body, footer, closeModal } = createModal('Upload container', { className: 'upload-modal' });
    let resolved = false;
    const finish = (value) => {
      if (resolved) return;
      resolved = true;
      closeModal();
      resolve(value);
    };
    body.closest('dialog').addEventListener('cancel', () => finish(null), { once: true });

    body.innerHTML = `
      <div class="dropzone" id="dropzone" tabindex="0">
        <p class="dropzone-title" id="dropzone-title">Drop a .zip here</p>
        <p class="dropzone-sub" id="dropzone-sub">or click to choose</p>
        <p class="dropzone-file" id="dropzone-file" hidden></p>
        <input id="zip-file" type="file" accept=".zip,application/zip" required>
      </div>
      <p class="destination" id="upload-destination" hidden></p>
      <details id="zip-details" class="zip-details" hidden>
        <summary id="zip-summary"></summary>
        <pre class="file-list" id="file-list"></pre>
      </details>
      <div id="default-picker" class="form-field" hidden>
        <label for="default-asset">Default page</label>
        <select id="default-asset"></select>
      </div>
      <div class="status" id="upload-status"></div>
    `;

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'button outline';
    cancelBtn.textContent = 'Cancel';
    const submitBtn = document.createElement('button');
    submitBtn.type = 'button';
    submitBtn.className = 'button';
    submitBtn.textContent = 'Upload';
    footer.append(cancelBtn, submitBtn);
    cancelBtn.addEventListener('click', () => finish(null));

    const dropzone = body.querySelector('#dropzone');
    const dropzoneTitle = body.querySelector('#dropzone-title');
    const dropzoneSub = body.querySelector('#dropzone-sub');
    const dropzoneFile = body.querySelector('#dropzone-file');
    const zipFile = body.querySelector('#zip-file');
    const zipDetails = body.querySelector('#zip-details');
    const zipSummary = body.querySelector('#zip-summary');
    const fileList = body.querySelector('#file-list');
    const defaultPicker = body.querySelector('#default-picker');
    const defaultAsset = body.querySelector('#default-asset');
    const uploadStatus = body.querySelector('#upload-status');
    const uploadDestination = body.querySelector('#upload-destination');

    /** The container path implied by the currently-accepted zip, if any. */
    function currentPath() {
      return pendingZip ? `${pathPrefix}${kebabFromZipName(pendingZip.name)}` : '';
    }

    function updateDestination() {
      const path = currentPath();
      if (!path) {
        uploadDestination.hidden = true;
        return;
      }
      uploadDestination.hidden = false;
      uploadDestination.innerHTML = `Uploading to <code>${escapeHtml(displayPath(path))}</code>`;
    }

    function populateDefaultPicker(files) {
      const htmlFiles = files.filter((f) => /\.html?$/i.test(f));
      if (!htmlFiles.length) {
        defaultPicker.hidden = true;
        defaultAsset.innerHTML = '';
        uploadStatus.textContent = 'No index.html — zip needs at least one .html file for a default page';
        uploadStatus.className = 'status bad';
        return;
      }
      defaultAsset.innerHTML = htmlFiles.map((f) => `<option value="${escapeHtml(f)}">${escapeHtml(f)}</option>`).join('');
      defaultPicker.hidden = false;
      uploadStatus.textContent = '';
      uploadStatus.className = 'status';
    }

    async function acceptZipFile(file) {
      pendingZip = null;
      defaultPicker.hidden = true;
      zipDetails.hidden = true;
      fileList.textContent = '';
      uploadStatus.textContent = '';
      uploadStatus.className = 'status';

      if (!isZipFile(file)) {
        resetDropzone(dropzone, dropzoneTitle, dropzoneSub, dropzoneFile);
        updateDestination();
        uploadStatus.textContent = 'Not a zip file';
        uploadStatus.className = 'status bad';
        return;
      }

      try {
        const inspected = await inspectZip(file);
        pendingZip = { ...inspected, name: file.name };
        dropzone.classList.add('has-file');
        dropzoneTitle.textContent = file.name;
        dropzoneSub.textContent = '';
        dropzoneFile.hidden = true;
        updateDestination();

        const n = inspected.files.length;
        zipSummary.textContent = `${n} file${n === 1 ? '' : 's'} · ${formatBytes(inspected.extractedBytes)}`;
        fileList.textContent = inspected.files.join('\n');
        zipDetails.hidden = false;

        if (!inspected.hasIndex) populateDefaultPicker(inspected.files);
      } catch (err) {
        resetDropzone(dropzone, dropzoneTitle, dropzoneSub, dropzoneFile);
        updateDestination();
        uploadStatus.textContent = err.message || 'Invalid zip';
        uploadStatus.className = 'status bad';
      }
    }

    zipFile.addEventListener('change', async () => {
      const file = zipFile.files?.[0];
      if (!file) {
        pendingZip = null;
        resetDropzone(dropzone, dropzoneTitle, dropzoneSub, dropzoneFile);
        updateDestination();
        return;
      }
      await acceptZipFile(file);
    });

    ['dragenter', 'dragover'].forEach((type) => {
      dropzone.addEventListener(type, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropzone.classList.add('dragover');
      });
    });
    dropzone.addEventListener('dragleave', (e) => {
      e.preventDefault();
      if (!dropzone.contains(e.relatedTarget)) dropzone.classList.remove('dragover');
    });
    dropzone.addEventListener('drop', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.remove('dragover');
      const file = e.dataTransfer?.files?.[0];
      if (file) await acceptZipFile(file);
    });
    dropzone.addEventListener('click', () => zipFile.click());

    submitBtn.addEventListener('click', async () => {
      const path = currentPath();
      if (!pendingZip || !path) {
        uploadStatus.textContent = 'Drop or choose a valid zip first';
        uploadStatus.className = 'status bad';
        return;
      }
      if (!pendingZip.hasIndex && !defaultAsset.value) {
        uploadStatus.textContent = 'Pick a default page';
        uploadStatus.className = 'status bad';
        return;
      }

      if (existingPaths.includes(path)) {
        const overwrite = await showConfirmDialog(
          `A container already exists at ${displayPath(path)}. Overwrite it?`,
          { confirmText: 'Overwrite', danger: true },
        );
        if (!overwrite) return;
      }

      submitBtn.disabled = true;
      uploadStatus.textContent = `Uploading to ${displayPath(path)}…`;
      uploadStatus.className = 'status';
      try {
        const headers = { 'Content-Type': 'application/zip' };
        if (!pendingZip.hasIndex) headers['X-WAC-Default'] = defaultAsset.value;
        await wacApi(session, promptForSecret, `/${session.org}/${session.site}/${toApiPath(path)}.wac`, {
          method: 'POST',
          headers,
          body: pendingZip.bytes,
        });
        showToast('Container uploaded');
        finish(path);
      } catch (err) {
        uploadStatus.textContent = err.message || 'Upload failed';
        uploadStatus.className = 'status bad';
        submitBtn.disabled = false;
      }
    });

    if (initialFile) acceptZipFile(initialFile);
  });
}
