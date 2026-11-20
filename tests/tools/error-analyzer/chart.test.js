import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateByPeriod, formatAxisValue, getLabelStep,
} from '../../../tools/error-analyzer/chart.js';

const slot = (iso, weight) => ({ time: new Date(iso), weight });

describe('error-analyzer:chart.js', () => {
  describe('formatAxisValue', () => {
    it('formats with K/M/B suffixes', () => {
      assert.equal(formatAxisValue(999), '999');
      assert.equal(formatAxisValue(1500), '1.5K');
      assert.equal(formatAxisValue(2500000), '2.5M');
      assert.equal(formatAxisValue(3000000000), '3.0B');
    });
  });

  describe('getLabelStep', () => {
    it('picks a step per range', () => {
      assert.equal(getLabelStep('week', 100), 6);
      assert.equal(getLabelStep('month', 30), 2);
      assert.equal(getLabelStep('month', 10), 1);
      assert.equal(getLabelStep('year', 52), 1);
    });
  });

  describe('aggregateByPeriod', () => {
    const data = [
      { timeSlots: [slot('2025-03-10T10:00:00', 2), slot('2025-03-09T10:00:00', 1)] },
      { timeSlots: [slot('2025-03-10T15:00:00', 5)] },
    ];

    it('sums by day and sorts chronologically', () => {
      const { labels, counts } = aggregateByPeriod(data, 'month');
      assert.deepEqual(labels, ['3/9', '3/10']);
      assert.deepEqual(counts, [1, 7]);
    });

    it('groups by hour for week', () => {
      const { labels, counts } = aggregateByPeriod(data, 'week');
      assert.deepEqual(labels, ['3/9 10:00', '3/10 10:00', '3/10 15:00']);
      assert.deepEqual(counts, [1, 2, 5]);
    });

    it('groups by week start for year', () => {
      const { labels, counts } = aggregateByPeriod(data, 'year');
      assert.deepEqual(labels, ['3/9']);
      assert.deepEqual(counts, [8]);
    });
  });
});
