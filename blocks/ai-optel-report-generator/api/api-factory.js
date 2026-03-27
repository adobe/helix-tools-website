/**
 * API Factory - AWS Bedrock Integration via RUM Bundler Proxy
 */

import { callBedrockAPI, callBedrockAPIAsync, hasBedrockToken } from './bedrock-api.js';

export function getApiProvider() {
  if (hasBedrockToken()) return { type: 'bedrock', hasToken: true };
  return { type: null, hasToken: false };
}

/**
 * Call AI synchronously (streaming mode)
 * Use for quick requests like tool_use calls
 */
export async function callAI(params) {
  if (!hasBedrockToken()) {
    throw new Error('RUM admin token not found. Please ensure you are logged in.');
  }
  return callBedrockAPI(params);
}

/**
 * Call AI asynchronously (job queue mode)
 * Use for long-running requests like final report generation
 * @param {object} params - Request parameters
 * @param {function} onProgress - Optional progress callback
 */
export async function callAIAsync(params, onProgress = null) {
  if (!hasBedrockToken()) {
    throw new Error('RUM admin token not found. Please ensure you are logged in.');
  }
  return callBedrockAPIAsync(params, onProgress);
}

export function getProviderName() {
  return hasBedrockToken() ? 'AWS Bedrock (Claude Opus 4.6)' : 'No provider configured';
}
