import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import filterPendingPages from '../../../tools/page-status/diff-utils.js';

const OLD = '2024-01-01T00:00:00Z';
const NEW = '2024-12-01T00:00:00Z';

describe('filterPendingPages', () => {
  it('keeps pages where preview is newer than publish', () => {
    const resources = [{ path: '/a', previewLastModified: NEW, publishLastModified: OLD }];
    assert.deepEqual(filterPendingPages(resources), resources);
  });

  it('excludes pages where publish is newer than preview', () => {
    const resources = [{ path: '/a', previewLastModified: OLD, publishLastModified: NEW }];
    assert.deepEqual(filterPendingPages(resources), []);
  });

  it('excludes pages with equal preview and publish dates', () => {
    const resources = [{ path: '/a', previewLastModified: OLD, publishLastModified: OLD }];
    assert.deepEqual(filterPendingPages(resources), []);
  });

  it('excludes pages missing preview date', () => {
    const resources = [{ path: '/a', previewLastModified: null, publishLastModified: OLD }];
    assert.deepEqual(filterPendingPages(resources), []);
  });

  it('excludes pages missing publish date', () => {
    const resources = [{ path: '/a', previewLastModified: NEW, publishLastModified: null }];
    assert.deepEqual(filterPendingPages(resources), []);
  });

  it('excludes /helix-env.json', () => {
    const resources = [{
      path: '/helix-env.json',
      previewLastModified: NEW,
      publishLastModified: OLD,
    }];
    assert.deepEqual(filterPendingPages(resources), []);
  });

  it('excludes /sitemap.json', () => {
    const resources = [{
      path: '/sitemap.json',
      previewLastModified: NEW,
      publishLastModified: OLD,
    }];
    assert.deepEqual(filterPendingPages(resources), []);
  });

  it('excludes entries with no path', () => {
    const resources = [{ path: null, previewLastModified: NEW, publishLastModified: OLD }];
    assert.deepEqual(filterPendingPages(resources), []);
  });

  it('handles a mixed array correctly', () => {
    const pending = { path: '/changed', previewLastModified: NEW, publishLastModified: OLD };
    const current = { path: '/current', previewLastModified: OLD, publishLastModified: NEW };
    const ignored = { path: '/helix-env.json', previewLastModified: NEW, publishLastModified: OLD };
    assert.deepEqual(filterPendingPages([pending, current, ignored]), [pending]);
  });
});
