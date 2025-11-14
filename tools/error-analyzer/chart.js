let chartInstance = null;

/**
 * Initialize the chart instance
 * @returns The chart instance
 */
export async function initChart() {
  let chartDom = document.getElementById('error-chart');
  if (!chartDom) {
    const graphContainer = document.querySelector('.error-graph-container');
    chartDom = document.createElement('div');
    chartDom.id = 'error-chart';
    graphContainer.append(chartDom);
  }

  if (!chartInstance) {
    /* eslint-disable-next-line import/no-unresolved */
    const echarts = await import('echarts');
    chartInstance = echarts.init(chartDom);

    // Handle window resize for chart
    window.addEventListener('resize', () => {
      if (chartInstance) {
        chartInstance.resize();
      }
    });
  }

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

  // Aggregate error counts by time period from filtered data
  const timePeriods = new Map();

  filteredData.forEach((item) => {
    // Process all time slots for this error
    item.timeSlots.forEach((slot) => {
      const date = slot.time;
      let timeKey;

      // Format time key based on date range
      if (dateRange === 'week') {
        // By hour for last week
        timeKey = `${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:00`;
      } else if (dateRange === 'year') {
        // By week for last year - use start of week as label
        const dayOfWeek = date.getDay();
        const startOfWeek = new Date(date);
        startOfWeek.setDate(date.getDate() - dayOfWeek);
        timeKey = `${startOfWeek.getMonth() + 1}/${startOfWeek.getDate()}`;
      } else {
        // By day for last month
        timeKey = `${date.getMonth() + 1}/${date.getDate()}`;
      }

      if (!timePeriods.has(timeKey)) {
        timePeriods.set(timeKey, {
          errorCount: 0,
          sortDate: date.getTime(), // Store timestamp for sorting
        });
      }

      const period = timePeriods.get(timeKey);
      period.errorCount += slot.weight;
    });
  });

  // Convert to arrays for chart and sort by actual date, not string
  const sortedEntries = Array.from(timePeriods.entries())
    .sort((a, b) => a[1].sortDate - b[1].sortDate);

  const categories = sortedEntries.map((entry) => entry[0]);
  const errorCounts = sortedEntries.map((entry) => entry[1].errorCount);

  // Calculate label interval based on date range
  let labelInterval = 'auto';
  if (dateRange === 'week') {
    // For week view (hourly data), show labels every 6 hours
    labelInterval = 5; // Show every 6th label (0-indexed)
  } else if (dateRange === 'month' && categories.length > 15) {
    // For month view, show every other day if more than 15 days
    labelInterval = 1;
  }

  const option = {
    grid: {
      left: '60',
      right: '20',
      bottom: '80',
      top: '40',
      containLabel: false,
    },
    tooltip: {
      trigger: 'axis',
      axisPointer: {
        type: 'shadow',
      },
    },
    xAxis: {
      type: 'category',
      data: categories,
      axisLabel: {
        rotate: 45,
        interval: labelInterval,
      },
    },
    yAxis: {
      type: 'value',
      name: 'Error Count',
      axisLabel: {
        formatter(value) {
          if (value < 1000) {
            return value.toString();
          }
          if (value < 1000000) {
            return `${(value / 1000).toFixed(1)}K`;
          }
          if (value < 1000000000) {
            return `${(value / 1000000).toFixed(1)}M`;
          }
          return `${(value / 1000000000).toFixed(1)}B`;
        },
      },
    },
    series: [
      {
        name: 'Errors',
        type: 'bar',
        data: errorCounts,
        itemStyle: {
          color: '#5470c6',
        },
      },
    ],
  };

  chart.setOption(option);

  // Show the chart container
  const errorGraphContainer = document.querySelector('.error-graph-container');
  if (errorGraphContainer) {
    errorGraphContainer.classList.add('visible');
  }
}
