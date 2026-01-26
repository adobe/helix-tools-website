// eslint-disable-next-line import/extensions, import/no-unresolved
import pLimit from 'https://cdn.skypack.dev/p-limit@4.0.0';

// Parse parallelism parameter from URL to control concurrent PSI requests
const parallelism = new URL(window.location.href).searchParams.get('parallelism');
const limit = pLimit(parallelism ? parseInt(parallelism, 10) : 10);

// Statistical and utility helper functions for PSI data analysis

/**
 * Extracts values for a specific key from an array of objects.
 * @param {Object[]} arr - Array of objects containing performance metrics
 * @param {string} key - Key name to extract from each object (e.g., 'FCP', 'LCP')
 * @returns {any[]} Array of values for the specified key
 */
function keyToArray(arr, key) {
  return arr.map((item) => item[key]);
}

/**
 * Calculates the arithmetic mean (average) of an array of numbers.
 * @param {number[]} arr - Array of numbers to average
 * @returns {number} Mean value, or 0 if array is empty or invalid
 */
function mean(arr) {
  if (!arr || arr.length === 0) {
    return 0;
  }
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

/**
 * Calculates the sample standard deviation of an array of numbers.
 * @param {number[]} arr - Array of numbers to analyze
 * @returns {number} Standard deviation, or 0 if array has fewer than 2 elements
 */
function stDev(arr) {
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
function lowestCluster(arr) {
  if (!arr || arr.length === 0) {
    return 0;
  }

  // Sort values to make cluster detection easier
  const sorted = arr.sort((a, b) => a - b);
  let clusterVal = 0;
  // eslint-disable-next-line no-console
  console.log(sorted);

  // Check for clusters of 3 identical values (highest confidence indicator)
  for (let i = 0; i < (sorted.length - 2); i += 1) {
    if (sorted[i] === sorted[i + 1] && sorted[i] === sorted[i + 2]) {
      // eslint-disable-next-line no-console
      console.log(clusterVal);
      clusterVal = sorted[i];
      break; // Use first cluster found (will be lowest due to sorting)
    }
  }

  // Fallback strategies if no perfect cluster found
  if (!clusterVal && sorted.length >= 3) {
    // Average of first 3 values (lowest performing, most stable)
    const [first, second, third] = sorted;
    clusterVal = (first + second + third) / 3;
  } else if (!clusterVal && sorted.length === 2) {
    // Average of both values
    const [first, second] = sorted;
    clusterVal = (first + second) / 2;
  } else if (!clusterVal) {
    // Single value fallback
    const [first] = sorted;
    clusterVal = first;
  }

  return clusterVal;
}

// Performance evaluation functions using Google's official PSI thresholds and algorithms

/**
 * Returns color code based on Google PageSpeed Insights performance thresholds.
 * @param {string} metric - Performance metric name (FCP, SI, LCP, TTI, TBT, CLS)
 * @param {number} value - Metric value in seconds (or unitless for CLS)
 * @returns {string} CSS color value following Google's PSI color scheme
 */
function getPerformanceColor(metric, value) {
  const thresholds = {
    FCP: { good: 1.8, needsImprovement: 3.0 }, // First Contentful Paint (s) ✅
    SI: { good: 3.4, needsImprovement: 5.8 }, // Speed Index (s) ✅
    LCP: { good: 2.5, needsImprovement: 4.0 }, // Largest Contentful Paint (s) ✅
    TTI: { good: 3.8, needsImprovement: 7.3 }, // Time to Interactive (s) ✅
    TBT: { good: 0.2, needsImprovement: 0.6 }, // Total Blocking Time (s) ✅
    CLS: { good: 0.1, needsImprovement: 0.25 }, // Cumulative Layout Shift (unitless) ✅
  };

  const threshold = thresholds[metric];
  if (!threshold) return 'black';

  // Apply Google's official color scheme
  if (value <= threshold.good) return '#0cce6b'; // Green - Good
  if (value <= threshold.needsImprovement) return '#ffa400'; // Orange - Needs Improvement
  return '#f4442f'; // Red - Poor
}

/**
 * Calculates overall performance score using Google's official Lighthouse algorithm.
 * @param {Object} metrics - Object containing performance metrics in seconds
 * @returns {number} Performance score from 0-100 (rounded to nearest integer)
 */
function calculatePerformanceScore(metrics) {
  // eslint-disable-next-line no-console
  console.log('Calculating score for metrics:', metrics);

  // Official Google PSI metric weights (must sum to 1.0)
  const weights = {
    FCP: 0.15,
    SI: 0.15,
    LCP: 0.25,
    TTI: 0.15,
    TBT: 0.25,
    CLS: 0.05,
  };

  let totalScore = 0;
  let totalWeight = 0;

  // Calculate weighted score for each available metric
  Object.keys(weights).forEach((metric) => {
    if (metrics[metric] !== undefined) {
      const value = metrics[metric];

      // Use same thresholds as color function (official Google PSI values)
      const thresholds = {
        FCP: { good: 1.8, needsImprovement: 3.0 },
        SI: { good: 3.4, needsImprovement: 5.8 },
        LCP: { good: 2.5, needsImprovement: 4.0 },
        TTI: { good: 3.8, needsImprovement: 7.3 },
        TBT: { good: 0.2, needsImprovement: 0.6 },
        CLS: { good: 0.1, needsImprovement: 0.25 },
      };

      const threshold = thresholds[metric];
      let score;

      // Calculate individual metric score using Google's scoring curve
      if (value <= threshold.good) {
        // Values in "good" range get perfect score (100)
        score = 100;
      } else if (value <= threshold.needsImprovement) {
        // Linear penalty in "needs improvement" range (100 down to 70)
        const improvementRange = threshold.needsImprovement - threshold.good;
        const penalty = ((value - threshold.good) / improvementRange) * 30;
        score = 100 - penalty;
      } else {
        // Exponential penalty in "poor" range (70 down to 0)
        const penaltyRatio = (value - threshold.needsImprovement) / threshold.needsImprovement;
        const poorPenalty = penaltyRatio * 70;
        score = Math.max(0, 100 - poorPenalty); // Floor at 0
      }

      const logMessage = `${metric}: value=${value}, score=${score}, weight=${weights[metric]}`;
      // eslint-disable-next-line no-console
      console.log(logMessage);

      // Add to weighted total
      totalScore += score * weights[metric];
      totalWeight += weights[metric];
    }
  });

  // Return weighted average, rounded to nearest integer
  const finalScore = totalWeight > 0 ? Math.round(totalScore / totalWeight) : 0;
  // eslint-disable-next-line no-console
  console.log('Final score:', finalScore);
  return finalScore;
}

/**
 * Returns appropriate color and visual indicator for performance score display.
 * @param {number} score - Performance score (0-100)
 * @returns {Object} Object containing color and indicator
 */
function getScoreColor(score) {
  // Google PSI score ranges with appropriate visual indicators
  if (score >= 90) return { color: '#0cce6b', indicator: '●' }; // Green circle - Good (90-100)
  if (score >= 50) return { color: '#ffa400', indicator: '■' }; // Orange square - Needs Improvement (50-89)
  return { color: '#f4442f', indicator: '▲' }; // Red triangle - Poor (0-49)
}

// Statistical testing functions for comparing performance between URLs

/**
 * Dynamically loads the jStat library for statistical calculations needed for significance testing.
 * @returns {Promise<void>} Promise that resolves when jStat is available
 * @throws {Error} If jStat library fails to load from CDN
 */
async function loadJStat() {
  return new Promise((resolve, reject) => {
    // Check if jStat is already loaded globally
    if (typeof jStat !== 'undefined') {
      resolve();
      return;
    }

    // Create script element to load jStat from CDN
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/jstat@latest/dist/jstat.min.js';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load jStat'));
    document.head.appendChild(script);
  });
}

