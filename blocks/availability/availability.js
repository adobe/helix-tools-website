import { createTag } from '../../scripts/scripts.js';

/**
 * @typedef {{
 *  cdn?: 'fastly' | 'cloudflare';
 *  errored?: Record<string, boolean>;
 *  headerMismatch?: Record<string, boolean>;
 *  highlight?: boolean;
 *  hashes?: Record<string, string>;
 *  popCodes?: Set<string> - Only show pins for these POP codes (case-insensitive)
 *  popResponses?: Record<string, object> - POP object per code for JSON tooltip
 *  regionLocations?: Array<{Code: string, City: string, Latitude: string, Longitude: string}>
 *    Direct pin locations (e.g. AWS regions for Cloudflare CDN)
 * }} Options
 */

/**
 * Generates a random number between 0 and max (exclusive) that is not equal to excluding
 * @param {number} max The upper bound (exclusive)
 * @param {number} excluding Number to avoid (to avoid repetition)
 * @returns {number} Randomly generated number
 */
function generateRandomNumber(max, excluding) {
  let randomNum;
  do {
    randomNum = Math.floor(Math.random() * Math.floor(max));
  } while (randomNum === excluding);
  return randomNum;
}

/**
 * Fetches data from a given URL.
 * @param {string} url URL to fetch data from
 * @returns {Promise<Object[]>} Fetched data, array of Objects
 */
async function fetchData(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('data could not be fetched from', url);
    const { data } = await res.json();
    return data;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('error: ', error);
  }
  return [];
}

/**
 * Gets a header value case-insensitively.
 * @param {Record<string, string>} headers
 * @param {string} key
 * @returns {string}
 */
function getHeader(headers, key) {
  if (!headers || typeof headers !== 'object') return '';
  const k = key.toLowerCase();
  const entry = Object.entries(headers).find(([hk]) => hk.toLowerCase() === k);
  return entry ? String(entry[1] ?? '') : '';
}

/**
 * Builds slim tooltip data from a pop response.
 * @param {object} popResponse
 * @param {boolean} headerMismatch
 * @returns {object|null}
 */
/**
 * @param {object} popResponse
 * @param {string[]} [mismatchFields] - Field names that differ from live
 * @returns {object|null}
 */
function buildPopTooltipData(popResponse, mismatchFields = []) {
  if (!popResponse) return null;
  const headers = popResponse.headers ?? popResponse.response?.headers ?? {};
  const popError = popResponse.error ?? '';
  const xError = getHeader(headers, 'x-error') || getHeader(headers, 'x_error') || '';
  const resp = popResponse.response ?? {};
  const message = resp.message ?? resp.Message ?? '';
  return {
    pop: popResponse.pop ?? '',
    region: popResponse.region ?? '',
    status: popResponse.status ?? resp.status ?? '',
    lastModified: getHeader(headers, 'last-modified'),
    contentLength: getHeader(headers, 'content-length'),
    contentEncoding: getHeader(headers, 'content-encoding'),
    message,
    mismatchFields: Array.isArray(mismatchFields) ? mismatchFields : [],
    error: popError || xError,
  };
}

const PORTAL_STYLE_ID = 'availability-availability-tooltip-portal-style';

/** @returns {HTMLStyleElement} */
function getPortalStyle() {
  let el = document.getElementById(PORTAL_STYLE_ID);
  if (!el) {
    el = createTag('style', { id: PORTAL_STYLE_ID });
    document.head.appendChild(el);
  }
  return el;
}

/**
 * Overrides the tooltip's CSS styles based on the provided axis and pixel values.
 * @param {HTMLElement} tooltip Tooltip element whose style will be overridden
 * @param {string} axis Axis on which to apply the override
 * @param {number} pixels Number of pixels to shift the tooltip
 */
