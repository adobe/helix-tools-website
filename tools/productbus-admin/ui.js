/**
 * ProductBus Admin - Shared UI utilities
 * Separated to avoid circular imports between api.js and page modules
 */

export function showToast(message, type = 'success') {
  const existing = document.querySelector('.productbus-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.classList.add('productbus-toast', type);
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => toast.classList.add('show'), 10);
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

export function createModal(title, content, footer) {
  const dialog = document.createElement('dialog');
  dialog.className = 'productbus-modal';

  const titleEl = document.createElement('h3');
  titleEl.textContent = title;

  dialog.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        ${titleEl.outerHTML}
        <button type="button" class="modal-close" aria-label="Close">&times;</button>
      </div>
      <div class="modal-body"></div>
      ${footer ? '<div class="modal-footer"></div>' : ''}
    </div>
  `;

  const modalBody = dialog.querySelector('.modal-body');
  if (typeof content === 'string') {
    modalBody.innerHTML = content;
  } else {
    modalBody.appendChild(content);
  }

  if (footer) {
    const modalFooter = dialog.querySelector('.modal-footer');
    if (typeof footer === 'string') {
      modalFooter.innerHTML = footer;
    } else {
      modalFooter.appendChild(footer);
    }
  }

  const closeModal = () => {
    dialog.close();
    dialog.remove();
  };

  dialog.addEventListener('cancel', closeModal);
  dialog.querySelector('.modal-close').addEventListener('click', closeModal);
  dialog.addEventListener('click', (e) => {
    const rect = dialog.getBoundingClientRect();
    if (e.clientX < rect.left || e.clientX > rect.right
        || e.clientY < rect.top || e.clientY > rect.bottom) {
      closeModal();
    }
  });

  document.body.appendChild(dialog);
  dialog.showModal();
  return dialog;
}

export function createFormField(name, label, type = 'text', options = {}) {
  const {
    required = false, placeholder = '', value = '', disabled = false, maxLength = '',
  } = options;

  const field = document.createElement('div');
  field.className = 'form-field';

  const labelEl = document.createElement('label');
  labelEl.textContent = label;
  labelEl.setAttribute('for', name);

  const input = document.createElement(type === 'textarea' ? 'textarea' : 'input');
  input.id = name;
  input.name = name;
  if (type !== 'textarea') input.type = type;
  if (required) input.required = true;
  if (placeholder) input.placeholder = placeholder;
  if (value) input.value = value;
  if (disabled) input.disabled = true;
  if (maxLength) input.maxLength = maxLength;

  field.appendChild(labelEl);
  field.appendChild(input);
  return field;
}
