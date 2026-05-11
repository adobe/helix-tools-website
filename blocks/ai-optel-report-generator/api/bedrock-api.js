/**
 * AWS Bedrock API Integration via RUM Bundler Proxy
 * Authenticates via domainkey (passed in request body/query params).
 */

import { AI_MODELS, BEDROCK_CONFIG } from '../config.js';
import { getEffectiveDomainKey, getPageDomain } from '../domainkey-context.js';

export function hasBedrockToken() {
  return !!getEffectiveDomainKey();
}

const MAX_RETRIES = 4;
const ENDPOINT = BEDROCK_CONFIG.PROXY_ENDPOINT;
const JOBS_ENDPOINT = `${BEDROCK_CONFIG.PROXY_ENDPOINT}/jobs`;
const USAGE_ENDPOINT = `${BEDROCK_CONFIG.PROXY_ENDPOINT}/usage`;
const POLL_INTERVAL = 5000; // Poll every 5 seconds
const MAX_POLL_TIME = 300000; // Max 5 minutes

// Usage tracking for billing
let usageTracker = { inputTokens: 0, outputTokens: 0, model: null };

/** Reset usage tracker - call at start of new report generation */
export function resetUsageTracker() {
  usageTracker = { inputTokens: 0, outputTokens: 0, model: null };
}

/** Add usage from an API response */
function trackUsage(usage, model) {
  if (usage) {
    usageTracker.inputTokens += usage.input_tokens || 0;
    usageTracker.outputTokens += usage.output_tokens || 0;
    if (model) usageTracker.model = model;
  }
}

/** Submit accumulated usage to server */
export async function submitUsage(reportId) {
  if (usageTracker.inputTokens === 0 && usageTracker.outputTokens === 0) {
    return;
  }

  const domainkey = getEffectiveDomainKey();
  if (!domainkey) {
    return;
  }

  try {
    await fetch(USAGE_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        domain: getPageDomain(),
        domainkey,
        reportId,
        model: usageTracker.model || 'unknown',
        inputTokens: usageTracker.inputTokens,
        outputTokens: usageTracker.outputTokens,
      }),
    });
  } catch {
    // Ignore network errors for usage telemetry (fetch only throws on network failure).
  }
}

