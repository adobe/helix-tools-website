import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatNumber, formatRelativeDate } from '../utils.js';

// Build a Date that is exactly `n` UTC days before today's UTC midnight.
function daysAgo(n) {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}

describe('error-analyzer:utils.js', () => {
  describe('formatNumber', () => {
    it('returns numbers below 1000 as plain strings', () => {
      assert.equal(formatNumber(0), '0');
      assert.equal(formatNumber(1), '1');
      assert.equal(formatNumber(999), '999');
    });

    it('formats thousands as K', () => {
      assert.equal(formatNumber(1000), '1.0K');
      assert.equal(formatNumber(1500), '1.5K');
      assert.equal(formatNumber(999000), '999.0K');
    });

    it('formats millions as M', () => {
      assert.equal(formatNumber(1000000), '1.0M');
      assert.equal(formatNumber(2500000), '2.5M');
    });

    it('formats billions as B', () => {
      assert.equal(formatNumber(1000000000), '1.0B');
      assert.equal(formatNumber(3000000000), '3.0B');
    });
  });

  describe('formatRelativeDate', () => {
    it('returns "-" for an invalid date string', () => {
      assert.equal(formatRelativeDate('not-a-date'), '-');
      assert.equal(formatRelativeDate(''), '-');
    });

    it('returns "Today" for the current date', () => {
      assert.equal(formatRelativeDate(new Date()), 'Today');
    });

    it('returns "Today" for a future date', () => {
      assert.equal(formatRelativeDate(daysAgo(-1)), 'Today');
    });

    it('returns "Yesterday" for 1 day ago', () => {
      assert.equal(formatRelativeDate(daysAgo(1)), 'Yesterday');
    });

    it('returns "X days ago" for 2–6 days ago', () => {
      assert.equal(formatRelativeDate(daysAgo(2)), '2 days ago');
      assert.equal(formatRelativeDate(daysAgo(6)), '6 days ago');
    });

    it('returns "Last week" for 7–13 days ago', () => {
      assert.equal(formatRelativeDate(daysAgo(7)), 'Last week');
      assert.equal(formatRelativeDate(daysAgo(13)), 'Last week');
    });

    it('returns "X weeks ago" for 14–29 days ago', () => {
      assert.equal(formatRelativeDate(daysAgo(14)), '2 weeks ago');
      assert.equal(formatRelativeDate(daysAgo(21)), '3 weeks ago');
    });

    it('returns "Last month" for 30–59 days ago', () => {
      assert.equal(formatRelativeDate(daysAgo(30)), 'Last month');
      assert.equal(formatRelativeDate(daysAgo(59)), 'Last month');
    });

    it('returns "X months ago" for 60–364 days ago', () => {
      assert.equal(formatRelativeDate(daysAgo(60)), '2 months ago');
      assert.equal(formatRelativeDate(daysAgo(90)), '3 months ago');
    });

    it('returns "Last year" for 365–729 days ago', () => {
      assert.equal(formatRelativeDate(daysAgo(365)), 'Last year');
      assert.equal(formatRelativeDate(daysAgo(729)), 'Last year');
    });

    it('returns "X years ago" for 730+ days ago', () => {
      assert.equal(formatRelativeDate(daysAgo(730)), '2 years ago');
      assert.equal(formatRelativeDate(daysAgo(1095)), '3 years ago');
    });
  });
});