/**
 * Performs two-sample t-test to determine if performance differences are statistically significant.
 * @param {number[]} arr1 - Performance measurements from first URL
 * @param {number[]} arr2 - Performance measurements from second URL
 * @returns {Promise<number>} P-value indicating statistical significance (0-1)
 */
async function significancetest(arr1, arr2) {
  // Ensure jStat library is loaded before performing calculations
  if (typeof jStat === 'undefined') {
    await loadJStat();
  }

  // Calculate basic statistics for both samples
  const n1 = arr1.length;
  const n2 = arr2.length;
  const mean1 = mean(arr1);
  const mean2 = mean(arr2);
  const stDev1 = stDev(arr1);
  const stDev2 = stDev(arr2);

  // Calculate pooled standard deviation (assumes equal variances)
  const pooledstDev = Math.sqrt(
    ((n1 - 1) * stDev1 * stDev1 + (n2 - 1) * stDev2 * stDev2) / (n1 + n2 - 2),
  );

  // Calculate t-statistic for the difference in means
  const t = (mean1 - mean2) / (pooledstDev * Math.sqrt(1 / n1 + 1 / n2));
  const df = n1 + n2 - 2; // degrees of freedom

  // Calculate p-value using jStat's Student's t-distribution CDF
  // eslint-disable-next-line no-undef
  const p = 1 - jStat.studentt.cdf(Math.abs(t), df);
  return p;
}

