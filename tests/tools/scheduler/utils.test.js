import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateNonce, writeScheduleIntent, ensureViewNonce, __resetViewNonceForTests,
  schedulePage as schedulePageApi,
  deletePageSchedule,
  deleteSnapshotSchedule,
  fetchSchedule,
} from '../../../tools/scheduler/utils.js';

describe('scheduler:utils.js', () => {
  describe('generateNonce', () => {
    it('returns a UUID v4 shaped string', () => {
      const n = generateNonce();
      assert.match(n, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    });

    it('returns different values on successive calls', () => {
      assert.notEqual(generateNonce(), generateNonce());
    });
  });

  describe('writeScheduleIntent', () => {
    it('POSTs to admin.hlx.page/log without Authorization header', async () => {
      let captured;
      const originalFetch = global.fetch;
      global.fetch = async (url, opts) => {
        captured = { url, opts };
        return new Response('', { status: 201 });
      };
      try {
        const result = await writeScheduleIntent('o', 's', {
          route: 'schedule-page-intent', nonce: 'n1', path: '/x', scheduledPublish: '2099-01-01T00:00:00Z',
        });
        assert.equal(result.ok, true);
        assert.equal(captured.url, 'https://admin.hlx.page/log/o/s/main');
        assert.equal(captured.opts.method, 'POST');
        assert.equal(captured.opts.headers?.Authorization, undefined);
        const body = JSON.parse(captured.opts.body);
        assert.equal(body.entries.length, 1);
        assert.equal(body.entries[0].route, 'schedule-page-intent');
        assert.equal(body.entries[0].nonce, 'n1');
      } finally {
        global.fetch = originalFetch;
      }
    });

    it('returns ok:false with error message on non-OK response', async () => {
      const originalFetch = global.fetch;
      global.fetch = async () => new Response('', {
        status: 403, headers: { 'x-error': 'forbidden' },
      });
      try {
        const result = await writeScheduleIntent('o', 's', { route: 'r', nonce: 'n' });
        assert.equal(result.ok, false);
        assert.match(result.error, /forbidden/);
      } finally {
        global.fetch = originalFetch;
      }
    });
  });

  describe('ensureViewNonce', () => {
    it('writes one log entry and caches the nonce within the TTL', async () => {
      __resetViewNonceForTests();
      let postCount = 0;
      const originalFetch = global.fetch;
      global.fetch = async (url, opts) => {
        if (url.startsWith('https://admin.hlx.page/log/') && opts?.method === 'POST') {
          postCount += 1;
          return new Response('', { status: 201 });
        }
        throw new Error(`Unexpected fetch: ${url}`);
      };
      try {
        const n1 = await ensureViewNonce('o', 's');
        const n2 = await ensureViewNonce('o', 's');
        assert.equal(n1, n2);
        assert.equal(postCount, 1);
      } finally {
        global.fetch = originalFetch;
      }
    });

    it('rotates the nonce for a different org/site', async () => {
      __resetViewNonceForTests();
      const originalFetch = global.fetch;
      global.fetch = async () => new Response('', { status: 201 });
      try {
        const n1 = await ensureViewNonce('o1', 's1');
        const n2 = await ensureViewNonce('o2', 's2');
        assert.notEqual(n1, n2);
      } finally {
        global.fetch = originalFetch;
      }
    });
  });

  describe('worker-call signatures', () => {
    it('schedulePage POSTs body { path, scheduledPublish, nonce } without userId', async () => {
      let captured;
      const originalFetch = global.fetch;
      global.fetch = async (url, opts) => {
        captured = { url, opts };
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      };
      try {
        await schedulePageApi({
          org: 'o', site: 's', path: '/x', scheduledPublish: '2099-01-01T00:00:00Z', nonce: 'n1',
        });
        assert.equal(captured.url, 'https://helix-snapshot-scheduler-prod.adobeaem.workers.dev/schedule/page/o/s');
        const body = JSON.parse(captured.opts.body);
        assert.deepEqual(Object.keys(body).sort(), ['nonce', 'path', 'scheduledPublish']);
      } finally {
        global.fetch = originalFetch;
      }
    });

    it('deletePageSchedule appends ?nonce= to URL', async () => {
      let capturedUrl;
      const originalFetch = global.fetch;
      global.fetch = async (url) => { capturedUrl = url; return new Response('', { status: 200 }); };
      try {
        await deletePageSchedule('o', 's', '/x', 'n1');
        assert.match(capturedUrl, /\/schedule\/page\/o\/s\/x\?nonce=n1$/);
      } finally {
        global.fetch = originalFetch;
      }
    });

    it('deleteSnapshotSchedule appends ?nonce= to URL', async () => {
      let capturedUrl;
      const originalFetch = global.fetch;
      global.fetch = async (url) => { capturedUrl = url; return new Response('', { status: 200 }); };
      try {
        await deleteSnapshotSchedule('o', 's', 'snap1', 'n2');
        assert.match(capturedUrl, /\/schedule\/snapshot\/o\/s\/snap1\?nonce=n2$/);
      } finally {
        global.fetch = originalFetch;
      }
    });

    it('fetchSchedule appends ?nonce= to URL', async () => {
      let capturedUrl;
      const originalFetch = global.fetch;
      global.fetch = async (url) => {
        capturedUrl = url;
        return new Response(JSON.stringify({}), { status: 200 });
      };
      try {
        await fetchSchedule('o', 's', 'n3');
        assert.match(capturedUrl, /\/schedule\/o\/s\?nonce=n3$/);
      } finally {
        global.fetch = originalFetch;
      }
    });
  });
});
