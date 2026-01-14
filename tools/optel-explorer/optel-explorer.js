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

// Register all custom elements
customElements.define('incognito-checkbox', IncognitoCheckbox);
customElements.define('facet-sidebar', FacetSidebar);
customElements.define('list-facet', ListFacet);
customElements.define('thumbnail-facet', ThumbnailFacet);
customElements.define('link-facet', LinkFacet);
customElements.define('literal-facet', LiteralFacet);
customElements.define('vitals-facet', VitalsFacet);
customElements.define('file-facet', FileFacet);
customElements.define('url-selector', URLSelector);
customElements.define('daterange-picker', DateRangePicker);

// Import and execute the slicer module to initialize the application
import('./slicer.js');