// PSI API interaction functions

/**
 * Fetches a single PSI result from proxy API.
 * @param {string} url - URL to analyze with PageSpeed Insights
 * @returns {Promise<Object>} Raw PSI result object from Google's API
 */
async function getResult(url) {
  // eslint-disable-next-line no-console
  console.log(`fetching: ${url}`);
  const resp = await limit(() => fetch(`https://thinktanked.org/deep-psi?url=${encodeURI(url)}`));
  const json = await resp.json();
  return json;
}

/**
 * Fetches multiple PSI results for robust statistical analysis.
 * @param {string} url - Base URL to test
 * @param {number} samples - Number of independent PSI tests to run
 * @returns {Promise<Object[]>} Array of PSI result objects
 */
async function getResults(url, samples) {
  const reqs = [];
  for (let i = 0; i < samples; i += 1) {
    // Add random cache-buster to ensure independent measurements
    reqs.push(getResult(`${url}${url.includes('?') ? '&' : '?'}ck=${Math.random()}`));
  }
  // Execute all requests in parallel (subject to rate limiting)
  return Promise.all(reqs);
}

// UI generation and table management functions

/**
 * Creates a comprehensive results table showing individual PSI results and statistical analysis.
 * @param {Object[]} results - Array of processed PSI results
 * @param {Object} averages - Object to populate with calculated representative values
 * @returns {HTMLElement} Complete table container element
 */
