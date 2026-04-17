import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  truncate, escapeHTML, formatRelativeDate,
} from '../utils.js';

describe('optel/oversight:utils.js', () => {
  describe('truncate', () => {
    it('truncates to the beginning of the hour', () => {
      const time = new Date('2021-01-01T01:30:00Z');
      assert.strictEqual(truncate(time, 'hour'), '2021-01-01T02:00:00+01:00');
    });

    it('truncates to the beginning of the day', () => {
      const time = new Date('2021-01-01T01:30:00Z');
      assert.strictEqual(truncate(time, 'day'), '2021-01-01T00:00:00+01:00');
    });

    it('truncates to the beginning of the week', () => {
      const time = new Date('2021-01-01T01:30:00Z');
      assert.strictEqual(truncate(time, 'week'), '2020-12-27T00:00:00+01:00');
    });

    it('truncates to the beginning of the week (May 11th)', () => {
      const time = new Date('2024-05-11T00:00:00+02:00');
      assert.strictEqual(truncate(time, 'week'), '2024-05-05T00:00:00+02:00');
    });

    it('truncates to the beginning of the week (May 12th)', () => {
      const time = new Date('2024-05-12T00:00:00+02:00');
      assert.strictEqual(truncate(time, 'week'), '2024-05-12T00:00:00+02:00');
    });

    it('truncates to the beginning of the week (May 13th)', () => {
      const time = new Date('2024-05-13T00:00:00+02:00');
      assert.strictEqual(truncate(time, 'week'), '2024-05-12T00:00:00+02:00');
    });

    it('truncates to the beginning of the week (May 14th)', () => {
      const time = new Date('2024-05-14T00:00:00+02:00');
      assert.strictEqual(truncate(time, 'week'), '2024-05-12T00:00:00+02:00');
    });
  });

  describe('escapeHTML', () => {
    it('escapes HTML entities', () => {
      assert.strictEqual(escapeHTML('<script>alert("xss")</script>'), '&#60;script&#62;alert(&#34;xss&#34;)&#60;/script&#62;');
      assert.strictEqual(escapeHTML("<script>alert('xss')</script>"), '&#60;script&#62;alert(&#39;xss&#39;)&#60;/script&#62;');
      assert.strictEqual(escapeHTML('<div>hello</div>'), '&#60;div&#62;hello&#60;/div&#62;');
    });
  });
});

describe('formatRelativeDate', () => {
  it('returns "-" for an invalid date', () => {
    assert.strictEqual(formatRelativeDate('not-a-date'), '-');
  });

  it('returns "Today" for the current UTC date', () => {
    const now = new Date();
    assert.strictEqual(formatRelativeDate(now), 'Today');
  });

  it('returns "Yesterday" for 1 UTC day ago', () => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - 1);
    assert.strictEqual(formatRelativeDate(d), 'Yesterday');
  });

  it('returns "X days ago" for 3 days ago', () => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - 3);
    assert.strictEqual(formatRelativeDate(d), '3 days ago');
  });

  it('returns "Last week" for exactly 7 days ago', () => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - 7);
    assert.strictEqual(formatRelativeDate(d), 'Last week');
  });

  it('returns "2 weeks ago" for 14 days ago', () => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - 14);
    assert.strictEqual(formatRelativeDate(d), '2 weeks ago');
  });

  it('returns "Last month" for 30 days ago', () => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - 30);
    assert.strictEqual(formatRelativeDate(d), 'Last month');
  });

  it('returns "2 months ago" for 60 days ago', () => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - 60);
    assert.strictEqual(formatRelativeDate(d), '2 months ago');
  });

  it('returns "Last year" for 365 days ago', () => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - 365);
    assert.strictEqual(formatRelativeDate(d), 'Last year');
  });

  it('returns "2 years ago" for 730 days ago', () => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - 730);
    assert.strictEqual(formatRelativeDate(d), '2 years ago');
  });
});
