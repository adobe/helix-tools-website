import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateNonce, ensureViewNonce, __resetViewNonceForTests,
  schedulePage as schedulePageApi,
  deletePageSchedule,
  deleteSnapshotSchedule,
  fetchSchedule,
  isPageHost,
  parseSidekickParams,
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

  describe('ensureViewNonce', () => {
    it('writes one intent and caches the nonce within the TTL', async () => {
      __resetViewNonceForTests();
      let writeCount = 0;
      const writeIntent = async () => { writeCount += 1; return { ok: true }; };
      const n1 = await ensureViewNonce('o', 's', writeIntent);
      const n2 = await ensureViewNonce('o', 's', writeIntent);
      assert.equal(n1, n2);
      assert.equal(writeCount, 1);
    });

    it('passes a view-schedule-intent entry with the generated nonce', async () => {
      __resetViewNonceForTests();
      let captured;
      const writeIntent = async (entry) => { captured = entry; return { ok: true }; };
      const nonce = await ensureViewNonce('o', 's', writeIntent);
      assert.equal(captured.route, 'view-schedule-intent');
      assert.equal(captured.nonce, nonce);
    });

    it('rotates the nonce for a different org/site', async () => {
      __resetViewNonceForTests();
      const writeIntent = async () => ({ ok: true });
      const n1 = await ensureViewNonce('o1', 's1', writeIntent);
      const n2 = await ensureViewNonce('o2', 's2', writeIntent);
      assert.notEqual(n1, n2);
    });

    it('throws and clears the cache when the writer fails', async () => {
      __resetViewNonceForTests();
      const writeIntent = async () => ({ ok: false, error: 'forbidden' });
      await assert.rejects(
        ensureViewNonce('o', 's', writeIntent),
        /forbidden/,
      );
    });
  });

  describe('isPageHost', () => {
    it('matches the default preview/live/review hosts', () => {
      assert.equal(isPageHost('main--site--org.aem.page'), true);
      assert.equal(isPageHost('main--site--org.aem.live'), true);
      assert.equal(isPageHost('default--main--site--org.aem.reviews'), true);
    });

    it('rejects anything else, including authoring surfaces and a custom prod domain', () => {
      assert.equal(isPageHost('org-my.sharepoint.com'), false);
      assert.equal(isPageHost('docs.google.com'), false);
      assert.equal(isPageHost('www.example.com'), false);
    });
  });

  describe('parseSidekickParams', () => {
    it('derives path directly from a preview/live referrer', () => {
      const search = '?owner=org&repo=site&referrer=https%3A%2F%2Fmain--site--org.aem.page%2Ffoo%2Fbar';
      const result = parseSidekickParams(search);
      assert.deepEqual(result, {
        org: 'org',
        site: 'site',
        path: '/foo/bar',
        referrer: 'https://main--site--org.aem.page/foo/bar',
        isProject: true,
      });
    });

    it('leaves path empty for an authoring-surface referrer (e.g. SharePoint)', () => {
      const referrer = 'https://org-my.sharepoint.com/:w:/r/personal/foo/Documents/page.docx';
      const search = `?owner=org&repo=site&referrer=${encodeURIComponent(referrer)}`;
      const result = parseSidekickParams(search);
      assert.equal(result.path, '');
      assert.equal(result.isProject, false);
      assert.equal(result.referrer, referrer);
    });

    it('leaves path empty for a custom prod domain referrer (resolved via Admin instead)', () => {
      const search = '?owner=org&repo=site&referrer=https%3A%2F%2Fwww.example.com%2Ffoo';
      const result = parseSidekickParams(search);
      assert.equal(result.path, '');
      assert.equal(result.isProject, false);
    });

    it('handles a missing or unparsable referrer', () => {
      assert.deepEqual(parseSidekickParams('?owner=org&repo=site'), {
        org: 'org', site: 'site', path: '', referrer: '', isProject: false,
      });
      assert.equal(parseSidekickParams('?referrer=not-a-url').path, '');
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
