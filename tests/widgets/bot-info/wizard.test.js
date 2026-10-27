import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectContentSourceKind,
  buildContentSource,
  contentSourceChanged,
  diffOrgUsers,
  validateContentSelection,
  usersError,
} from '../../../widgets/bot-info/wizard.js';

describe('bot-info:wizard.js', () => {
  describe('detectContentSourceKind', () => {
    it('defaults to da for an empty url', () => {
      assert.equal(detectContentSourceKind(''), 'da');
      assert.equal(detectContentSourceKind(undefined), 'da');
    });

    it('detects google drive', () => {
      assert.equal(detectContentSourceKind('https://drive.google.com/drive/folders/abc123'), 'google');
    });

    it('detects sharepoint', () => {
      assert.equal(detectContentSourceKind('https://example.sharepoint.com/sites/x'), 'onedrive');
    });

    it('detects DA', () => {
      assert.equal(detectContentSourceKind('https://content.da.live/org/site'), 'da');
    });

    it('detects AEM (api.aem.live only)', () => {
      assert.equal(detectContentSourceKind('https://api.aem.live/org/sites/site/source'), 'aem');
    });

    it('falls back to byom for unknown markup hosts, including adobeaemcloud/franklin.delivery', () => {
      assert.equal(detectContentSourceKind('https://example.com/content'), 'byom');
      assert.equal(detectContentSourceKind('https://author-p123.adobeaemcloud.com/'), 'byom');
      assert.equal(
        detectContentSourceKind('https://author-p130360-e1272151.adobeaemcloud.com/bin/franklin.delivery/adobe-rnd/aem-boilerplate-xwalk/main'),
        'byom',
      );
    });
  });

  describe('buildContentSource', () => {
    it('builds a markup source for DA', () => {
      assert.deepEqual(
        buildContentSource('https://content.da.live/org/site', 'da'),
        { type: 'markup', url: 'https://content.da.live/org/site' },
      );
    });

    it('builds a sourcebus connector without a URL for built-in AEM', () => {
      assert.deepEqual(
        buildContentSource('https://api.aem.live/org/sites/site/source', 'aem'),
        { type: 'sourcebus' },
      );
    });

    it('omits the URL and suffix for built-in AEM even when supplied', () => {
      assert.deepEqual(
        buildContentSource('https://api.aem.live/org/sites/site/source', 'aem', '.html'),
        { type: 'sourcebus' },
      );
      assert.deepEqual(
        buildContentSource('', 'aem'),
        { type: 'sourcebus' },
      );
    });

    it('builds a markup source for BYOM', () => {
      assert.equal(buildContentSource('https://x.example.com', 'byom').type, 'markup');
    });

    it('builds an onedrive source for sharepoint', () => {
      assert.deepEqual(
        buildContentSource('https://x.sharepoint.com/sites/y', 'onedrive'),
        { type: 'onedrive', url: 'https://x.sharepoint.com/sites/y' },
      );
    });

    it('builds a google source and extracts the folder id', () => {
      const result = buildContentSource('https://drive.google.com/drive/folders/FOLDER_ID', 'google');
      assert.equal(result.type, 'google');
      assert.equal(result.id, 'FOLDER_ID');
    });

    it('leaves google id unset for an unparseable url', () => {
      const result = buildContentSource('not a url', 'google');
      assert.equal(result.type, 'google');
      assert.equal(result.id, undefined);
    });

    it('defaults to markup for an unknown kind', () => {
      assert.equal(buildContentSource('https://x.com', 'bogus').type, 'markup');
    });

    it('adds a suffix only for BYOM', () => {
      assert.equal(buildContentSource('https://x.example.com', 'byom', '.html').suffix, '.html');
    });

    it('never sets a suffix for DA, SharePoint, Google Drive or AEM', () => {
      assert.equal(buildContentSource('https://content.da.live/o/s', 'da', '.html').suffix, undefined);
      assert.equal(buildContentSource('https://x.sharepoint.com', 'onedrive', '.html').suffix, undefined);
      assert.equal(buildContentSource('https://drive.google.com/drive/folders/x', 'google', '.html').suffix, undefined);
      assert.equal(buildContentSource('https://api.aem.live/o/sites/s/source', 'aem', '.html').suffix, undefined);
    });

    it('omits the suffix when none is provided', () => {
      assert.equal(buildContentSource('https://x.example.com', 'byom').suffix, undefined);
    });
  });

  describe('contentSourceChanged', () => {
    it('skips an unchanged source for every content kind', () => {
      [
        ['https://content.da.live/org/site', 'da'],
        ['https://api.aem.live/org/sites/site/source', 'aem'],
        ['https://x.sharepoint.com/sites/y', 'onedrive'],
        ['https://drive.google.com/drive/folders/FOLDER_ID', 'google'],
        ['https://example.com/content', 'byom', '.html'],
      ].forEach(([url, kind, suffix]) => {
        const original = buildContentSource(url, kind, suffix);
        assert.equal(contentSourceChanged(original, buildContentSource(url, kind, suffix)), false);
      });
    });

    it('ignores source options not managed by the wizard', () => {
      const source = buildContentSource('https://content.da.live/org/site', 'da');
      assert.equal(contentSourceChanged({ ...source, extra: true }, source), false);
    });

    it('saves when the site has no content source', () => {
      const source = buildContentSource('https://content.da.live/org/site', 'da');
      assert.equal(contentSourceChanged(undefined, source), true);
      assert.equal(contentSourceChanged({}, source), true);
    });

    it('saves a changed URL, type or Google folder id', () => {
      const source = buildContentSource('https://drive.google.com/drive/folders/FOLDER_ID', 'google');
      ['url', 'type', 'id'].forEach((key) => {
        assert.equal(contentSourceChanged({ ...source, [key]: 'different' }, source), true);
      });
    });

    it('saves an added, changed or removed suffix', () => {
      const source = buildContentSource('https://example.com/content', 'byom');
      const withSuffix = { ...source, suffix: '.html' };
      assert.equal(contentSourceChanged(source, withSuffix), true);
      assert.equal(contentSourceChanged(withSuffix, { ...source, suffix: '.md' }), true);
      assert.equal(contentSourceChanged(withSuffix, source), true);
    });
  });

  describe('diffOrgUsers', () => {
    const orig = [
      { email: 'a@b.com', id: '1', roles: ['admin'] },
      { email: 'c@d.com', id: '2', roles: ['author'] },
    ];

    it('detects added users (no id)', () => {
      const current = [...orig, { email: 'new@x.com', roles: ['author'] }];
      const { toAdd, toRemove, toUpdate } = diffOrgUsers(orig, current);
      assert.deepEqual(toAdd, [{ email: 'new@x.com', roles: ['author'] }]);
      assert.equal(toRemove.length, 0);
      assert.equal(toUpdate.length, 0);
    });

    it('detects removed users and carries their id', () => {
      const current = [orig[0]];
      const { toRemove } = diffOrgUsers(orig, current);
      assert.equal(toRemove.length, 1);
      assert.equal(toRemove[0].id, '2');
    });

    it('detects role changes as updates keeping the id', () => {
      const current = [
        { email: 'a@b.com', id: '1', roles: ['admin', 'publish'] },
        orig[1],
      ];
      const { toUpdate, toAdd, toRemove } = diffOrgUsers(orig, current);
      assert.equal(toAdd.length, 0);
      assert.equal(toRemove.length, 0);
      assert.equal(toUpdate.length, 1);
      assert.equal(toUpdate[0].id, '1');
      assert.deepEqual(toUpdate[0].roles, ['admin', 'publish']);
    });

    it('ignores role order when comparing', () => {
      const current = [
        { email: 'a@b.com', id: '1', roles: ['admin'] },
        { email: 'c@d.com', id: '2', roles: ['author'] },
      ];
      const { toUpdate } = diffOrgUsers(orig, current);
      assert.equal(toUpdate.length, 0);
    });

    it('matches emails case-insensitively', () => {
      const current = [
        { email: 'A@B.com', id: '1', roles: ['admin'] },
        { email: 'c@d.com', id: '2', roles: ['author'] },
      ];
      const { toAdd, toRemove } = diffOrgUsers(orig, current);
      assert.equal(toAdd.length, 0);
      assert.equal(toRemove.length, 0);
    });

    it('handles empty inputs', () => {
      assert.deepEqual(diffOrgUsers(), { toAdd: [], toRemove: [], toUpdate: [] });
    });
  });

  describe('validateContentSelection', () => {
    it('accepts the DA default (not advanced)', () => {
      assert.equal(validateContentSelection({ advanced: false, url: '' }), null);
    });

    it('rejects an empty url when advanced', () => {
      assert.equal(
        validateContentSelection({ advanced: true, url: '   ' }),
        'Enter a content source URL.',
      );
    });

    it('accepts a url when advanced', () => {
      assert.equal(
        validateContentSelection({ advanced: true, url: 'https://example.com' }),
        null,
      );
    });
  });

  describe('usersError', () => {
    const someUsers = [{ email: 'a@b.com' }];

    it('requires at least one org user for a new org', () => {
      assert.equal(
        usersError([], true),
        'Add at least one organization user before saving.',
      );
    });

    it('allows no users for an existing org (site access can be inherited)', () => {
      assert.equal(usersError([], false), null);
    });

    it('passes when a new org has an org user', () => {
      assert.equal(usersError(someUsers, true), null);
    });
  });
});
