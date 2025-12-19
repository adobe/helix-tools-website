# JSON2HTML Playground - Development Plan

## Need
Build a "Playground" similar to CodePen.io for the JSON2HTML feature in Edge Delivery Services.

**Reference:** https://www.aem.live/developer/json2html

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

### Phase 1: Mock UI (Current)
- Build HTML structure
- Add CSS styling
- Basic JS for tab switching and layout
- No actual rendering yet

### Phase 2: Core Functionality
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
├── index.html              # Main HTML structure
├── json2html-playground.js # Core JavaScript
├── json2html-playground.css # Styles
├── examples.js             # Example templates & JSON
├── PLAN.md                 # This file
├── JSON2HTML-FEATURES.md   # Feature documentation
└── UI-PATTERNS-PROPOSAL.md # UI design analysis
```

---

## Testing

### Manual Testing
1. Load playground
2. Select example or enter custom JSON/template
3. Verify preview renders correctly
4. Test error handling with invalid JSON
5. Test responsive breakpoints
6. Test View Source toggle

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

*Last Updated: December 2024*