function applyTooltipOverride(tooltip, axis, pixels) {
  const block = tooltip?.closest?.('.block');
  const inPortal = !block && tooltip?.parentElement === document.body;
  // if axis is 'reset,' reset previous tooltip override
  if (axis === 'reset') {
    const resetBlock = tooltip?.closest?.('.block') ?? tooltip;
    const resetStyle = resetBlock.querySelector?.('style');
    if (resetStyle) resetStyle.remove();
    getPortalStyle().textContent = '';
    return;
  }
  let style;
  if (inPortal) {
    style = getPortalStyle();
  } else if (block) {
    style = block.querySelector('style');
    if (!style) {
      style = createTag('style');
      block.append(style);
    }
  } else {
    return;
  }
  const sel = inPortal ? '#availability-tooltip.tooltip-pop' : '.availability .tooltip';
  if (axis === 'left') {
    const op = pixels > 0 ? '-' : '+';
    const TOOLTIP_POINTER_WIDTH = 6;
    const halfTip = Math.floor(tooltip.clientWidth / 2);
    const tooltipShift = (op === '+' ? Math.floor(pixels - TOOLTIP_POINTER_WIDTH) : Math.ceil(pixels + TOOLTIP_POINTER_WIDTH));
    if (Math.abs(tooltipShift) >= halfTip) {
      style.textContent = `${sel}::after { ${axis}: calc(50% ${op} ${halfTip}px); }`;
      tooltip.classList.add(op === '+' ? 'max' : 'min');
    } else {
      style.textContent = `${sel}::after { ${axis}: calc(50% ${op} ${Math.abs(pixels)}px); }`;
    }
  }
}

/**
 * Moves the tooltip element based on the specified axis and direction.
 * @param {HTMLElement} tooltip Tooltip element to move
 * @param {string} axis Axis to move the tooltip ('x' for horizontal, 'y' for vertical)
 * @param {number} direction Pixels to move the tooltip (>0 for right/down, <=0 for left/up)
 */
function moveTooltip(tooltip, axis, direction) {
  // get the current computed style (positioning) of the tooltip
  const style = window.getComputedStyle(tooltip);
  if (axis === 'x') { // move horizontally
    // calculate and apply the new left position
    tooltip.style.left = `${(parseFloat(style.left, 10) + direction).toFixed(2)}px`;
    applyTooltipOverride(tooltip, 'left', direction);
  } else if (axis === 'y') { // flip vertically
    tooltip.classList.add('flip');
    // get current transformation matrix of the tooltip
    const matrix = new DOMMatrix(window.getComputedStyle(tooltip).transform);
    // apply new transformation to the tooltip to mirror it vertically
    tooltip.style.transform = new DOMMatrix([
      matrix.a,
      matrix.b,
      matrix.c,
      matrix.d,
      matrix.e,
      Math.abs(matrix.f / 2.5),
    ]);
  }
}

const VIEWPORT_PADDING = 8;

/** Shared mouse position for tooltip unfocus checks (one listener for all maps) */
const availabilityLastMouse = { x: 0, y: 0 };
let availabilityMouseTracking = false;
function ensureAvailabilityMouseTracking() {
  if (availabilityMouseTracking) return;
  availabilityMouseTracking = true;
  document.addEventListener('mousemove', (e) => {
    availabilityLastMouse.x = e.clientX;
    availabilityLastMouse.y = e.clientY;
  }, { passive: true });
}

/**
 * Ensures the tooltip element stays within the given exterior bounding box.
 * @param {Object} exterior Bounding box of the exterior element
 * @param {Object} interior Bounding box of the interior element (tooltip)
 * @param {HTMLElement} tooltip Tooltip element to move (if outside the bounding box)
 */
function ensureTooltipInsideBoundingBox(exterior, interior, tooltip) {
  const fitsLeft = interior.left >= exterior.left;
  if (!fitsLeft) moveTooltip(tooltip, 'x', exterior.left - interior.left);
  const fitsRight = interior.right <= exterior.right;
  if (!fitsRight) moveTooltip(tooltip, 'x', exterior.right - interior.right);
  const fitsTop = interior.top >= exterior.top;
  if (!fitsTop) moveTooltip(tooltip, 'y');
  const fitsBottom = interior.bottom <= (exterior.bottom ?? Infinity);
  if (!fitsBottom) {
    const tooltipStyle = window.getComputedStyle(tooltip);
    const dy = interior.bottom - exterior.bottom;
    const topVal = parseFloat(tooltipStyle.top, 10);
    tooltip.style.top = `${topVal - dy}px`;
  }
}

/**
 * Aligns the tooltip pointer (::after) to point at the pin.
 * @param {HTMLElement} tooltip Tooltip element
 * @param {SVGCircleElement} pin Pin element
 */