function createTable(results, averages) {
  const tableContainer = document.createElement('div');
  tableContainer.className = 'table-container';

  const table = document.createElement('table');
  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  const keys = Object.keys(results[0]); // Get metric names from first result

  // Add headers for metrics
  keys.forEach((key) => {
    const th = document.createElement('th');
    th.textContent = key;
    headerRow.append(th);
  });

  // Add score header
  const scoreTh = document.createElement('th');
  scoreTh.textContent = 'Score';
  scoreTh.style.textAlign = 'center';
  headerRow.append(scoreTh);

  thead.append(headerRow);
  table.append(thead);

  const tbody = document.createElement('tbody');
  const totals = {};
  results.forEach((result) => {
    const dataRow = document.createElement('tr');
    keys.forEach((key) => {
      const td = document.createElement('td');
      let value = result[key];
      totals[key] = totals[key] ? totals[key] + value : value;

      // Format values appropriately for display
      if (key === 'CLS') {
        // CLS is unitless, show 3 decimal places for precision
        value = Math.round(value * 1000) / 1000;
      } else if (['FCP', 'SI', 'LCP', 'TTI', 'TBT'].includes(key)) {
        // Convert milliseconds to seconds for time-based metrics (PSI returns ms)
        value = Math.round((value / 1000) * 100) / 100; // Round to 2 decimal places
      } else {
        // Other metrics rounded to nearest integer
        value = Math.round(value);
      }

      td.textContent = value;
      td.style.color = getPerformanceColor(key, value);
      td.style.fontWeight = 'bold';
      dataRow.append(td);
    });

    // Add score column
    const scoreTd = document.createElement('td');

    // Convert result values to seconds for score calculation
    const scoreMetrics = {};
    Object.keys(result).forEach((key) => {
      if (['FCP', 'SI', 'LCP', 'TTI', 'TBT'].includes(key)) {
        scoreMetrics[key] = Math.round((result[key] / 1000) * 100) / 100;
      } else {
        scoreMetrics[key] = result[key];
      }
    });

    const score = calculatePerformanceScore(scoreMetrics);
    const scoreInfo = getScoreColor(score);
    scoreTd.innerHTML = `<div class="score-container">
        <div class="score-circle" style="background-color: ${scoreInfo.color}; color: white;">${score}</div>
      </div>`;
    scoreTd.style.textAlign = 'center';
    dataRow.append(scoreTd);

    tbody.append(dataRow);
  });

  // Create summary row with statistical analysis
  const avg = document.createElement('tr');

  keys.forEach((key) => {
    const td = document.createElement('td');
    let psiVal = lowestCluster(keyToArray(results, key));
    let value = mean(keyToArray(results, key));
    const deviation = stDev(keyToArray(results, key));
    if (key === 'CLS') {
      value = Math.round(value * 1000) / 1000;
      psiVal = Math.round(psiVal * 1000) / 1000;
    } else if (['FCP', 'SI', 'LCP', 'TTI', 'TBT'].includes(key)) {
      // Convert milliseconds to seconds for time-based metrics
      value = Math.round((value / 1000) * 100) / 100;
      psiVal = Math.round((psiVal / 1000) * 100) / 100;
    } else {
      value = Math.round(value);
      psiVal = Math.round(psiVal);
    }

    // Store representative value for external use (Lighthouse calculator links)
    averages[key] = psiVal;
    const color = getPerformanceColor(key, psiVal);

    // Format standard deviation to be more readable
    let formattedDeviation;
    if (key === 'CLS') {
      formattedDeviation = Intl.NumberFormat({ maximumSignificantDigits: 3 }).format(deviation);
    } else {
      // For time-based metrics, format deviation in seconds with appropriate precision
      const deviationInSeconds = deviation / 1000;
      const formatOptions = { maximumSignificantDigits: 2 };
      formattedDeviation = Intl.NumberFormat(formatOptions).format(deviationInSeconds);
    }

    // Display both representative value (bold, colored) and statistical summary (smaller)
    const valueSpan = `<span style="color: ${color}; font-weight: bold;">${psiVal}</span>`;
    const deviationSpan = `<small style="color: var(--color-font-grey); font-size: 0.9em;">(${value} ± ${formattedDeviation})</small>`;
    td.innerHTML = `${valueSpan}<br>${deviationSpan}`;
    avg.append(td);
  });

  // Add average score column
  const avgScoreTd = document.createElement('td');
  const avgMetrics = {};
  keys.forEach((key) => {
    const rawValue = lowestCluster(keyToArray(results, key));
    // Convert to seconds for time-based metrics
    if (['FCP', 'SI', 'LCP', 'TTI', 'TBT'].includes(key)) {
      avgMetrics[key] = Math.round((rawValue / 1000) * 100) / 100;
    } else {
      avgMetrics[key] = rawValue;
    }
  });
  // eslint-disable-next-line no-console
  console.log('Average metrics for score calculation:', avgMetrics);
  const avgScore = calculatePerformanceScore(avgMetrics);
  const avgScoreInfo = getScoreColor(avgScore);
  const scoreCircleHtml = `<div class="score-container">
      <div class="score-circle" style="background-color: ${avgScoreInfo.color}; color: white;">${avgScore}</div>
    </div>`;
  avgScoreTd.innerHTML = scoreCircleHtml;
  avgScoreTd.style.textAlign = 'center';
  avg.append(avgScoreTd);

  avg.className = 'average';

  tbody.append(avg);
  table.append(tbody);
  tableContainer.append(table);
  return tableContainer;
}

