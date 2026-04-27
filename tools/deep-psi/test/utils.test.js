import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  mean,
  stDev,
  lowestCluster,
  getPerformanceColor,
  calculatePerformanceScore,
  significancetest,
} from '../utils.js';

describe('deep-psi:utils.js', () => {
  describe('mean', () => {
    it('returns 0 for an empty array', () => {
      assert.equal(mean([]), 0);
    });

    it('returns 0 for null', () => {
      assert.equal(mean(null), 0);
    });

    it('returns the value for a single-element array', () => {
      assert.equal(mean([5]), 5);
    });

    it('returns the arithmetic mean', () => {
      assert.equal(mean([1, 2, 3, 4, 5]), 3);
    });
  });

  describe('stDev', () => {
    it('returns 0 for an empty array', () => {
      assert.equal(stDev([]), 0);
    });

    it('returns 0 for a single-element array', () => {
      assert.equal(stDev([5]), 0);
    });

    it('returns 0 for an array of identical values', () => {
      assert.equal(stDev([7, 7, 7, 7]), 0);
    });

    it('computes sample standard deviation correctly', () => {
      // sample stDev of [2, 4] = sqrt(((2-3)^2 + (4-3)^2) / 1) = sqrt(2)
      assert.ok(Math.abs(stDev([2, 4]) - Math.sqrt(2)) < 1e-10);
    });
  });

  describe('lowestCluster', () => {
    it('returns 0 for an empty array', () => {
      assert.equal(lowestCluster([]), 0);
    });

    it('returns the single value for a one-element array', () => {
      assert.equal(lowestCluster([5]), 5);
    });

    it('returns the average for a two-element array', () => {
      assert.equal(lowestCluster([3, 7]), 5);
    });

    it('returns the average of the 3 lowest when no cluster exists', () => {
      assert.equal(lowestCluster([1, 2, 3, 4, 5]), 2);
    });

    it('returns the cluster value when a run of 3 identical values exists', () => {
      assert.equal(lowestCluster([5, 2, 2, 2, 8]), 2);
    });

    it('prefers the lowest cluster when multiple clusters exist', () => {
      assert.equal(lowestCluster([1, 1, 1, 5, 5, 5]), 1);
    });

    it('does not mutate the input array', () => {
      const input = [3, 1, 2];
      lowestCluster(input);
      assert.deepEqual(input, [3, 1, 2]);
    });
  });

  describe('getPerformanceColor', () => {
    it('returns grey for an unknown metric', () => {
      assert.equal(getPerformanceColor('UNKNOWN', 1.0), 'var(--color-font-grey)');
    });

    it('returns good color at the good threshold boundary (FCP=1.8)', () => {
      const good = getPerformanceColor('FCP', 1.8);
      const needsImprovement = getPerformanceColor('FCP', 1.81);
      assert.notEqual(good, needsImprovement);
      assert.equal(good, getPerformanceColor('FCP', 0));
    });

    it('returns needs-improvement color between thresholds (FCP=2.4)', () => {
      const mid = getPerformanceColor('FCP', 2.4);
      assert.equal(mid, getPerformanceColor('FCP', 1.81));
      assert.equal(mid, getPerformanceColor('FCP', 3.0));
    });

    it('returns poor color above the needs-improvement threshold (FCP=3.01)', () => {
      const poor = getPerformanceColor('FCP', 3.01);
      assert.equal(poor, getPerformanceColor('FCP', 10));
    });

    it('applies correct thresholds for CLS (unitless metric)', () => {
      assert.equal(getPerformanceColor('CLS', 0.1), getPerformanceColor('FCP', 0));
      assert.equal(getPerformanceColor('CLS', 0.15), getPerformanceColor('FCP', 2.4));
      assert.equal(getPerformanceColor('CLS', 0.26), getPerformanceColor('FCP', 10));
    });

    it('all six metrics return a color (not grey)', () => {
      ['FCP', 'SI', 'LCP', 'TTI', 'TBT', 'CLS'].forEach((metric) => {
        assert.notEqual(getPerformanceColor(metric, 0), 'var(--color-font-grey)');
      });
    });
  });

  describe('calculatePerformanceScore', () => {
    it('returns 0 for empty metrics', () => {
      assert.equal(calculatePerformanceScore({}), 0);
    });

    it('returns 100 when all metrics are in the good range', () => {
      assert.equal(calculatePerformanceScore({
        FCP: 1.0, SI: 1.0, LCP: 1.0, TTI: 1.0, TBT: 0.1, CLS: 0.05,
      }), 100);
    });

    it('returns 100 at the exact good boundary for a single metric', () => {
      // FCP=1.8 is exactly at good threshold → score=100, weight normalizes to 100
      assert.equal(calculatePerformanceScore({ FCP: 1.8 }), 100);
    });

    it('returns 70 at the exact needs-improvement boundary for a single metric', () => {
      // FCP=3.0 → linear penalty: 100 - ((3.0-1.8)/(3.0-1.8))*30 = 70
      assert.equal(calculatePerformanceScore({ FCP: 3.0 }), 70);
    });

    it('returns 85 at the midpoint of the needs-improvement range for a single metric', () => {
      // FCP=2.4 (midpoint of 1.8–3.0) → 100 - 0.5*30 = 85
      assert.equal(calculatePerformanceScore({ FCP: 2.4 }), 85);
    });

    it('floors the score at 0 for extreme poor values', () => {
      assert.equal(calculatePerformanceScore({ FCP: 1000 }), 0);
    });

    it('normalizes correctly when only a subset of metrics are provided', () => {
      // Two metrics both at good boundary → both score 100 → weighted average = 100
      assert.equal(calculatePerformanceScore({ FCP: 1.0, LCP: 1.0 }), 100);
    });
  });

  describe('significancetest', () => {
    it('returns a high p-value for identical arrays (no significant difference)', () => {
      const arr = [1.2, 1.5, 1.3, 1.4, 1.6, 1.2, 1.5, 1.3, 1.4, 1.6];
      const p = significancetest(arr, arr);
      assert.ok(p > 0.05, `expected p > 0.05, got ${p}`);
    });

    it('returns a low p-value for clearly different arrays (significant difference)', () => {
      const fast = [1, 1.1, 0.9, 1.0, 1.2, 0.8, 1.0, 1.1, 0.9, 1.0];
      const slow = [10, 10.1, 9.9, 10.0, 10.2, 9.8, 10.0, 10.1, 9.9, 10.0];
      const p = significancetest(fast, slow);
      assert.ok(p < 0.05, `expected p < 0.05, got ${p}`);
    });

    it('returns a value between 0 and 1', () => {
      const arr1 = [1.5, 1.6, 1.4, 1.7, 1.3];
      const arr2 = [2.0, 2.1, 1.9, 2.2, 1.8];
      const p = significancetest(arr1, arr2);
      assert.ok(p >= 0 && p <= 1, `expected 0 <= p <= 1, got ${p}`);
    });
  });
});
