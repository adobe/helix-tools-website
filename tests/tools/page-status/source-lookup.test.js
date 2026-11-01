import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { lookupSource, lookupAll } from '../../../tools/page-status/source-lookup.js';

const res = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

function mockAdmin(handler) {
  const calls = [];
  return {
    calls,
    raw: async (method, path, body, opts) => {
      calls.push({ method, path, params: opts?.params });
      return handler(path);
    },
  };
}

describe('lookupSource', () => {
  it('requests status with editUrl=auto', async () => {
    const admin = mockAdmin(() => res(200, { edit: { status: 200, lastModified: 'T' } }));
    await lookupSource(admin, 'o', 's', '/');
    await lookupSource(admin, 'o', 's', '/blog/post');
    assert.deepEqual(admin.calls, [
      { method: 'GET', path: '/o/sites/s/status/', params: { editUrl: 'auto' } },
      { method: 'GET', path: '/o/sites/s/status/blog/post', params: { editUrl: 'auto' } },
    ]);
  });

  it('returns lastModified when source exists', async () => {
    const admin = mockAdmin(() => res(200, { edit: { status: 200, lastModified: 'T' } }));
    assert.deepEqual(await lookupSource(admin, 'o', 's', '/a'), { lastModified: 'T' });
  });

  it('returns missing when source is not found', async () => {
    const admin = mockAdmin(() => res(200, { edit: { status: 404 } }));
    assert.deepEqual(await lookupSource(admin, 'o', 's', '/a'), { missing: true });
  });

  it('throws with edit status when lookup is forbidden', async () => {
    const admin = mockAdmin(() => res(200, { edit: { status: 403 } }));
    await assert.rejects(lookupSource(admin, 'o', 's', '/a'), (e) => e.status === 403);
  });

  it('throws with response status on request failure', async () => {
    const admin = mockAdmin(() => res(429));
    await assert.rejects(lookupSource(admin, 'o', 's', '/a'), (e) => e.status === 429);
  });
});

describe('lookupAll', () => {
  it('reports each result and limits concurrency', async () => {
    let active = 0;
    let peak = 0;
    const admin = {
      raw: async (method, path) => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((r) => { setTimeout(r, 1); });
        active -= 1;
        if (path.endsWith('/bad')) return res(500);
        return res(200, { edit: { status: 200, lastModified: path } });
      },
    };
    const paths = [...Array.from({ length: 10 }, (_, i) => `/p${i}`), '/bad'];
    const results = [];
    await lookupAll(admin, 'o', 's', paths, {
      onResult: (path, result, error) => results.push({ path, result, error: error?.status }),
    });
    assert.equal(peak, 4);
    assert.equal(results.length, 11);
    assert.deepEqual(results.find((r) => r.path === '/bad'), { path: '/bad', result: undefined, error: 500 });
    assert.deepEqual(results.find((r) => r.path === '/p0').result, { lastModified: '/o/sites/s/status/p0' });
  });

  it('stops starting lookups once aborted', async () => {
    const admin = { raw: async () => res(200, { edit: { status: 200, lastModified: 'T' } }) };
    const paths = Array.from({ length: 20 }, (_, i) => `/p${i}`);
    let count = 0;
    const signal = { aborted: false };
    await lookupAll(admin, 'o', 's', paths, {
      signal,
      onResult: () => {
        count += 1;
        if (count === 2) signal.aborted = true;
      },
    });
    assert.ok(count < 20);
  });
});
