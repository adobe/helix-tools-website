const PERF_COLOR_GOOD = '#025d3c';
const PERF_COLOR_MEDIUM = '#903300';
const PERF_COLOR_POOR = '#9c2113';

/**
 * Calculates the arithmetic mean (average) of an array of numbers.
 * @param {number[]} arr
 * @returns {number} Mean value, or 0 if array is empty or invalid
 */
export function mean(arr) {
  if (!arr || arr.length === 0) {
    return 0;
  }
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

/**
 * Calculates the sample standard deviation of an array of numbers.
 * @param {number[]} arr
 * @returns {number} Standard deviation, or 0 if array has fewer than 2 elements
 */
export function stDev(arr) {
  if (!arr || arr.length < 2) {
    return 0;
  }
  const m = mean(arr);
  return Math.sqrt(arr.reduce((sq, n) => sq + (n - m) ** 2, 0) / (arr.length - 1));
}

/**
 * Finds the most stable/representative value using clustering algorithm.
 * 1. Look for clusters of 3 identical values (most reliable)
 * 2. If no cluster, average the 3 lowest values
 * 3. Fallback to simple averaging for small datasets
 * @param {number[]} arr - Array of performance measurements
 * @returns {number} Most representative value from the dataset
 */
export function lowestCluster(arr) {
  if (!arr || arr.length === 0) {
    return 0;
  }

  const sorted = arr.slice().sort((a, b) => a - b);
  let clusterVal = 0;

  for (let i = 0; i < (sorted.length - 2); i += 1) {
    if (sorted[i] === sorted[i + 1] && sorted[i] === sorted[i + 2]) {
      clusterVal = sorted[i];
      break;
    }
  }

  if (!clusterVal && sorted.length >= 3) {
    const [first, second, third] = sorted;
    clusterVal = (first + second + third) / 3;
  } else if (!clusterVal && sorted.length === 2) {
    const [first, second] = sorted;
    clusterVal = (first + second) / 2;
  } else if (!clusterVal) {
    const [first] = sorted;
    clusterVal = first;
  }

  return clusterVal;
}

/**
 * Returns color code based on Google PageSpeed Insights performance thresholds.
 * @param {string} metric - FCP, SI, LCP, TTI, TBT, or CLS
 * @param {number} value - Metric value in seconds (or unitless for CLS)
 * @returns {string} CSS color hex string, or var(--color-font-grey) for unknown metrics
 */
export function getPerformanceColor(metric, value) {
  const thresholds = {
    FCP: { good: 1.8, needsImprovement: 3.0 },
    SI: { good: 3.4, needsImprovement: 5.8 },
    LCP: { good: 2.5, needsImprovement: 4.0 },
    TTI: { good: 3.8, needsImprovement: 7.3 },
    TBT: { good: 0.2, needsImprovement: 0.6 },
    CLS: { good: 0.1, needsImprovement: 0.25 },
  };

  const threshold = thresholds[metric];
  if (!threshold) return 'var(--color-font-grey)';

  if (value <= threshold.good) return PERF_COLOR_GOOD;
  if (value <= threshold.needsImprovement) return PERF_COLOR_MEDIUM;
  return PERF_COLOR_POOR;
}

/**
 * Calculates overall performance score using Google's Lighthouse weighting algorithm.
 * @param {Object} metrics - Performance metrics in seconds (time-based) or unitless (CLS)
 * @returns {number} Performance score 0-100 (rounded)
 */
export function calculatePerformanceScore(metrics) {
  const weights = {
    FCP: 0.15,
    SI: 0.15,
    LCP: 0.25,
    TTI: 0.15,
    TBT: 0.25,
    CLS: 0.05,
  };

  const thresholds = {
    FCP: { good: 1.8, needsImprovement: 3.0 },
    SI: { good: 3.4, needsImprovement: 5.8 },
    LCP: { good: 2.5, needsImprovement: 4.0 },
    TTI: { good: 3.8, needsImprovement: 7.3 },
    TBT: { good: 0.2, needsImprovement: 0.6 },
    CLS: { good: 0.1, needsImprovement: 0.25 },
  };

  let totalScore = 0;
  let totalWeight = 0;

  Object.keys(weights).forEach((metric) => {
    if (metrics[metric] !== undefined) {
      const value = metrics[metric];
      const threshold = thresholds[metric];
      let score;

      if (value <= threshold.good) {
        score = 100;
      } else if (value <= threshold.needsImprovement) {
        const improvementRange = threshold.needsImprovement - threshold.good;
        const penalty = ((value - threshold.good) / improvementRange) * 30;
        score = 100 - penalty;
      } else {
        const penaltyRatio = (value - threshold.needsImprovement) / threshold.needsImprovement;
        const poorPenalty = penaltyRatio * 70;
        score = Math.max(0, 100 - poorPenalty);
      }

      totalScore += score * weights[metric];
      totalWeight += weights[metric];
    }
  });

  return totalWeight > 0 ? Math.round(totalScore / totalWeight) : 0;
}

/**
 * Returns color and indicator for a performance score.
 * @param {number} score - Performance score 0-100
 * @returns {{ color: string, indicator: string }}
 */
export function getScoreColor(score) {
  if (score >= 90) return { color: PERF_COLOR_GOOD, indicator: '●' };
  if (score >= 50) return { color: PERF_COLOR_MEDIUM, indicator: '■' };
  return { color: PERF_COLOR_POOR, indicator: '▲' };
}

// Statistical functions for two-sample t-test (ported from jStat 1.9.5, MIT)

/* eslint-disable no-loss-of-precision */
function gammaln(x) {
  let j = 0;
  const cof = [
    76.18009172947146, -86.50532032941677, 24.01409824083091,
    -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5,
  ];
  let ser = 1.000000000190015;
  const xx = x;
  let y = x;
  let tmp = y + 5.5;
  tmp -= (xx + 0.5) * Math.log(tmp);
  for (; j < 6; j += 1) {
    y += 1;
    ser += cof[j] / y;
  }
  return Math.log((Math.sqrt(2 * Math.PI) * ser) / xx) - tmp;
}
/* eslint-enable no-loss-of-precision */

function betacf(x, a, b) {
  const fpmin = 1e-30;
  let m = 1;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  let m2; let aa; let del; let h;

  if (Math.abs(d) < fpmin) d = fpmin;
  d = 1 / d;
  h = d;

  for (; m <= 100; m += 1) {
    m2 = 2 * m;
    aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < fpmin) d = fpmin;
    c = 1 + aa / c;
    if (Math.abs(c) < fpmin) c = fpmin;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < fpmin) d = fpmin;
    c = 1 + aa / c;
    if (Math.abs(c) < fpmin) c = fpmin;
    d = 1 / d;
    del = d * c;
    h *= del;
    if (Math.abs(del - 1.0) < 3e-7) break;
  }

  return h;
}