// Loading animation functions

/**
 * Shows loading state across all form controls to prevent user interaction during PSI analysis.
 */
function showLoadingAnimation() {
  const submitButton = document.getElementById('button');
  const resetButton = document.querySelector('button[type="reset"]');
  const clearCheckbox = document.getElementById('clear');

  if (submitButton) {
    submitButton.disabled = true;
    submitButton.innerHTML = '<span class="loading-spinner"></span> Loading...';
  }

  if (resetButton) {
    resetButton.disabled = true;
  }

  if (clearCheckbox) {
    clearCheckbox.disabled = true;
  }
}

/**
 * Hides loading state and re-enables all form controls after PSI analysis completion.
 * Restores original button text and enables user interaction.
 */
function hideLoadingAnimation() {
  const submitButton = document.getElementById('button');
  const resetButton = document.querySelector('button[type="reset"]');
  const clearCheckbox = document.getElementById('clear');

  if (submitButton) {
    submitButton.disabled = false;
    submitButton.innerHTML = 'Submit';
  }

  if (resetButton) {
    resetButton.disabled = false;
  }

  if (clearCheckbox) {
    clearCheckbox.disabled = false;
  }
}

// Main PSI execution functions

/**
 * Executes PSI analysis for a single URL and displays comprehensive results.
 * @param {number} num - URL number (1 or 2) for identifying form fields and output containers
 * @returns {Promise<Object[]|null>} Array of processed PSI results, or null if analysis failed
 */
