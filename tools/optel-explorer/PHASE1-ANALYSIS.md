# Phase 1 Analysis: RUM to Optel Migration

**Analysis Date:** 2026-01-12
**Source Repository:** helix-website (`tools/rum/`)
**Target Repository:** helix-tools-website (`tools/optel-explorer/`)
**Analysis Status:** ✅ Complete

---

## Executive Summary

The RUM tool is a sophisticated real user monitoring dashboard with 15+ facet types, responsive charting with Core Web Vitals focus, and authentication-based access control. The codebase uses modern web architecture (Web Components, ES6 modules) and is production-ready, though it has several incomplete features documented in TODO comments.

**Migration Scope:**
This analysis covers the **main RUM explorer tool only**. The admin tool (`tools/rum/admin/`) for organization management is **OUT OF SCOPE** and will be migrated separately in Phase 6 (future).

**Key Statistics:**

- **Files Being Migrated:** 16 files (~3,400 lines of code)
- **Files Deferred (Phase 6):** 4 admin files (~650 lines of code)
- **Custom Web Components:** 7 elements
- **Facet Types:** 15+ unique facets
- **API Endpoints:** 10+ distinct endpoints
- **Dependencies:** 1 production dependency (`@adobe/rum-distiller`)
- **Browser Support:** Modern browsers (ES2015+, no IE11)

---

## 1. Feature Inventory

### 1.1 Core User-Facing Features

#### Data Selection & Filtering

- ✅ Domain selection with validation and autocomplete
- ✅ Favicon display from Google's favicon service
- ✅ Organization-scoped domains (`:all` suffix)
- ✅ Date range filtering with presets (Week, Month, Year, Custom)
- ✅ Custom date range selection with dual inputs
- ✅ Incognito mode toggle for access control (open/incognito/provided)
- ✅ Text-based filtering with space-separated keywords (>2 chars)
- ✅ URL state persistence via browser history
- ✅ Deep linking support (full URL parameter preservation)

#### Key Metrics Display

- ✅ **Page Views** - with per-visit average
- ✅ **Visits** - with bounce rate percentage
- ✅ **Engagement/Conversions** - with conversion rate percentage
- ✅ **LCP** (Largest Contentful Paint) - 75th percentile in seconds
- ✅ **CLS** (Cumulative Layout Shift) - 75th percentile
- ✅ **INP** (Interaction to Next Paint) - 75th percentile in seconds
- ✅ **TTFB** (Time to First Byte) - 75th percentile (shown with `metrics=all` param)
- ✅ Color-coded scores: `good`, `ni` (needs improvement), `poor`

#### Faceted Filtering System

**Facet Types (15+):**

1. **List Facet** - Checkbox-based filtering with counts

   - Displays up to 10 options by default
   - "Load More" pagination
   - Shows up to 3 Core Web Vitals metrics per option (LCP, CLS, INP)
   - Significance indicators via border width (`interesting`, `significant`)
   - Copy-to-clipboard TSV export
   - Sort options (count or alphabetical)
2. **Link Facet** - URL-based display

   - Parses URL components (protocol, hostname, pathname, etc.)
   - Optional thumbnail preview (40x60px from OG image proxy)
   - Favicon fallback for broken images
   - Internal/external referrer distinction
3. **Thumbnail Facet** - Image preview

   - Max 100px width display
   - Supports external URLs and internal media paths
   - Format detection (JPEG, PNG, GIF, SVG, WebP)
   - Image proxy: `width=750&format=webply&optimize=medium`
4. **Literal Facet** - Raw value display with monospace font
5. **File Facet** - File/media reference with thumbnails
6. **Vitals Facet** - Core Web Vitals matrix

   - 3x3 grid (Good/NI/Poor by LCP/CLS/INP)
   - Color-coded by metric quality

**Available Facets:**

- `type` - Host Type (content type analysis)
- `userAgent` - Device Type and OS (desktop/mobile/bot)
- `url` - Page URL with thumbnail preview
- `checkpoint` - Event checkpoints (enter, loadresource, 404, viewblock, viewmedia, click, error, paid, consent, navigate)
- `click.source` - Click source CSS selector
- `click.target` - Click target URL
- `viewmedia.source` - Media source CSS selector
- `viewmedia.target` - Media file reference
- `viewblock.source` - Block CSS selector
- `enter.source` - External referrer (with favicon)
- `navigate.source` - Internal referrer
- `consent.source` - Consent provider (OneTrust)
- `consent.target` - Consent dialog state (show/hidden)
- `paid.source` - Ad network (Google, DoubleClick, Microsoft, Facebook, Twitter, LinkedIn, Pinterest, TikTok)
- `paid.target` - Click tracking parameter
- `error.source` - Error source URL
- `error.target` - Error line number
- `loadresource.histogram` - Resource load time histogram (ms)
- `loadresource.source` - Resource loaded
- `missingresource.source` - Missing resource
- `cwv-lcp.source` - LCP element DOM selector
- `cwv-lcp.target` - LCP element preview (thumbnail)

#### Charts & Visualization

**Skyline Chart** (`charts/skyline.js`):

- Multi-series stacked bar chart showing traffic over time
- Time granularities: hourly, daily, weekly, monthly
- Core Web Vitals distribution (Good/NI/Poor for LCP, CLS, INP)
- Primary metric: Page Views (purple gradient)
- Interpolation for sparse data (<10 samples)
- Responsive height: `calc(100vh - 450px)`
- Dark mode support
- Hover tooltips with percentages and absolute values
- X-axis labels rotated 90° for readability
- Uses Chart.js v4.4.2

**Charting Libraries:**

- `chart.js@4.4.2` (via esm.sh)
- `chartjs-adapter-luxon@1.3.1` (timezone-aware dates)
- Registers: TimeScale, LinearScale, standard plugins

#### User Interactions

**Primary Workflows:**

1. Domain Selection & Exploration
2. Date Range Selection (presets or custom)
3. Filtering & Faceting (checkbox + text)
4. Data Export (TSV to clipboard)
5. Labs Link Navigation (to oversight/explorer.html) ⚠️ **Cross-tool link - needs update**

**Event System:**

- Custom event: `facetchange`
- Custom event: `urlstatechange`
- Intersection Observer for lazy initialization

#### Export Capabilities

- ✅ **TSV to Clipboard** - Tab-separated values from facets
  - Columns: value, count, lcp, cls, inp
  - Uses `navigator.clipboard.writeText()`
  - Toast notification: "Rows copied to clipboard..."
- ❌ **PDF Export** - Not implemented (mentioned in lab link)
- ❌ **CSV Export** - Infrastructure exists but not wired up

#### Timezone Handling

- ✅ Browser timezone detection via `Intl.DateTimeFormat()`
- ✅ Display timezone in UI (e.g., "America/Los_Angeles")
- ✅ `toISOStringWithTimezone()` function for API requests
- ✅ Date format: `YYYY-MM-DDTHH:mm:ss±HH:mm`

#### Design & UX

- ✅ Dark mode support with color scheme detection
- ✅ Responsive design (breakpoints: 600px, 900px, 1200px)
- ✅ Mobile-first approach
- ✅ Shadow DOM for component encapsulation
- ✅ Animated icons (incognito eye open/closed)
- ✅ Debounced inputs (500ms for date picker)
- ❌ Toast notifications incomplete (TODOs for error/success states)

### 1.2 Authentication & Access Control (In Scope)

**Two-Tier Authentication Model:**

The RUM Explorer uses a two-tier authentication system that enables both authenticated access AND shareable URLs:


| Layer             | Storage                             | Purpose                             | Scope                                 |
| ------------------- | ------------------------------------- | ------------------------------------- | --------------------------------------- |
| **Bundler Token** | `localStorage['rum-bundler-token']` | Authenticates*user* to the API      | User-level; used to fetch domain keys |
| **Domain Key**    | URL param`?domainkey=`              | Authorizes access to*domain's data* | Domain-level; shareable via URL       |

**How They Work Together:**

1. **With bundler token only:** Tool fetches domain-specific key via API (`/domainkey/{domain}`)
2. **With domainkey in URL:** Used directly - no bundler token needed for data access
3. **With `domainkey=incognito`:** Fetches key but hides it from URL (privacy mode)
4. **Neither available:** Falls back to `domainkey=open` for public domains

**Key UX Feature:** URLs containing `?domainkey=abc123` can be shared - recipients can view the data **without** needing their own bundler token. This enables easy collaboration and reporting.

**Migration Consideration:** Need to decide whether to rename `rum-bundler-token` to `optel-bundler-token` or keep for backwards compatibility (users on helix-website would lose their stored token).