function alignPointerToPin(tooltip, pin) {
  const block = tooltip.closest('.block');
  const inPortal = !block && tooltip.parentElement === document.body;
  const style = inPortal ? getPortalStyle() : (block.querySelector('style') || (() => {
    const s = createTag('style');
    block.append(s);
    return s;
  })());
  const pinRect = pin.getBoundingClientRect();
  const tipRect = tooltip.getBoundingClientRect();
  const pinCenterX = pinRect.left + pinRect.width / 2;
  const pointerLeftPx = pinCenterX - tipRect.left;
  const POINTER_HALF = 6;
  const tipWidth = tipRect.width;
  const clamped = Math.max(POINTER_HALF, Math.min(tipWidth - POINTER_HALF, pointerLeftPx));
  tooltip.classList.remove('min', 'max');
  if (clamped <= POINTER_HALF) tooltip.classList.add('min');
  else if (clamped >= tipWidth - POINTER_HALF) tooltip.classList.add('max');
  const sel = inPortal ? '#availability-tooltip.tooltip-pop' : '.availability .tooltip.tooltip-pop';
  style.textContent = `${sel}::after { left: ${clamped}px !important; transform: none !important; right: auto !important; }`;
}

/**
 * Positions the tooltip relative to the specified pin within the SVG element
 * @param {HTMLElement} tooltip Tooltip element to position
 * @param {HTMLElement} pin Pin element relative to which the tooltip will be positioned
 * @param {SVGElement} svg SVG element containing the pin
 */
function positionTooltip(tooltip, pin, svg) {
  const inPortal = tooltip.parentElement === document.body;
  if (inPortal) {
    const pinRect = pin.getBoundingClientRect();
    const OFFSET = -6; /* overlap pin to avoid dead zone when moving to tooltip */
    tooltip.style.position = 'fixed';
    tooltip.style.left = `${pinRect.left + pinRect.width / 2}px`;
    tooltip.style.top = `${pinRect.top - OFFSET}px`;
  } else {
    const width = svg.width.baseVal.value;
    const height = svg.height.baseVal.value;
    const cx = parseFloat(pin.getAttribute('cx'), 10);
    const cy = parseFloat(pin.getAttribute('cy'), 10);
    tooltip.style.top = `${100 * (cy / height)}%`;
    tooltip.style.left = `${100 * (cx / width)}%`;
  }
  const tipRect = tooltip.getBoundingClientRect();
  const viewport = {
    left: VIEWPORT_PADDING,
    top: VIEWPORT_PADDING,
    right: window.innerWidth - VIEWPORT_PADDING,
    bottom: window.innerHeight - VIEWPORT_PADDING,
  };
  ensureTooltipInsideBoundingBox(viewport, tipRect, tooltip);
  requestAnimationFrame(() => alignPointerToPin(tooltip, pin));
}

/**
 * Focuses a pin, moving the pin to front of group and displaying the tooltip.
 * @param {HTMLElement} pin Pin element to focus.
 * @param {HTMLElement} tooltip Tooltip element to display label
 * @param {HTMLElement} svg SVG element containing the pins
 */
function focusPin(pin, tooltip, svg) {
  // move focused pin to front
  pin.parentElement.append(pin);
  pin.dataset.focus = 'true';
  // reset, rewrite, and reposition tooltip
  tooltip.classList = 'tooltip';
  tooltip.removeAttribute('style');
  applyTooltipOverride(svg.closest('.block'), 'reset');
  const { popData } = pin.dataset;
  if (popData) {
    try {
      const data = JSON.parse(popData);
      tooltip.classList.add('tooltip-pop');
      tooltip.innerHTML = '';
      const lines = [
        ['pop', data.pop],
        ['region', data.region],
        ['status', data.status],
        ['last-modified', data.lastModified],
        ['content-length', data.contentLength],
      ];
      if (data.contentEncoding) lines.push(['content-encoding', data.contentEncoding]);
      if (data.message) lines.push(['message', data.message]);
      lines.forEach(([label, value]) => {
        if (label === 'region' && value === '') return;
        const line = document.createElement('div');
        line.className = 'tooltip-pop-line';
        const labelSpan = document.createElement('span');
        labelSpan.className = 'tooltip-pop-label';
        labelSpan.textContent = `${label}: `;
        line.appendChild(labelSpan);
        const mf = data.mismatchFields;
        const isConflict = Array.isArray(mf) && mf.includes(label);
        const valSpan = document.createElement('span');
        valSpan.className = isConflict ? 'tooltip-pop-conflict' : 'tooltip-pop-value';
        valSpan.textContent = value || '—';
        line.appendChild(valSpan);
        tooltip.appendChild(line);
      });
      if (data.error) {
        const line = document.createElement('div');
        line.className = 'tooltip-pop-line tooltip-pop-error';
        const labelSpan = document.createElement('span');
        labelSpan.className = 'tooltip-pop-label';
        labelSpan.textContent = 'error: ';
        line.appendChild(labelSpan);
        const valSpan = document.createElement('span');
        valSpan.className = 'tooltip-pop-value tooltip-pop-error-value';
        valSpan.textContent = data.error;
        line.appendChild(valSpan);
        tooltip.appendChild(line);
      }
    } catch {
      tooltip.textContent = pin.getAttribute('aria-label');
    }
  } else {
    tooltip.textContent = pin.getAttribute('aria-label');
  }
  if (tooltip.classList.contains('tooltip-pop')) {
    document.body.appendChild(tooltip);
    tooltip.classList.add('availability-tooltip-portal');
  }
  positionTooltip(tooltip, pin, svg);
  tooltip.setAttribute('aria-hidden', false);
}