async function executePSI(num) {
  // Validate required DOM elements exist
  const urlElement = document.getElementById(`url${num}`);
  if (!urlElement) {
    // eslint-disable-next-line no-console
    console.error(`URL element url${num} not found`);
    return null;
  }
  const url = urlElement.value;
  if (!url) return null; // No URL provided

  const output = document.getElementById(`output${num}`);
  if (!output) {
    // eslint-disable-next-line no-console
    console.error(`Output element output${num} not found`);
    return null;
  }

  // Clear previous content (loading message is handled centrally)
  output.innerHTML = '';

  // Add URL header above the table
  const urlHeader = document.createElement('h3');
  urlHeader.className = 'table-url-header loading';
  urlHeader.innerHTML = `<span class="loading-spinner"></span> Loading URL ${num}...`;
  output.appendChild(urlHeader);

  // Determine number of API calls based on environment
  const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  const apiCalls = isLocalhost ? 2 : 20; // Production uses 20 for statistical reliability

  // Fetch multiple PSI results for statistical analysis
  const rawResults = await getResults(url, apiCalls);

  // Map Google PSI audit names to our display names
  const categs = [
    'first-contentful-paint',
    'speed-index',
    'largest-contentful-paint',
    'interactive',
    'total-blocking-time',
    'cumulative-layout-shift',
  ];
  const names = ['FCP', 'SI', 'LCP', 'TTI', 'TBT', 'CLS'];
  const results = rawResults.map((result) => {
    const cleaned = {};
    // Check if the result has the expected structure
    if (!result || !result.lighthouseResult || !result.lighthouseResult.audits) {
      // eslint-disable-next-line no-console
      console.error('Invalid PSI result structure:', result);
      return null; // Filter out invalid results
    }

    // Extract numeric values for each performance metric
    categs.forEach((categ, i) => {
      try {
        const audit = result.lighthouseResult.audits[categ];
        if (audit && typeof audit.numericValue === 'number') {
          cleaned[names[i]] = audit.numericValue;
        } else {
          // eslint-disable-next-line no-console
          console.warn(`Missing or invalid audit for ${categ}:`, audit);
          cleaned[names[i]] = 0; // Default value for missing data
        }
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error(`Error processing audit ${categ}:`, error);
        cleaned[names[i]] = 0; // Default value for errors
      }
    });
    return cleaned;
  }).filter((result) => result !== null); // Remove failed results

  // Check if we have any valid results
  if (results.length === 0) {
    output.innerHTML = '<div class="error-message">No valid PSI results obtained. Please check the URL and try again.</div>';
    return null;
  }

  const avgs = {};
  output.append(createTable(results, avgs));

  // Update URL header to show final URL and remove loading state
  const existingUrlHeader = output.querySelector('.table-url-header');
  if (existingUrlHeader) {
    existingUrlHeader.className = 'table-url-header';
    existingUrlHeader.textContent = `URL ${num}: ${url}`;
  }

  // Create links to Google's official Lighthouse score calculator for verification
  const p = document.createElement('p');

  // Link using representative values (clustering algorithm results)
  // Use URL constructor to safely build the URL and prevent XSS
  const scoreUrl = new URL('https://googlechrome.github.io/lighthouse/scorecalc/');
  scoreUrl.hash = `FCP=${encodeURIComponent(avgs.FCP)}&TTI=${encodeURIComponent(avgs.TTI)}&SI=${encodeURIComponent(avgs.SI)}&TBT=${encodeURIComponent(avgs.TBT)}&LCP=${encodeURIComponent(avgs.LCP)}&CLS=${encodeURIComponent(avgs.CLS)}&device=mobile&version=10`;

  const scoreLink = document.createElement('a');
  scoreLink.href = scoreUrl.href;
  scoreLink.target = '_blank';
  scoreLink.rel = 'noopener noreferrer';
  scoreLink.textContent = 'Overall Best Stable Score';
  p.appendChild(scoreLink);

  const avgScore = (r, k) => mean(keyToArray(r, k));

  // Link using simple arithmetic averages for comparison
  const avgScoreUrl = new URL('https://googlechrome.github.io/lighthouse/scorecalc/');
  avgScoreUrl.hash = `FCP=${encodeURIComponent(avgScore(results, 'FCP'))}&TTI=${encodeURIComponent(avgScore(results, 'TTI'))}&SI=${encodeURIComponent(avgScore(results, 'SI'))}&TBT=${encodeURIComponent(avgScore(results, 'TBT'))}&LCP=${encodeURIComponent(avgScore(results, 'LCP'))}&CLS=${encodeURIComponent(avgScore(results, 'CLS'))}&device=mobile&version=10`;

  p.appendChild(document.createElement('br'));

  const avgScoreLink = document.createElement('a');
  avgScoreLink.href = avgScoreUrl.href;
  avgScoreLink.target = '_blank';
  avgScoreLink.rel = 'noopener noreferrer';
  avgScoreLink.textContent = 'Overall Average Score';
  p.appendChild(avgScoreLink);

  output.append(p);

  // Remove loading message
  const loadingMessage = output.querySelector('.status-message');
  if (loadingMessage) {
    loadingMessage.remove();
  }

  return results;
}

/**
 * Main orchestration function that coordinates the entire PSI comparison workflow.
 */