**Domain-Level Access:**

- ✅ Three access modes: `open`, `incognito`, `provided`
- ✅ Domain key-based authentication
- ✅ Organization key support (for viewing org data)
- ✅ Bearer token authentication (bundler token: `rum-bundler-token`)
- ✅ Automatic fallback to public access if key unavailable

**Admin Features (OUT OF SCOPE - Phase 6):**
The following admin features are deferred to Phase 6:

- ❌ Organization management interface (`admin/orgs.html`)
- ❌ Create/list organizations
- ❌ Add/remove domains from organizations
- ❌ Display organization keys
- ❌ Admin token authentication (`rum-admin-token`)

See Section 14.2 for rationale and future migration plan.

### 1.3 Real-Time Updates

**Update Mechanism:**

- ❌ No WebSocket implementation
- ❌ No polling/auto-refresh
- ✅ Updates triggered by user interactions:
  - Facet checkbox changes
  - Date range changes
  - Domain changes
  - Filter text input (debounced)
- ✅ URL state synchronization via `window.history.replaceState()`

**Performance:**

- Page reload on date range preset change
- Intersection Observer delays initialization until section visible
- Debounced text filter (500ms)

---

## 2. API Endpoints

### 2.1 Base URL

```
https://bundles.aem.page
```

### 2.2 Bundle Data Retrieval

**Domain-Scoped Bundles:**

```
GET /bundles/{domain}/{year}/{month}/{day}/{hour}?domainkey={key}
GET /bundles/{domain}/{year}/{month}/{day}?domainkey={key}
GET /bundles/{domain}/{year}/{month}?domainkey={key}
```

**Organization-Scoped Bundles:**

```
GET /orgs/{org}/bundles/{year}/{month}/{day}/{hour}?domainkey={key}
GET /orgs/{org}/bundles/{year}/{month}/{day}?domainkey={key}
GET /orgs/{org}/bundles/{year}/{month}?domainkey={key}
```

### 2.3 Domain Management

```
GET /domains?suggested=true           # Authenticated - get user's domains
GET /domainkey/{domain}                # Authenticated - get domain key
GET /orgs/{org}/key                    # Authenticated - get org key
```

### 2.4 Organization Management

```
GET /orgs                              # Authenticated - list orgs
POST /orgs                             # Authenticated - create org
  Body: { name: string }
GET /orgs/{org}/domains                # Authenticated - list domains
POST /orgs/{org}/domains               # Authenticated - add domains
  Body: { domains: string[] }
DELETE /orgs/{org}/domains/{domain}    # Authenticated - remove domain
```

### 2.5 Request Patterns

**Authentication:**

- Bearer token in `Authorization` header
- Token storage: `localStorage['rum-bundler-token']` or `localStorage['rum-admin-token']`
- Fallback: prompt user for token if missing

**Query Parameters:**

- `domainkey={key}` - Access key (or `open` for public data)
- `suggested=true` - Filter domain list

**Response Structure:**

```json
{
  "rumBundles": [
    {
      "timeSlot": "YYYY-MM-DDTHH:mm:ss.sssZ",
      "weight": 1,
      "url": "https://example.com/page",
      "hostType": "content",
      "events": [
        {
          "checkpoint": "enter",
          "source": "https://referrer.com",
          "target": "https://example.com/page",
          "timeDelta": 0
        }
      ],
      "cwvLCP": 1.234,
      "cwvCLS": 0.001,
      "cwvINP": 0.1
    }
  ]
}
```

### 2.6 Batch Requests

- Uses `Promise.all()` for multiple time periods
- Parallel requests for hourly/daily/monthly data
- Error handling per-request (continues on partial failure)

---

## 3. URL Parameters & Embed Modes

### 3.1 URL Parameter Schema


| Parameter          | Type     | Values                    | Purpose                | Example                  |
| -------------------- | ---------- | --------------------------- | ------------------------ | -------------------------- |
| `domain`           | string   | hostname                  | Domain to analyze      | `www.aem.live`           |
| `domainkey`        | string   | key or 'incognito'        | Access key             | `abc123`                 |
| `view`             | string   | week, month, year, custom | Date range preset      | `month`                  |
| `startDate`        | string   | YYYY-MM-DD                | Custom range start     | `2024-01-01`             |
| `endDate`          | string   | YYYY-MM-DD                | Custom range end       | `2024-01-31`             |
| `filter`           | string   | keywords                  | Text search (>2 chars) | `checkout error`         |
| `metrics`          | string   | 'all'                     | Show TTFB metric       | `all`                    |
| `checkpoint`       | string[] | checkpoint name           | Filter by event        | `click`                  |
| `url`              | string[] | URL pattern               | Filter by page         | `/products/*`            |
| `userAgent`        | string[] | device type               | Filter by device       | `desktop`                |
| `{facet}`          | string[] | facet value               | Generic facet filter   | `type=content`           |
| `conversion.{key}` | string   | value                     | Conversion spec        | `conversion.event=click` |
| `org`              | string   | org-id                    | Organization scope     | `adobe`                  |

**Multi-Value Parameters:**

- Checkpoints: `?checkpoint=click&checkpoint=error`
- Facets: `?url=/page1&url=/page2`

### 3.2 Example URLs

```
# Basic domain analysis
/tools/rum/explorer.html?domain=www.aem.live&view=month

# Organization-scoped
/tools/rum/explorer.html?domain=adobe:all&view=year

# Multiple filters
/tools/rum/explorer.html?domain=www.aem.live&checkpoint=click&userAgent=mobile

# Custom date range with filters
/tools/rum/explorer.html?domain=www.aem.live&view=custom&startDate=2024-01-01&endDate=2024-01-31&filter=checkout

# Show all metrics
/tools/rum/explorer.html?domain=www.aem.live&metrics=all

# Admin org view
/tools/rum/admin/orgs.html?org=adobe
```

### 3.3 Deep Linking

- ✅ **Full URL state preservation** - All filters, date ranges, domain selections persist
- ✅ **Browser history integration** - Back/forward navigation works
- ✅ **Shareable URLs** - Copy URL from browser to share exact view
- ✅ **Bookmark support** - Bookmarked URLs restore exact state

### 3.4 Embed/Iframe Modes

**Current Implementation:**

- ❌ No explicit embed mode parameters (`hideNav`, `embedded`, etc.)
- ⚠️ Tool is standalone page without embed-specific styling
- ⚠️ Could theoretically be embedded via iframe (single-page structure)

**Recommendation:** Add embed mode support during migration if needed

---

## 4. External Integrations

### 4.1 OAuth Flows

- ❌ **No OAuth implementation found**
- ✅ Bearer token authentication only
- ✅ Tokens stored in localStorage
- ✅ Fallback: prompt dialog for manual token entry

### 4.2 Webhooks

- ❌ **No webhook functionality**

### 4.3 Third-Party Services

**Google Favicon API:**

```
https://www.google.com/s2/favicons?domain={domain}&sz={size}
```

- Used in: `url-selector.js`, `link-facet.js`
- Purpose: Display domain favicons
- Fallback: Default browser favicon behavior

**OpenGraph Image Proxy:**

```
https://www.aem.live/tools/rum/_ogimage?proxyurl={url}
```

- Used in: `link-facet.js`, `thumbnail-facet.js`
- Purpose: Generate thumbnails from page URLs
- Fallback: Favicon display if image fails

**⚠️ Migration Note:** This endpoint is currently hosted at `www.aem.live/tools/rum/_ogimage`. Options:

1. Keep pointing to helix-website endpoint (simplest, but cross-origin)
2. Move proxy to helix-tools-website (requires backend work)
3. Create shared proxy service (architectural decision)

This is a **backend dependency** that needs discussion during Phase 3.

**CDN Libraries (esm.sh):**

```
https://esm.sh/chart.js@4.4.2
https://esm.sh/chartjs-adapter-luxon@1.3.1
https://esm.sh/@adobe/rum-distiller@1.20.8
```

- No build step required
- ES6 module imports
- Pinned versions for stability

### 4.4 Ad Network Detection

**Supported Networks** (in `paid.source` facet):

- Google Ads
- DoubleClick
- Microsoft Advertising
- Facebook Ads
- Twitter Ads
- LinkedIn Ads
- Pinterest Ads
- TikTok Ads

Detection based on URL patterns and tracking parameters.

---

## 5. Third-Party Dependencies

### 5.1 Production Dependencies

**package.json:**

```json
{
  "dependencies": {
    "@adobe/rum-distiller": "1.20.8"
  }
}
```

**Purpose:** RUM data processing and analysis library

### 5.2 CDN Libraries (No npm install required)


