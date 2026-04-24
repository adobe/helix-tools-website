import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  escapeHtml,
  getContentSourceType,
  getScoreClass,
  isExpired,
  getDAEditorURL,
} from '../helpers/utils.js';

describe('site-admin:utils.js', () => {
  describe('escapeHtml', () => {
    it('escapes all five special characters', () => {
      assert.equal(escapeHtml('&<>"\' '), '&amp;&lt;&gt;&quot;&#39; ');
    });

    it('returns plain strings unchanged', () => {
      assert.equal(escapeHtml('hello world'), 'hello world');
    });

    it('handles empty string', () => {
      assert.equal(escapeHtml(''), '');
    });

    it('escapes multiple occurrences', () => {
      assert.equal(escapeHtml('a & b & c'), 'a &amp; b &amp; c');
    });
  });

  describe('getContentSourceType', () => {
    it('returns loading state when isLoading is true', () => {
      assert.deepEqual(getContentSourceType('', '', true), { type: 'loading', label: '...' });
    });

    it('returns unknown when both contentUrl and contentSourceType are empty', () => {
      assert.deepEqual(getContentSourceType('', ''), { type: 'unknown', label: '?' });
    });

    it('returns unknown when both are null/undefined', () => {
      assert.deepEqual(getContentSourceType(null, null), { type: 'unknown', label: '?' });
    });

    it('recognizes google source type', () => {
      assert.deepEqual(getContentSourceType('', 'google'), { type: 'google', label: 'Google Drive' });
    });

    it('recognizes onedrive source type', () => {
      assert.deepEqual(getContentSourceType('', 'onedrive'), { type: 'sharepoint', label: 'Sharepoint' });
    });

    it('recognizes DA content URL with markup type', () => {
      assert.deepEqual(
        getContentSourceType('https://content.da.live/org/repo', 'markup'),
        { type: 'da', label: 'DA' },
      );
    });

    it('recognizes AEM content URL with markup type', () => {
      assert.deepEqual(
        getContentSourceType('https://author.adobeaemcloud.com/content', 'markup'),
        { type: 'aem', label: 'AEM' },
      );
    });

    it('falls back to BYOM for markup type with unrecognized URL', () => {
      assert.deepEqual(
        getContentSourceType('https://example.com/content', 'markup'),
        { type: 'byom', label: 'BYOM' },
      );
    });

    it('returns unknown for unrecognized source type', () => {
      assert.deepEqual(getContentSourceType('https://example.com', 'unknown-type'), { type: 'unknown', label: '?' });
    });
  });

  describe('getScoreClass', () => {
    it('returns good for scores >= 90', () => {
      assert.equal(getScoreClass(90), 'good');
      assert.equal(getScoreClass(100), 'good');
    });

    it('returns average for scores between 50 and 89', () => {
      assert.equal(getScoreClass(50), 'average');
      assert.equal(getScoreClass(89), 'average');
    });

    it('returns poor for scores below 50', () => {
      assert.equal(getScoreClass(49), 'poor');
      assert.equal(getScoreClass(0), 'poor');
    });
  });

  describe('isExpired', () => {
    it('returns false for null/undefined', () => {
      assert.equal(isExpired(null), false);
      assert.equal(isExpired(undefined), false);
    });

    it('returns true for a date in the past', () => {
      assert.equal(isExpired('2020-01-01T00:00:00Z'), true);
    });

    it('returns false for a date in the future', () => {
      assert.equal(isExpired('2099-01-01T00:00:00Z'), false);
    });
  });

  describe('getDAEditorURL', () => {
    it('returns null for null input', () => {
      assert.equal(getDAEditorURL(null), null);
    });

    it('returns null for empty string', () => {
      assert.equal(getDAEditorURL(''), null);
    });

    it('transforms content.da.live URL to DA editor URL', () => {
      assert.equal(
        getDAEditorURL('https://content.da.live/org/repo/path'),
        'https://da.live/#/org/repo/path',
      );
    });

    it('transforms stage-content.da.live URL to DA editor URL', () => {
      assert.equal(
        getDAEditorURL('https://stage-content.da.live/org/repo/path'),
        'https://da.live/#/org/repo/path',
      );
    });

    it('returns non-DA URLs unchanged', () => {
      assert.equal(
        getDAEditorURL('https://docs.google.com/spreadsheets/d/abc'),
        'https://docs.google.com/spreadsheets/d/abc',
      );
    });
  });
});
