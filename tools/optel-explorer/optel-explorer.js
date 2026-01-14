/**
 * Optel Explorer - Main entry point
 * Operational Telemetry data exploration and analysis tool for AEM Edge Delivery Services.
 */
import SkylineChart from './charts/skyline.js';
import OptelIncognitoCheckbox from './elements/incognito-checkbox.js';
import OptelFacetSidebar from './elements/facetsidebar.js';
import OptelListFacet from './elements/list-facet.js';
import OptelThumbnailFacet from './elements/thumbnail-facet.js';
import OptelLinkFacet from './elements/link-facet.js';
import OptelLiteralFacet from './elements/literal-facet.js';
import OptelVitalsFacet from './elements/vitals-facet.js';
import OptelFileFacet from './elements/file-facet.js';
import OptelURLSelector from './elements/url-selector.js';
import OptelDateRangePicker from './elements/daterange-picker.js';

// Set up the slicer namespace for the chart
window.slicer = {
  Chart: SkylineChart,
};

// Register all custom elements with optel- prefix
customElements.define('optel-incognito-checkbox', OptelIncognitoCheckbox);
customElements.define('optel-facet-sidebar', OptelFacetSidebar);
customElements.define('optel-list-facet', OptelListFacet);
customElements.define('optel-thumbnail-facet', OptelThumbnailFacet);
customElements.define('optel-link-facet', OptelLinkFacet);
customElements.define('optel-literal-facet', OptelLiteralFacet);
customElements.define('optel-vitals-facet', OptelVitalsFacet);
customElements.define('optel-file-facet', OptelFileFacet);
customElements.define('optel-url-selector', OptelURLSelector);
customElements.define('optel-daterange-picker', OptelDateRangePicker);

// Import and execute the slicer module to initialize the application
import('./slicer.js');