function regularizedIncompleteBeta(x, a, b) {
  const bt = (x === 0 || x === 1) ? 0
    : Math.exp(
      gammaln(a + b) - gammaln(a) - gammaln(b) + a * Math.log(x) + b * Math.log(1 - x),
    );
  if (x < 0 || x > 1) return NaN;
  if (x < (a + 1) / (a + b + 2)) return (bt * betacf(x, a, b)) / a;
  return 1 - (bt * betacf(1 - x, b, a)) / b;
}

function studentTCdf(t, dof) {
  const dof2 = dof / 2;
  return regularizedIncompleteBeta(
    (t + Math.sqrt(t * t + dof)) / (2 * Math.sqrt(t * t + dof)),
    dof2,
    dof2,
  );
}

/**
 * Two-sample t-test returning a p-value. Small p (< 0.05) indicates a statistically
 * significant difference between the two sample means.
 * @param {number[]} arr1
 * @param {number[]} arr2
 * @returns {number} p-value
 */
export function significancetest(arr1, arr2) {
  const n1 = arr1.length;
  const n2 = arr2.length;
  const mean1 = mean(arr1);
  const mean2 = mean(arr2);
  const stDev1 = stDev(arr1);
  const stDev2 = stDev(arr2);

  const pooledStDev = Math.sqrt(
    ((n1 - 1) * stDev1 * stDev1 + (n2 - 1) * stDev2 * stDev2) / (n1 + n2 - 2),
  );

  const tStat = (mean1 - mean2) / (pooledStDev * Math.sqrt(1 / n1 + 1 / n2));
  const df = n1 + n2 - 2;

  return 1 - studentTCdf(Math.abs(tStat), df);
}
