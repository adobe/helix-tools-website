export { ADMIN_API_BASE } from '../../../utils/admin/admin-client.js';
export const PSI_STORAGE_KEY = 'site-admin-psi-scores';
export const FAVORITES_STORAGE_KEY = 'site-admin-favorites';
export const VIEW_STORAGE_KEY = 'site-admin-view';

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
