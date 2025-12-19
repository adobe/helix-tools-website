# JSON2HTML Playground - Development Plan

## Need
Build a "Playground" similar to CodePen.io for the JSON2HTML feature in Edge Delivery Services.

**Reference:** https://www.aem.live/developer/json2html

---

## Progress Update (December 19, 2024)

### ✅ Phase 1: Mock UI - COMPLETE

**Completed:**
- Created `index.html` with full HTML structure
- Created `json2html-playground.css` with responsive styling
- Created `json2html-playground.js` with basic interactions
- Fixed multiple AEM decoration conflicts (wrapper divs, `<p>` tag injection)
- **Three-panel layout**: JSON (left) + Template (right) + Preview (bottom)
- Both editors visible simultaneously for easy editing
- Vertical resizer between JSON and Template panels
- Horizontal resizer between editors row and preview panel
- Panels fill full width of workspace
- Examples modal structure in place
- Syntax Help modal structure in place
- Share button placeholder ready
- Auto-render checkbox functional
- Responsive layout tested

**UI Fixed Issues (Latest Session):**
- Fixed 404 errors from AEM block decoration by using `<span>` elements instead of nested `<div>`s
- Fixed header alignment: Title on LEFT, action buttons (Examples, Syntax Help, Share) on RIGHT
- Fixed control-bar alignment: Auto-render, Render, Fullscreen buttons aligned RIGHT
- Added CSS rules for `.default-content-wrapper` that AEM injects
- 70/30 split between editors (top) and preview (bottom)
- Fullscreen button moved next to Render button

**Current State:**
- Mock UI is ready for demo/review ✅
- Layout matches reference design at https://json2html-playground--helix-tools-website--adobe.aem.live/
- Preview shows static HTML (Mustache tags visible as text - expected, Phase 2 fix)
- No rendering via /simulator endpoint yet (Phase 2)
- Examples load sample JSON but don't render (Phase 2)

### 🔜 Next Steps (Phase 2)

1. **Integrate /simulator endpoint**
   - Call `POST https://json2html.aem-cf-workers.workers.dev/simulator`
   - Send URL-encoded JSON and template
   - Receive rendered HTML response

2. **Implement server-side rendering flow**
   - Encode JSON input (URL encoding)
   - Encode template input (URL encoding)
   - POST to /simulator endpoint
   - Update iframe `srcdoc` with response HTML

3. **Add error handling**
   - Handle network errors (timeout, offline)
   - Parse error responses from /simulator
   - JSON parse errors with line numbers
   - Template syntax errors
   - Display errors in status bar

4. **Implement View Source toggle**
   - Show rendered HTML vs raw source
   - Syntax highlight the source view (Prism.js)

5. **Add debounced auto-render**
   - 300-500ms debounce on input changes
   - Visual indicator while rendering (loading spinner)
   - Cancel pending requests on new input

---

## Agreed Decisions ✅

### Layout
- **Three-Panel Layout** (CodePen-style)
- Desktop: JSON (left) + Template (right) on top, HTML Preview below
- Resizable panels: vertical divider between editors, horizontal divider for preview
- Tablet/Mobile: Stacked layout

### Code Editor
- **MVP:** Plain textarea + Prism.js overlay (already in project)
- **V1.1:** Consider CodeMirror 6 upgrade

### Rendering
- **Server-side** using `/simulator` endpoint (ensures consistency with production behavior)
- Endpoint: `POST https://json2html.aem-cf-workers.workers.dev/simulator`
- Debounced requests to avoid hammering the server

### Features for MVP
- [x] JSON input with Prism.js highlighting
- [x] Template input with Prism.js highlighting  
- [x] Live preview in iframe (using `srcdoc`)
- [x] View Source toggle (Rendered vs HTML source)
- [x] Mustache syntax reference panel
- [x] Error display for invalid JSON/template
- [x] 3-5 example templates
- [x] Responsive layout
- [x] Debounced auto-render (300ms)

### URL Sharing
- Use **LZString compression** for moderate payloads
- Fallback: Limit to example permalinks

### Security
- iframe with `sandbox="allow-scripts"` + `srcdoc`
- No eval(), proper input sanitization

---

## Implementation Phases

