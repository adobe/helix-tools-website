import { filterItems } from './combobox-filter.js';

export const CHEVRON_SVG = '<svg viewBox="0 0 12 12" width="12" height="12" fill="currentColor" aria-hidden="true"><path d="M6 8.5a.75.75 0 0 1-.53-.22L1.97 4.78a.75.75 0 0 1 1.06-1.06L6 6.69l2.97-2.97a.75.75 0 1 1 1.06 1.06L6.53 8.28A.75.75 0 0 1 6 8.5z"/></svg>';

/**
 * Creates a hand-rolled, Spectrum-styled combobox (filterable single-select with free text).
 * Follows the WAI-ARIA combobox pattern with aria-autocomplete="list".
 * @param {Object} options
 * @param {string} options.id - Base id for the input; the listbox gets `${id}-listbox`.
 * @param {string} options.label - Accessible label for the input.
 * @param {string} options.placeholder - Input placeholder text.
 * @param {boolean} [options.disabled=false] - Whether the combobox starts disabled.
 * @param {boolean} [options.labelVisible=false] - Render `label` as a visible `<label>` above the
 *   field (and rely on it for the accessible name instead of an `aria-label`).
 * @returns {{
 *   element: HTMLDivElement,
 *   getValue: () => string,
 *   setValue: (v: string) => void,
 *   setItems: (items: string[]) => void,
 *   setDisabled: (b: boolean) => void,
 *   on: (eventName: string, cb: (value: string) => void) => void,
 *   off: (eventName: string, cb: (value: string) => void) => void,
 * }}
 */
