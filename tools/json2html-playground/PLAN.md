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
- Panels now fill full width of workspace
- Tab switching works (JSON Data / Template)
- Resizer between panels is functional
- Examples modal structure in place
- Syntax Help modal structure in place
- Share button placeholder ready
- Auto-render checkbox functional
- Responsive layout tested

**UI Fixed Issues:**
- Header overlap with main content
- AEM wrapper divs breaking flexbox layout
- Panels not filling full width
- `<p>` tag injection inside custom divs

**Current State:**
- Mock UI is ready for demo/review
- Preview shows static HTML (Mustache tags visible as text)
- No actual Mustache.js rendering yet
- Examples load sample JSON but don't render

### 🔜 Next Steps (Phase 2)

1. **Integrate Mustache.js library**
   - Add Mustache.js to the project (CDN or local)
   - Import in `json2html-playground.js`

2. **Implement client-side rendering**
   - Parse JSON input
   - Render template with Mustache.js
   - Update iframe `srcdoc` with rendered HTML

3. **Add error handling**
   - JSON parse errors with line numbers
   - Template syntax errors
   - Display errors in status bar

4. **Implement View Source toggle**
   - Show rendered HTML vs raw source
   - Syntax highlight the source view

5. **Add debounced auto-render**
   - 300ms debounce on input changes
   - Visual indicator while rendering

---

## Agreed Decisions ✅

### Layout
- **Option D: Hybrid Split-Adjustable**
- Desktop: Tabbed editors (JSON/Template) + Preview side-by-side
- Tablet: Stacked layout
- Mobile: Full-width tabs

### Code Editor
- **MVP:** Plain textarea + Prism.js overlay (already in project)
- **V1.1:** Consider CodeMirror 6 upgrade

### Rendering
- **Client-side only** using Mustache.js (no server calls for preview)
- Faster, snappier experience

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
- Integrate Mustache.js (client-side)
- Implement live preview
- Add error handling with line numbers
- JSON validation

### Phase 3: Polish
- Add 5-7 examples
- Mustache syntax help modal
- Copy HTML button
- URL sharing with LZString
- Responsive refinements

---

## Future Enhancements (V2+)

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
- [ ] relativeURLPrefix testing
- [ ] Schema-based template testing

---

## Backend Enhancement Needed

Enhance `/simulator` endpoint to return structured errors:

```json
{
  "error": true,
  "type": "json_parse_error",
  "message": "Unexpected token at position 42",
  "line": 3,
  "column": 15
}
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
- [ ] (Phase 2) Verify preview renders correctly
- [ ] (Phase 2) Test error handling with invalid JSON
- [ ] (Phase 2) Test View Source toggle

### curl Test for /simulate endpoint
```bash
curl -X POST https://json2html.aem-cf-workers.workers.dev/simulator \
  -H "Content-Type: application/json" \
  -d '{
    "json": "%7B%22name%22%3A%22John%22%2C%22age%22%3A30%7D",
    "template": "%3Ch1%3EHello%20%7B%7Bname%7D%7D%3C%2Fh1%3E%3Cp%3EAge%3A%20%7B%7Bage%7D%7D%3C%2Fp%3E"
  }'
```

---

*Last Updated: December 19, 2024*
*Phase 1 Complete - Ready for Phase 2*
