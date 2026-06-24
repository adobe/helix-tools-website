import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  processAuditLog,
  detectMediaType,
  mergeEntriesIntoMediaMap,
  transformToMediaData,
} from '../../../../tools/media-library/indexing/transforms.js';

// ─── processAuditLog ─────────────────────────────────────────────────────────

describe('processAuditLog', () => {
  it('returns [] for empty input', () => {
    assert.deepEqual(processAuditLog([], 'org', 'site'), []);
  });

  it('returns [] for null input', () => {
    assert.deepEqual(processAuditLog(null, 'org', 'site'), []);
  });

  it('excludes entries where route is not preview', () => {
    const entries = [
      {
        route: 'code', path: '/media/doc.pdf', timestamp: 1, user: 'alice',
      },
      {
        route: 'live', path: '/media/doc.pdf', timestamp: 1, user: 'alice',
      },
    ];
    assert.deepEqual(processAuditLog(entries, 'org', 'site'), []);
  });

  it('excludes preview entries whose path is not pdf, svg, or extensionless fragment', () => {
    const entries = [
      {
        route: 'preview', path: '/page.html', timestamp: 1, user: 'alice',
      },
      {
        route: 'preview', path: '/media/image.jpg', timestamp: 1, user: 'alice',
      },
      {
        route: 'preview', path: '/fragments/hero.html', timestamp: 1, user: 'alice',
      },
    ];
    assert.deepEqual(processAuditLog(entries, 'org', 'site'), []);
  });

  it('includes .pdf paths with correct contentType and constructed URL', () => {
    const entries = [{
      route: 'preview', path: '/docs/report.pdf', timestamp: 100, user: 'alice',
    }];
    const [item] = processAuditLog(entries, 'myorg', 'mysite');
    assert.equal(item.contentType, 'application/pdf');
    assert.equal(item.url, 'https://main--mysite--myorg.aem.page/docs/report.pdf');
    assert.equal(item.name, 'report.pdf');
    assert.equal(item.operation, 'ingest');
  });

  it('includes .svg paths with correct contentType', () => {
    const entries = [{
      route: 'preview', path: '/icons/logo.svg', timestamp: 100, user: 'alice',
    }];
    const [item] = processAuditLog(entries, 'org', 'site');
    assert.equal(item.contentType, 'image/svg+xml');
    assert.equal(item.name, 'logo.svg');
  });

  it('includes extensionless /fragments/ paths with null contentType', () => {
    const entries = [{
      route: 'preview', path: '/content/fragments/hero', timestamp: 100, user: 'alice',
    }];
    const [item] = processAuditLog(entries, 'org', 'site');
    assert.equal(item.contentType, null);
    assert.equal(item.name, 'hero');
  });

  it('strips query params from name but uses original path in URL', () => {
    const entries = [{
      route: 'preview', path: '/docs/report.pdf?v=2', timestamp: 100, user: 'alice',
    }];
    const [item] = processAuditLog(entries, 'org', 'site');
    assert.equal(item.name, 'report.pdf');
    assert.ok(item.url.includes('report.pdf?v=2'));
  });

  it('falls back to "Unknown" when user is missing', () => {
    const entries = [{ route: 'preview', path: '/doc.pdf', timestamp: 100 }];
    const [item] = processAuditLog(entries, 'org', 'site');
    assert.equal(item.user, 'Unknown');
  });
});

// ─── detectMediaType ──────────────────────────────────────────────────────────

