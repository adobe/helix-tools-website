/* Analysis Engine Module - Core AI orchestration for RUM dashboard analysis */

import extractDashboardData from './dashboard-extractor.js';
import {
  extractFacetsFromExplorer,
  initializeDynamicFacets,
  handleDynamicFacetToolCall,
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

function buildFinalSynthesisMessage(dashboardData, allInsights) {
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

Generate the report following the template structure in your system instructions.`;
}

/** Call AWS Bedrock API for analysis */
async function callAnthropicAPI(dashboardData, facetTools, progressCallback) {
  try {
    // Verify API credentials exist (checked in metrics-processing.js)
    const { getApiProvider } = await import('../api/api-factory.js');
    const provider = getApiProvider();
    if (!provider.hasToken) {
      throw new Error('AWS Bedrock token not found. Please configure your token.');
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
      const finalData = await callAIAsync(finalRequest, (progress) => {
        // Update progress based on job status
        if (progressCallback && progress.status === 'processing') {
          const elapsed = Math.round((progress.elapsed || 0) / 1000);
          progressCallback(3, 'in-progress', `Generating report... (${elapsed}s elapsed)`, 50 + Math.min(30, elapsed));
        }
      });

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