/**
 * Unfocuses the focused pin and hides the tooltip.
 * @param {HTMLElement} tooltip Tooltip element
 * @param {HTMLElement} svg SVG element containing the pins
 */
function unfocusPin(tooltip, svg) {
  const focused = svg.querySelector('[data-focus]');
  if (focused) {
    focused.removeAttribute('data-focus');
    focused.style.removeProperty('stroke-width');
  }
  if (tooltip.classList.contains('availability-tooltip-portal')) {
    const block = svg.closest('.block');
    const wrapper = block?.querySelector('.tooltip-wrapper');
    if (wrapper) {
      wrapper.prepend(tooltip);
    }
    tooltip.classList.remove('availability-tooltip-portal');
  }
  tooltip.setAttribute('aria-hidden', true);
}

/**
 * Iterates through array of pins, focusing and unfocusing them in an infinite loop.
 * @param {HTMLElement[]} pins Array of pin elements
 * @param {HTMLElement} svg SVG element containing the pins
 * @param {HTMLElement} tooltip Tooltip element to display label
 * @param {number} [lastIndex = -1] The index of the last focused pin (to avoid repetition)
 */
function iterateThroughPins(pins, svg, tooltip, lastIndex = -1) {
  const randomIndex = generateRandomNumber(pins.length, lastIndex);
  const randomPin = pins[randomIndex];
  if (svg.dataset.auto === 'true') focusPin(randomPin, tooltip, svg);
  setTimeout(() => {
    if (svg.dataset.auto === 'true') unfocusPin(tooltip, svg);
    setTimeout(() => {
      iterateThroughPins(pins, svg, tooltip, randomIndex); // recursive call to focus another pin
    }, 200);
  }, 3000);
}

/* eslint-disable max-len */
/**
 * Enables hover interactions for a pin element.
 * @param {SVGCircleElement} pin Pin element to enable interaction
 * @param {HTMLElement} tooltip Tooltip element
 * @param {SVGElement} svg SVG map element containing the pins
 * @param {() => void} [scheduleUnfocus] If provided, used instead of immediate unfocus on pin leave
 * @param {() => void} [cancelUnfocus] If provided, called on pin enter to cancel any pending unfocus
 */
function enablePinInteractions(pin, tooltip, svg, scheduleUnfocus, cancelUnfocus) {
  pin.addEventListener('mouseenter', () => {
    cancelUnfocus?.();
    focusPin(pin, tooltip, svg);
  });
  const onLeave = scheduleUnfocus ?? (() => unfocusPin(tooltip, svg));
  pin.addEventListener('mouseleave', onLeave);
}

/**
 * Creates a pin element for a city based on its coordinates.
 * @param {Object} city City data
 * @param {number} width Width of the SVG
 * @param {number} height Height of the SVG
 * @param {number} longUnit Unit for longitude positioning
 * @param {number} latUnit Unit for latitude positioning
 * @param {string} [hash]
 * @param {boolean} [error=false] Whether the pin represents an errored city
 * @param {boolean} [headerMismatch=false] Whether last-modified/content-length differ from live
 * @param {object} [popResponse] Full POP response object for tooltip
 * @param {string[]} [mismatchFields] - Fields that differ (e.g. ['content-length'])
 * @returns {SVGCircleElement} Created pin element
 */
