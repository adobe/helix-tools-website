/**
 * Central Configuration - Update when switching environments or models
 *
 * Model IDs, token limits, temperatures, and the AI system prompt/template are
 * owned server-side by the Bedrock proxy (helix-rum-bundler, src/api/bedrock.js)
 * and selected via the `purpose` field on each request. They are intentionally
 * NOT configured here so they cannot be overridden from the client.
 */

export const BEDROCK_CONFIG = {
  PROXY_ENDPOINT: 'https://bundles.aem.page/bedrock',
};

export const DA_CONFIG = {
  ORG: 'adobe',
  REPO: 'helix-optel',
  BASE_URL: 'https://admin.da.live/source',
  UPLOAD_PATH: 'optel-reports',
  WORKER_URL: 'https://optel-da-upload.adobeaem.workers.dev/',
};

export const PATHS = {
  BLOCK_BASE: '/blocks/ai-optel-report-generator',
  REPORT_TEMPLATE: 'templates/report-template.html',
};

export const STORAGE_KEYS = {
  VIEWED_REPORTS: 'viewedReports',
  SOURCE_REPORT: 'optel-detective-source-report',
};
