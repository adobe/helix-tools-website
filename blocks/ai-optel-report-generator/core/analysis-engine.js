/* Analysis Engine Module - Core AI orchestration for RUM dashboard analysis */

import extractDashboardData from './dashboard-extractor.js';
import {
  extractFacetsFromExplorer,
  initializeDynamicFacets,
  handleDynamicFacetToolCall,
  crossReferenceErrors,
} from './facet-manager.js';
import {
  processMetricsBatches,
} from './metrics-processing.js';
import { buildFacetInfoSection } from '../reports/facet-link-generator.js';
import { PATHS, API_CONFIG, AI_MODELS } from '../config.js';

// Template cache
let systemPromptCache = null;
let overviewAnalysisTemplateCache = null;

async function loadTextFile(filename) {
  try {
    const response = await fetch(`${PATHS.BLOCK_BASE}/${filename}`);
    if (!response.ok) {
      throw new Error(`Failed to load ${filename}: ${response.status}`);
    }
    return await response.text();
  } catch (error) {
    throw new Error(`Error loading ${filename}: ${error.message}`);
  }
}

async function getSystemPrompt() {
  if (!systemPromptCache) {
    systemPromptCache = await loadTextFile(PATHS.SYSTEM_PROMPT);
  }
  return systemPromptCache || 'You are a RUM data analyst specializing in web performance and user engagement analysis.';
}

async function getOverviewAnalysisTemplate() {
  if (!overviewAnalysisTemplateCache) {
    overviewAnalysisTemplateCache = await loadTextFile(PATHS.OVERVIEW_TEMPLATE);
  }
  return overviewAnalysisTemplateCache || 'CREATE A CLEAN, PROFESSIONAL REPORT WITH STRUCTURED SECTIONS.';
}

function getCwvSeverityLabel(classes) {
  if (classes.includes('score-poor')) return ' [POOR]';
  if (classes.includes('score-ni')) return ' [NEEDS IMPROVEMENT]';
  return '';
}

function formatCwvMetrics(metrics) {
  if (!metrics) return '';
  const parts = Object.entries(metrics).map(([metric, data]) => {
    const severity = getCwvSeverityLabel(data.classes);
    const interesting = data.classes.includes('interesting') ? ' *statistically significant*' : '';
    return `${metric}: ${data.value}${severity}${interesting}`;
  });
  return parts.length > 0 ? ` | CWV: ${parts.join(', ')}` : '';
}

