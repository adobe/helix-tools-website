import { STORAGE_KEYS } from './constants.js';

export function getStoredTheme() {
  const v = localStorage.getItem(STORAGE_KEYS.THEME);
  return (v === 'light' || v === 'dark') ? v : null;
}

export function effectiveTheme() {
  return getStoredTheme()
    ?? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
}

export function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') {
    root.setAttribute('data-theme', theme);
    localStorage.setItem(STORAGE_KEYS.THEME, theme);
  } else {
    root.removeAttribute('data-theme');
    localStorage.removeItem(STORAGE_KEYS.THEME);
  }
}

export function themeTitle(theme) {
  return `Theme: ${theme} (click to switch)`;
}