| Library               | Version | Purpose                | Source |
| ----------------------- | --------- | ------------------------ | -------- |
| chart.js              | 4.4.2   | Charting/visualization | esm.sh |
| chartjs-adapter-luxon | 1.3.1   | Timezone-aware dates   | esm.sh |
| @adobe/rum-distiller  | 1.20.8  | RUM data processing    | esm.sh |

**Import Pattern:**

```javascript
import { Chart, registerables } from 'https://esm.sh/chart.js@4.4.2';
import 'https://esm.sh/chartjs-adapter-luxon@1.3.1';
```

**⚠️ Migration Note: Isolate CDN Dependency Pattern**

ESM.sh CDN imports are acceptable for the initial migration, but should be **isolated to a single location** to allow future changes to bundling strategy. Recommendation:

```javascript
// deps.js - Single file for all CDN imports
export { Chart, registerables } from 'https://esm.sh/chart.js@4.4.2';
export { DataChunks } from 'https://esm.sh/@adobe/rum-distiller@1.20.8';
// ... other CDN imports

// Other files import from deps.js
import { Chart, DataChunks } from './deps.js';
```

**Benefits:**

- Single place to update versions
- Easy to swap CDN for local bundles later
- Clear dependency inventory
- Potential for SRI hash management

### 5.3 No Build Tools

- ✅ Pure ES6+ modules (no transpiling)
- ✅ No webpack/rollup/vite
- ✅ No npm build step
- ✅ Browser-native module loading

---

## 6. Browser Support Requirements

### 6.1 Required Browser Features


| Feature               | Minimum Support                       | Notes                    |
| ----------------------- | --------------------------------------- | -------------------------- |
| ES6 Modules           | ES2015+                               | `<script type="module">` |
| Custom Elements       | Chrome 54+, Safari 10.1+, Firefox 63+ | Web Components           |
| Shadow DOM            | Chrome 53+, Safari 10+, Firefox 63+   | Scoped styles            |
| Intersection Observer | Chrome 51+, Safari 12.1+, Firefox 55+ | Lazy loading             |
| LocalStorage          | All modern browsers                   | Token persistence        |
| matchMedia            | All modern browsers                   | Dark mode detection      |
| Promise/async-await   | ES2017+                               | Async operations         |
| Fetch API             | Chrome 42+, Safari 10.1+, Firefox 39+ | HTTP requests            |
| URL/URLSearchParams   | Chrome 49+, Safari 10.1+, Firefox 44+ | URL parsing              |
| Intl.DateTimeFormat   | ES2015+                               | Timezone detection       |
| Container Queries     | Chrome 105+, Safari 16+, Firefox 110+ | CSS layout (partial)     |

### 6.2 Polyfills

- ❌ **No polyfills included**
- ⚠️ Assumes modern browser environment
- ❌ **No IE11 support**

### 6.3 Browser-Specific Code

**Dark Mode Detection:**

```javascript
window.matchMedia('(prefers-color-scheme: dark)').matches
```

**Clipboard API:**

```javascript
navigator.clipboard.writeText(text)
```

**Intersection Observer:**

```javascript
new IntersectionObserver(callback, options)
```

### 6.4 Recommended Browser Matrix


| Browser | Minimum Version  | Notes                            |
| --------- | ------------------ | ---------------------------------- |
| Chrome  | 105+             | Full support (container queries) |
| Safari  | 16+              | Full support (container queries) |
| Firefox | 110+             | Full support (container queries) |
| Edge    | 105+             | Chromium-based, full support     |
| IE      | ❌ Not supported | No ES6 module support            |

---

## 7. Known Bugs & Intentional Quirks

### 7.1 TODO Comments (Incomplete Features)

#### High Priority

**Error/Success Toast Notifications** (`admin/orgs.js`):

- Line 119: `TODO: toast error` - Org creation errors not shown
- Line 221: `TODO: toast error` - Domain addition errors not shown
- Line 249: `TODO: toast error` - Domain removal errors not shown
- Line 278: `TODO: toast error` - Generic operation errors not shown
- Line 225: `TODO: toast success` - Org creation success not shown
- Line 253: `TODO: toast success` - Domain addition success not shown
- Line 282: `TODO: toast success` - Domain removal success not shown

**Impact:** Users experience silent failures/successes in admin operations

**Auth Error Handling** (`admin/orgs.js`):

- Line 153: `TODO: ask for token again` - No retry flow if token expires
- Line 157: `TODO: show error` - Auth failures not communicated

**Impact:** User confusion when authentication fails

#### Medium Priority

**Facet Filtering Logic** (`utils.js`, `slicer.js`):

- Line 3 (utils.js): `TODO: find a better way to filter out non-facet keys`
- Line 226 (slicer.js): `TODO: find a better way to filter out non-facet keys`

**Current Approach:** Hardcoded list matching
**Impact:** Adding new facet types requires code changes in multiple places

### 7.2 Intentional Quirks & Workarounds

#### Chart.js Fake Data Series

**Location:** `skyline.js` lines 154-157, 187-190, 220-223

```javascript
{
  label: 'Fake LCP Data',
  backgroundColor: 'transparent',
  data: [-2],
  yAxisID: 'lcp',
}
```

**Purpose:** Maintain chart axis spacing for multi-metric display
**Reason:** Chart.js doesn't natively support multiple Y-axes for stacked bars
**Impact:** None (transparent background, negative values outside visible range)

#### Date Adjustment Logic

**Location:** `daterange-picker.js` lines 344-348

```javascript
if (previousValue && value === 'custom' && previousValue !== 'custom') {
  const fromDate = new Date(dateFrom);
  fromDate.setDate(fromDate.getDate() + 1);
  dateFrom = toDateString(fromDate);
}
```

**Purpose:** Adds 1 day when transitioning from preset to custom range
**Reason:** Likely prevents overlap/double-counting edge case
**Impact:** Custom date range starts 1 day after preset end date

#### Chart Aspect Ratio Hack

**Location:** `skyline.js` line 646

```javascript
this.chart.options.scales.y.min = -Math.max(...allTraffic) * 0.71;
this.chart.options.scales.y.max = Math.max(...allTraffic) * 1.0;
```

**Purpose:** Vertically center chart with negative Y-axis scale
**Reason:** 0.71 multiplier achieves specific aspect ratio
**Impact:** None (works as intended but magic number undocumented)

#### Domain Key Fallback Probe

**Location:** `incognito-checkbox.js` lines 26-34

```javascript
const res = await fetch(url, {
  headers: { Authorization: `Bearer ${token}` }
});
if (!res.ok) {
  // Try public access
  const publicRes = await fetch(url.replace(/domainkey=[^&]+/, 'domainkey=open'));
  // ...
}
```

**Purpose:** Silently downgrade from private to public access if domain key fails
**Reason:** Graceful degradation for better UX
**Impact:** User may not realize they're viewing limited data

#### Media Path Truncation

**Location:** `slicer.js` lines 180-182

```javascript
if (cp === 'viewmedia' && mi) {
  acc.add(target.substring(mi + 1));
}
```

**Purpose:** Remove `https://domain/` prefix from media URLs
**Reason:** Keeps only relative `/media_*` path for cleaner display
**Impact:** Matches thumbnail-facet's media path handling

### 7.3 Validation & Sanitization

#### XSS Prevention

**Location:** `slicer.js` lines 369-371

```javascript
const sanitizedFilter = filterValue.replace(/[<>"']/g, '');
elems.filterInput.value = sanitizedFilter;
```

**Purpose:** Remove HTML characters from text filter
**Impact:** Silent sanitization (no user notification)

#### Date Validation

**Location:** `daterange-picker.js`

```javascript
if (new Date(from) > new Date(to)) {
  [from, to] = [to, from]; // Swap
}
```

**Purpose:** Automatic reordering if user enters end date before start
**Impact:** No user warning shown (silent correction)

#### Organization Name Validation

**Location:** `admin/orgs.js`

```javascript
if (!name || name.includes(' ')) {
  return; // Silent failure
}
```

**Purpose:** Reject empty names or names with spaces
**Impact:** No error message shown to user

---

## 8. Error Handling Patterns

### 8.1 Error Display Mechanisms

#### Silent Errors (No User Feedback)

1. **Network Failures** (`incognito-checkbox.js`):

   - Domain key fetch failures → silently downgrade to public access
   - No error message shown to user
   - User may not realize they're viewing limited data
2. **Validation Failures** (various files):

   - Invalid org names → silent rejection
   - Invalid date ranges → automatic correction
   - Invalid filter text → silent sanitization

#### Modal Dialogs (Limited Error Support)

**Location:** `admin/orgs.js`

