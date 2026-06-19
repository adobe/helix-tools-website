import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RewrittenData } from '../../../tools/log-viewer/rewrite.js';

const LIVE = 'main--site--owner.aem.live';
const PREVIEW = 'main--site--owner.aem.page';

describe('log-viewer:rewrite.js', () => {
  describe('RewrittenData.path() — indexer', () => {
    const base = {
      route: 'indexer', owner: 'owner', repo: 'repo', ref: 'main',
    };

    it('renders an array of change strings', () => {
      const rd = new RewrittenData({ ...base, changes: ['/foo 12ms', '/bar 8ms'] }, LIVE, PREVIEW);
      const html = rd.path();
      assert.match(html, /\/foo/);
      assert.match(html, /\/bar/);
      assert.equal(rd.data.duration, 20);
    });

    it('does not throw when changes is a number (non-array)', () => {
      const rd = new RewrittenData({ ...base, changes: 5 }, LIVE, PREVIEW);
      assert.doesNotThrow(() => rd.path());
    });

    it('does not throw when changes is a single string (non-array)', () => {
      const rd = new RewrittenData({ ...base, changes: '/foo 12ms' }, LIVE, PREVIEW);
      let html;
      assert.doesNotThrow(() => { html = rd.path(); });
      assert.match(html, /\/foo/);
    });

    it('returns "-" when changes is absent', () => {
      const rd = new RewrittenData({ ...base }, LIVE, PREVIEW);
      assert.equal(rd.path(), '-');
    });
  });
});
