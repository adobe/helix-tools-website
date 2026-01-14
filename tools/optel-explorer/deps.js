/**
 * Optel Explorer - Centralized Dependencies
 * Re-exports CDN dependencies to allow easy version management and future bundling.
 * The actual CDN URLs are defined in the importmap in index.html.
 */

// Chart.js and adapters
export {
  Chart,
  TimeScale,
  LinearScale,
  registerables,
  // eslint-disable-next-line import/no-unresolved, import/extensions
} from 'chartjs';

// eslint-disable-next-line import/no-unresolved, import/extensions
export { default as luxonAdapter } from 'chartjs-adapter-luxon';

// RUM Distiller - data processing library
export {
  DataChunks,
  utils,
  stats,
  series,
  facets,
  // eslint-disable-next-line import/no-unresolved
} from '@adobe/rum-distiller';
