import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  pad,
  toDateTimeLocal,
  toUTCDate,
  calculatePastDate,
  writeTimeParams,
  formatTimestamp,
  formatUser,
  formatErrors,
  formatMethod,
  formatDuration,
  formatPath,
} from '../utils.js';

describe('log-viewer:utils.js', () => {
  describe('pad', () => {
    it('pads single-digit numbers with a leading zero', () => {
      assert.equal(pad(5), '05');
    });

    it('does not pad two-digit numbers', () => {
      assert.equal(pad(12), '12');
    });

    it('handles 0', () => {
      assert.equal(pad(0), '00');
    });
  });

  describe('toDateTimeLocal', () => {
    it('formats a date to YYYY-MM-DDTHH:MM', () => {
      // Use a fixed local date to avoid timezone dependence.
      // We construct via individual parts so the test is timezone-independent.
      const date = new Date(2024, 0, 5, 9, 3); // Jan 5, 2024 09:03 local
      assert.equal(toDateTimeLocal(date), '2024-01-05T09:03');
    });

    it('pads month, day, hours, and minutes when single digit', () => {
      const date = new Date(2023, 2, 7, 8, 4); // Mar 7, 2023 08:04 local
      assert.equal(toDateTimeLocal(date), '2023-03-07T08:04');
    });

    it('handles double-digit values without extra padding', () => {
      const date = new Date(2020, 11, 31, 23, 59); // Dec 31, 2020 23:59 local
      assert.equal(toDateTimeLocal(date), '2020-12-31T23:59');
    });
  });

  describe('toUTCDate', () => {
    it('formats a UTC timestamp to MM/DD/YYYY HH:MM UTC', () => {
      // Jan 5 2024 09:03 UTC
      const date = new Date('2024-01-05T09:03:00Z');
      assert.equal(toUTCDate(date), '01/05/2024 09:03 UTC');
    });

    it('pads single-digit UTC month, day, hours, and minutes', () => {
      const date = new Date('2023-03-07T08:04:00Z');
      assert.equal(toUTCDate(date), '03/07/2023 08:04 UTC');
    });

    it('correctly uses UTC values regardless of local timezone', () => {
      // midnight UTC — local time may differ
      const date = new Date('2024-06-01T00:00:00Z');
      assert.equal(toUTCDate(date), '06/01/2024 00:00 UTC');
    });
  });

  describe('calculatePastDate', () => {
    // calculatePastDate uses local-time setters (setDate, setHours, setMinutes),
    // so tests must read back with the corresponding local-time getters to be
    // timezone-portable.

    it('subtracts days from the reference date', () => {
      const ref = new Date(2024, 2, 10, 12, 0, 0); // Mar 10 2024 12:00 local
      const result = calculatePastDate(2, 0, 0, new Date(ref));
      assert.equal(result.getDate(), 8);
      assert.equal(result.getMonth(), 2); // March = index 2
    });

    it('subtracts hours from the reference date', () => {
      const ref = new Date(2024, 2, 10, 12, 0, 0); // Mar 10 2024 12:00 local
      const result = calculatePastDate(0, 3, 0, new Date(ref));
      assert.equal(result.getHours(), 9);
    });

    it('subtracts minutes from the reference date', () => {
      const ref = new Date(2024, 2, 10, 12, 30, 0); // Mar 10 2024 12:30 local
      const result = calculatePastDate(0, 0, 30, new Date(ref));
      assert.equal(result.getMinutes(), 0);
      assert.equal(result.getHours(), 12);
    });

    it('handles all three offsets together', () => {
      const ref = new Date(2024, 2, 10, 12, 30, 0); // Mar 10 2024 12:30 local
      const result = calculatePastDate(1, 2, 15, new Date(ref));
      assert.equal(result.getDate(), 9);
      assert.equal(result.getHours(), 10);
      assert.equal(result.getMinutes(), 15);
    });

    it('does not modify any component when all params are 0', () => {
      const ref = new Date(2024, 2, 10, 12, 30, 0); // Mar 10 2024 12:30 local
      const result = calculatePastDate(0, 0, 0, new Date(ref));
      assert.equal(result.getFullYear(), 2024);
      assert.equal(result.getMonth(), 2);
      assert.equal(result.getDate(), 10);
      assert.equal(result.getHours(), 12);
      assert.equal(result.getMinutes(), 30);
    });
  });

  describe('writeTimeParams', () => {
    it('returns since=Nd for a day-based timeframe', () => {
      assert.equal(writeTimeParams('7:00:00'), 'since=7d');
    });

    it('returns since=Nh for an hour-based timeframe (days=0)', () => {
      assert.equal(writeTimeParams('0:12:00'), 'since=12h');
    });

    it('returns since=Nm for a minute-based timeframe (days=0, hours=0)', () => {
      assert.equal(writeTimeParams('0:00:30'), 'since=30m');
    });

    it('returns from/to params for custom timeframe', () => {
      const from = '2024-01-01T00:00:00.000Z';
      const to = '2024-01-02T00:00:00.000Z';
      const result = writeTimeParams('custom', from, to);
      assert.ok(result.startsWith('from='));
      assert.ok(result.includes('&to='));
      assert.ok(result.includes(encodeURIComponent(from)));
      assert.ok(result.includes(encodeURIComponent(to)));
    });

    it('returns from/to params for today timeframe', () => {
      const from = '2024-06-15T00:00:00.000Z';
      const to = '2024-06-15T14:30:00.000Z';
      const result = writeTimeParams('today', from, to);
      assert.ok(result.startsWith('from='));
      assert.ok(result.includes('&to='));
    });

    it('picks hours when days is 1 but hours param drives the "1:00:00" case', () => {
      // "1:00:00" → days=1, which returns since=1d
      assert.equal(writeTimeParams('1:00:00'), 'since=1d');
    });
  });

  describe('formatTimestamp', () => {
    it('returns "-" for null', () => {
      assert.equal(formatTimestamp(null), '-');
    });

    it('returns "-" for undefined', () => {
      assert.equal(formatTimestamp(undefined), '-');
    });

    it('returns "-" for 0 (falsy)', () => {
      assert.equal(formatTimestamp(0), '-');
    });

    it('formats a valid ISO timestamp to UTC date string', () => {
      const result = formatTimestamp('2024-06-01T12:00:00Z');
      assert.equal(result, '06/01/2024 12:00 UTC');
    });

    it('formats a numeric epoch timestamp', () => {
      // 2024-01-01T00:00:00Z in ms
      const epoch = Date.UTC(2024, 0, 1, 0, 0, 0);
      const result = formatTimestamp(epoch);
      assert.equal(result, '01/01/2024 00:00 UTC');
    });
  });

  describe('formatUser', () => {
    it('returns "-" for null', () => {
      assert.equal(formatUser(null), '-');
    });

    it('returns "-" for empty string', () => {
      assert.equal(formatUser(''), '-');
    });

    it('formats an email as a mailto anchor showing only the local part', () => {
      const result = formatUser('jane@example.com');
      assert.equal(result, '<a href="mailto:jane@example.com" title="jane@example.com">jane</a>');
    });

    it('uses the full address in href and title', () => {
      const result = formatUser('user.name@company.org');
      assert.ok(result.includes('href="mailto:user.name@company.org"'));
      assert.ok(result.includes('title="user.name@company.org"'));
      assert.ok(result.includes('>user.name<'));
    });
  });

  describe('formatErrors', () => {
    it('returns "-" for null', () => {
      assert.equal(formatErrors(null), '-');
    });

    it('returns "-" for an empty array', () => {
      assert.equal(formatErrors([]), '-');
    });

    it('formats a single error with message and target', () => {
      const result = formatErrors([{ message: 'Not found', target: '/path' }]);
      assert.equal(result, 'Not found (/path)');
    });

    it('formats multiple errors joined with ", <br />"', () => {
      const errors = [
        { message: 'Error A', target: '/a' },
        { message: 'Error B', target: '/b' },
      ];
      const result = formatErrors(errors);
      assert.equal(result, 'Error A (/a), <br />Error B (/b)');
    });

    it('returns raw error value when message is absent', () => {
      const result = formatErrors(['raw string error']);
      assert.equal(result, 'raw string error');
    });
  });

  describe('formatMethod', () => {
    it('returns "-" for null', () => {
      assert.equal(formatMethod(null), '-');
    });

    it('returns "-" for empty string', () => {
      assert.equal(formatMethod(''), '-');
    });

    it('wraps the method in <code> tags', () => {
      assert.equal(formatMethod('GET'), '<code>GET</code>');
      assert.equal(formatMethod('POST'), '<code>POST</code>');
    });
  });

  describe('formatDuration', () => {
    it('returns "-" for null', () => {
      assert.equal(formatDuration(null), '-');
    });

    it('returns "-" for 0', () => {
      assert.equal(formatDuration(0), '-');
    });

    it('converts milliseconds to seconds with one decimal place', () => {
      assert.equal(formatDuration(1000), '1.0 s');
      assert.equal(formatDuration(1500), '1.5 s');
      assert.equal(formatDuration(250), '0.3 s');
    });

    it('handles large durations', () => {
      assert.equal(formatDuration(60000), '60.0 s');
    });
  });

  describe('formatPath', () => {
    const live = 'main--site--org.aem.live';
    const preview = 'main--site--org.aem.page';

    it('returns "-" when no type and no value', () => {
      assert.equal(formatPath(null, {}, live, preview), '-');
    });

    it('returns value as-is when no route or source', () => {
      assert.equal(formatPath('/some/path', {}, live, preview), '/some/path');
    });

    it('builds a github link for route=code', () => {
      const data = {
        route: 'code', owner: 'adobe', repo: 'helix', ref: 'main',
      };
      const result = formatPath('/src/file.js', data, live, preview);
      assert.ok(result.includes('href="https://github.com/adobe/helix/tree/main"'));
      assert.ok(result.includes('target="_blank"'));
    });

    it('builds an admin config button for route=config', () => {
      const data = { route: 'config', org: 'myorg', site: 'mysite' };
      const result = formatPath('/path', data, live, preview);
      assert.ok(result.includes("data-url='https://admin.hlx.page/config/myorg/sites/mysite.json'"));
      assert.ok(result.includes('<button'));
    });

    it('builds a live link for route=index', () => {
      const data = { route: 'index' };
      const result = formatPath('/page', data, live, preview);
      assert.ok(result.includes(`href="https://${live}/page"`));
    });

    it('builds a live link for route=live', () => {
      const data = { route: 'live' };
      const result = formatPath('/page', data, live, preview);
      assert.ok(result.includes(`href="https://${live}/page"`));
    });

    it('builds a preview link for route=preview', () => {
      const data = { route: 'preview' };
      const result = formatPath('/page', data, live, preview);
      assert.ok(result.includes(`href="https://${preview}/page"`));
    });

    it('builds an admin job button for route=job', () => {
      const data = {
        route: 'job', org: 'myorg', site: 'mysite', ref: 'main',
      };
      const result = formatPath('/job-id', data, live, preview);
      assert.ok(result.includes("data-url='https://admin.hlx.page/job/myorg/mysite/main/job-id/details'"));
    });

    it('builds an admin job button for source containing "-job"', () => {
      const data = {
        source: 'bulk-job', org: 'myorg', site: 'mysite', ref: 'main',
      };
      const result = formatPath('/job-123', data, live, preview);
      assert.ok(result.includes('admin.hlx.page/job/'));
    });

    it('builds an admin status button for route=status', () => {
      const data = {
        route: 'status', owner: 'adobe', repo: 'helix', ref: 'main',
      };
      const result = formatPath('/page', data, live, preview);
      assert.ok(result.includes("data-url='https://admin.hlx.page/status/adobe/helix/main/page'"));
    });

    it('builds a snapshot job button when job id is present', () => {
      const data = {
        route: 'snapshot', org: 'myorg', site: 'mysite', ref: 'main', job: 'job-abc',
      };
      const result = formatPath(null, data, live, preview);
      assert.ok(result.includes("data-url='https://admin.hlx.page/job/myorg/mysite/main/job-abc/details'"));
    });

    it('returns "-" for snapshot with no job id and no value', () => {
      const data = { route: 'snapshot', org: 'myorg', site: 'mysite' };
      assert.equal(formatPath(null, data, live, preview), '-');
    });

    it('truncates button label text longer than 26 characters', () => {
      const data = {
        route: 'status', owner: 'adobe', repo: 'helix', ref: 'main',
      };
      const longPath = '/this-is-a-very-long-path-name';
      const result = formatPath(longPath, data, live, preview);
      assert.ok(result.includes('…'));
      // The truncated label should be 26 chars + ellipsis
      assert.ok(result.includes(`${longPath.substring(0, 26)}…`));
    });

    it('builds indexer buttons for each change segment', () => {
      const data = {
        route: 'indexer',
        owner: 'adobe',
        repo: 'helix',
        ref: 'main',
        changes: ['/page-one 200ms', '/page-two 50ms'],
        duration: 100,
      };
      const result = formatPath('/index', data, live, preview);
      assert.ok(result.includes('/page-one'));
      assert.ok(result.includes('/page-two'));
      assert.ok(result.includes('<br /><br />'));
    });

    it('returns value or "-" for indexer with no changes', () => {
      const data = { route: 'indexer', owner: 'adobe', repo: 'helix' };
      assert.equal(formatPath('/path', data, live, preview), '/path');
      assert.equal(formatPath(null, data, live, preview), '-');
    });

    it('builds sitemap links from updated array (source=sitemap)', () => {
      const data = {
        source: 'sitemap',
        updated: [['/page-a', '/page-b']],
      };
      const result = formatPath(null, data, live, preview);
      assert.ok(result.includes(`href="https://${live}/page-a"`));
      assert.ok(result.includes(`href="https://${live}/page-b"`));
    });

    it('builds a single sitemap link from path (route=sitemap)', () => {
      const data = { route: 'sitemap', path: '/sitemap.xml' };
      const result = formatPath(null, data, live, preview);
      assert.ok(result.includes(`href="https://${live}/sitemap.xml"`));
    });
  });
});