```javascript
function createModal(title, message, onConfirm) {
  // Modal has no error state parameter
  // Cannot display error messages in modal context
}
```

**Issues:**

- No error state styling
- No error message display area
- Errors logged to console only

#### Console Logging (Developer-Only)

```javascript
console.log('Error:', error);
console.error('Failed to fetch:', error);
```

**Used Throughout:**

- API failures
- Authentication errors
- Data processing errors

**Impact:** Non-technical users cannot diagnose issues

### 8.2 Error Recovery Mechanisms

#### Graceful Degradation

1. **Domain Key Fallback:**

   - Private key fails → try public access
   - Public access fails → show empty state
2. **Favicon/Image Fallback:**

   - Thumbnail fails → show favicon
   - Favicon fails → show broken image icon
3. **Data Interpolation:**

   - Sparse data (<10 samples) → interpolate missing values
   - No data → show empty chart

#### Retry Logic

- ❌ **No automatic retry for failed requests**
- ❌ **No exponential backoff**
- ✅ Manual retry: user can refresh page or change filters

### 8.3 API Error Handling

**HTTP Status Checks:**

```javascript
if (!res.ok) {
  if (res.status === 401 || res.status === 403) {
    // Auth failure
  }
  throw new Error(`HTTP ${res.status}`);
}
```

**Error Scenarios:**

- 401/403 → Authentication failure (prompt for token)
- 404 → Domain/org not found (silent failure)
- 500 → Server error (logged to console)
- Network error → Silent failure or fallback

### 8.4 Validation Patterns

**Input Validation:**

- Org name: `if (!name || name.includes(' '))`
- Domain list: `.split(/[\s,]+/)` (whitespace/comma separated)
- Date range: automatic swap if start > end
- Filter text: XSS character removal
- Checkpoint: only known checkpoints included

**URL Validation:**

- Domain sanitization in `url-selector.js`
- URL parameter parsing with `URLSearchParams`
- No explicit URL format validation

---

## 9. Performance Characteristics

### 9.1 Page Load Strategy

**Initialization Phases:**

1. **Parse HTML** - Inline scripts execute immediately
2. **Load ES6 Modules** - Deferred execution
3. **Custom Elements Defined** - Web Components register
4. **Intersection Observer** - Delays initialization until section visible
5. **Data Fetch** - API requests triggered by user interaction

### 9.2 Data Loading Patterns

**Batch Requests:**

```javascript
const promises = dateRanges.map(range =>
  fetch(`/bundles/${domain}/${range}?domainkey=${key}`)
);
const results = await Promise.all(promises);
```

**Impact:** Multiple parallel requests for different time periods

**Debouncing:**

- Date picker: 500ms debounce on input changes
- Text filter: immediate (no debounce in current impl)

### 9.3 Rendering Optimization

**Lazy Initialization:**

```javascript
const observer = new IntersectionObserver(entries => {
  if (entries[0].isIntersecting) {
    initializeFacet();
    observer.disconnect();
  }
});
```

**Chart Rendering:**

- Canvas-based (Chart.js) → GPU-accelerated
- Responsive height: `calc(100vh - 450px)`
- Updates triggered by data changes only (no polling)

### 9.4 Memory Management

**No Explicit Cleanup:**

- ❌ No event listener cleanup
- ❌ No chart destroy on navigation
- ⚠️ Potential memory leaks on repeated use

**Data Caching:**

- ❌ No in-memory cache for API responses
- ❌ No localStorage cache for recent queries
- ✅ Browser HTTP cache headers respected

### 9.5 Network Optimization

**Parallel Requests:**

- ✅ Multiple bundle requests via `Promise.all()`
- ✅ Favicon/image requests load in parallel

**No Optimization:**

- ❌ No request batching beyond time ranges
- ❌ No response compression (handled by server)
- ❌ No service worker for offline support

---

## 10. File Structure & Code Organization

### 10.1 Directory Structure

```
tools/rum/
├── explorer.html              # Main entry point
├── loader.js                  # Module loader/orchestrator
├── slicer.js                  # Data processing & facet logic
├── utils.js                   # Utility functions
├── colors.css                 # Color scheme (light/dark mode)
├── rum-slicer.css            # Main stylesheet
├── website.svg                # Icon/logo
├── package.json               # Dependencies
├── package-lock.json          # Dependency lock
├── charts/
│   ├── chart.js               # Chart base class
│   └── skyline.js             # Skyline chart implementation
├── elements/                  # Web Components
│   ├── daterange-picker.js    # Date range selector
│   ├── facetsidebar.js        # Facet container
│   ├── file-facet.js          # File facet type
│   ├── incognito-checkbox.js  # Access control toggle
│   ├── link-facet.js          # URL facet type
│   ├── list-facet.js          # Checkbox facet type
│   ├── literal-facet.js       # Raw value facet type
│   ├── thumbnail-facet.js     # Image facet type
│   ├── url-selector.js        # Domain selector
│   └── vitals-facet.js        # CWV matrix facet
├── admin/                     # Admin interface
│   ├── orgs.html              # Organization management
│   ├── orgs.js                # Org management logic
│   ├── orgs.css               # Org admin styles
│   └── store.js               # State management
└── test/
    └── utils.test.js          # Unit tests
```

### 10.2 Code Architecture Patterns

**Web Components:**

- All UI elements extend `HTMLElement`
- Shadow DOM for style encapsulation
- Custom events for communication
- Self-contained with inline styles

**Module Pattern:**

```javascript
// loader.js - orchestrates initialization
import { initFacets } from './slicer.js';
import { setupUrlSelector } from './elements/url-selector.js';

// Each component is self-registering
customElements.define('rum-url-selector', URLSelectorElement);
```

**State Management:**

- URL parameters as single source of truth
- localStorage for authentication tokens
- No global state object
- Component-level state via properties

### 10.3 Naming Conventions

**Files:**

- Kebab-case: `daterange-picker.js`, `rum-slicer.css`
- Component name matches file: `url-selector.js` → `URLSelectorElement`

**Custom Elements:**

- Prefix: `rum-` (e.g., `<rum-facet-sidebar>`)
- Future: Should be `optel-` for rebranded version

**CSS:**

- BEM-like: `.facet__header`, `.facet__option`
- Component scoped: `.rum-url-selector .favicon`

**JavaScript:**

- camelCase: `fetchBundles`, `createModal`
- Constants: `UPPERCASE_SNAKE_CASE` (rare)

### 10.4 Testing Infrastructure

**Unit Tests:**

- Framework: None (vanilla JS with assertions)
- Location: `test/utils.test.js`
- Coverage: Minimal (only utils.js tested)

**No E2E Tests:**

- ❌ No Playwright/Puppeteer tests
- ❌ No integration tests
- ❌ No visual regression tests

---

## 11. Accessibility & UX Considerations

### 11.1 Keyboard Navigation

**Supported:**

- ✅ Tab navigation through form elements
- ✅ Enter key submits URL selector
- ✅ Checkbox selection via space bar
- ✅ Date picker keyboard input

**Not Supported:**

- ❌ No custom keyboard shortcuts
- ❌ No focus management for modals
- ❌ No arrow key navigation in facet lists

### 11.2 ARIA & Semantic HTML

**Limited Implementation:**

- ✅ Semantic HTML5 elements (`<section>`, `<header>`, `<dialog>`)
- ❌ No ARIA labels on custom components
- ❌ No ARIA live regions for dynamic updates
- ❌ No screen reader announcements

**Impact:** Tool may not be fully accessible to screen reader users

### 11.3 Color & Contrast

**Dark Mode:**

- ✅ Automatic detection via `prefers-color-scheme`
- ✅ Separate color palettes in `colors.css`
- ✅ High contrast for metric scores (good/ni/poor)

**Accessibility:**

- ⚠️ Color-coded metrics may not be distinguishable for colorblind users
- ⚠️ No WCAG 2.1 AA compliance verification

### 11.4 Mobile/Responsive UX

**Breakpoints:**

- 600px (mobile → tablet)
- 900px (tablet → desktop)
- 1200px (desktop → wide)

**Responsive Features:**

- ✅ Stacked layout on mobile
- ✅ Horizontal scroll for charts
- ✅ Touch-friendly checkbox sizes
- ❌ No mobile-specific navigation

### 11.5 Loading States

**Current Implementation:**

- ❌ No loading spinners
- ❌ No skeleton screens
- ❌ No progress indicators
- ⚠️ User may see blank screen during data fetch

**Recommendation:** Evaluate helix-tools-website loading patterns during migration

---

## 12. Security Considerations

### 12.1 Authentication & Authorization

**Token Storage:**