### Phase 1: Mock UI ✅ COMPLETE
- [x] Build HTML structure
- [x] Add CSS styling
- [x] Basic JS for tab switching and layout
- [x] Fix AEM decoration conflicts
- [x] Responsive layout
- [x] No actual rendering yet (expected)

### Phase 2: Core Functionality (NEXT)
- Integrate /simulator endpoint for rendering
- Implement live preview via server-side rendering
- Add error handling (network + parse errors)
- JSON validation before sending
- Debounced auto-render with loading indicator

### Phase 3: Polish
- Add 5-7 examples
- Mustache syntax help modal
- Copy HTML button
- URL sharing with LZString
- Responsive refinements

---

## Future Enhancements (V2+)

- [ ] **Client-side Mustache.js rendering** (offline mode, faster feedback)
- [ ] CSS injection pane (3rd editor)
- [ ] JSON Schema validation
- [ ] Diff view for template changes
- [ ] Console output panel
- [ ] Permalink to specific examples (`#example=product-card`)
- [ ] Download HTML feature
- [ ] Dark mode
- [ ] Keyboard shortcuts
- [ ] Save to browser localStorage
- [ ] CodeMirror 6 upgrade
- [x] ~~relativeURLPrefix testing~~ → Moved to /simulator enhancements
- [ ] Schema-based template testing (requires site auth - out of scope for playground)

---

## /simulator Endpoint (Core Dependency)

The playground relies on the `/simulator` endpoint in the `helix-json2html` backend.

### Endpoint Details
- **URL:** `POST https://json2html.aem-cf-workers.workers.dev/simulator`
- **Request Body:**
  ```json
  {
    "json": "<URL-encoded JSON string>",
    "template": "<URL-encoded Mustache template>"
  }
  ```
- **Response:** Rendered HTML string

### Backend Enhancements Needed (helix-json2html)

The current `/simulator` endpoint is minimal - it only does `Mustache.render(template, data)`. 
To make the playground truly useful for testing production-like behavior, enhance the endpoint
with features that **don't require authentication** to a specific org/site.

#### Current State (`simulator.js`)
```javascript
// Current: Just basic Mustache rendering
const htmlResponse = Mustache.render(decodedTemplate, decodedJson);
```

#### Enhanced Request Body
```json
{
  "json": "<URL-encoded JSON string>",
  "template": "<URL-encoded Mustache template>",
  "options": {
    "relativeURLPrefix": "https://example.com",
    "genericFallback": false
  }
}
```

#### Enhancements to Implement

| Feature | Description | Implementation |
|---------|-------------|----------------|
| **Structured Error Responses** | Return detailed errors instead of generic 500 | See error format below |
| **relativeURLPrefix** | Rewrite relative media URLs with a prefix | Reuse `rewriteRelativeUrls()` from utils.js |
| **Generic HTML Fallback** | Generate semantic HTML when template is empty | Reuse `jsonToHtmlDivs()` from utils.js |
| **HTML Entity Encoding** | Proper encoding of special characters | Already uses `html-entities` package |

#### 1. Structured Error Responses

Return JSON errors with helpful debugging info:

```json
{
  "error": true,
  "type": "json_parse_error | template_render_error | validation_error",
  "message": "Unexpected token at position 42",
  "details": {
    "line": 3,
    "column": 15,
    "snippet": "{ \"name\": John }"
  }
}
```

**Error Types:**
- `json_parse_error` - Invalid JSON input (with position info)
- `template_render_error` - Mustache rendering failed (missing variable, etc.)
- `validation_error` - Missing required fields

#### 2. relativeURLPrefix Support

Test how relative media URLs get rewritten in production:

```javascript
// In simulator.js - reuse existing utility
import { rewriteRelativeUrls } from './utils/utils.js';

if (options.relativeURLPrefix) {
  htmlResponse = await rewriteRelativeUrls(
    htmlResponse,
    options.relativeURLPrefix,
    false,  // useAEMMapping = false (requires site auth)
    null, null, null, null  // org, site, branch, apiKey not needed
  );
}
```

**What it does:**
- Rewrites `src="/media/image.jpg"` → `src="https://example.com/media/image.jpg"`
- Only affects media extensions: `.mp4`, `.pdf`, `.svg`, `.jpg`, `.jpeg`, `.png`, `.gif`, `.webp`, `.avif`
- Decodes HTML entities (`&#x2F;` → `/`, `&quot;` → `"`, `&amp;` → `&`)

