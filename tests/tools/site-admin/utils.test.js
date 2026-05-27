import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  getContentSourceType,
  getScoreClass,
  isExpired,
  getDAEditorURL,
  compareSites,
  buildSiteConfig,
} from '../../../tools/site-admin/helpers/utils.js';

describe('site-admin:utils.js', () => {
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

  describe('compareSites', () => {
    const s = (name) => ({ name });

    it('places the selected site before all others', () => {
      assert.equal(compareSites(s('alpha'), s('selected'), 'selected', []), 1);
      assert.equal(compareSites(s('selected'), s('alpha'), 'selected', []), -1);
    });

    it('when both are non-selected, favorites come before non-favorites', () => {
      assert.equal(compareSites(s('fav'), s('plain'), null, ['fav']), -1);
      assert.equal(compareSites(s('plain'), s('fav'), null, ['fav']), 1);
    });

    it('when both are favorites, falls back to alphabetical order', () => {
      assert.ok(compareSites(s('alpha'), s('beta'), null, ['alpha', 'beta']) < 0);
      assert.ok(compareSites(s('beta'), s('alpha'), null, ['alpha', 'beta']) > 0);
    });

    it('when neither is a favorite, sorts alphabetically', () => {
      assert.ok(compareSites(s('apple'), s('banana'), null, []) < 0);
      assert.ok(compareSites(s('banana'), s('apple'), null, []) > 0);
    });

    it('ignores selected-site logic when selectedSite is null', () => {
      // 'selected' is just a normal non-favorite when selectedSite is null
      assert.ok(compareSites(s('selected'), s('apple'), null, []) > 0);
    });

    it('selected site sorts before favorites', () => {
      assert.equal(compareSites(s('selected'), s('fav'), 'selected', ['fav']), -1);
      assert.equal(compareSites(s('fav'), s('selected'), 'selected', ['fav']), 1);
    });
  });

  describe('buildSiteConfig', () => {
    describe('GitHub code source', () => {
      it('extracts owner and repo from a GitHub URL', () => {
        const result = buildSiteConfig({}, 'https://github.com/my-org/my-repo', 'https://content.da.live/org/repo');
        assert.equal(result.code.owner, 'my-org');
        assert.equal(result.code.repo, 'my-repo');
        assert.equal(result.code.source.type, 'github');
        assert.equal(result.code.source.url, 'https://github.com/my-org/my-repo');
      });

      it('only uses the first two path segments, ignoring trailing paths', () => {
        const result = buildSiteConfig({}, 'https://github.com/my-org/my-repo/tree/main', 'https://content.da.live/org/repo');
        assert.equal(result.code.owner, 'my-org');
        assert.equal(result.code.repo, 'my-repo');
      });
    });

    describe('BYOGIT code source', () => {
      it('uses the BYOGIT fixed source config when byogit is provided', () => {
        const result = buildSiteConfig({}, '', 'https://content.da.live/org/repo', { owner: 'prog-123', repo: 'repo-456' });
        assert.equal(result.code.owner, 'prog-123');
        assert.equal(result.code.repo, 'repo-456');
        assert.equal(result.code.source.type, 'byogit');
        assert.equal(result.code.source.secretId, 'cm-byog');
      });

      it('does not parse the code URL when byogit is provided', () => {
        assert.doesNotThrow(() => buildSiteConfig({}, '', 'https://content.da.live/org/repo', { owner: 'o', repo: 'r' }));
      });
    });

    describe('content source type detection', () => {
      it('sets type to google and extracts folder id for Google Drive URLs', () => {
        const result = buildSiteConfig({}, 'https://github.com/o/r', 'https://drive.google.com/drive/folders/FOLDER_ID_123');
        assert.equal(result.content.source.type, 'google');
        assert.equal(result.content.source.id, 'FOLDER_ID_123');
      });

      it('sets type to onedrive for SharePoint URLs', () => {
        const result = buildSiteConfig({}, 'https://github.com/o/r', 'https://mycompany.sharepoint.com/sites/mysite');
        assert.equal(result.content.source.type, 'onedrive');
      });

      it('leaves type as markup for generic content URLs', () => {
        const result = buildSiteConfig({}, 'https://github.com/o/r', 'https://content.da.live/org/repo');
        assert.equal(result.content.source.type, 'markup');
        assert.equal(result.content.source.url, 'https://content.da.live/org/repo');
      });

      it('does not set source.id for non-Google-Drive URLs', () => {
        const result = buildSiteConfig({}, 'https://github.com/o/r', 'https://content.da.live/org/repo');
        assert.equal(result.content.source.id, undefined);
      });
    });

    describe('existing site config merging', () => {
      it('preserves existing site fields', () => {
        const result = buildSiteConfig({ name: 'my-site', extra: 'preserved' }, 'https://github.com/o/r', 'https://content.da.live/org/repo');
        assert.equal(result.name, 'my-site');
        assert.equal(result.extra, 'preserved');
      });

      it('overwrites code and content with newly built values', () => {
        const existing = { code: { owner: 'old' }, content: { source: { type: 'old' } } };
        const result = buildSiteConfig(existing, 'https://github.com/new-org/new-repo', 'https://content.da.live/org/repo');
        assert.equal(result.code.owner, 'new-org');
        assert.equal(result.content.source.type, 'markup');
      });
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