```javascript
localStorage.setItem('rum-bundler-token', token);
localStorage.setItem('rum-admin-token', token);
```

**Risks:**

- ⚠️ localStorage accessible to all scripts on domain
- ⚠️ XSS vulnerability could steal tokens
- ✅ HTTPS-only domain mitigates MITM attacks

**Best Practice:** Consider httpOnly cookies or secure token storage

### 12.2 Input Sanitization

**XSS Prevention:**

```javascript
// Filter text sanitization
const sanitized = filterValue.replace(/[<>"']/g, '');

// URL parameter parsing
const params = new URLSearchParams(window.location.search);
```

**DOM Manipulation:**

- ✅ No `innerHTML` with user input
- ✅ Uses `textContent` for user-provided strings
- ✅ DOM APIs for element creation

### 12.3 API Security

**CORS:**

- Assumes `bundles.aem.page` has appropriate CORS headers
- Bearer token sent in Authorization header

**Rate Limiting:**

- ❌ No client-side rate limiting
- ⚠️ Batch requests could trigger server-side limits

### 12.4 Third-Party Risks

**External Services:**

- Google Favicon API (HTTPS, no sensitive data)
- OpenGraph Image Proxy (HTTPS, trusted domain)
- esm.sh CDN (pinned versions, subresource integrity not used)

**Recommendation:** Add SRI hashes for CDN imports

---

## 13. Conversion & Advanced Features

### 13.1 Conversion Tracking

**URL Parameter Format:**

```
?conversion.{key}={value}
```

**Examples:**

- `?conversion.event=click`
- `?conversion.target=/checkout`

**Implementation:** Parsed in `slicer.js` as custom filter criteria

### 13.2 Statistical Significance

**Functions:** `utils.js`

```javascript
function zTestTwoProportions(p1, n1, p2, n2)
function tTest(mean1, stdDev1, n1, mean2, stdDev2, n2)
```

**Purpose:** Determine if facet differences are statistically significant

**Visual Indicator:**

- Border width increases for `interesting` (p < 0.1)
- Border width increases more for `significant` (p < 0.05)

### 13.3 Data Interpolation

**Sparse Data Handling:**

```javascript
if (weight < 10) {
  // Interpolate missing values
}
```

**Impact:** Smoother charts for low-traffic domains

### 13.4 Core Web Vitals Scoring

**Thresholds:**


| Metric | Good     | Needs Improvement | Poor    |
| -------- | ---------- | ------------------- | --------- |
| LCP    | ≤ 2.5s  | 2.5s - 4.0s       | > 4.0s  |
| CLS    | ≤ 0.1   | 0.1 - 0.25        | > 0.25  |
| INP    | ≤ 200ms | 200ms - 500ms     | > 500ms |

**Color Coding:**

- Green: `good`
- Orange: `ni` (needs improvement)
- Red: `poor`

---

## 14. Migration Considerations

### 14.1 helix-tools-website Conventions (RESOLVED)

Based on comprehensive scan of helix-tools-website repository, the following conventions MUST be followed:

**Standard Tool Structure:** (Look at Section 14.3 for the complete file structure)

```
tools/optel-explorer/
├── index.html                    # Entry point (NOT explorer.html)
├── optel-explorer.js            # Primary JavaScript (tool-name.js pattern)
├── optel-explorer.css           # Primary CSS (tool-name.css pattern)
├── loader.js                     # Supporting utilities (if needed)
├── slicer.js                     # Supporting utilities
├── utils.js                      # Supporting utilities
├── charts/
│   ├── chart.js
│   └── skyline.js
└── elements/                     # Keep as elements/ (not components/)
    ├── [rename rum- prefix to optel-]
```

**Key Decisions (RESOLVED):**

- ✅ `explorer.html` → `index.html` (confirmed by user)
- ✅ Keep `elements/` directory name (matches other tools like error-analyzer)
- ✅ Use `optel-explorer.js` and `optel-explorer.css` naming (follows convention)
- ✅ Admin tool - OUT OF SCOPE (see section 14.2)

### 14.2 Admin Tool - Out of Scope (RESOLVED)

**Decision:** Admin tool migration is **OUT OF SCOPE** for the initial Optel Explorer migration.

**What is "admin"?**
The RUM admin interface (`tools/rum/admin/`) provides organization management:

- Create/list organizations
- Display org API keys for shared access
- Add/remove domains from organizations
- Requires admin-level authentication (`rum-admin-token`)

**Why Out of Scope:**

1. **Separate user personas** - Admins (org management) vs. Analysts (data exploration)
2. **Different functionality** - Org/domain management is distinct from data analysis
3. **Follows helix-tools-website patterns** - 10 existing admin tools are separate (e.g., `index-admin`, `site-admin`, `user-admin`)
4. **Focus on core value** - Primary user-facing explorer tool delivers main value
5. **Validate necessity** - Admin functionality can be re-evaluated after main migration

**Future Migration (Phase 6):**
When admin tool is migrated, it will become a separate tool:

```
tools/optel-admin/           # Separate tool (NOT optel-explorer/admin/)
├── index.html
├── optel-admin.js
├── optel-admin.css
└── (admin functionality)
```

This will follow helix-tools-website conventions and use shared `/utils/config/config.js` for org/site selection.

**Files Not Being Migrated in This Phase:**

```
tools/rum/admin/
├── orgs.html               # ❌ Not migrated (Phase 6)
├── orgs.js                 # ❌ Not migrated (Phase 6)
├── orgs.css                # ❌ Not migrated (Phase 6)
└── store.js                # ❌ Not migrated (Phase 6)
```

See SPEC.md Phase 6 for future admin tool migration details.

### 14.3 File Reorganization (FINAL)

**Confirmed Structure:**

```
tools/optel-explorer/
├── index.html                    # ✅ Confirmed (was explorer.html)
├── optel-explorer.js             # Primary JavaScript (was loader.js entry point logic)
├── optel-explorer.css            # Primary CSS (was rum-slicer.css)
├── loader.js                     # Module loader
├── slicer.js                     # Data processing
├── utils.js                      # Utilities
├── website.svg                   # Icon/logo
├── package.json                  # Dependencies (@adobe/rum-distiller)
├── package-lock.json             # Dependency lock file
├── charts/
│   ├── chart.js                  # Base chart class
│   └── skyline.js                # Skyline chart
├── elements/                     # ✅ Keep as elements/
│   ├── daterange-picker.js       # Date range selector
│   ├── facetsidebar.js           # Facet container
│   ├── file-facet.js             # File facet type
│   ├── incognito-checkbox.js     # Access control toggle
│   ├── link-facet.js             # URL facet type
│   ├── list-facet.js             # Checkbox facet type
│   ├── literal-facet.js          # Raw value facet type
│   ├── thumbnail-facet.js        # Image facet type
│   ├── url-selector.js           # Domain selector
│   └── vitals-facet.js           # CWV matrix facet
└── test/
    └── utils.test.js             # Unit tests
```

**CSS Migration:**

- ❌ Don't migrate `colors.css` - adopt global `/styles/colors.css`. However if there is any CSS in colors.css that is not there in the global `/styles/colors.css` then ask the user what to do during implementation.
- ✅ Migrate `rum-slicer.css` → `optel-explorer.css` with rebrand
- ✅ Component styles stay in elements/ (scoped via Shadow DOM)

### 14.4 Branding Changes Required

**Custom Element Names:**

```javascript
// Before
customElements.define('rum-url-selector', URLSelectorElement);
customElements.define('rum-facet-sidebar', FacetSidebarElement);

// After
customElements.define('optel-url-selector', URLSelectorElement);
customElements.define('optel-facet-sidebar', FacetSidebarElement);
```

**User-Facing Strings:**

- "RUM" → "Optel" (throughout UI)
- "Real User Monitoring" → "Operational Telemetry"
- Page titles, meta descriptions, etc.

**Code Comments:**

```javascript
// Before: "Fetch RUM bundles from API"
// After: "Fetch Optel bundles from API"
```

**Variable Names:**

```javascript
// Before
const rumBundles = await fetchRumData();

// After
const optelBundles = await fetchOptelData();
```

**Telemetry Event Naming (OPEN ITEM):**

- Current: Uses "RUM" in event names
- **TODO: Finalize with stakeholders** - Keep as "RUM" for now with comment marking decision point
- User decision: Keep as RUM, add TODO for stakeholder confirmation

### 14.5 Design System Integration (RESOLVED)

Based on helix-tools-website scan, the following design system files are available:

**Global Styles to Adopt:**