function createPin(city, width, height, longUnit, latUnit, hash, error = false, headerMismatch = false, popResponse = null, mismatchFields = []) { // eslint-disable-line max-len
  const pin = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  pin.setAttribute('cx', ((width / 2) + (parseFloat(city.Longitude, 10) * longUnit)).toFixed(2));
  pin.setAttribute('cy', ((height / 2) - (parseFloat(city.Latitude, 10) * latUnit)).toFixed(2));
  const PIN_RADIUS = 33;
  pin.setAttribute('r', PIN_RADIUS);
  let label = `${city.City}${city.Code ? ` (${city.Code})` : ''}${hash ? ` ${hash}` : ''}`;
  if (headerMismatch) label += ' [last-modified/content-length differs]';
  pin.setAttribute('aria-label', label);
  if (popResponse) {
    const tooltipData = buildPopTooltipData(popResponse, mismatchFields);
    if (tooltipData) pin.dataset.popData = JSON.stringify(tooltipData);
  }
  if (error) {
    pin.classList.add('error');
    pin.style.fill = '#ef4444';
    pin.style.stroke = '#ef4444';
  } else if (headerMismatch) {
    pin.classList.add('header-mismatch');
    pin.style.fill = '#e67700';
    pin.style.stroke = '#e67700';
  } else {
    pin.style.fill = '#22c55e';
    pin.style.stroke = '#22c55e';
  }
  return pin;
}

/**
 * Fetches data from the given source and populates the SVG with pins representing cities.
 * @param {string} src URL to fetch the data from
 * @param {SVGElement} svg SVG element to populate with pins
 * @param {HTMLElement} tooltip Tooltip element to display pin label
 * @param {Options} opts
 */
async function populateMap(src, svg, tooltip, opts) {
  // create a group element to hold the pins separate from the map
  const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  group.id = 'availability-group';
  svg.append(group);
  // get the dimensions of the SVG
  const width = svg.width.baseVal.value;
  const height = svg.height.baseVal.value;
  // calculate units for positioning pins based on latitude and longitude
  const longUnit = (width / 2) / 180; // where longitude range is -180° to 180°
  const latUnit = (height / 2) / 90; // where latitude range is -180° to 180°
  let cities;
  if (opts.regionLocations?.length) {
    // Use direct region locations (e.g. AWS regions for Cloudflare CDN)
    cities = opts.regionLocations;
  } else {
    // fetch the cities data from the provided source
    cities = await fetchData(src);
    if (opts.cdn) {
      cities = cities.filter((city) => city.Provider.toLowerCase() === opts.cdn);
    }
    if (opts.popCodes?.size) {
      const matchCode = (city) => {
        const codeLc = city.Code?.toLowerCase();
        if (!codeLc) return false;
        if (opts.popCodes.has(codeLc)) return true;
        // relaxed: 3-letter pop (e.g. LIS) may match Code "LIS-xyz" or "xyz-LIS"
        return Array.from(opts.popCodes).some(
          (pc) => pc.length === 3 && (codeLc.startsWith(pc) || codeLc.endsWith(`-${pc}`)),
        );
      };
      const filtered = cities.filter(matchCode);
      if (filtered.length > 0) cities = filtered;
    }
  }
  // iterate over the cities data to create pins for each city
  const headerMismatchByCode = opts.headerMismatch ?? {};
  const popResponsesByCode = opts.popResponses ?? {};
  const getMatchedPopCode = (city) => {
    if (!opts.popCodes?.size) return null;
    const codeLc = city.Code?.toLowerCase();
    if (!codeLc) return null;
    if (opts.popCodes.has(codeLc)) return codeLc;
    return Array.from(opts.popCodes).find(
      (pc) => pc.length === 3 && (codeLc.startsWith(pc) || codeLc.endsWith(`-${pc}`)),
    ) ?? null;
  };
  const regionPopsData = opts.regionPopsData ?? [];
  const headerMismatchFieldsByCode = opts.headerMismatchFields ?? {};
  // Delay unfocus on pin/SVG leave so user can move to tooltip without flicker
  let hideTimeout;
  const HIDE_DELAY_MS = 600;
  ensureAvailabilityMouseTracking();
  const isPointerOverTooltip = () => {
    const { x: mx, y: my } = availabilityLastMouse;
    const r = 6; /* check ±6px for boundary forgiveness */
    const pts = [
      [mx, my],
      [mx - r, my],
      [mx + r, my],
      [mx, my - r],
      [mx, my + r],
    ];
    return pts.some(([x, y]) => {
      const el = document.elementFromPoint(x, y);
      return el && (el === tooltip || tooltip.contains(el));
    });
  };
  const scheduleUnfocus = () => {
    hideTimeout = setTimeout(() => {
      if (isPointerOverTooltip()) return;
      unfocusPin(tooltip, svg);
    }, HIDE_DELAY_MS);
  };
  const cancelUnfocus = () => clearTimeout(hideTimeout);
  tooltip.addEventListener('mouseenter', cancelUnfocus);
  tooltip.addEventListener('pointerenter', cancelUnfocus);
  /* Debounce tooltip leave so brief pointer glitches don't cause flicker */
  tooltip.addEventListener('mouseleave', scheduleUnfocus);
  tooltip.addEventListener('pointerleave', scheduleUnfocus);
  cities.forEach((city, idx) => {
    const codeLc = city.Code?.toLowerCase();
    const matchedPop = getMatchedPopCode(city);
    // When using regionLocations, use parallel regionPopsData for guaranteed popResponse
    const fromRegion = regionPopsData[idx];
    const popResponse = fromRegion?.popResponse
      ?? popResponsesByCode[city.Code]
      ?? popResponsesByCode[codeLc]
      ?? popResponsesByCode[matchedPop];
    const headerMismatch = fromRegion?.headerMismatch
      ?? headerMismatchByCode[city.Code]
      ?? headerMismatchByCode[codeLc]
      ?? headerMismatchByCode[matchedPop];
    const mismatchFields = fromRegion?.mismatchFields
      ?? headerMismatchFieldsByCode[city.Code]
      ?? headerMismatchFieldsByCode[codeLc]
      ?? headerMismatchFieldsByCode[matchedPop]
      ?? [];
    const errored = opts.errored[city.Code] ?? opts.errored[codeLc] ?? opts.errored[matchedPop];
    const hash = opts.hashes[city.Code] ?? opts.hashes[codeLc] ?? opts.hashes[matchedPop];
    const pin = createPin(
      city,
      width,
      height,
      longUnit,
      latUnit,
      hash,
      errored,
      headerMismatch,
      popResponse,
      mismatchFields,
    );
    group.append(pin);
    enablePinInteractions(pin, tooltip, svg, scheduleUnfocus, cancelUnfocus);
  });
  // auto-iterate through pins
  const pins = svg.querySelectorAll('circle');
  if (opts.highlight) {
    iterateThroughPins(pins, svg, tooltip);
  }
  // disable auto-iteration when the user hovers over the SVG
  svg.addEventListener('mouseenter', () => {
    svg.dataset.auto = false;
  });
  // reenable auto-iteration when the user's hover leaves the SVG
  svg.addEventListener('mouseleave', () => {
    svg.dataset.auto = true;
    scheduleUnfocus();
  });

  // unfocus when clicking anywhere (map background, legend, or elsewhere) but not the tooltip
  const block = svg.closest('.block');
  const handleClick = (e) => {
    if (e.target.closest?.('circle') || tooltip.contains(e.target)) return;
    unfocusPin(tooltip, svg);
  };
  if (block) block.addEventListener('click', handleClick);
  document.addEventListener('click', handleClick);
}

