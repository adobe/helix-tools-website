/**
 * Admin API Constants
 * Shared constants for AEM Admin API interactions.
 */

export const ADMIN_API_BASE = 'https://admin.hlx.page';

// Storage keys for persisting context across sessions
export const CONTEXT_STORAGE_KEY = 'aem-admin-context';
export const PROJECTS_STORAGE_KEY = 'aem-projects';

// Authentication status mappings for site access configuration
export const AUTH_STATUS_MAP = {
  none: {
    status: 'public',
    label: 'Public',
    description: 'Anyone can access this site',
    color: 'green',
  },
  site: {
    status: 'protected',
    label: 'Authenticated',
    description: 'Preview and Live require authentication',
    color: 'blue',
  },
  preview: {
    status: 'preview-only',
    label: 'Preview Authenticated',
    description: 'Only Preview requires authentication',
    color: 'orange',
  },
  live: {
    status: 'live-only',
    label: 'Live Authenticated',
    description: 'Only Live requires authentication',
    color: 'orange',
  },
};