```html
<!-- In index.html -->
<link rel="stylesheet" href="/styles/styles.css" />  <!-- Always include -->
<link rel="stylesheet" href="/utils/config/config.css" />  <!-- If admin tool -->
<link rel="stylesheet" href="./optel-explorer.css" />  <!-- Tool-specific -->
```

**Design Tokens Available:**

1. **Colors** (`/styles/colors.css`):

   - 16 color families with 1600 variants each
   - CSS variables: `--blue-900`, `--gray-25`, etc.
   - Transparent variants for overlays
   - **Action:** Remove RUM's `colors.css`, use global tokens
2. **Typography** (`/styles/typography.css`):

   - Font families: `robotoflex`, `robotomono`
   - Size scale: `--body-size-l`, etc.
   - Line height scale: `--line-height-m`, etc.
   - **Action:** Adopt global typography
3. **Spacing** (`/styles/styles.css` :root):

   - `--spacing-xs` through `--spacing-xxl`
   - **Action:** Use tokens instead of hardcoded px values
4. **Layout**:

   - Header height: `--header-height: 82px` (responsive)
   - Layers: `--layer-elevated`, `--layer-base`, etc.
   - Shadows: `--shadow-default`, `--shadow-hover`, etc.
   - **Action:** Use for modal overlays, dropdowns

**Responsive Breakpoints:**

- Standard: `@media (width >= 900px)`
- RUM uses: 600px, 900px, 1200px
- **Action:** Align to 900px standard, keep additional breakpoints if needed for data viz

**Shared Components Available:**


| Component     | Location                             | Usage                                    |
| --------------- | -------------------------------------- | ------------------------------------------ |
| Header/Footer | `/blocks/header/`, `/blocks/footer/` | Auto-decorated via`<header>`, `<footer>` |
| Form          | `/blocks/form/`                      | Form field styling                       |
| Modal         | `/blocks/modal/`                     | Dialog/modal patterns                    |
| Table         | `/blocks/table/`                     | Data table rendering                     |
| Console       | `/blocks/console/`                   | Output logging                           |

**Utility Functions** (`/utils/helpers.js`):

- `createTag(tag, attributes, html)` - Create DOM elements
- Animation utilities for reveal effects
- Link target determination

**Data Visualization Exception:**

- ✅ Keep custom chart styles (Skyline chart is data viz exception per SPEC)
- ✅ Keep facet-specific styling (data presentation exception)
- ✅ Keep Core Web Vitals color coding (good/ni/poor)
- ⚠️ Adopt global colors for chrome/navigation/forms

**⚠️ Caveat: Spectrum Styles Consideration**

The current RUM Explorer implementation uses Adobe Spectrum design system styles for UI components. While the primary plan is to adopt the helix-tools-website style system (`/styles/styles.css`, design tokens, etc.), we may want to evaluate using Spectrum styles (or their equivalents) for the migrated Optel Explorer. This consideration applies particularly to:

- Form controls (inputs, checkboxes, buttons)
- Dropdown/select components
- Modal dialogs
- Toast notifications
- Loading indicators

**Rationale:** Maintaining visual consistency with other Adobe tools and dashboards may provide a more cohesive user experience for internal users. This decision should be evaluated during Phase 3 implementation based on:

1. Availability of Spectrum-compatible CSS in helix-tools-website
2. Consistency requirements with other Optel/admin tools
3. Effort required to adapt vs. adopt new patterns

**Integration Pattern:**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; ..." nonce="aem" move-to-http-header="true">
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Optel Explorer</title>
  <meta name="description" content="Optel data exploration and analysis">

  <!-- Global scripts & styles -->
  <script nonce="aem" src="/scripts/aem.js" type="module"></script>
  <script nonce="aem" src="/scripts/scripts.js" type="module"></script>
  <link rel="stylesheet" href="/styles/styles.css" />

  <!-- Tool-specific -->
  <script nonce="aem" src="./optel-explorer.js" type="module" defer></script>
  <link rel="stylesheet" href="./optel-explorer.css" />
</head>
<body class="optel-explorer">
  <header></header>  <!-- Auto-decorated -->
  <main>
    <!-- Tool content -->
  </main>
  <footer></footer>  <!-- Auto-decorated -->