#### 3. Generic HTML Fallback Mode

When `template` is empty and `genericFallback: true`, generate semantic HTML:

```javascript
import { jsonToHtmlDivs } from './utils/utils.js';

if (!template && options.genericFallback) {
  htmlResponse = `
    <!DOCTYPE html>
    <html>
      <head>${data.title ? `<title>${data.title}</title>` : ''}</head>
      <body>
        <main>
          <div class="data">${jsonToHtmlDivs(data)}</div>
        </main>
      </body>
    </html>
  `;
}
```

**Use case:** Preview what the generic fallback looks like without writing a template.

#### 4. Enhanced Response Headers

Add helpful headers for debugging:

```
X-Render-Mode: mustache | generic-fallback
X-Render-Time-Ms: 12
Content-Type: text/html;charset=UTF-8
```

---

### Features NOT Included (Require Site Authentication)

These production features require access to a specific org/site and are **out of scope** for the playground:

| Feature | Why Excluded |
|---------|--------------|
| **AEM Path Mappings** | Requires fetching `config.json` from authenticated site |
| **Schema-Based Templates** | Requires fetching templates from authenticated site |
| **Head.html Injection** | Requires fetching `head.html` from authenticated site |
| **Endpoint Data Fetching** | Requires site config from KV store |
| **Header Forwarding** | Site-specific configuration |

These features should be tested using the actual json2html production endpoint with proper authentication.

---

### Example Enhanced Simulator Implementation

```javascript
// simulator.js - Enhanced version
import Mustache from 'mustache';
import { rewriteRelativeUrls, jsonToHtmlDivs } from './utils/utils.js';

export async function simulateConversion(request) {
  try {
    const data = await request.json();
    const options = data.options || {};
    
    // Validate required fields
    if (!data.json) {
      return errorResponse('validation_error', 'Missing required field: json');
    }

    // Parse JSON with detailed error handling
    let jsonData;
    try {
      jsonData = JSON.parse(decodeURIComponent(data.json));
    } catch (e) {
      return errorResponse('json_parse_error', e.message, parseErrorDetails(e, data.json));
    }

    let htmlResponse;
    const decodedTemplate = data.template ? decodeURIComponent(data.template) : '';

    // Render with template or use generic fallback
    if (decodedTemplate) {
      try {
        htmlResponse = Mustache.render(decodedTemplate, jsonData);
      } catch (e) {
        return errorResponse('template_render_error', e.message);
      }
    } else if (options.genericFallback) {
      htmlResponse = createGenericHtml(jsonData);
    } else {
      return errorResponse('validation_error', 'Missing template. Set genericFallback:true for auto-generated HTML.');
    }

    // Apply relativeURLPrefix if provided
    if (options.relativeURLPrefix) {
      htmlResponse = await rewriteRelativeUrls(
        htmlResponse, 
        options.relativeURLPrefix, 
        false, null, null, null, null
      );
    }

    return new Response(htmlResponse, {
      headers: {
        'Content-Type': 'text/html;charset=UTF-8',
        'X-Render-Mode': decodedTemplate ? 'mustache' : 'generic-fallback',
      },
    });
  } catch (error) {
    return errorResponse('internal_error', error.message);
  }
}

function errorResponse(type, message, details = null) {
  return new Response(JSON.stringify({
    error: true,
    type,
    message,
    ...(details && { details }),
  }), {
    status: 400,
    headers: { 'Content-Type': 'application/json' },
  });
}

function createGenericHtml(data) {
  return `<!DOCTYPE html>
<html>
  <head>${data.title ? `<title>${data.title}</title>` : ''}</head>
  <body>
    <main><div class="data">${jsonToHtmlDivs(data)}</div></main>
  </body>
</html>`;
}
```

---

### Playground UI for Enhanced Features

Add UI controls to test these features:

```
┌─────────────────────────────────────────────────────────┐
│ Options Panel (collapsible)                             │
├─────────────────────────────────────────────────────────┤
│ ☐ Generic Fallback (no template needed)                 │
│ Relative URL Prefix: [https://cdn.example.com_________] │
└─────────────────────────────────────────────────────────┘
```

---

## Files Structure