async function comparePSI() {
  // Show loading animation
  showLoadingAnimation();

  // Get URL values
  const url1 = document.getElementById('url1')?.value;
  const url2 = document.getElementById('url2')?.value;

  // Validate at least one URL is provided
  if (!url1) {
    hideLoadingAnimation();
    return;
  }

  // Show single loading message
  const output1 = document.getElementById('output1');
  const output2 = document.getElementById('output2');

  if (output1) {
    output1.innerHTML = '';

    // Create centralized loading message
    const loadingDiv = document.createElement('div');
    loadingDiv.className = 'status-message';
    loadingDiv.textContent = url2 ? 'Fetching reports for both URLs...' : 'Fetching report for URL...';
    loadingDiv.style.textAlign = 'center';
    loadingDiv.style.gridColumn = '1 / -1';

    output1.appendChild(loadingDiv);
  }

  // Clear second output area
  if (output2) {
    output2.innerHTML = '';
  }

  // Execute PSI for first URL
  const res1 = await executePSI(1);
  if (!res1) {
    hideLoadingAnimation();
    return; // Failed to get results for primary URL
  }

  // Execute PSI for second URL only if provided
  let res2 = null;
  if (url2) {
    res2 = await executePSI(2);
    if (!res2) {
      hideLoadingAnimation();
      return; // Failed to get results for secondary URL
    }
  }

  // Only show significance test if both URLs have results
  if (res1 && res2) {
    // eslint-disable-next-line no-console
    console.log(keyToArray(res1, 'LCP'), keyToArray(res2, 'LCP'));

    // Show significance test section
    const significanceContainer = document.getElementById('psi-significance-container');
    if (significanceContainer) {
      significanceContainer.style.display = 'block';
    }

    const significancetestresults = document.getElementById('significancetestresults');
    if (significancetestresults) {
      significancetestresults.innerHTML = ''; // Clear previous results

      // Process significance tests asynchronously
      const significancePromises = Object.keys(res1[0]).map(async (key) => {
        try {
          // Perform two-sample t-test for this metric
          const p = await significancetest(keyToArray(res1, key), keyToArray(res2, key));
          const li = document.createElement('li');
          // Format p-value with appropriate precision
          li.innerHTML = `<code>${key}</code>: ${Intl.NumberFormat({ maximumSignificantDigits: 3 }).format(p)}`;
          return li;
        } catch (error) {
          // eslint-disable-next-line no-console
          console.error(`Error calculating significance for ${key}:`, error);
          const li = document.createElement('li');
          li.innerHTML = `<code>${key}</code>: Error calculating significance`;
          return li;
        }
      });

      // Wait for all significance tests to complete
      const significanceResults = await Promise.all(significancePromises);
      significanceResults.forEach((li) => significancetestresults.append(li));
    }
  }

  // Hide loading animation
  hideLoadingAnimation();
}

/**
 * Initializes the PSI comparison form with comprehensive event handling.
 */
function initializeForm() {
  const form = document.getElementById('psi-form');
  if (!form) {
    // eslint-disable-next-line no-console
    console.error('Form element psi-form not found');
    return;
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();

    // Update browser URL with current form values
    const url = new URL(window.location);
    url.searchParams.set('url1', document.getElementById('url1').value);
    url.searchParams.set('url2', document.getElementById('url2').value);
    window.history.pushState({}, '', url);

    // Handle clear results checkbox
    const clearCheckbox = document.getElementById('clear');
    const output1 = document.getElementById('output1');
    const output2 = document.getElementById('output2');
    const significanceResults = document.getElementById('significancetestresults');
    const significanceContainer = document.getElementById('psi-significance-container');

    if (clearCheckbox && clearCheckbox.checked) {
      // Clear all previous results if checkbox is checked
      if (output1) output1.innerHTML = '';
      if (output2) output2.innerHTML = '';
      if (significanceResults) significanceResults.innerHTML = '';
      if (significanceContainer) significanceContainer.style.display = 'none';
    }

    comparePSI();
  });

  const params = new URLSearchParams(window.location.search);
  const url1 = params.get('url1');
  const url2 = params.get('url2');

  const url1Element = document.getElementById('url1');
  const url2Element = document.getElementById('url2');

  // Restore URLs from parameters if available
  if (url1 && url1Element) url1Element.value = url1;
  if (url2 && url2Element) url2Element.value = url2;

  // Add event listener for clear checkbox
  const clearCheckbox = document.getElementById('clear');
  if (clearCheckbox) {
    clearCheckbox.addEventListener('change', () => {
      if (clearCheckbox.checked) {
        const output1 = document.getElementById('output1');
        const output2 = document.getElementById('output2');
        const significanceResults = document.getElementById('significancetestresults');
        const significanceContainer = document.getElementById('psi-significance-container');

        if (output1) output1.innerHTML = '';
        if (output2) output2.innerHTML = '';
        if (significanceResults) significanceResults.innerHTML = '';
        if (significanceContainer) significanceContainer.style.display = 'none';
      }
    });
  }
}

function init() {
  initializeForm();
  return Promise.resolve();
}

const initPromise = init();

// eslint-disable-next-line import/prefer-default-export
export function ready() {
  return initPromise;
}
