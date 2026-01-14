/**
 * Optel Explorer - Main entry point
 * Operational Telemetry data exploration and analysis tool for AEM Edge Delivery Services.
 */
import SkylineChart from './charts/skyline.js';
import IncognitoCheckbox from './elements/incognito-checkbox.js';
import FacetSidebar from './elements/facetsidebar.js';
import ListFacet from './elements/list-facet.js';
import ThumbnailFacet from './elements/thumbnail-facet.js';
import LinkFacet from './elements/link-facet.js';
import LiteralFacet from './elements/literal-facet.js';
import VitalsFacet from './elements/vitals-facet.js';
import FileFacet from './elements/file-facet.js';
import URLSelector from './elements/url-selector.js';
import DateRangePicker from './elements/daterange-picker.js';

// Set up the slicer namespace for the chart
window.slicer = {
  Chart: SkylineChart,
};

// Register all custom elements with optel- prefix
customElements.define('optel-incognito-checkbox', IncognitoCheckbox);
customElements.define('optel-facet-sidebar', FacetSidebar);
customElements.define('optel-list-facet', ListFacet);
customElements.define('optel-thumbnail-facet', ThumbnailFacet);
customElements.define('optel-link-facet', LinkFacet);
customElements.define('optel-literal-facet', LiteralFacet);
customElements.define('optel-vitals-facet', VitalsFacet);
customElements.define('optel-file-facet', FileFacet);
customElements.define('optel-url-selector', URLSelector);
customElements.define('optel-daterange-picker', DateRangePicker);

// Import and execute the slicer module to initialize the application
import('./slicer.js');
