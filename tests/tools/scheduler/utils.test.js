import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateNonce, writeScheduleIntent } from '../../../tools/scheduler/utils.js';

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
});
