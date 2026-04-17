/**
 * Central Configuration - Update when switching environments or models
 */

export const AI_MODELS = {
  BEDROCK_MODEL_ID: 'us.anthropic.claude-opus-4-6-v1',
  SYNTHESIS_MODEL_ID: 'us.anthropic.claude-opus-4-6-v1',
};

export const BEDROCK_CONFIG = {
  PROXY_ENDPOINT: 'https://bundles.aem.page/bedrock',
  MAX_TOKENS: 4096,
  TEMPERATURE: 0.7,
};

export const DA_CONFIG = {
  ORG: 'adobe',
  REPO: 'helix-optel',
  BASE_URL: 'https://admin.da.live/source',
  UPLOAD_PATH: 'optel-reports',
  WORKER_URL: 'https://optel-da-upload.adobeaem.workers.dev/',
};

export const API_CONFIG = {
  BATCH_MAX_TOKENS: 2048,
  FOLLOWUP_MAX_TOKENS: 3072,
  SYNTHESIS_MAX_TOKENS: 7500,
  BATCH_TEMPERATURE: 0.35,
  FOLLOWUP_TEMPERATURE: 0.3,
};

export const PATHS = {
  BLOCK_BASE: '/blocks/ai-optel-report-generator',
  SYSTEM_PROMPT: 'templates/system-prompt.txt',
  OVERVIEW_TEMPLATE: 'templates/overview-analysis-template.html',
  REPORT_TEMPLATE: 'templates/report-template.html',
};

export const STORAGE_KEYS = {
  VIEWED_REPORTS: 'viewedReports',
  SOURCE_REPORT: 'optel-detective-source-report',
};