</body>
</html>
```

### 14.6 API Endpoint Decisions

**Current Hardcoded Endpoints:**

```javascript
const BASE_URL = 'https://bundles.aem.page';
```

**Options:**

1. Keep hardcoded (simplest, works across envs)
2. Environment config (requires build/env management)
3. Relative to host (breaks local dev without proxy)

**Recommendation:** Discuss each endpoint individually as specified in SPEC

### 14.4 Design System Integration

**Current Styles:**

- Custom color scheme (`colors.css`)
- Custom layout (`rum-slicer.css`)
- Shadow DOM scoped styles (in components)

**helix-tools-website Adoption:**

- Adopt global chrome/navigation
- Adopt global typography
- Adopt global color scheme (unless data viz exception)
- Keep custom chart styles (data visualization exception)

**Questions:**

- What is helix-tools-website global design system?
- Are there existing facet/filter components to reuse?
- Loading state patterns to adopt?

### 14.5 Testing Strategy

**Current Coverage:**

- ❌ Minimal unit tests
- ❌ No E2E tests
- ❌ No integration tests

**Recommended Additions:**

1. **Unit Tests:**

   - Statistical functions (zTest, tTest)
   - Data processing (slicer.js facet logic)
   - URL parameter parsing
   - Date range calculations
2. **E2E Tests (Playwright/Puppeteer):**

   - Domain selection flow
   - Date range selection flow
   - Facet filtering flow
   - Export to clipboard flow
   - Admin org management flow
3. **Integration Tests:**

   - API endpoint mocking
   - Authentication flow
   - Error handling scenarios

### 14.6 Open Items from SPEC

**To Decide During Implementation:**

1. **Telemetry Event Naming:**

   - Current: Uses "RUM" in event names
   - Question: Switch to "Optel" or preserve for backwards compatibility?
2. **Loading State Patterns:**

   - Current: No loading states
   - Question: Adopt helix-tools-website patterns or preserve current UX?
3. **Chart Library Alignment:**

   - Current: Chart.js 4.4.2
   - Question: Align version with other tools or keep pinned?
4. **Browser Support Matrix:**

   - Current: Modern browsers only (no IE11)
   - Confirm: Is this acceptable for target audience?
5. **Embed Mode Requirements:**

   - Current: No embed mode
   - Question: Should we add `hideNav`, `embedded` params?

---

## 15. Feature Parity Checklist

This checklist will be used during Phase 4 (Validation) to verify 100% feature parity.

### 15.1 Core Functionality

- [ ] Domain selection with autocomplete
- [ ] Favicon display
- [ ] Organization-scoped domains (`:all` suffix)
- [ ] Incognito mode toggle (3 access levels)
- [ ] Date range presets (Week, Month, Year)
- [ ] Custom date range selection
- [ ] Text-based filtering
- [ ] URL state persistence
- [ ] Deep linking support

### 15.2 Metrics Display

- [ ] Page Views (with per-visit average)
- [ ] Visits (with bounce rate %)
- [ ] Engagement/Conversions (with conversion rate %)
- [ ] LCP (75th percentile, color-coded)
- [ ] CLS (75th percentile, color-coded)
- [ ] INP (75th percentile, color-coded)
- [ ] TTFB (with `metrics=all` param)

### 15.3 Facet Types

- [ ] List Facet (with counts, metrics, significance)
- [ ] Link Facet (with thumbnails, favicon fallback)
- [ ] Thumbnail Facet (with image proxy)
- [ ] Literal Facet
- [ ] File Facet
- [ ] Vitals Facet (3x3 matrix)

### 15.4 Facet Categories

- [ ] `type` - Host Type
- [ ] `userAgent` - Device Type/OS
- [ ] `url` - Page URL
- [ ] `checkpoint` - Event checkpoints (10 types)
- [ ] `click.source` - Click source
- [ ] `click.target` - Click target
- [ ] `viewmedia.source` - Media source
- [ ] `viewmedia.target` - Media file
- [ ] `viewblock.source` - Block selector
- [ ] `enter.source` - External referrer
- [ ] `navigate.source` - Internal referrer
- [ ] `consent.source` - Consent provider
- [ ] `consent.target` - Consent state
- [ ] `paid.source` - Ad network
- [ ] `paid.target` - Click tracking
- [ ] `error.source` - Error source
- [ ] `error.target` - Error line
- [ ] `loadresource.histogram` - Load time
- [ ] `loadresource.source` - Resource loaded
- [ ] `missingresource.source` - Missing resource
- [ ] `cwv-lcp.source` - LCP element
- [ ] `cwv-lcp.target` - LCP preview

### 15.5 Charts

- [ ] Skyline chart displays
- [ ] Time granularities (hourly, daily, weekly, monthly)
- [ ] CWV distribution (Good/NI/Poor stacks)
- [ ] Page Views series
- [ ] Sparse data interpolation
- [ ] Dark mode support
- [ ] Hover tooltips
- [ ] Responsive height

### 15.6 Data Export

- [ ] TSV to clipboard
- [ ] Toast notification on copy
- [ ] Includes metrics (count, LCP, CLS, INP)

### 15.7 UX Features

- [ ] Dark mode auto-detection
- [ ] Responsive layout (3 breakpoints)
- [ ] Debounced inputs
- [ ] Animated icons
- [ ] Intersection Observer lazy loading
- [ ] Browser history integration

### 15.8 Advanced Features

- [ ] Statistical significance testing
- [ ] CWV scoring/color-coding
- [ ] Conversion tracking
- [ ] Multi-value URL parameters
- [ ] Timezone detection/display

### 15.9 Error Handling

- [ ] Domain key fallback to public access
- [ ] Favicon/image fallback
- [ ] Date range auto-correction
- [ ] XSS sanitization
- [ ] Console error logging

### 15.10 Quirks to Preserve

- [ ] Fake data series in charts (for axis spacing)
- [ ] Date +1 day adjustment (preset→custom)
- [ ] Chart aspect ratio (0.71 multiplier)
- [ ] Media path truncation
- [ ] Silent sanitization

### 15.11 Incomplete Features (Preserve TODO Comments)

- [ ] TODO: Toast error/success notifications (7 locations)
- [ ] TODO: Token retry flow
- [ ] TODO: Better facet filtering logic

### 15.12 Out of Scope (Admin Features - Phase 6)

The following admin features are **NOT** part of this migration:

- ❌ Organization listing
- ❌ Create organization
- ❌ Display org key
- ❌ List org domains
- ❌ Add domains to org
- ❌ Remove domains from org
- ❌ Admin modal dialogs
- ❌ Admin authentication flows

These will be migrated in Phase 6 as a separate `optel-admin` tool.

---

## 16. Risk Assessment

### 16.1 High Risk Items

**Incomplete Error Handling:**

- Admin operations have silent failures
- Users may not know if actions succeeded
- Mitigation: Implement toast notifications during migration

**No Automated Testing:**

- No E2E test coverage for critical flows
- Regression risk during migration
- Mitigation: Create comprehensive test suite in Phase 2

**localStorage State (Cross-Domain Migration):**

- helix-website (`www.aem.live`) and helix-tools-website are **different origins**
- localStorage is origin-scoped - users' `rum-bundler-token` will NOT transfer automatically
- Users will need to re-enter their bundler token on the new domain
- No technical migration path for saved settings (browser security prevents cross-origin localStorage access)
- Mitigation: Document in user communication (per SPEC), provide clear instructions for token re-entry

### 16.2 Medium Risk Items

**Browser Support:**

- Container queries require very modern browsers
- No polyfills for older browsers
- Mitigation: Verify browser matrix with stakeholders

**API Endpoint Changes:**

- Hardcoded `bundles.aem.page` may need updates
- No environment-based configuration
- Mitigation: Discuss each endpoint individually (per SPEC)

**Chart Library Version:**

- Pinned to specific version (4.4.2)
- May diverge from other tools over time
- Mitigation: Discuss alignment opportunities (per SPEC)

### 16.3 Low Risk Items

**Dark Mode:**

- Auto-detection works well
- No user toggle needed
- Risk: None

**URL Parameters:**

- Well-documented, comprehensive
- Deep linking works correctly
- Risk: None

**Web Components:**

- Self-contained, reusable
- Shadow DOM prevents style conflicts
- Risk: Minimal

---

## 17. Next Steps (Phase 2)

### 17.1 Test Case Development

Create separate test plan document covering:

1. **Unit Test Scenarios:**

   - Statistical functions (zTest, tTest)
   - Data processing (facet logic)
   - URL parameter parsing
   - Date calculations
   - Validation/sanitization
2. **Integration Test Scenarios:**

   - API authentication flow
   - Bundle data fetching
   - Error handling
   - Domain key fallback
3. **E2E Test Scenarios:**

   - Complete user workflows
   - Domain selection → date range → filtering → export
   - Admin org management flows
   - Cross-browser testing matrix
4. **Edge Case Testing:**

   - Sparse data interpolation
   - Empty states
   - Invalid inputs
   - Network failures
   - Token expiration

### 17.2 Design System Audit

Before Phase 3 implementation:

1. Review helix-tools-website design system
2. Identify reusable components
3. Document style adoption plan
4. Identify data visualization exceptions
5. Plan loading state implementation

### 17.3 Stakeholder Questions

**Open Items from Analysis:**

1. Should `explorer.html` become `index.html`?
2. Should admin be separate tool or integrated?
3. What are helix-tools-website's existing facet/filter components?
4. What loading state patterns should we adopt?
5. Should we add embed mode parameters?
6. What is the telemetry event naming strategy?
7. Confirm browser support matrix (container queries requirement)

---

## Appendix A: File Manifest

### Files Being Migrated (16 files)

```
tools/rum/
├── explorer.html              # Main entry point (267 lines) → index.html
├── loader.js                  # Module loader (124 lines)
├── slicer.js                  # Data processing (486 lines)
├── utils.js                   # Utilities (108 lines)
├── colors.css                 # Color scheme (59 lines) → ❌ REPLACED by global colors
├── rum-slicer.css             # Main styles (376 lines) → optel-slicer.css
├── website.svg                # Icon
├── package.json               # Dependencies (15 lines)
├── package-lock.json          # Lock file
├── charts/
│   ├── chart.js               # Base class (96 lines)
│   └── skyline.js             # Skyline chart (712 lines)
├── elements/
│   ├── daterange-picker.js    # Date range (397 lines)
│   ├── facetsidebar.js        # Facet container (84 lines)
│   ├── file-facet.js          # File facet (67 lines)
│   ├── incognito-checkbox.js  # Access toggle (112 lines)
│   ├── link-facet.js          # URL facet (154 lines)
│   ├── list-facet.js          # List facet (289 lines)
│   ├── literal-facet.js       # Literal facet (58 lines)
│   ├── thumbnail-facet.js     # Image facet (89 lines)
│   ├── url-selector.js        # Domain selector (163 lines)
│   └── vitals-facet.js        # CWV facet (147 lines)
└── test/
    └── utils.test.js          # Unit tests (34 lines)
```

### Files NOT Being Migrated (Phase 6 - Future)

```
tools/rum/admin/               # ❌ OUT OF SCOPE for this migration
├── orgs.html                  # Admin UI (159 lines)
├── orgs.js                    # Admin logic (306 lines)
├── orgs.css                   # Admin styles (134 lines)
└── store.js                   # State mgmt (45 lines)
```

**Total Lines Being Migrated:** ~3,400 lines (excluding package-lock.json and admin files)
**Total Lines Deferred:** ~650 lines (admin files - Phase 6)

---

## Appendix B: API Request Examples

### Example 1: Fetch Monthly Bundle Data

```javascript
// Request
GET https://bundles.aem.page/bundles/www.aem.live/2024/01?domainkey=abc123
Headers: {
  Authorization: 'Bearer <token>'
}

// Response
{
  "rumBundles": [
    {
      "timeSlot": "2024-01-15T14:30:00.000Z",
      "weight": 1,
      "url": "https://www.aem.live/developer/tutorial",
      "hostType": "content",
      "events": [
        {
          "checkpoint": "enter",
          "source": "https://www.google.com",
          "target": "https://www.aem.live/developer/tutorial",
          "timeDelta": 0
        },
        {
          "checkpoint": "viewblock",
          "source": ".hero",
          "target": "",
          "timeDelta": 245
        },
        {
          "checkpoint": "click",
          "source": ".cta-button",
          "target": "/developer/setup",
          "timeDelta": 5420
        }
      ],
      "cwvLCP": 1.234,
      "cwvCLS": 0.001,
      "cwvINP": 0.098
    }
  ]
}
```

### Example 2: Fetch Domain List

```javascript
// Request
GET https://bundles.aem.page/domains?suggested=true
Headers: {
  Authorization: 'Bearer <token>'
}

// Response
{
  "domains": [
    "www.aem.live",
    "www.hlx.live",
    "adobe:all"
  ]
}
```

### Example 3: Create Organization

```javascript
// Request
POST https://bundles.aem.page/orgs
Headers: {
  Authorization: 'Bearer <token>',
  Content-Type: 'application/json'
}
Body: {
  "name": "my-org-name"
}

