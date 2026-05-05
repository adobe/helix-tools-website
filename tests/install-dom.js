/**
 * Provides minimal browser globals for unit tests of DOM-based utilities (e.g. escapeHtml).
 */
/* eslint-env node */
import { JSDOM } from 'jsdom';

if (typeof global.document === 'undefined') {
  const dom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>', {
    url: 'http://localhost/',
  });
  global.window = dom.window;
  global.document = dom.window.document;
}
