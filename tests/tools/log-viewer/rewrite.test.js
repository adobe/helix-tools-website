import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RewrittenData } from '../../../tools/log-viewer/rewrite.js';

const LIVE = 'main--site--owner.aem.live';
const PREVIEW = 'main--site--owner.aem.page';

describe('log-viewer:rewrite.js', () => {
  describe('RewrittenData.timestamp()', () => {
    it('returns "-" when no value', () => {
      const rd = new RewrittenData({}, LIVE, PREVIEW);
      assert.equal(rd.timestamp(null), '-');
      assert.equal(rd.timestamp(undefined), '-');
      assert.equal(rd.timestamp(0), '-');
    });

    it('formats a timestamp', () => {
      const rd = new RewrittenData({}, LIVE, PREVIEW);
      const result = rd.timestamp('2024-01-15T12:00:00Z');
      assert.match(result, /01\/15\/2024/);
      assert.match(result, /UTC/);
    });
  });

  describe('RewrittenData.user()', () => {
    it('returns "-" when no value', () => {
      const rd = new RewrittenData({}, LIVE, PREVIEW);
      assert.equal(rd.user(null), '-');
      assert.equal(rd.user(''), '-');
    });

    it('formats email as mailto link showing username', () => {
      const rd = new RewrittenData({}, LIVE, PREVIEW);
      const result = rd.user('alice@example.com');
      assert.match(result, /href="mailto:alice@example\.com"/);
      assert.match(result, /alice/);
    });
  });

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

    it('does not throw when changes is a plain object (non-array)', () => {
      const rd = new RewrittenData({ ...base, changes: { count: 5 } }, LIVE, PREVIEW);
      assert.doesNotThrow(() => rd.path());
    });

    it('does not throw when changes is an array of objects', () => {
      const rd = new RewrittenData({ ...base, changes: [{ path: '/foo', ms: 12 }] }, LIVE, PREVIEW);
      assert.doesNotThrow(() => rd.path());
    });

    it('returns "-" when changes is absent', () => {
      const rd = new RewrittenData({ ...base }, LIVE, PREVIEW);
      assert.equal(rd.path(), '-');
    });

    it('returns "-" when changes is null', () => {
      const rd = new RewrittenData({ ...base, changes: null }, LIVE, PREVIEW);
      assert.equal(rd.path(), '-');
    });

    it('accumulates duration from changes when duration is missing', () => {
      const rd = new RewrittenData({ ...base, changes: ['/a 100ms', '/b 200ms'] }, LIVE, PREVIEW);
      rd.path();
      assert.equal(rd.data.duration, 300);
    });

    it('does not overwrite existing duration', () => {
      const rd = new RewrittenData({ ...base, changes: ['/a 100ms'], duration: 999 }, LIVE, PREVIEW);
      rd.path();
      assert.equal(rd.data.duration, 999);
    });
  });

  describe('RewrittenData.path() — sitemap', () => {
    const base = { owner: 'owner', repo: 'repo', ref: 'main' };

    it('renders links from updated[0] array (source: sitemap)', () => {
      const rd = new RewrittenData(
        { ...base, source: 'sitemap', updated: [['/foo', '/bar']] },
        LIVE,
        PREVIEW,
      );
      const html = rd.path();
      assert.match(html, /\/foo/);
      assert.match(html, /\/bar/);
    });

    it('does not throw when updated is empty array', () => {
      const rd = new RewrittenData(
        { ...base, source: 'sitemap', updated: [] },
        LIVE,
        PREVIEW,
      );
      assert.doesNotThrow(() => rd.path());
    });

    it('does not throw when updated[0] is not an array', () => {
      const rd = new RewrittenData(
        { ...base, source: 'sitemap', updated: ['/foo'] },
        LIVE,
        PREVIEW,
      );
      assert.doesNotThrow(() => rd.path());
    });

    it('renders path link when no updated field (route: sitemap)', () => {
      const rd = new RewrittenData(
        { ...base, route: 'sitemap', path: '/sitemap.xml' },
        LIVE,
        PREVIEW,
      );
      const html = rd.path('/sitemap.xml');
      assert.match(html, /sitemap\.xml/);
      assert.match(html, new RegExp(LIVE));
    });
  });

  describe('RewrittenData.path() — snapshot', () => {
    const base = {
      route: 'snapshot', owner: 'owner', repo: 'repo', ref: 'main',
    };

    it('renders job details link when job field is present', () => {
      const rd = new RewrittenData({
        ...base, org: 'org', site: 'site', job: 'job-123',
      }, LIVE, PREVIEW);
      const html = rd.path('/some/path');
      assert.match(html, /job-123/);
    });

    it('returns value when job field is absent', () => {
      const rd = new RewrittenData({ ...base, org: 'org', site: 'site' }, LIVE, PREVIEW);
      const result = rd.path('/some/path');
      assert.equal(result, '/some/path');
    });

    it('returns "-" when no job and no value', () => {
      const rd = new RewrittenData({ ...base, org: 'org', site: 'site' }, LIVE, PREVIEW);
      assert.equal(rd.path(null), '-');
    });
  });

  describe('RewrittenData.path() — code', () => {
    it('renders github link', () => {
      const rd = new RewrittenData(
        {
          route: 'code', owner: 'adobe', repo: 'site', ref: 'main',
        },
        LIVE,
        PREVIEW,
      );
      const html = rd.path('/');
      assert.match(html, /github\.com\/adobe\/site/);
    });
  });

  describe('RewrittenData.path() — preview', () => {
    it('renders preview link', () => {
      const rd = new RewrittenData({
        route: 'preview', owner: 'o', repo: 'r', ref: 'main',
      }, LIVE, PREVIEW);
      const html = rd.path('/foo');
      assert.match(html, new RegExp(PREVIEW));
      assert.match(html, /\/foo/);
    });
  });

  describe('RewrittenData.path() — live/index', () => {
    it('renders live link for route:live', () => {
      const rd = new RewrittenData({
        route: 'live', owner: 'o', repo: 'r', ref: 'main',
      }, LIVE, PREVIEW);
      const html = rd.path('/foo');
      assert.match(html, new RegExp(LIVE));
    });

    it('renders live link for route:index', () => {
      const rd = new RewrittenData({
        route: 'index', owner: 'o', repo: 'r', ref: 'main',
      }, LIVE, PREVIEW);
      const html = rd.path('/foo');
      assert.match(html, new RegExp(LIVE));
    });
  });

  describe('RewrittenData.path() — no type', () => {
    it('returns value when no route or source', () => {
      const rd = new RewrittenData({}, LIVE, PREVIEW);
      assert.equal(rd.path('/foo'), '/foo');
    });

    it('returns "-" when no type and no value', () => {
      const rd = new RewrittenData({}, LIVE, PREVIEW);
      assert.equal(rd.path(null), '-');
    });
  });

  describe('RewrittenData.errors()', () => {
    it('returns "-" for null', () => {
      const rd = new RewrittenData({}, LIVE, PREVIEW);
      assert.equal(rd.errors(null), '-');
    });

    it('returns "-" for empty array', () => {
      const rd = new RewrittenData({}, LIVE, PREVIEW);
      assert.equal(rd.errors([]), '-');
    });

    it('does not throw when errors is a string (non-array)', () => {
      const rd = new RewrittenData({}, LIVE, PREVIEW);
      assert.doesNotThrow(() => rd.errors('something went wrong'));
    });

    it('does not throw when errors is a plain object (non-array)', () => {
      const rd = new RewrittenData({}, LIVE, PREVIEW);
      assert.doesNotThrow(() => rd.errors({ message: 'oops' }));
    });

    it('formats error objects with message and target', () => {
      const rd = new RewrittenData({}, LIVE, PREVIEW);
      const result = rd.errors([{ message: 'Not found', target: '/foo' }]);
      assert.match(result, /Not found/);
      assert.match(result, /\/foo/);
    });

    it('joins multiple errors', () => {
      const rd = new RewrittenData({}, LIVE, PREVIEW);
      const result = rd.errors([
        { message: 'Err A', target: '/a' },
        { message: 'Err B', target: '/b' },
      ]);
      assert.match(result, /Err A/);
      assert.match(result, /Err B/);
    });
  });

  describe('RewrittenData.method()', () => {
    it('returns "-" for null', () => {
      const rd = new RewrittenData({}, LIVE, PREVIEW);
      assert.equal(rd.method(null), '-');
    });

    it('wraps method in code tags', () => {
      const rd = new RewrittenData({}, LIVE, PREVIEW);
      assert.equal(rd.method('GET'), '<code>GET</code>');
    });
  });

  describe('RewrittenData.duration()', () => {
    it('returns "-" for null', () => {
      const rd = new RewrittenData({}, LIVE, PREVIEW);
      assert.equal(rd.duration(null), '-');
    });

    it('returns "-" for zero', () => {
      const rd = new RewrittenData({}, LIVE, PREVIEW);
      assert.equal(rd.duration(0), '-');
    });

    it('formats ms as seconds', () => {
      const rd = new RewrittenData({}, LIVE, PREVIEW);
      assert.equal(rd.duration(1500), '1.5 s');
    });
  });

  describe('RewrittenData.rewrite()', () => {
    it('applies known formatters and leaves unknown keys alone', () => {
      const data = { method: 'GET', duration: 2000, unknownField: 'raw' };
      const rd = new RewrittenData(data, LIVE, PREVIEW);
      rd.rewrite(['method', 'duration', 'unknownField']);
      assert.equal(rd.data.method, '<code>GET</code>');
      assert.equal(rd.data.duration, '2.0 s');
      assert.equal(rd.data.unknownField, 'raw');
    });
  });
});