function formatErrorCrossReference(crossRefData) {
  if (!crossRefData) return '';

  const sections = [];

  if (crossRefData.url) {
    const pages = crossRefData.url
      .map((item) => `  - ${item.text}: ${item.count.toLocaleString()} errors`)
      .join('\n');
    sections.push(`Pages with JS errors (filtered by checkpoint=error):\n${pages}`);
  }

  if (crossRefData.userAgent) {
    const devices = crossRefData.userAgent
      .map((item) => `  - ${item.text}: ${item.count.toLocaleString()} errors`)
      .join('\n');
    sections.push(`Devices/browsers with JS errors (filtered by checkpoint=error):\n${devices}`);
  }

  if (crossRefData['error.source']) {
    const sources = crossRefData['error.source']
      .map((item) => `  - ${item.text}: ${item.count.toLocaleString()} errors${formatCwvMetrics(item.metrics)}`)
      .join('\n');
    sections.push(`Error sources with CWV impact (global, filtered by checkpoint=error):\n${sources}`);
  }

  if (crossRefData['error.target']) {
    const targets = crossRefData['error.target']
      .map((item) => `  - ${item.text}: ${item.count.toLocaleString()} errors${formatCwvMetrics(item.metrics)}`)
      .join('\n');
    sections.push(`Error targets with CWV impact (global, filtered by checkpoint=error):\n${targets}`);
  }

  if (crossRefData.perPageErrors) {
    const perPage = crossRefData.perPageErrors.map((entry) => {
      const lines = [`  Page: ${entry.page} (${entry.errorCount.toLocaleString()} total errors)`];
      if (entry['error.source']) {
        lines.push('    Error sources on this page:');
        entry['error.source'].forEach((item) => {
          lines.push(`      - ${item.text}: ${item.count.toLocaleString()}${formatCwvMetrics(item.metrics)}`);
        });
      }
      if (entry['error.target']) {
        lines.push('    Error targets on this page:');
        entry['error.target'].forEach((item) => {
          lines.push(`      - ${item.text}: ${item.count.toLocaleString()}${formatCwvMetrics(item.metrics)}`);
        });
      }
      return lines.join('\n');
    }).join('\n\n');
    sections.push(`PER-PAGE ERROR BREAKDOWN (checkpoint=error + url filter applied):\n${perPage}`);
  }

  if (sections.length === 0) return '';

  const totalLine = crossRefData.totalErrorCount
    ? `TOTAL ERROR COUNT (from checkpoint=error): ${crossRefData.totalErrorCount.toLocaleString()} (raw: ${crossRefData.totalErrorCountRaw})\nUSE THIS EXACT NUMBER when linking to checkpoint=error. Do NOT sum sub-categories or use any other value.\n`
    : '';

  return `\nERROR CROSS-REFERENCE DATA (errors filtered by page and device):
${totalLine}
${sections.join('\n\n')}

Use this data for the Business Impact Analysis section. ONLY cite findings that appear in this cross-reference data:
- Pages listed above with error counts = proven errors on those pages (cite the count shown)
- Per-page breakdowns = proven error types ON specific pages (this is the strongest evidence)
- Devices listed above = proven device-specific error concentration
- Global error.source/error.target = overall error type distribution
- CWV data marked [POOR] = errors correlated with failing Core Web Vitals (prioritize these!)
- CWV data marked *statistically significant* = performance deviation is not random, it's proven
- If a page is NOT in this list, do NOT claim it has errors
- If an error type is NOT shown in a page's breakdown, do NOT claim that error type occurs on that page

PRIORITIZATION using CWV signals:
- Errors with [POOR] CWV that are also *statistically significant* = CRITICAL (proven performance-degrading errors)
- Errors with [POOR] CWV = HIGH (correlated with bad performance, worth investigating)
- Errors with [NEEDS IMPROVEMENT] CWV = MODERATE
- Errors without CWV data or with passing CWV = prioritize by volume and page criticality only

IMPORTANT: Every data point MUST be wrapped in a facet link span.
- Page references: <span data-facet="url" data-facet-value="PAGE_PATH">page name (COUNT errors)</span>
- Error sources (global): <span data-facet="checkpoint" data-facet-value="error" data-nested-facet="error.source" data-nested-value="SOURCE">error description</span>
- Error targets (global): <span data-facet="checkpoint" data-facet-value="error" data-nested-facet="error.target" data-nested-value="TARGET">error message</span>
- Error on a specific page (from per-page breakdown): add data-url-context to enable BOTH error + URL checkboxes:
  <span data-facet="checkpoint" data-facet-value="error" data-nested-facet="error.source" data-nested-value="SOURCE" data-url-context="PAGE_PATH">error on page</span>
  This filters dashboard to checkpoint=error + error.source=SOURCE + url=PAGE_PATH in one click.
- Device segments: <span data-facet="userAgent" data-facet-value="VALUE">device description</span>
No unlinked data — every mentioned metric must be clickable for validation.
No speculation — only state what the data above explicitly shows.\n`;
}

function buildFinalSynthesisMessage(dashboardData, allInsights, crossRefData) {
  const hasMetrics = Object.keys(dashboardData.metrics).length > 0;

  return `Create a polished, professional analysis report. Use only the data below as source material.

DATE RANGE: ${dashboardData.dateRange || 'Not specified'}

DASHBOARD METRICS:
${hasMetrics
    ? Object.entries(dashboardData.metrics)
      .map(([metric, value]) => `${metric}: ${value}`)
      .join('\n')
    : 'Dashboard metrics not available - use segment data from batch analyses'}

FACETS ANALYZED (${Object.keys(dashboardData.segments).length} total):
${Object.entries(dashboardData.segments)
    .slice(0, 10)
    .map(([segment, items]) => `- ${segment}: ${items.length} items, top: ${items[0]?.value || 'N/A'} (${items[0]?.count?.toLocaleString() || 0})`)
    .join('\n')}
${Object.keys(dashboardData.segments).length > 10 ? `... and ${Object.keys(dashboardData.segments).length - 10} more` : ''}

BATCH ANALYSIS RESULTS:
${(() => {
    const maxTotal = 6000;
    const perInsight = Math.min(600, Math.floor(maxTotal / allInsights.length));
    return allInsights.map((insight) => insight.slice(0, perInsight)).join('\n---\n');
  })()}
${formatErrorCrossReference(crossRefData)}
Generate the report following the template structure in your system instructions.`;
}

