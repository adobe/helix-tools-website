import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import filterPendingPages from '../../../tools/page-status/diff-utils.js';

const OLD = '2024-01-01T00:00:00Z';
const NEW = '2024-12-01T00:00:00Z';

describe('filterPendingPages', () => {
  it('keeps pages where preview is newer than publish', () => {
    const r = [{ path: '/a', previewLastModified: NEW, publishLastModified: OLD }];
    assert.deepEqual(filterPendingPages(r), r);
  });

  it('excludes pages where publish is newer than preview', () => {
    const r = [{ path: '/a', previewLastModified: OLD, publishLastModified: NEW }];
    assert.deepEqual(filterPendingPages(r), []);
  });

  it('excludes pages with equal dates', () => {
    const r = [{ path: '/a', previewLastModified: OLD, publishLastModified: OLD }];
    assert.deepEqual(filterPendingPages(r), []);
  });

  it('excludes pages with no preview date', () => {
    assert.deepEqual(
      filterPendingPages([{ path: '/a', previewLastModified: null, publishLastModified: OLD }]),
      [],
    );
  });

  it('excludes pages with no publish date', () => {
    assert.deepEqual(
      filterPendingPages([{ path: '/a', previewLastModified: NEW, publishLastModified: null }]),
      [],
    );
  });

  it('excludes /helix-env.json', () => {
    assert.deepEqual(
      filterPendingPages([{ path: '/helix-env.json', previewLastModified: NEW, publishLastModified: OLD }]),
      [],
    );
  });

  it('excludes /sitemap.json', () => {
    assert.deepEqual(
      filterPendingPages([{ path: '/sitemap.json', previewLastModified: NEW, publishLastModified: OLD }]),
      [],
    );
  });

  it('excludes entries with no path', () => {
    assert.deepEqual(
      filterPendingPages([{ path: null, previewLastModified: NEW, publishLastModified: OLD }]),
      [],
    );
  });

  it('handles a mixed array', () => {
    const pending = { path: '/changed', previewLastModified: NEW, publishLastModified: OLD };
    const current = { path: '/ok', previewLastModified: OLD, publishLastModified: NEW };
    const ignored = { path: '/helix-env.json', previewLastModified: NEW, publishLastModified: OLD };
    assert.deepEqual(filterPendingPages([pending, current, ignored]), [pending]);
  });
});
