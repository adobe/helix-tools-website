import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  setNestedValue,
  removeNestedValue,
  applyPendingChanges,
  extractHostname,
  cleanSidekickHostProperties,
} from '../../../tools/simple-config-editor/utils.js';

describe('simple-config-editor:utils.js', () => {
  describe('setNestedValue', () => {
    it('sets a top-level key when path is empty', () => {
      const obj = {};
      setNestedValue(obj, '', 'foo', 1);
      assert.deepEqual(obj, { foo: 1 });
    });

    it('descends a single-segment path', () => {
      const obj = { a: { b: 0 } };
      setNestedValue(obj, 'a', 'b', 2);
      assert.deepEqual(obj, { a: { b: 2 } });
    });

    it('creates intermediate objects when missing', () => {
      const obj = {};
      setNestedValue(obj, 'a.b.c', 'd', 'x');
      assert.deepEqual(obj, { a: { b: { c: { d: 'x' } } } });
    });

    it('overwrites a non-object intermediate to allow descent', () => {
      // setNestedValue's "create missing" rule replaces falsy/non-object
      // intermediates. That matches the original tool behavior — callers
      // never set into existing scalar paths in practice.
      const obj = { a: 'string' };
      setNestedValue(obj, 'a', 'b', 1);
      assert.deepEqual(obj, { a: { b: 1 } });
    });
  });

  describe('removeNestedValue', () => {
    it('deletes a top-level key when path is empty', () => {
      const obj = { foo: 1, bar: 2 };
      removeNestedValue(obj, '', 'foo');
      assert.deepEqual(obj, { bar: 2 });
    });

    it('deletes a nested key', () => {
      const obj = { a: { b: { c: 1, d: 2 } } };
      removeNestedValue(obj, 'a.b', 'c');
      assert.deepEqual(obj, { a: { b: { d: 2 } } });
    });

    it('is a no-op when the path does not resolve', () => {
      const obj = { a: 1 };
      removeNestedValue(obj, 'x.y', 'z');
      assert.deepEqual(obj, { a: 1 });
    });
  });

  describe('applyPendingChanges', () => {
    it('applies an edit at a nested path', () => {
      const config = { a: { b: 1 } };
      const changes = new Map([
        ['a.b', {
          key: 'b', path: 'a', action: 'edit', newValue: 2,
        }],
      ]);
      applyPendingChanges(config, changes);
      assert.deepEqual(config, { a: { b: 2 } });
    });

    it('applies an add at a new nested path', () => {
      const config = {};
      const changes = new Map([
        ['cdn.prod.host', {
          key: 'host', path: 'cdn.prod', action: 'add', newValue: 'example.com',
        }],
      ]);
      applyPendingChanges(config, changes);
      assert.deepEqual(config, { cdn: { prod: { host: 'example.com' } } });
    });

    it('applies a remove', () => {
      const config = { a: { b: 1, c: 2 } };
      const changes = new Map([
        ['a.b', {
          key: 'b', path: 'a', action: 'remove', newValue: null,
        }],
      ]);
      applyPendingChanges(config, changes);
      assert.deepEqual(config, { a: { c: 2 } });
    });

    it('applies multiple changes in order', () => {
      const config = { a: { b: 1 } };
      const changes = new Map([
        ['a.b', {
          key: 'b', path: 'a', action: 'edit', newValue: 99,
        }],
        ['x', {
          key: 'x', path: '', action: 'add', newValue: 'new',
        }],
        ['a.c', {
          key: 'c', path: 'a', action: 'remove', newValue: null,
        }],
      ]);
      applyPendingChanges(config, changes);
      assert.deepEqual(config, { a: { b: 99 }, x: 'new' });
    });

    it('returns the same (mutated) config object', () => {
      const config = {};
      const result = applyPendingChanges(config, new Map());
      assert.equal(result, config);
    });
  });

  describe('extractHostname', () => {
    it('returns a bare hostname unchanged', () => {
      assert.deepEqual(extractHostname('www.example.com'), { value: 'www.example.com' });
    });

    it('extracts hostname from https URL', () => {
      assert.deepEqual(
        extractHostname('https://www.example.com/path'),
        { value: 'www.example.com' },
      );
    });

    it('extracts hostname from http URL', () => {
      assert.deepEqual(
        extractHostname('http://example.com:8080/'),
        { value: 'example.com' },
      );
    });

    it('extracts hostname from protocol-relative URL', () => {
      assert.deepEqual(
        extractHostname('//cdn.example.com/asset.js'),
        { value: 'cdn.example.com' },
      );
    });

    it('returns the original value with an error on parse failure', () => {
      assert.deepEqual(
        extractHostname('https://[not a url'),
        { value: 'https://[not a url', error: 'Failed to parse URL: https://[not a url' },
      );
    });

    it('returns non-string input unchanged in the value field', () => {
      assert.deepEqual(extractHostname(null), { value: null });
      assert.deepEqual(extractHostname(undefined), { value: undefined });
      assert.deepEqual(extractHostname(42), { value: 42 });
    });

    it('returns empty string unchanged', () => {
      assert.deepEqual(extractHostname(''), { value: '' });
    });
  });

  describe('cleanSidekickHostProperties', () => {
    it('cleans sidekick host props and reports each change', () => {
      const config = {
        sidekick: {
          host: 'https://www.example.com/',
          liveHost: 'live.example.com',
        },
      };
      const { config: out, changes, errors } = cleanSidekickHostProperties(config);
      assert.equal(out, config);
      assert.equal(out.sidekick.host, 'www.example.com');
      assert.equal(out.sidekick.liveHost, 'live.example.com');
      assert.deepEqual(changes, [{ path: 'sidekick.host', from: 'https://www.example.com/', to: 'www.example.com' }]);
      assert.deepEqual(errors, []);
    });

    it('cleans cdn env host props', () => {
      const config = {
        cdn: {
          prod: { host: 'https://prod.example.com/' },
          live: { host: 'live.example.com' },
        },
      };
      const { changes } = cleanSidekickHostProperties(config);
      assert.equal(config.cdn.prod.host, 'prod.example.com');
      assert.equal(config.cdn.live.host, 'live.example.com');
      assert.deepEqual(changes, [{ path: 'cdn.prod.host', from: 'https://prod.example.com/', to: 'prod.example.com' }]);
    });

    it('handles all four sidekick host props and four cdn envs', () => {
      const config = {
        sidekick: {
          host: 'https://a.example.com',
          liveHost: 'https://b.example.com',
          previewHost: 'https://c.example.com',
          reviewHost: 'https://d.example.com',
        },
        cdn: {
          prod: { host: 'https://e.example.com' },
          live: { host: 'https://f.example.com' },
          preview: { host: 'https://g.example.com' },
          review: { host: 'https://h.example.com' },
        },
      };
      const { changes } = cleanSidekickHostProperties(config);
      assert.equal(changes.length, 8);
      assert.equal(config.sidekick.host, 'a.example.com');
      assert.equal(config.cdn.review.host, 'h.example.com');
    });

    it('returns empty changes on a config with no host fields', () => {
      const config = { unrelated: { foo: 'bar' } };
      const { changes, errors } = cleanSidekickHostProperties(config);
      assert.deepEqual(changes, []);
      assert.deepEqual(errors, []);
    });

    it('surfaces parse errors from extractHostname', () => {
      const config = { sidekick: { host: 'https://[not a url' } };
      const { changes, errors } = cleanSidekickHostProperties(config);
      assert.deepEqual(changes, []);
      assert.equal(errors.length, 1);
      assert.match(errors[0].message, /Failed to parse URL/);
      assert.equal(errors[0].path, 'sidekick.host');
    });

    it('handles null config', () => {
      const result = cleanSidekickHostProperties(null);
      assert.equal(result.config, null);
      assert.deepEqual(result.changes, []);
      assert.deepEqual(result.errors, []);
    });

    it('skips non-object sidekick or cdn nodes', () => {
      const config = { sidekick: 'string', cdn: null };
      const { changes, errors } = cleanSidekickHostProperties(config);
      assert.deepEqual(changes, []);
      assert.deepEqual(errors, []);
    });
  });
});
