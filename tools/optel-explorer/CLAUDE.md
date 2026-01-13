# Optel Explorer - AI Agent Context

## What Is This?

Migration of the RUM Explorer tool from `helix-website` (`tools/rum/`) to `helix-tools-website` (`tools/optel-explorer/`). Rebranded from "RUM" to "Optel".

## Key Documents

- **[SPEC.md](./SPEC.md)** - Migration specification, phases, and requirements
- **[PHASE1-ANALYSIS.md](./PHASE1-ANALYSIS.md)** - Comprehensive analysis of source codebase (~2200 lines)

Read these before making changes.

## Quick Context

### What We're Migrating
- RUM data exploration dashboard with 15+ facet types
- Core Web Vitals visualization (Skyline chart)
- ~3,400 lines of code (16 files)
- Admin tool is OUT OF SCOPE (Phase 6 future work)

### Key Decisions Made

| Decision | Resolution |
|----------|------------|
| Entry point | `index.html` (not explorer.html) |
| Naming | `optel-explorer.js`, `optel-explorer.css` |
| Custom elements | `optel-*` prefix (was `rum-*`) |
| Component directory | Keep as `elements/` |
| Global styles | Adopt `/styles/styles.css` |
| Colors | Use global tokens, remove RUM's `colors.css` |
| Chart styles | Keep custom (data viz exception) |

### Two-Tier Authentication Model

Critical to understand:

| Layer | Storage | Purpose |
|-------|---------|---------|
| **Bundler Token** | `localStorage['rum-bundler-token']` | Authenticates user to API |
| **Domain Key** | URL param `?domainkey=` | Authorizes domain data access, shareable |

These are separate mechanisms, not exchanged. URLs with `?domainkey=` can be shared without recipients needing a bundler token.

### CDN Dependencies Pattern

Isolate all ESM.sh imports in a single `deps.js` file:

```javascript
// deps.js - centralized CDN imports
export { Chart, registerables } from 'https://esm.sh/chart.js@4.4.2';
export { DataChunks } from 'https://esm.sh/@adobe/rum-distiller@1.20.8';
```

### Open Decisions (Phase 3)

- Spectrum styles vs helix-tools-website styles
- localStorage key naming (`rum-bundler-token` vs `optel-bundler-token`)
- OG image proxy endpoint location
- Telemetry event naming (keep as "RUM" with TODO)

## Current Status

- **Phase 1 (Analysis):** Complete
- **Phase 2 (Test Plan):** Not started
- **Phase 3 (Implementation):** Not started

## Source Code Location

Original RUM Explorer: `/Users/ssane/Documents/internal/eds-eng/codebase/helix/helix-website/tools/rum/`