describe('detectMediaType', () => {
  it('contentType image/* → image', () => {
    assert.equal(detectMediaType({ path: '/media/photo.jpg', contentType: 'image/jpeg' }), 'image');
    assert.equal(detectMediaType({ path: '/media/photo.png', contentType: 'image/png' }), 'image');
  });

  it('contentType image/svg+xml with /icons/ path → icon', () => {
    assert.equal(detectMediaType({ path: '/icons/logo.svg', contentType: 'image/svg+xml' }), 'icon');
  });

  it('contentType image/svg+xml without /icons/ → svg', () => {
    assert.equal(detectMediaType({ path: '/media/diagram.svg', contentType: 'image/svg+xml' }), 'svg');
  });

  it('contentType video/* → video', () => {
    assert.equal(detectMediaType({ path: '/media/clip.mp4', contentType: 'video/mp4' }), 'video');
  });

  it('contentType application/pdf → document', () => {
    assert.equal(detectMediaType({ path: '/media/report.pdf', contentType: 'application/pdf' }), 'document');
  });

  it('contentType takes precedence over path extension', () => {
    // contentType says image even though no conventional extension
    assert.equal(detectMediaType({ path: '/media/asset', contentType: 'image/webp' }), 'image');
  });

  it('/fragments/ path with no contentType → fragment', () => {
    assert.equal(detectMediaType({ path: '/content/fragments/hero', contentType: null }), 'fragment');
  });

  it('image extensions → image when no contentType', () => {
    ['jpg', 'jpeg', 'png', 'gif', 'webp'].forEach((ext) => {
      assert.equal(detectMediaType({ path: `/media/f.${ext}`, contentType: null }), 'image', ext);
    });
  });

  it('video extensions → video when no contentType', () => {
    ['mp4', 'mov', 'avi', 'webm'].forEach((ext) => {
      assert.equal(detectMediaType({ path: `/media/f.${ext}`, contentType: null }), 'video', ext);
    });
  });

  it('.svg extension with /icons/ path → icon when no contentType', () => {
    assert.equal(detectMediaType({ path: '/icons/arrow.svg', contentType: null }), 'icon');
  });

  it('.svg extension without /icons/ → svg when no contentType', () => {
    assert.equal(detectMediaType({ path: '/media/chart.svg', contentType: null }), 'svg');
  });

  it('.pdf extension → document when no contentType', () => {
    assert.equal(detectMediaType({ path: '/media/report.pdf', contentType: null }), 'document');
  });

  it('unknown extension → document', () => {
    assert.equal(detectMediaType({ path: '/media/file.xyz', contentType: null }), 'document');
  });
});

// ─── mergeEntriesIntoMediaMap ─────────────────────────────────────────────────

describe('mergeEntriesIntoMediaMap', () => {
  const URL_A = 'https://main--site--org.aem.page/media/img.jpg';
  const URL_B = 'https://main--site--org.aem.page/media/other.jpg';

  it('returns [] for empty entries', () => {
    assert.deepEqual(mergeEntriesIntoMediaMap([], new Map()), []);
  });

  it('adds a new entry to the map', () => {
    const map = new Map();
    const items = mergeEntriesIntoMediaMap(
      [{
        url: URL_A, name: 'img.jpg', timestamp: 100, user: 'alice', operation: 'upload', type: 'image', doc: '/page-a',
      }],
      map,
    );
    assert.equal(items.length, 1);
    assert.equal(items[0].url, URL_A);
    assert.equal(items[0].usageCount, 1);
    assert.equal(items[0].status, 'referenced');
    assert.deepEqual(items[0].uniqueSources, ['/page-a']);
  });

  it('deduplicates entries with the same URL', () => {
    const map = new Map();
    const entries = [
      {
        url: URL_A, timestamp: 100, user: 'alice', operation: 'upload', doc: '/page-a', type: 'image',
      },
      {
        url: URL_A, timestamp: 200, user: 'bob', operation: 'delete', doc: '/page-b', type: 'image',
      },
    ];
    const items = mergeEntriesIntoMediaMap(entries, map);
    assert.equal(items.length, 1);
    assert.equal(items[0].usageCount, 2);
  });

  it('accumulates uniqueSources from multiple entries', () => {
    const map = new Map();
    const entries = [
      {
        url: URL_A, timestamp: 100, user: 'alice', doc: '/page-a', type: 'image',
      },
      {
        url: URL_A, timestamp: 200, user: 'bob', doc: '/page-b', type: 'image',
      },
    ];
    const [item] = mergeEntriesIntoMediaMap(entries, map);
    assert.equal(item.uniqueSources.length, 2);
    assert.ok(item.uniqueSources.includes('/page-a'));
    assert.ok(item.uniqueSources.includes('/page-b'));
  });

  it('newer timestamp updates user and operation', () => {
    const map = new Map();
    const entries = [
      {
        url: URL_A, timestamp: 100, user: 'alice', operation: 'upload', type: 'image',
      },
      {
        url: URL_A, timestamp: 200, user: 'bob', operation: 'delete', type: 'image',
      },
    ];
    const [item] = mergeEntriesIntoMediaMap(entries, map);
    assert.equal(item.timestamp, 200);
    assert.equal(item.user, 'bob');
    assert.equal(item.operation, 'delete');
  });

  it('older timestamp does not overwrite user or operation', () => {
    const map = new Map();
    const entries = [
      {
        url: URL_A, timestamp: 200, user: 'bob', operation: 'delete', type: 'image',
      },
      {
        url: URL_A, timestamp: 100, user: 'alice', operation: 'upload', type: 'image',
      },
    ];
    const [item] = mergeEntriesIntoMediaMap(entries, map);
    assert.equal(item.timestamp, 200);
    assert.equal(item.user, 'bob');
    assert.equal(item.operation, 'delete');
  });

  it('item with no doc has status unused', () => {
    const map = new Map();
    const [item] = mergeEntriesIntoMediaMap(
      [{
        url: URL_A, timestamp: 100, user: 'alice', type: 'image',
      }],
      map,
    );
    assert.equal(item.status, 'unused');
    assert.equal(item.doc, null);
  });

  it('falls back to resourcePath when doc is absent', () => {
    const map = new Map();
    const [item] = mergeEntriesIntoMediaMap(
      [{
        url: URL_A, timestamp: 100, user: 'alice', type: 'image', resourcePath: '/page-via-resource',
      }],
      map,
    );
    assert.deepEqual(item.uniqueSources, ['/page-via-resource']);
  });

  it('keeps separate items for distinct URLs', () => {
    const map = new Map();
    const items = mergeEntriesIntoMediaMap(
      [
        {
          url: URL_A, timestamp: 100, user: 'alice', type: 'image',
        },
        {
          url: URL_B, timestamp: 100, user: 'bob', type: 'image',
        },
      ],
      map,
    );
    assert.equal(items.length, 2);
  });
});