export function createCombobox({
  id, label, placeholder, disabled = false, labelVisible = false,
}) {
  const listboxId = `${id}-listbox`;

  const element = document.createElement('div');
  element.className = 'combobox';
  if (disabled) element.classList.add('is-disabled');

  if (labelVisible) {
    const labelEl = document.createElement('label');
    labelEl.className = 'combobox-label';
    labelEl.setAttribute('for', id);
    labelEl.textContent = label;
    element.append(labelEl);
  }

  const field = document.createElement('div');
  field.className = 'combobox-field';

  const input = document.createElement('input');
  input.type = 'text';
  input.id = id;
  input.name = id;
  input.className = 'combobox-input';
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-expanded', 'false');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-controls', listboxId);
  if (!labelVisible) input.setAttribute('aria-label', label);
  input.setAttribute('autocomplete', 'off');
  if (placeholder) input.placeholder = placeholder;
  if (disabled) input.disabled = true;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'combobox-button';
  button.tabIndex = -1;
  button.setAttribute('aria-hidden', 'true');
  button.innerHTML = CHEVRON_SVG;

  field.append(input, button);

  const listbox = document.createElement('ul');
  listbox.className = 'combobox-listbox';
  listbox.id = listboxId;
  listbox.setAttribute('role', 'listbox');
  listbox.hidden = true;

  element.append(field, listbox);

  let allItems = [];
  let lastCommitted = '';
  let activeIndex = -1;
  const listeners = { commit: new Set() };

  const isOpen = () => !listbox.hidden;

  const emit = (eventName, value) => {
    (listeners[eventName] || []).forEach((cb) => cb(value));
  };

  const optionElements = () => [...listbox.querySelectorAll('.combobox-option')];

  const isSelectableOption = (li) => li && !li.classList.contains('is-empty')
    && li.getAttribute('aria-disabled') !== 'true';

  const clearActive = () => {
    optionElements().forEach((li) => li.classList.remove('is-active'));
    input.removeAttribute('aria-activedescendant');
    activeIndex = -1;
  };

  const setActive = (index) => {
    const options = optionElements();
    optionElements().forEach((li) => li.classList.remove('is-active'));
    if (index < 0 || index >= options.length || !isSelectableOption(options[index])) {
      input.removeAttribute('aria-activedescendant');
      activeIndex = -1;
      return;
    }
    activeIndex = index;
    const active = options[index];
    active.classList.add('is-active');
    input.setAttribute('aria-activedescendant', active.id);
    active.scrollIntoView({ block: 'nearest' });
  };

  const renderOptions = (matches) => {
    listbox.replaceChildren();
    if (matches.length === 0) {
      const li = document.createElement('li');
      li.className = 'combobox-option is-empty';
      li.setAttribute('role', 'option');
      li.setAttribute('aria-disabled', 'true');
      li.textContent = 'No matches';
      listbox.append(li);
      return;
    }
    matches.forEach((item, i) => {
      const li = document.createElement('li');
      li.className = 'combobox-option';
      li.setAttribute('role', 'option');
      li.id = `${id}-opt-${i}`;
      li.textContent = item;
      listbox.append(li);
    });
  };

  const open = (items) => {
    if (input.disabled) return;
    renderOptions(items);
    listbox.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    clearActive();
  };

  const close = () => {
    listbox.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    activeIndex = -1;
  };

  const commit = (value) => {
    input.value = value;
    close();
    if (value !== lastCommitted) {
      lastCommitted = value;
      emit('commit', value);
    }
  };

  const commitActiveOrTyped = () => {
    if (isOpen() && activeIndex >= 0) {
      const options = optionElements();
      const active = options[activeIndex];
      if (isSelectableOption(active)) {
        commit(active.textContent);
        return;
      }
    }
    commit(input.value);
  };

  const moveActive = (delta) => {
    const options = optionElements();
    if (options.length === 0) return;
    let next = activeIndex;
    if (next < 0) {
      next = delta > 0 ? 0 : options.length - 1;
    } else {
      next += delta;
    }
    while (next >= 0 && next < options.length && !isSelectableOption(options[next])) {
      next += delta;
    }
    if (next < 0 || next >= options.length) return;
    setActive(next);
  };

  input.addEventListener('input', () => {
    if (input.disabled) return;
    const matches = filterItems(input.value, allItems);
    renderOptions(matches);
    listbox.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    clearActive();
  });

  input.addEventListener('keydown', (e) => {
    if (input.disabled) return;
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (!isOpen()) {
          open([...allItems]);
          setActive(0);
        } else {
          moveActive(1);
        }
        break;
      case 'ArrowUp':
        if (isOpen()) {
          e.preventDefault();
          moveActive(-1);
        }
        break;
      case 'Enter':
        if (isOpen()) {
          e.preventDefault();
          commitActiveOrTyped();
        } else {
          commit(input.value);
        }
        break;
      case 'Escape':
        if (isOpen()) {
          e.preventDefault();
          e.stopPropagation();
          close();
        }
        break;
      case 'Tab':
        if (isOpen()) close();
        break;
      default:
        break;
    }
  });

  button.addEventListener('mousedown', (e) => {
    // Keep focus in the input so the chevron toggle does not trigger a blur commit.
    e.preventDefault();
  });

  button.addEventListener('click', () => {
    if (input.disabled) return;
    if (isOpen()) {
      close();
    } else {
      open([...allItems]);
    }
    input.focus();
  });

  listbox.addEventListener('mousedown', (e) => {
    // Prevent the input from losing focus (which would trigger a blur commit) before the click.
    e.preventDefault();
  });

  listbox.addEventListener('click', (e) => {
    const li = e.target.closest('.combobox-option');
    if (!li || !isSelectableOption(li)) return;
    commit(li.textContent);
    input.focus();
  });

  element.addEventListener('focusout', (e) => {
    if (e.relatedTarget && element.contains(e.relatedTarget)) return;
    commit(input.value);
  });

  document.addEventListener('click', (e) => {
    if (element.contains(e.target)) return;
    if (isOpen()) close();
  });

  return {
    element,
    getValue: () => input.value,
    setValue: (v) => {
      const value = v == null ? '' : String(v);
      input.value = value;
      lastCommitted = value;
    },
    setItems: (items) => {
      allItems = [...items].filter((i) => i != null && String(i).trim() !== '');
      if (isOpen()) {
        const matches = filterItems(input.value, allItems);
        renderOptions(matches);
        clearActive();
      }
    },
    setDisabled: (b) => {
      input.disabled = !!b;
      element.classList.toggle('is-disabled', !!b);
      if (b) close();
    },
    on: (eventName, cb) => {
      if (!listeners[eventName]) listeners[eventName] = new Set();
      listeners[eventName].add(cb);
    },
    off: (eventName, cb) => {
      if (listeners[eventName]) listeners[eventName].delete(cb);
    },
  };
}
