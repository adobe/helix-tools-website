import { describe, test, expect } from 'vitest';
import { filterPendingPages } from '../tools/page-status/utils.js';

const PREVIEW_DATE = '2024-06-01T12:00:00Z';
const PUBLISH_DATE = '2024-05-01T12:00:00Z'; // older than preview

describe('filterPendingPages', () => {
  test('includes pages where preview is newer than publish', () => {
    const resources = [
      { path: '/page', previewLastModified: PREVIEW_DATE, publishLastModified: PUBLISH_DATE },
    ];
    expect(filterPendingPages(resources)).toHaveLength(1);
  });

  test('excludes pages where preview is older than publish', () => {
    const resources = [
      { path: '/page', previewLastModified: PUBLISH_DATE, publishLastModified: PREVIEW_DATE },
    ];
    expect(filterPendingPages(resources)).toHaveLength(0);
  });

  test('excludes pages where preview equals publish', () => {
    const resources = [
      { path: '/page', previewLastModified: PREVIEW_DATE, publishLastModified: PREVIEW_DATE },
    ];
    expect(filterPendingPages(resources)).toHaveLength(0);
  });

  test('excludes resources without a path', () => {
    const resources = [
      { previewLastModified: PREVIEW_DATE, publishLastModified: PUBLISH_DATE },
    ];
    expect(filterPendingPages(resources)).toHaveLength(0);
  });

  test('excludes resources missing previewLastModified', () => {
    const resources = [
      { path: '/page', publishLastModified: PUBLISH_DATE },
    ];
    expect(filterPendingPages(resources)).toHaveLength(0);
  });

  test('excludes resources missing publishLastModified', () => {
    const resources = [
      { path: '/page', previewLastModified: PREVIEW_DATE },
    ];
    expect(filterPendingPages(resources)).toHaveLength(0);
  });

  test('excludes /helix-env.json', () => {
    const resources = [
      { path: '/helix-env.json', previewLastModified: PREVIEW_DATE, publishLastModified: PUBLISH_DATE },
    ];
    expect(filterPendingPages(resources)).toHaveLength(0);
  });

  test('excludes /sitemap.json', () => {
    const resources = [
      { path: '/sitemap.json', previewLastModified: PREVIEW_DATE, publishLastModified: PUBLISH_DATE },
    ];
    expect(filterPendingPages(resources)).toHaveLength(0);
  });

  test('returns only pending pages from a mixed array', () => {
    const resources = [
      { path: '/pending', previewLastModified: PREVIEW_DATE, publishLastModified: PUBLISH_DATE },
      { path: '/published', previewLastModified: PUBLISH_DATE, publishLastModified: PREVIEW_DATE },
      { path: '/no-publish', previewLastModified: PREVIEW_DATE },
      { path: '/helix-env.json', previewLastModified: PREVIEW_DATE, publishLastModified: PUBLISH_DATE },
    ];
    const result = filterPendingPages(resources);
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe('/pending');
  });

  test('returns empty array when given empty input', () => {
    expect(filterPendingPages([])).toEqual([]);
  });
});
