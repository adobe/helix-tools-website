import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RewrittenData } from '../../../tools/log-viewer/rewrite.js';

const LIVE = 'main--site--owner.aem.live';
const PREVIEW = 'main--site--owner.aem.page';

// Helpers
const rd = (data, onAdminClick) => new RewrittenData(data, LIVE, PREVIEW, onAdminClick);
const click = (el) => el.click();

describe('log-viewer:rewrite.js', () => {
  describe('RewrittenData.timestamp()', () => {
    it('returns null when no value', () => {
      assert.equal(rd({}).timestamp(null), null);
      assert.equal(rd({}).timestamp(0), null);
    });

    it('formats a timestamp string', () => {
      const result = rd({}).timestamp('2024-01-15T12:00:00Z');
      assert.match(result, /01\/15\/2024/);
      assert.match(result, /UTC/);
    });
  });

  describe('RewrittenData.user()', () => {
    it('returns null when no value', () => {
      assert.equal(rd({}).user(null), null);
      assert.equal(rd({}).user(''), null);
    });

    it('returns an anchor with mailto href showing username', () => {
      const a = rd({}).user('alice@example.com');
      assert.equal(a.tagName, 'A');
      assert.equal(a.href, 'mailto:alice@example.com');
      assert.equal(a.textContent, 'alice');
    });
  });

  describe('RewrittenData.path() — no type', () => {
    it('returns value when no route or source', () => {
      assert.equal(rd({}).path('/foo'), '/foo');
    });

    it('returns null when no type and no value', () => {
      assert.equal(rd({}).path(null), null);
    });
  });

  describe('RewrittenData.path() — code', () => {
    it('renders a github link', () => {
      const a = rd({ route: 'code', owner: 'adobe', repo: 'site', ref: 'main' }).path('/');
      assert.equal(a.tagName, 'A');
      assert.match(a.href, /github\.com\/adobe\/site/);
    });
  });

  describe('RewrittenData.path() — index / live', () => {
    it('renders live link for route:index', () => {
      const a = rd({ route: 'index', owner: 'o', repo: 'r', ref: 'main' }).path('/foo');
      assert.equal(a.tagName, 'A');
      assert.match(a.href, new RegExp(LIVE));
    });

    it('renders live link for route:live', () => {
      const a = rd({ route: 'live', owner: 'o', repo: 'r', ref: 'main' }).path('/foo');
      assert.match(a.href, new RegExp(LIVE));
    });
  });

  describe('RewrittenData.path() — preview', () => {
    it('renders a preview link', () => {
      const a = rd({ route: 'preview', owner: 'o', repo: 'r', ref: 'main' }).path('/foo');
      assert.equal(a.tagName, 'A');
      assert.match(a.href, new RegExp(PREVIEW));
    });
  });

  describe('RewrittenData.path() — config / job / status (admin buttons)', () => {
    it('returns a button for route:config', () => {
      const button = rd({ route: 'config', org: 'org', site: 'site' }).path('/config.json');
      assert.equal(button.tagName, 'BUTTON');
      assert.equal(button.className, 'button outline');
    });

    it('calls onAdminClick with a requestFn and the button when clicked', () => {
      let called = false;
      let capturedFn;
      let capturedButton;
      const spy = (fn, btn) => { called = true; capturedFn = fn; capturedButton = btn; };
      const button = rd({ route: 'config', org: 'org', site: 'site' }, spy).path('/config.json');
      click(button);
      assert.ok(called);
      assert.equal(typeof capturedFn, 'function');
      assert.equal(capturedButton, button);
    });

    it('truncates button text beyond 26 chars', () => {
      const long = '/a-very-long-path-segment-that-exceeds-the-limit';
      const button = rd({ route: 'status', owner: 'o', repo: 'r', ref: 'main' }).path(long);
      assert.ok(button.textContent.length <= 27); // 26 chars + ellipsis char
    });
  });

  describe('RewrittenData.path() — indexer', () => {
    const base = { route: 'indexer', owner: 'owner', repo: 'repo', ref: 'main' };

    it('returns null when changes is absent', () => {
      assert.equal(rd({ ...base }).path(), null);
    });

    it('returns null when changes is null', () => {
      assert.equal(rd({ ...base, changes: null }).path(), null);
    });

    it('does not throw when changes is a plain object (non-array)', () => {
      assert.doesNotThrow(() => rd({ ...base, changes: { count: 5 } }).path());
    });

    it('renders admin buttons for each path segment', () => {
      const instance = rd({ ...base, changes: ['/foo 100ms', '/bar 200ms'] });
      const fragment = instance.path();
      const buttons = [...fragment.childNodes].filter((n) => n.tagName === 'BUTTON');
      assert.equal(buttons.length, 2);
    });

    it('accumulates duration from changes when duration is missing', () => {
      const instance = rd({ ...base, changes: ['/a 100ms', '/b 200ms'] });
      instance.path();
      assert.equal(instance.data.duration, 300);
    });

    it('does not overwrite existing duration', () => {
      const instance = rd({ ...base, changes: ['/a 100ms'], duration: 999 });
      instance.path();
      assert.equal(instance.data.duration, 999);
    });
  });

  describe('RewrittenData.path() — sitemap', () => {
    const base = { owner: 'owner', repo: 'repo', ref: 'main' };

    it('renders links from updated[0] array', () => {
      const fragment = rd({ ...base, source: 'sitemap', updated: [['/foo', '/bar']] }).path();
      const links = [...fragment.childNodes].filter((n) => n.tagName === 'A');
      assert.equal(links.length, 2);
      assert.match(links[0].href, /\/foo/);
    });

    it('does not throw when updated is empty', () => {
      assert.doesNotThrow(() => rd({ ...base, source: 'sitemap', updated: [] }).path());
    });

    it('returns null when updated[0] is not an array', () => {
      const result = rd({ ...base, source: 'sitemap', updated: ['/foo'] }).path();
      assert.equal(result, null);
    });

    it('renders a path link for route:sitemap (no updated)', () => {
      const a = rd({ ...base, route: 'sitemap', path: '/sitemap.xml' }).path('/sitemap.xml');
      assert.equal(a.tagName, 'A');
      assert.match(a.href, /sitemap\.xml/);
    });
  });

  describe('RewrittenData.path() — snapshot', () => {
    const base = { route: 'snapshot', owner: 'o', repo: 'r', ref: 'main', org: 'org', site: 'site' };

    it('returns an admin button when job field is present', () => {
      const button = rd({ ...base, job: 'job-123' }).path('/path');
      assert.equal(button.tagName, 'BUTTON');
      assert.match(button.textContent, /job-123/);
    });

    it('returns value when job is absent', () => {
      assert.equal(rd({ ...base }).path('/path'), '/path');
    });

    it('returns null when no job and no value', () => {
      assert.equal(rd({ ...base }).path(null), null);
    });
  });

  describe('RewrittenData.path() — auth', () => {
    it('returns value without console.warn', () => {
      assert.equal(rd({ route: 'auth' }).path('/some'), '/some');
    });

    it('returns null when no value', () => {
      assert.equal(rd({ route: 'auth' }).path(null), null);
    });
  });

  describe('RewrittenData.errors()', () => {
    it('returns null for null', () => assert.equal(rd({}).errors(null), null));
    it('returns null for empty array', () => assert.equal(rd({}).errors([]), null));
    it('does not throw when errors is a string', () => assert.doesNotThrow(() => rd({}).errors('oops')));
    it('does not throw when errors is a plain object', () => assert.doesNotThrow(() => rd({}).errors({ msg: 'x' })));

    it('formats error objects into a fragment', () => {
      const fragment = rd({}).errors([{ message: 'Not found', target: '/foo' }]);
      assert.equal(fragment.nodeName, '#document-fragment');
      assert.match(fragment.textContent, /Not found/);
      assert.match(fragment.textContent, /\/foo/);
    });

    it('joins multiple errors', () => {
      const fragment = rd({}).errors([
        { message: 'Err A', target: '/a' },
        { message: 'Err B', target: '/b' },
      ]);
      assert.match(fragment.textContent, /Err A/);
      assert.match(fragment.textContent, /Err B/);
    });
  });

  describe('RewrittenData.method()', () => {
    it('returns null for null', () => assert.equal(rd({}).method(null), null));

    it('wraps method in a code element', () => {
      const code = rd({}).method('GET');
      assert.equal(code.tagName, 'CODE');
      assert.equal(code.textContent, 'GET');
    });
  });

  describe('RewrittenData.status()', () => {
    it('returns null for null', () => assert.equal(rd({}).status(null), null));

    it('returns a span with status-light class', () => {
      const span = rd({}).status(200);
      assert.equal(span.tagName, 'SPAN');
      assert.match(span.className, /status-light/);
      assert.equal(span.textContent, '200');
    });
  });

  describe('RewrittenData.duration()', () => {
    it('returns null for null', () => assert.equal(rd({}).duration(null), null));
    it('returns null for zero', () => assert.equal(rd({}).duration(0), null));
    it('formats ms as seconds string', () => assert.equal(rd({}).duration(1500), '1.5 s'));
  });

  describe('RewrittenData.rewrite()', () => {
    it('applies known formatters and leaves unknown keys untouched', () => {
      const instance = rd({ method: 'GET', duration: 2000, unknownField: 'raw' });
      instance.rewrite(['method', 'duration', 'unknownField']);
      assert.equal(instance.data.method.tagName, 'CODE');
      assert.equal(instance.data.duration, '2.0 s');
      assert.equal(instance.data.unknownField, 'raw');
    });
  });
});
