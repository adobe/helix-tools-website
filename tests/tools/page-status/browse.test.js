import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  contentToWebPath,
  sourceToWebPath,
  walkTree,
  collectResources,
} from '../../../tools/page-status/browse.js';

const json = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

function mockAdmin(routes) {
  const calls = [];
  return {
    calls,
    raw: async (method, path, body, opts) => {
      const cursor = opts?.params?.cursor;
      calls.push({ path, cursor, limit: opts?.params?.limit });
      const route = routes[cursor ? `${path}?${cursor}` : path];
      return route || json(404);
    },
  };
}

const child = (partition, path, lastModified) => ({
  path: `/o/sites/s/${partition}${path}`,
  type: path.endsWith('/') ? 'folder' : 'file',
  lastModified,
});

describe('contentToWebPath', () => {
  it('maps index.md to folder', () => assert.equal(contentToWebPath('/a/index.md'), '/a/'));
  it('maps root index.md to /', () => assert.equal(contentToWebPath('/index.md'), '/'));
  it('strips .md', () => assert.equal(contentToWebPath('/a/b.md'), '/a/b'));
  it('keeps other extensions', () => assert.equal(contentToWebPath('/a/b.json'), '/a/b.json'));
});

describe('sourceToWebPath', () => {
  it('maps index.html to folder', () => assert.equal(sourceToWebPath('/a/index.html'), '/a/'));
  it('strips .html', () => assert.equal(sourceToWebPath('/a/b.html'), '/a/b'));
  it('keeps .json', () => assert.equal(sourceToWebPath('/a/b.json'), '/a/b.json'));
  it('keeps other files as-is', () => assert.equal(sourceToWebPath('/a/b.pdf'), '/a/b.pdf'));
});

describe('walkTree', () => {
  it('walks nested folders and skips .helix and .snapshots', async () => {
    const tree = {
      '/': { folders: ['/a/', '/.helix/', '/.snapshots/'], files: [{ path: '/x' }] },
      '/a/': { folders: ['/a/b/'], files: [{ path: '/a/y' }] },
      '/a/b/': { folders: [], files: [{ path: '/a/b/z' }] },
    };
    const visited = [];
    const files = await walkTree('/', async (f) => {
      visited.push(f);
      return tree[f];
    });
    assert.deepEqual(visited.sort(), ['/', '/a/', '/a/b/']);
    assert.deepEqual(files.map((f) => f.path).sort(), ['/a/b/z', '/a/y', '/x']);
  });

  it('limits concurrent listings to 8', async () => {
    const folders = Array.from({ length: 30 }, (_, i) => `/f${i}/`);
    let active = 0;
    let peak = 0;
    await walkTree('/', async (f) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((r) => { setTimeout(r, 1); });
      active -= 1;
      return { folders: f === '/' ? folders : [], files: [] };
    });
    assert.equal(peak, 8);
  });

  it('rejects when a listing fails', async () => {
    await assert.rejects(walkTree('/', async () => { throw new Error('boom'); }), /boom/);
  });
});

describe('collectResources', () => {
  const T1 = '2024-01-01T00:00:00.000Z';
  const T2 = '2024-02-01T00:00:00.000Z';
  const T3 = '2024-03-01T00:00:00.000Z';

  it('merges preview, live and source listings by web path', async () => {
    const admin = mockAdmin({
      '/o/sites/s/preview/': json(200, {
        children: [child('preview', '/index.md', T2), child('preview', '/blog/', null),
          child('preview', '/doc.pdf', T2)],
      }),
      '/o/sites/s/preview/blog/': json(200, {
        children: [child('preview', '/blog/post.md', T2)],
        cursor: 'c1',
      }),
      '/o/sites/s/preview/blog/?c1': json(200, {
        children: [child('preview', '/blog/data.json', T2)],
      }),
      '/o/sites/s/live/': json(200, { children: [child('live', '/index.md', T3)] }),
      '/o/sites/s/source/': json(200, [
        { name: 'blog/', 'content-type': 'application/folder' },
        { name: 'index.html', 'last-modified': T1 },
        { name: 'logo.png', 'last-modified': T1 },
        { name: 'doc.pdf', 'last-modified': T1 },
      ]),
      '/o/sites/s/source/blog/': json(200, [
        { name: 'post.html', 'last-modified': T1 },
        { name: 'draft.html', 'last-modified': T1 },
      ]),
    });

    const resources = await collectResources(admin, {
      org: 'o', site: 's', folder: '/', source: true,
    });

    assert.deepEqual(resources, [
      {
        path: '/', previewLastModified: T2, publishLastModified: T3, sourceLastModified: T1,
      },
      { path: '/blog/data.json', previewLastModified: T2 },
      { path: '/blog/draft', sourceLastModified: T1 },
      { path: '/blog/post', previewLastModified: T2, sourceLastModified: T1 },
      { path: '/doc.pdf', previewLastModified: T2, sourceLastModified: T1 },
    ]);
    assert.ok(admin.calls.every((c) => !c.path.includes('/preview') || c.limit === 1000));
  });

  it('skips the source bus when not requested', async () => {
    const admin = mockAdmin({
      '/o/sites/s/preview/a/': json(200, { children: [child('preview', '/a/b.md', T1)] }),
    });
    const resources = await collectResources(admin, {
      org: 'o', site: 's', folder: '/a/', source: false,
    });
    assert.deepEqual(resources, [{ path: '/a/b', previewLastModified: T1 }]);
    assert.ok(admin.calls.every((c) => !c.path.includes('/source')));
  });

  it('throws with status when a listing is forbidden', async () => {
    const admin = mockAdmin({ '/o/sites/s/preview/': json(403) });
    await assert.rejects(
      collectResources(admin, {
        org: 'o', site: 's', folder: '/', source: false,
      }),
      (e) => e.status === 403,
    );
  });
});
