import { describe, test, expect } from 'vitest';
import {
  escapeHtml,
  getContentSourceType,
  getScoreClass,
  getDAEditorURL,
} from '../tools/site-admin/helpers/utils.js';

// --- escapeHtml ---

describe('escapeHtml', () => {
  test('escapes &', () => expect(escapeHtml('a & b')).toBe('a &amp; b'));
  test('escapes <', () => expect(escapeHtml('<div>')).toBe('&lt;div&gt;'));
  test('escapes >', () => expect(escapeHtml('a > b')).toBe('a &gt; b'));
  test('escapes "', () => expect(escapeHtml('"quoted"')).toBe('&quot;quoted&quot;'));
  test("escapes '", () => expect(escapeHtml("it's")).toBe('it&#39;s'));
  test('escapes all special chars in one string', () => {
    expect(escapeHtml('<a href="x" data-val=\'y\'>a & b</a>'))
      .toBe('&lt;a href=&quot;x&quot; data-val=&#39;y&#39;&gt;a &amp; b&lt;/a&gt;');
  });
  test('passes through plain strings unchanged', () => expect(escapeHtml('hello world')).toBe('hello world'));
  test('handles empty string', () => expect(escapeHtml('')).toBe(''));
});

// --- getScoreClass ---

describe('getScoreClass', () => {
  test('90 is good', () => expect(getScoreClass(90)).toBe('good'));
  test('100 is good', () => expect(getScoreClass(100)).toBe('good'));
  test('89 is average', () => expect(getScoreClass(89)).toBe('average'));
  test('50 is average', () => expect(getScoreClass(50)).toBe('average'));
  test('49 is poor', () => expect(getScoreClass(49)).toBe('poor'));
  test('0 is poor', () => expect(getScoreClass(0)).toBe('poor'));
});

// --- getDAEditorURL ---

describe('getDAEditorURL', () => {
  test('returns null for null input', () => expect(getDAEditorURL(null)).toBeNull());
  test('returns null for empty string', () => expect(getDAEditorURL('')).toBeNull());

  test('transforms content.da.live URL to DA editor URL', () => {
    expect(getDAEditorURL('https://content.da.live/org/repo'))
      .toBe('https://da.live/#/org/repo');
  });

  test('transforms stage-content.da.live URL to DA editor URL', () => {
    expect(getDAEditorURL('https://stage-content.da.live/org/repo'))
      .toBe('https://da.live/#/org/repo');
  });

  test('returns non-DA URLs unchanged', () => {
    const url = 'https://example.com/path';
    expect(getDAEditorURL(url)).toBe(url);
  });
});

// --- getContentSourceType ---

describe('getContentSourceType', () => {
  test('returns loading when isLoading is true', () => {
    expect(getContentSourceType(null, null, true)).toEqual({ type: 'loading', label: '...' });
  });

  test('returns unknown when both contentUrl and contentSourceType are absent', () => {
    expect(getContentSourceType(null, null)).toEqual({ type: 'unknown', label: '?' });
  });

  test('google returns Google Drive', () => {
    expect(getContentSourceType(null, 'google')).toEqual({ type: 'google', label: 'Google Drive' });
  });

  test('onedrive returns Sharepoint', () => {
    expect(getContentSourceType(null, 'onedrive')).toEqual({ type: 'sharepoint', label: 'Sharepoint' });
  });

  test('markup + content.da.live URL returns DA', () => {
    expect(getContentSourceType('https://content.da.live/org/repo', 'markup'))
      .toEqual({ type: 'da', label: 'DA' });
  });

  test('markup + adobeaemcloud URL returns AEM', () => {
    expect(getContentSourceType('https://author.adobeaemcloud.com/content/dam', 'markup'))
      .toEqual({ type: 'aem', label: 'AEM' });
  });

  test('markup + other URL returns BYOM', () => {
    expect(getContentSourceType('https://example.com/content', 'markup'))
      .toEqual({ type: 'byom', label: 'BYOM' });
  });

  test('unrecognized contentSourceType returns unknown', () => {
    expect(getContentSourceType(null, 'custom-cms')).toEqual({ type: 'unknown', label: '?' });
  });

  test('loading takes precedence over other params', () => {
    expect(getContentSourceType('https://content.da.live/org', 'google', true))
      .toEqual({ type: 'loading', label: '...' });
  });
});