// Response
{
  "id": "org-abc123",
  "name": "my-org-name",
  "key": "generated-org-key-xyz"
}
```

---

## Appendix C: URL Parameter Examples

### Example URL Breakdowns

**1. Basic Month View**

```
/tools/rum/explorer.html?domain=www.aem.live&view=month

Parameters:
- domain: www.aem.live
- view: month
```

**2. Custom Date Range with Filters**

```
/tools/rum/explorer.html?domain=www.aem.live&view=custom&startDate=2024-01-01&endDate=2024-01-31&checkpoint=click&checkpoint=error&userAgent=mobile

Parameters:
- domain: www.aem.live
- view: custom
- startDate: 2024-01-01
- endDate: 2024-01-31
- checkpoint: ['click', 'error']
- userAgent: mobile
```

**3. Organization Scoped with All Metrics**

```
/tools/rum/explorer.html?domain=adobe:all&view=year&metrics=all&filter=checkout+error

Parameters:
- domain: adobe:all (all domains in adobe org)
- view: year
- metrics: all (show TTFB)
- filter: 'checkout error' (full-text search)
```

**4. Incognito Mode**

```
/tools/rum/explorer.html?domain=www.aem.live&domainkey=incognito

Parameters:
- domain: www.aem.live
- domainkey: incognito (use private access key)
```

---

## Appendix D: Component API Reference

### Custom Events

**`facetchange`**

```javascript
// Fired when facet selection changes
event.detail = {
  facet: 'userAgent',
  values: ['mobile', 'desktop'],
  action: 'add' | 'remove'
};
```

**`urlstatechange`**

```javascript
// Fired when URL parameters update
event.detail = {
  domain: 'www.aem.live',
  view: 'month',
  filters: {...}
};
```

### Custom Element Properties

**`<rum-url-selector>`**

```javascript
element.domain = 'www.aem.live';  // Get/set current domain
element.domains = ['...'];         // Get/set autocomplete list
```

**`<rum-daterange-picker>`**

```javascript
element.view = 'week' | 'month' | 'year' | 'custom';
element.startDate = '2024-01-01';
element.endDate = '2024-01-31';
```

**`<rum-incognito-checkbox>`**

```javascript
element.checked = true | false;
element.domainKey = 'abc123';
element.accessMode = 'open' | 'incognito' | 'provided';
```

---

## Appendix E: Phase 1 Decisions Summary

This appendix summarizes all key decisions made during Phase 1 analysis.

### Resolved Decisions


| Decision                  | Resolution                                                       | Source                          |
| --------------------------- | ------------------------------------------------------------------ | --------------------------------- |
| **File Structure**        | `explorer.html` → `index.html`                                  | User confirmation               |
| **Primary JS/CSS naming** | `optel-explorer.js`, `optel-explorer.css`                        | helix-tools-website convention  |
| **Component directory**   | Keep as`elements/` (not `components/`)                           | helix-tools-website convention  |
| **Custom element prefix** | `optel-` (was `rum-`)                                            | Branding requirement            |
| **Global styles**         | Adopt`/styles/styles.css`                                        | helix-tools-website convention  |
| **Color system**          | Use global`/styles/colors.css` tokens, remove RUM's `colors.css` | helix-tools-website convention  |
| **Design tokens**         | Use spacing, typography, shadow variables                        | helix-tools-website convention  |
| **Header/Footer**         | Auto-decorated blocks via`<header>`, `<footer>`                  | helix-tools-website convention  |
| **CSP nonces**            | Use`nonce="aem"` on all script tags                              | helix-tools-website convention  |
| **Body class**            | `class="optel-explorer"` for CSS scoping                         | helix-tools-website convention  |
| **Data viz exception**    | Keep custom chart styles (Skyline chart)                         | SPEC design system exception    |
| **CWV color coding**      | Keep good/ni/poor colors (data viz exception)                    | SPEC design system exception    |
| **Responsive breakpoint** | Primary: 900px (keep 600px/1200px if needed for data viz)        | helix-tools-website convention  |
| **Admin tool**            | OUT OF SCOPE (Phase 6 - future migration)                        | User confirmation + SPEC update |

### Open Decisions (Require Stakeholder Input)


| Decision                    | Options                                                                                  | Recommendation                       | Status           |
| ----------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------- | ------------------ |
| **Telemetry event naming**  | A) Rename to "Optel"<br>B) Keep as "RUM"                                                 | Keep as RUM with TODO                | Add TODO in code |
| **API endpoints**           | Discuss each individually per SPEC                                                       | -                                    | Phase 3          |
| **Chart.js version**        | Align with other tools or keep 4.4.2                                                     | Discuss during implementation        | Phase 3          |
| **Loading state patterns**  | Adopt helix-tools-website patterns or preserve current (none)                            | Evaluate during implementation       | Phase 3          |
| **Browser support matrix**  | Confirm container queries requirement                                                    | Verify with stakeholders             | Phase 2          |
| **Spectrum styles**         | A) Use helix-tools-website styles<br>B) Use Spectrum styles (or equivalents)             | Evaluate during Phase 3              | Phase 3          |
| **localStorage key naming** | A) Keep`rum-bundler-token` (backwards compat)<br>B) Rename to `optel-bundler-token`      | Keep as`rum-` for now                | Phase 3          |
| **OG image proxy endpoint** | A) Keep pointing to helix-website<br>B) Move to helix-tools-website<br>C) Shared service | Discuss during implementation        | Phase 3          |
| **Labs link to oversight**  | A) Update to absolute URL<br>B) Remove link<br>C) Migrate oversight too                  | Discuss - oversight is separate tool | Phase 3          |

### Migration Action Items

**Immediate (Phase 2):**

- [ ] Create test plan document
- [ ] Verify browser support requirements with stakeholders

**Phase 3 Implementation:**

- [ ] Set up `tools/optel-explorer/` directory structure
- [ ] Create `index.html` with helix-tools-website template
- [ ] Migrate and rebrand all JavaScript files (explorer only, NOT admin files)
- [ ] Adopt global design tokens in CSS
- [ ] Rename custom elements from `rum-*` to `optel-*`
- [ ] Update all user-facing strings from "RUM" to "Optel"
- [ ] Add TODO comments for telemetry event naming decision
- [ ] Implement/complete missing toast notifications (7 TODOs)

**Phase 6 (Future - Admin Tool):**

- [ ] Plan admin tool migration separately
- [ ] Create `tools/optel-admin/` (separate from optel-explorer)
- [ ] Migrate admin files with rebrand
- [ ] Adopt `/utils/config/config.js` pattern
- [ ] Validate admin functionality still needed

**Phase 4 Validation:**

- [ ] Execute comprehensive test suite (from Phase 2 plan)
- [ ] Verify all items in Feature Parity Checklist (Section 15)
- [ ] Manual QA with live domainKey(s)
- [ ] Cross-browser testing
- [ ] Performance validation
- [ ] Stakeholder sign-off

### Key Risks & Mitigations


| Risk                          | Impact                             | Mitigation                                     |
| ------------------------------- | ------------------------------------ | ------------------------------------------------ |
| **Incomplete error handling** | User confusion on failures         | Implement all 7 TODO toast notifications       |
| **No automated tests**        | Regression during migration        | Create comprehensive test suite in Phase 2     |
| **localStorage state loss**   | Users lose preferences             | Document in user communication (per SPEC)      |
| **Container queries support** | May not work in older browsers     | Verify browser matrix, add fallbacks if needed |
| **API endpoint changes**      | Breaking changes if endpoints move | Discuss each endpoint individually (per SPEC)  |

### Reference Documentation

**helix-tools-website Patterns:**

- Standard tool structure: `tools/{tool-name}/index.html`, `{tool-name}.js`, `{tool-name}.css`
- Global styles: `/styles/styles.css` (always include)
- Shared utilities: `/utils/helpers.js`, `/utils/config/config.js`
- Shared blocks: 24 blocks in `/blocks/` directory
- Admin pattern: Separate tools using `config.js` for org/site selection

**RUM Tool Statistics (Explorer Only):**

- ~3,400 lines of code (16 files being migrated)
- ~650 lines of code (4 admin files deferred to Phase 6)
- 7 custom web components
- 15+ unique facet types
- 10+ API endpoints
- 1 production dependency (@adobe/rum-distiller)
- Chart.js 4.4.2 + chartjs-adapter-luxon 1.3.1

**Scope Clarification:**

- ✅ In Scope: Main explorer tool (data analysis interface)
- ❌ Out of Scope: Admin tool (organization management) - Phase 6

---

**End of Phase 1 Analysis**