```
tools/json2html-playground/
├── index.html              # ✅ Main HTML structure (created)
├── json2html-playground.js # ✅ Core JavaScript (created)
├── json2html-playground.css # ✅ Styles (created)
├── examples.js             # 🔜 Example templates & JSON (Phase 3)
├── PLAN.md                 # ✅ This file
├── JSON2HTML-FEATURES.md   # ✅ Feature documentation (created)
└── UI-PATTERNS-PROPOSAL.md # ✅ UI design analysis (created)
```

### Related Backend Files (helix-json2html repo)
```
src/
├── simulator.js            # /simulator endpoint - needs enhancement
├── index.js                # Main router
└── json2html.js            # Main conversion logic
```

---

## Testing

### Local Development
```bash
cd helix-tools-website
npx -y @adobe/aem-cli up --no-open --forward-browser-logs
# Open http://localhost:3000/tools/json2html-playground/
```

### Manual Testing Checklist
- [ ] Load playground at localhost:3000/tools/json2html-playground/
- [ ] Verify header doesn't overlap content
- [ ] Verify panels fill full width
- [ ] Test JSON Data / Template tab switching
- [ ] Test resizer drag between panels
- [ ] Test Examples button opens modal
- [ ] Test Syntax Help button opens modal
- [ ] Test responsive breakpoints (600px, 900px)
- [ ] Select example and verify JSON loads
- [ ] (Phase 2) Verify /simulator endpoint is called on render
- [ ] (Phase 2) Verify preview displays rendered HTML
- [ ] (Phase 2) Test error handling with invalid JSON
- [ ] (Phase 2) Test error handling with network failure
- [ ] (Phase 2) Test View Source toggle
- [ ] (Phase 2) Test debounced auto-render

### curl Tests for /simulator endpoint

**Basic Request (current):**
```bash
curl -X POST https://json2html.aem-cf-workers.workers.dev/simulator \
  -H "Content-Type: application/json" \
  -d '{
    "json": "%7B%22name%22%3A%22John%22%2C%22age%22%3A30%7D",
    "template": "%3Ch1%3EHello%20%7B%7Bname%7D%7D%3C%2Fh1%3E%3Cp%3EAge%3A%20%7B%7Bage%7D%7D%3C%2Fp%3E"
  }'
```

**Enhanced Request (with options):**
```bash
curl -X POST https://json2html.aem-cf-workers.workers.dev/simulator \
  -H "Content-Type: application/json" \
  -d '{
    "json": "%7B%22title%22%3A%22Product%22%2C%22image%22%3A%22%2Fmedia%2Fproduct.jpg%22%7D",
    "template": "%3Cimg%20src%3D%22%7B%7Bimage%7D%7D%22%3E%3Ch1%3E%7B%7Btitle%7D%7D%3C%2Fh1%3E",
    "options": {
      "relativeURLPrefix": "https://cdn.example.com"
    }
  }'
# Expected: <img src="https://cdn.example.com/media/product.jpg"><h1>Product</h1>
```

**Generic Fallback (no template):**
```bash
curl -X POST https://json2html.aem-cf-workers.workers.dev/simulator \
  -H "Content-Type: application/json" \
  -d '{
    "json": "%7B%22title%22%3A%22Hello%22%2C%22items%22%3A%5B%22a%22%2C%22b%22%5D%7D",
    "template": "",
    "options": {
      "genericFallback": true
    }
  }'
# Expected: Auto-generated semantic HTML with div structure
```

**Error Response Test:**
```bash
curl -X POST https://json2html.aem-cf-workers.workers.dev/simulator \
  -H "Content-Type: application/json" \
  -d '{
    "json": "%7Binvalid%20json",
    "template": "%3Ch1%3ETest%3C%2Fh1%3E"
  }'
# Expected: { "error": true, "type": "json_parse_error", "message": "..." }
```

---

*Last Updated: December 19, 2024 (Phase 1 UI Complete, /simulator enhancement plan added)*

---

## Quick Start for Next Session

```bash
cd helix-tools-website
npx -y @adobe/aem-cli up --no-open --forward-browser-logs &
# Open http://localhost:3000/tools/json2html-playground/
```

**Phase 2 Focus: Integrate /simulator endpoint**
1. Call `POST https://json2html.aem-cf-workers.workers.dev/simulator`
2. URL-encode JSON and template, send in request body
3. Display rendered HTML in iframe srcdoc
4. Add error handling for network/parse errors
5. Debounce auto-render (300-500ms) with loading indicator
