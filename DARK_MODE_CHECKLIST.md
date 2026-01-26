# Dark Mode Implementation Checklist

## Status: In Progress

### Tested and Verified
- [x] page-status (Content Diff view fixed - code blocks, diff lines, buttons, headers)
- [x] site-query (minimal CSS, no issues)
- [x] admin-edit (previously completed)
- [x] headers-edit (warning banner has hardcoded colors but acceptable)
- [x] cdn-setup (minimal CSS, no issues)
- [x] version-admin (fixed current-version-info, version-current, version-data backgrounds)
- [x] simple-config-editor (fixed table backgrounds, hover states, changed-value highlight)
- [x] index-admin (fixed card gradients, attribute boxes, modal headers, form fields)
- [x] sitemap-admin (fixed card gradients, attribute boxes, language items, dialogs)
- [x] bulk (previously completed)

### Remaining Tools
- [x] deep-psi (fixed table backgrounds, borders, error messages, URL headers, deviation text)
- [x] error-analyzer (fixed table header, row borders, severity badges, filter panel, action buttons)
- [ ] image-audit (DEFERRED - needs overall design/layout fix first)
- [x] import (fixed environment badge text color, table backgrounds)
- [ ] json2html-playground
- [ ] media-library
- [ ] pdp-scanner
- [ ] project-admin
- [ ] snapshot-admin
- [x] svg-doctor (fixed upload grid, hover states, button states, form shadow)
- [x] mp4-doctor (uses embed block, no tool-specific CSS)
- [x] powerscore (fixed powerscore-styles.css variables, buttons, loading gradient, icon inlining)

### Blocks
- [x] power-score (uses powerscore-styles.css variables)
- [x] data-element (fixed h3 badge text, traffic-color default, icon inlining for dark mode)
- [x] results (fixed loading shimmer gradient)
- [x] sub-score (uses powerscore-styles.css variables)

### Global Styles
- [x] powerscore-styles.css (fixed root variables to use themed values, button colors)

### Icons
- [x] copy.svg (added fill="currentColor" for dark mode support)

### Notes
- image-audit: Deferred due to overall design/layout issues that should be addressed before dark mode styling
- Phase 6 (popovers) was deferred in the original dark mode implementation