/**
 * @param {HTMLDivElement} block
 * @param {Options} [opts]
 */
export default function decorate(block, opts = { highlight: true, errored: {} }) {
  if (opts.highlight === undefined) opts.highlight = true;
  if (opts.errored === undefined) opts.errored = {};
  if (opts.hashes === undefined) opts.hashes = {};
  if (opts.headerMismatch === undefined) opts.headerMismatch = {};

  // extract data source from the block
  const data = block.querySelector('a[href]');
  block.innerHTML = '';
  // create wrapper div element to position the tooltip
  const wrapper = createTag('div', { class: 'tooltip-wrapper' });
  // map container clips the map so tooltip (sibling) can overflow
  const mapContainer = createTag('div', { class: 'availability-map-container' });
  const img = createTag('img', { src: '/blocks/availability/map.svg' });
  img.addEventListener('load', async () => {
    // after img load, fetch the SVG content from the img source
    const res = await fetch(img.src);
    const text = await res.text();
    // replace the img with the SVG element
    const temp = createTag('div');
    temp.innerHTML = text;
    const svg = temp.querySelector('svg');
    img.replaceWith(svg);
    // if data is available, initialize the tooltip and populate the SVG map with city data
    if (data) {
      const tooltip = createTag('div', {
        'aria-hidden': true,
        class: 'tooltip',
        id: 'availability-tooltip',
      });
      wrapper.prepend(tooltip);
      populateMap(data.href, svg, tooltip, opts);
      svg.dataset.auto = true;
    }
  });
  mapContainer.append(img);
  wrapper.append(mapContainer);
  block.append(wrapper);
}