// ─── transformToMediaData ─────────────────────────────────────────────────────

describe('transformToMediaData', () => {
  const URL_A = 'https://main--site--org.aem.page/media/img.jpg';

  it('returns [] for empty inputs', () => {
    assert.deepEqual(transformToMediaData([], []), []);
  });

  it('produces one item per unique URL across both log sources', () => {
    const medialog = [{
      url: URL_A, timestamp: 100, user: 'alice', type: 'image', doc: '/page-a',
    }];
    const auditlog = [{
      url: URL_A, timestamp: 200, user: 'bob', type: 'image', doc: '/page-b',
    }];
    const items = transformToMediaData(medialog, auditlog);
    assert.equal(items.length, 1);
    assert.equal(items[0].usageCount, 2);
  });

  it('merges uniqueSources across log sources', () => {
    const medialog = [{
      url: URL_A, timestamp: 100, user: 'alice', type: 'image', doc: '/page-a',
    }];
    const auditlog = [{
      url: URL_A, timestamp: 200, user: 'bob', type: 'image', doc: '/page-b',
    }];
    const [item] = transformToMediaData(medialog, auditlog);
    assert.ok(item.uniqueSources.includes('/page-a'));
    assert.ok(item.uniqueSources.includes('/page-b'));
    assert.equal(item.status, 'referenced');
  });

  it('latest timestamp wins for top-level properties', () => {
    const medialog = [{
      url: URL_A, timestamp: 100, user: 'alice', operation: 'upload', type: 'image',
    }];
    const auditlog = [{
      url: URL_A, timestamp: 200, user: 'bob', operation: 'delete', type: 'image',
    }];
    const [item] = transformToMediaData(medialog, auditlog);
    assert.equal(item.timestamp, 200);
    assert.equal(item.user, 'bob');
    assert.equal(item.operation, 'delete');
  });

  it('items with no sources have status unused', () => {
    const medialog = [{
      url: URL_A, timestamp: 100, user: 'alice', type: 'image',
    }];
    const [item] = transformToMediaData(medialog, []);
    assert.equal(item.status, 'unused');
  });

  it('entries without path or url are skipped', () => {
    const medialog = [{ timestamp: 100, user: 'alice', type: 'image' }];
    assert.deepEqual(transformToMediaData(medialog, []), []);
  });

  it('supports path field as well as url field', () => {
    const auditlog = [{
      path: URL_A, timestamp: 100, user: 'alice', type: 'image',
    }];
    const items = transformToMediaData([], auditlog);
    assert.equal(items.length, 1);
    assert.equal(items[0].url, URL_A);
  });
});