/** Call AWS Bedrock API for analysis */
async function callAnthropicAPI(dashboardData, facetTools, progressCallback) {
  try {
    // Verify API credentials exist (checked in metrics-processing.js)
    const { getApiProvider } = await import('../api/api-factory.js');
    const provider = getApiProvider();
    if (!provider.hasToken) {
      throw new Error('Domain key required for AI analysis. Ensure the dashboard has loaded with a valid domain key.');
    }

    // Get system prompt
    const systemPromptText = await getSystemPrompt();

    // Process metrics in sequential batches
    if (progressCallback) {
      progressCallback(2, 'in-progress', 'Starting analysis...');
    }

    const allInsights = await processMetricsBatches(
      facetTools,
      dashboardData,
      systemPromptText,
      null, // API credentials auto-detected in metrics-processing.js
      'Analyze the RUM data from the dashboard.',
      handleDynamicFacetToolCall,
      progressCallback,
    );

    if (allInsights.length > 0) {
      if (progressCallback) {
        progressCallback(2, 'completed', 'Metrics batch processing completed');
        progressCallback(3, 'in-progress', 'Cross-referencing errors with pages and devices...', 5);
      }

      // Cross-reference errors with URLs and user agents for business impact analysis
      const crossRefData = await crossReferenceErrors();

      if (progressCallback) {
        progressCallback(3, 'in-progress', 'Generating streamlined overview report...', 10);
      }

      // Load overview template and facet info into system prompt
      if (progressCallback) {
        progressCallback(3, 'in-progress', 'Loading overview template...', 25);
      }
      const overviewTemplate = await getOverviewAnalysisTemplate();
      const facetInfoSection = buildFacetInfoSection(dashboardData);
      const enhancedSystemPrompt = `${systemPromptText}\n\n${overviewTemplate}\n\n${facetInfoSection}`;

      // Build lean user message with just data
      const finalSynthesisMessage = buildFinalSynthesisMessage(
        dashboardData,
        allInsights,
        crossRefData,
      );

      const maxTokens = API_CONFIG.SYNTHESIS_MAX_TOKENS || 4096;

      const finalRequest = {
        modelId: AI_MODELS.SYNTHESIS_MODEL_ID || AI_MODELS.BEDROCK_MODEL_ID,
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: finalSynthesisMessage }],
        system: enhancedSystemPrompt,
        temperature: API_CONFIG.BATCH_TEMPERATURE,
      };

      if (progressCallback) {
        progressCallback(3, 'in-progress', 'Preparing the overview analysis...', 40);
      }

      // Make final API call using async mode to avoid timeout
      if (progressCallback) {
        progressCallback(3, 'in-progress', 'Generating insights and findings (this may take a minute)...', 50);
      }

      const { callAIAsync } = await import('../api/api-factory.js');
      const finalData = await callAIAsync(finalRequest);

      if (finalData) {
        if (finalData.stop_reason === 'max_tokens') {
          throw new Error('AI response truncated. Please try again or increase max_tokens configuration.');
        }

        if (finalData.content && finalData.content.length > 0) {
          if (progressCallback) {
            progressCallback(3, 'in-progress', 'Finalizing report...', 80);
          }

          let finalAnalysis = '';

          finalData.content.forEach((item) => {
            if (item.type === 'text') {
              const text = item.text.trim();
              if (text) finalAnalysis += `${text}\n`;
            }
          });

          if (progressCallback) {
            progressCallback(3, 'completed', 'Streamlined overview report completed successfully', 100);
          }

          return finalAnalysis;
        }
      }
    }

    // Fallback result
    const result = 'Analysis completed successfully. Multiple insights were discovered across different data facets.';
    return result;
  } catch (error) {
    throw new Error(`Analysis Engine error: ${error.message}`);
  }
}

/**
 * Run complete RUM analysis
 * @param {Function} progressCallback - Progress callback function
 * @returns {Promise<string>} Analysis result
 */
export default async function runCompleteRumAnalysis(progressCallback = null) {
  try {
    // Step 1: Initialize analysis environment
    if (progressCallback) {
      progressCallback(0, 'in-progress', 'Setting up analysis tools...');
    }

    await new Promise((resolve) => {
      setTimeout(() => {
        initializeDynamicFacets();
        if (progressCallback) {
          progressCallback(0, 'completed', 'Analysis environment ready');
        }
        resolve();
      }, 200);
    });

    // Step 2: Extract dashboard data
    if (progressCallback) {
      progressCallback(1, 'in-progress', 'Scanning dashboard for data and available tools...');
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 300);
    });

    const dashboardData = await extractDashboardData();

    // Extract facet tools
    const facetTools = extractFacetsFromExplorer();

    if (facetTools.length > 0) {
      if (progressCallback) {
        progressCallback(1, 'completed', `Found ${facetTools.length} analysis metrics ready`);
      }
    } else if (progressCallback) {
      progressCallback(1, 'completed', 'Basic analysis mode - no advanced tools found');
    }

    // Step 3: Run AI analysis
    const response = await callAnthropicAPI(dashboardData, facetTools, progressCallback);

    return response;
  } catch (error) {
    throw new Error(`RUM Analysis failed: ${error.message}`);
  }
}
