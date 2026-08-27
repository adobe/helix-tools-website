import { escapeHtml } from './utils.js';

/**
 * Show a small floating progress indicator for a direct (no-review-modal)
 * upload — starts indeterminate and switches to a determinate bar once
 * real upload-progress events arrive.
 * @param {string} filename
 * @returns {{
 *   update: (fraction: number) => void,
 *   done: () => void,
 *   fail: (message?: string) => void,
 * }}
 */
export default function showUploadProgress(filename) {
  const el = document.createElement('div');
  el.className = 'wac-upload-progress indeterminate';
  el.innerHTML = `
    <p class="upload-progress-label">Uploading ${escapeHtml(filename)}…</p>
    <div class="upload-progress-track"><div class="upload-progress-bar"></div></div>
  `;
  document.body.append(el);

  const label = el.querySelector('.upload-progress-label');
  const bar = el.querySelector('.upload-progress-bar');

  return {
    update(fraction) {
      el.classList.remove('indeterminate');
      bar.style.width = `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`;
    },
    done() {
      el.classList.remove('indeterminate');
      el.classList.add('done');
      label.textContent = `Uploaded ${filename}`;
      bar.style.width = '100%';
      setTimeout(() => el.remove(), 1500);
    },
    fail(message) {
      el.classList.remove('indeterminate');
      el.classList.add('failed');
      label.textContent = message || `Failed to upload ${filename}`;
      setTimeout(() => el.remove(), 3000);
    },
  };
}