/** Transform content item to Messages API format */
function transformContentItem(item) {
  if (item.type === 'text') return { type: 'text', text: item.text };
  if (item.type === 'tool_use' || item.toolUse) {
    // Handle both Messages API format (id) and Converse API format (toolUseId/toolUse)
    const toolData = item.toolUse || item;
    const toolId = toolData.id || toolData.toolUseId || `toolu_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    return {
      type: 'tool_use',
      id: toolId,
      name: toolData.name,
      input: toolData.input || {},
    };
  }
  if (item.type === 'tool_result' || item.toolResult) {
    // Handle both Messages API format (tool_use_id) and Converse API format (toolUseId/toolResult)
    const resultData = item.toolResult || item;
    const result = {
      type: 'tool_result',
      tool_use_id: resultData.tool_use_id || resultData.toolUseId,
      content: resultData.content,
    };
    if (resultData.is_error || resultData.isError) result.is_error = true;
    return result;
  }
  return { type: 'text', text: JSON.stringify(item) };
}

/** Transform message to Messages API format */
function transformMessage(msg) {
  let content;
  if (typeof msg.content === 'string') {
    content = msg.content;
  } else if (Array.isArray(msg.content)) {
    content = msg.content.map(transformContentItem);
  } else {
    content = String(msg.content);
  }
  return { role: msg.role, content };
}

/** Build request body for Messages API via proxy */
function buildRequestBody(params) {
  const {
    messages,
    system,
    max_tokens: maxTokens = BEDROCK_CONFIG.MAX_TOKENS,
    temperature = BEDROCK_CONFIG.TEMPERATURE,
    tools,
  } = params;

  const body = {
    domain: getPageDomain(),
    domainkey: getEffectiveDomainKey(),
    modelId: params.modelId || AI_MODELS.BEDROCK_MODEL_ID,
    messages: messages.map(transformMessage),
    max_tokens: maxTokens,
    temperature,
  };

  if (system) body.system = system;
  if (tools?.length) body.tools = tools;

  return body;
}

/** Normalize response content to ensure tool_use blocks have all required fields */
function normalizeResponseContent(content, tools = []) {
  if (!Array.isArray(content)) return content;

  // Build a map of tool names for lookup
  const toolNames = tools.map((t) => t.name);
  let toolIndex = 0;

  return content.map((item) => {
    // Handle Converse API format (toolUse wrapper)
    if (item.toolUse) {
      const { toolUse } = item;
      const name = toolUse.name || toolNames[toolIndex % toolNames.length] || 'unknown_tool';
      toolIndex += 1;
      return {
        type: 'tool_use',
        id: toolUse.toolUseId || toolUse.id || `toolu_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
        name,
        input: toolUse.input || {},
      };
    }

    // Handle Messages API format (type: tool_use)
    if (item.type === 'tool_use') {
      const name = item.name || toolNames[toolIndex % toolNames.length] || 'unknown_tool';
      toolIndex += 1;
      return {
        type: 'tool_use',
        id: item.id || item.toolUseId || `toolu_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
        name,
        input: item.input || {},
      };
    }

    // Pass through other content types unchanged
    return item;
  });
}

/** Call Bedrock API via RUM Bundler Proxy with retry logic */
export async function callBedrockAPI(params) {
  const requestBody = buildRequestBody(params);
  let lastError;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
    // eslint-disable-next-line no-await-in-loop
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    if (response.ok) {
      // eslint-disable-next-line no-await-in-loop
      const data = await response.json();

      // Normalize content to ensure tool_use blocks have all required fields
      const normalizedContent = normalizeResponseContent(data.content, params.tools);

      // Track usage for billing
      trackUsage(data.usage, data.model || AI_MODELS.BEDROCK_MODEL_ID);

      return {
        id: data.id || `bedrock-${Date.now()}`,
        type: 'message',
        role: 'assistant',
        content: normalizedContent,
        model: data.model || AI_MODELS.BEDROCK_MODEL_ID,
        stop_reason: data.stop_reason,
        usage: data.usage,
      };
    }

    // Handle auth errors immediately
    if (response.status === 401 || response.status === 403) {
      const authError = new Error('Authentication failed. Check your domain key or RUM bundler token.');
      authError.isAuthError = true;
      throw authError;
    }

    const xError = response.headers.get('x-error') || '';
    // eslint-disable-next-line no-await-in-loop
    const errorText = await response.text();
    lastError = `Bedrock API error: ${response.status} ${xError || errorText}`;

    // Retry on 429 (rate limit) and 502/503 (transient proxy/CDN errors)
    if ([429, 502, 503].includes(response.status) && attempt < MAX_RETRIES - 1) {
      const delay = (2 ** attempt) * (response.status >= 500 ? 3000 : 1000);
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => { setTimeout(r, delay); });
    } else {
      break;
    }
  }

  throw new Error(lastError || 'Bedrock API request failed');
}

/**
 * Submit async job to Bedrock API
 * @param {object} params - Request parameters
 * @returns {Promise<{jobId: string}>}
 */
async function submitBedrockJob(params) {
  const requestBody = buildRequestBody(params);

  const response = await fetch(JOBS_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      const authError = new Error('Authentication failed. Check your domain key or RUM bundler token.');
      authError.isAuthError = true;
      throw authError;
    }
    const errorText = await response.text();
    throw new Error(`Failed to submit job: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  return data;
}

/**
 * Poll for job status
 * @param {string} jobId - Job ID to poll
 * @returns {Promise<object>} - Job result when complete
 */
async function pollJobStatus(jobId) {
  const domainkey = getEffectiveDomainKey();
  const domain = getPageDomain();
  const jobUrl = `${JOBS_ENDPOINT}/${jobId}?domain=${encodeURIComponent(domain)}&domainkey=${encodeURIComponent(domainkey)}`;

  const response = await fetch(jobUrl, {
    method: 'GET',
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`Job ${jobId} not found`);
    }
    const errorText = await response.text();
    throw new Error(`Failed to get job status: ${response.status} ${errorText}`);
  }

  return response.json();
}

/**
 * Call Bedrock API asynchronously via job queue
 * Use this for long-running requests (report generation) to avoid timeouts
 * @param {object} params - Request parameters
 * @param {function} onProgress - Optional callback for progress updates
 * @returns {Promise<object>} - Bedrock response
 */
export async function callBedrockAPIAsync(params, onProgress = null) {
  // Submit job
  const { jobId } = await submitBedrockJob(params);

  if (onProgress) onProgress({ status: 'submitted', jobId });

  // Poll until complete
  const startTime = Date.now();
  let pollCount = 0;

  while (Date.now() - startTime < MAX_POLL_TIME) {
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => { setTimeout(r, POLL_INTERVAL); });
    pollCount += 1;

    // eslint-disable-next-line no-await-in-loop
    const job = await pollJobStatus(jobId);

    if (onProgress) {
      onProgress({
        status: job.status,
        jobId,
        elapsed: Date.now() - startTime,
        pollCount,
      });
    }

    if (job.status === 'completed') {
      const { result } = job;

      // Normalize content
      const normalizedContent = normalizeResponseContent(result.content, params.tools);

      // Track usage for billing
      trackUsage(result.usage, result.model || AI_MODELS.BEDROCK_MODEL_ID);

      return {
        id: result.id || `bedrock-${Date.now()}`,
        type: 'message',
        role: 'assistant',
        content: normalizedContent,
        model: result.model || AI_MODELS.BEDROCK_MODEL_ID,
        stop_reason: result.stop_reason,
        usage: result.usage,
      };
    }

    if (job.status === 'failed') {
      throw new Error(`Bedrock job failed: ${job.error?.message || 'Unknown error'}`);
    }
  }

  throw new Error(`Job ${jobId} timed out after ${MAX_POLL_TIME / 1000} seconds`);
}

export { getEffectiveDomainKey as getBedrockToken };
