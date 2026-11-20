let chartInstance = null;

/**
 * Format a count with K/M/B suffixes
 * @param {number} value
 * @returns {string}
 */
export function formatAxisValue(value) {
  if (value < 1000) return value.toString();
  if (value < 1000000) return `${(value / 1000).toFixed(1)}K`;
  if (value < 1000000000) return `${(value / 1000000).toFixed(1)}M`;
  return `${(value / 1000000000).toFixed(1)}B`;
}

/**
 * Aggregate error counts by time period, sorted chronologically
 * @param {Array} filteredData - The filtered data with timeSlots
 * @param {string} dateRange - The date range ('week', 'month', or 'year')
 * @returns {{labels: string[], counts: number[]}}
 */
export function aggregateByPeriod(filteredData, dateRange) {
  const timePeriods = new Map();

  filteredData.forEach((item) => {
    item.timeSlots.forEach((slot) => {
      const date = slot.time;
      let timeKey;

      if (dateRange === 'week') {
        timeKey = `${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:00`;
      } else if (dateRange === 'year') {
        const startOfWeek = new Date(date);
        startOfWeek.setDate(date.getDate() - date.getDay());
        timeKey = `${startOfWeek.getMonth() + 1}/${startOfWeek.getDate()}`;
      } else {
        timeKey = `${date.getMonth() + 1}/${date.getDate()}`;
      }

      if (!timePeriods.has(timeKey)) {
        timePeriods.set(timeKey, { errorCount: 0, sortDate: date.getTime() });
      }
      timePeriods.get(timeKey).errorCount += slot.weight;
    });
  });

  const sorted = Array.from(timePeriods.entries())
    .sort((a, b) => a[1].sortDate - b[1].sortDate);

  return {
    labels: sorted.map((entry) => entry[0]),
    counts: sorted.map((entry) => entry[1].errorCount),
  };
}

/**
 * Get the label step for the x axis
 * @param {string} dateRange
 * @param {number} count - Number of categories
 * @returns {number} Show every nth label
 */
export function getLabelStep(dateRange, count) {
  if (dateRange === 'week') return 6;
  if (dateRange === 'month' && count > 15) return 2;
  return 1;
}

/**
 * Initialize the chart instance
 * @returns The chart instance
 */
export async function initChart() {
  if (chartInstance) return chartInstance;

  let wrapper = document.getElementById('error-chart');
  if (!wrapper) {
    const graphContainer = document.querySelector('.error-graph-container');
    wrapper = document.createElement('div');
    wrapper.id = 'error-chart';
    graphContainer.append(wrapper);
  }
  const canvas = document.createElement('canvas');
  wrapper.append(canvas);

  const { Chart, registerables } = await import('../../vendor/chartjs/chartjs.js');
  Chart.register(...registerables);

  chartInstance = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: [],
      datasets: [{ label: 'Errors', data: [], backgroundColor: '#5470c6' }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: { legend: { display: false } },
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: {
          ticks: { minRotation: 45, maxRotation: 45, autoSkip: false },
        },
        y: {
          beginAtZero: true,
          title: { display: true, text: 'Error Count' },
          ticks: { callback: (value) => formatAxisValue(value) },
        },
      },
    },
  });

  return chartInstance;
}

/**
 * Update the chart with error data
 * @param {Array} filteredData - The filtered data with timeSlots
 * @param {string} dateRange - The date range ('week', 'month', or 'year')
 */
export async function updateChart(filteredData, dateRange) {
  const chart = await initChart();
  if (!chart) return;

  const { labels, counts } = aggregateByPeriod(filteredData, dateRange);
  const step = getLabelStep(dateRange, labels.length);

  chart.data.labels = labels;
  chart.data.datasets[0].data = counts;
  chart.options.scales.x.ticks.callback = (value, index) => (
    index % step === 0 ? labels[index] : ''
  );
  chart.update();

  const errorGraphContainer = document.querySelector('.error-graph-container');
  if (errorGraphContainer) {
    errorGraphContainer.classList.add('visible');
  }
}
