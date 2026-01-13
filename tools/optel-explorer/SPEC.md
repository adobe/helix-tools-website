# Optel Explorer Migration Specification

## Overview

Migrate the RUM (Real User Monitoring) tool from `@helix-website/tools/rum` to `@helix-tools-website/tools/optel-explorer`. The tool is being rebranded from "RUM" to "Optel" while maintaining 100% feature parity. Post-migration, the tool will be accessible at `tools.aem.live` instead of `aem.live`.

## Scope

### In Scope

This migration covers the **main RUM explorer tool** (`tools/rum/explorer.html` and associated files):
- Data exploration interface
- Faceted filtering system
- Charts and visualizations
- All user-facing features documented in Phase 1 analysis
- URL parameter handling and deep linking
- Authentication for domain access

### Out of Scope (Future Phase)

The following components will be migrated in a **separate future phase**:
- **Admin tool** (`tools/rum/admin/`) - Organization management interface
  - Organization creation/management
  - Domain assignment to organizations
  - Organization key display
  - Admin authentication flows

**Rationale:** The admin tool is a separate concern with different user personas (administrators vs. analysts) and should follow helix-tools-website's pattern of separate admin tools. Deferring this allows focus on the primary user-facing explorer tool.

## Goals

- **100% Feature Parity**: Every feature must work identically to the current implementation, including edge cases and lesser-used functionality
- **Full Rebrand**: Update all user-facing strings, exports, code comments, and documentation to use "Optel" terminology
- **Design System Adoption**: Inherit the global design system from helix-tools-website as much as possible
- **Forever URL Support**: Old URLs at `aem.live/tools/rum` must redirect to `tools.aem.live/optel-explorer` indefinitely with full path and query parameter preservation

## Constraints

- No rollback mechanism required; parallel operation of both tools serves as the safety net
- Redirect infrastructure is handled externally (out of scope for this migration)
- Old code in helix-website will be left untouched
- No effort/time estimates required; focus on technical scope only

## Architecture Decisions

### Authentication & Cross-Domain State

- **Strategy**: Shared cookie/storage across `*.aem.live` subdomains
- **localStorage**: Fresh start on new domain; users will lose saved preferences
- **Implication**: No migration of user preferences; users reconfigure on new domain

### URL Handling

| Aspect | Decision |
|--------|----------|
| Redirect scope | Full path + all query parameters preserved |
| URL longevity | Forever support for old URL format |
| Deep links | `aem.live/tools/rum?domain=x&filter=y` → `tools.aem.live/optel-explorer?domain=x&filter=y` |

### API Endpoints

**Open Item**: Identify all hardcoded API endpoints during analysis phase. Each endpoint will be discussed individually to determine the appropriate solution (environment config, relative to host, or hardcoded).

### Design System Integration

- Adopt helix-tools-website global design system for chrome, layout, and standard components
- **Exceptions**: For data visualizations (charts, graphs, custom UI elements), consult before implementing custom styles
- **Loading States**: Evaluate helix-tools-website patterns vs current UX during implementation; decide case-by-case

### Third-Party Dependencies

| Dependency | Decision |
|------------|----------|
| Charting libraries | Pin to identical version as current tool; discuss alignment opportunities during implementation |
| External integrations | Identify OAuth flows, webhooks, embeds during analysis |

### Code Organization

- Reorganize file structure to match helix-tools-website conventions
- Deviations from conventions require explicit approval
- Full rebrand of code comments, JSDoc, and variable names to Optel terminology

## Behavior Preservation

The following behaviors must be preserved exactly:

- **Keyboard shortcuts**: All existing shortcuts unchanged
- **Timezone handling**: Current timezone logic preserved
- **Real-time updates**: Polling/refresh intervals unchanged
- **Error UX**: Error states and messages replicated exactly
- **Performance characteristics**: No performance optimizations during migration (preserve current behavior)

## Open Items

These require decisions during analysis or implementation:

| Item | Status | Notes |
|------|--------|-------|
| Telemetry event naming | Pending stakeholder input | Need to decide if events should use Optel or preserve RUM naming |
| Hardcoded API endpoints | Identify during analysis | Discuss solution for each endpoint individually |
| External integrations | Identify during analysis | OAuth, webhooks, third-party embeds |
| Embed/iframe modes | Identify during analysis | URL params like `hideNav=true`, `embedded=true` |
| Known bugs/issues | Document during analysis | Distinguish intentional quirks from actual bugs |
| Browser support | Check current tool | Determine current browser matrix |
| Loading state patterns | Evaluate during implementation | Compare helix-tools-website patterns vs current UX |
| Chart library alignment | Ask during implementation | Opportunities to align with existing approaches |

## Export & Branding

- All exports (PDF reports, CSV downloads, etc.) must use new "Optel" branding
- User-facing UI strings updated to Optel terminology
- Internal code fully rebranded

## Development Workflow

### PR Strategy

Single PR to `helix-tools-website` containing all migration work. No coordinated PRs required.

### Test Data

**Hybrid approach**:
- Unit/integration tests: Recorded fixtures for deterministic testing
- E2E validation: Live production data with provided domainKey(s)
- Test keys provided on demand; additional keys requested as needed for specific scenarios

## Acceptance Criteria

Migration is complete when ALL of the following are satisfied:

1. **All tests pass**: Automated test suite green
2. **Manual QA**: Key workflows verified manually
3. **Parity checklist**: Explicit feature checklist with all items verified working
4. **Stakeholder sign-off**: Designated approvers have reviewed and approved

## Users & Communication

- **User base**: Both internal Adobe teams and external customers
- **Impact**: Users with bookmarked URLs will be redirected seamlessly
- **Breaking change**: localStorage preferences will not migrate; users must reconfigure

## Phases

### Phase 1: Analysis

1. Analyze current tool functionality in `@helix-website/tools/rum`
2. Document all features, API endpoints, and external integrations
3. Identify embed modes and URL parameter behaviors
4. Document known bugs/issues
5. Determine browser support requirements
6. Create detailed feature inventory for parity checklist

### Phase 2: Test Case Development

Detailed test plan to be created as a **separate document** including:
- Specific test scenarios with inputs and expected outputs
- Coverage for all identified features
- Edge cases and error conditions
- Real-time update verification
- Cross-browser testing matrix

### Phase 3: Migration Implementation

1. Set up project structure following helix-tools-website conventions
2. Migrate code with full Optel rebrand
3. Integrate with helix-tools-website design system
4. Implement feature-by-feature with parity verification
5. Address open items as they arise (consult on UX/UI concerns, tradeoffs, visual differences)

### Phase 4: Validation

1. Execute automated test suite
2. Perform manual QA against parity checklist
3. Validate with live domainKey(s)
4. Obtain stakeholder sign-off

### Phase 5: Go-Live

1. Merge PR to helix-tools-website
2. External team enables redirect from aem.live to tools.aem.live
3. Monitor for issues; parallel operation allows quick rollback via redirect removal

### Phase 6: Admin Tool Migration (Future)

**Status:** Out of scope for initial migration; to be planned separately

**Scope:**
- Migrate `tools/rum/admin/` to `tools/optel-admin/`
- Organization management interface
- Domain assignment functionality
- Admin authentication flows
- Adopt helix-tools-website admin patterns (`/utils/config/config.js`)

**Dependencies:**
- Phase 5 complete (main explorer tool live and stable)
- Stakeholder confirmation of admin tool requirements
- Validation that admin functionality still needed in new architecture

**Rationale:**
- Separate user personas (admins vs. analysts)
- Follows helix-tools-website convention of separate admin tools
- Allows focus on primary user-facing explorer tool first
- Admin tool can be evaluated for necessity after main migration

---

## Appendix: Interview Decisions Log

| Topic | Decision |
|-------|----------|
| Feature scope | 100% feature parity |
| URL redirect | Full path + query param preservation, forever support |
| Auth | Shared cookie/storage across *.aem.live |
| localStorage | Fresh start; users lose preferences |
| API endpoints | Identify and discuss individually |
| Error handling | Match current behavior |
| Performance | Preserve as-is |
| Chart library | Same version; ask about alignment |
| External deps | Identify during analysis |
| Rollback | None needed; parallel operation is safety net |
| Keyboard nav | Preserve exactly |
| Export branding | New Optel branding |
| File structure | Adopt helix-tools-website conventions |
| Code comments | Full rebrand |
| Telemetry | Open item; decide later |
| Timezone | Preserve current behavior |
| Loading states | Evaluate during implementation |
| Real-time | Preserve polling intervals |
| PR strategy | Single PR to tools-website |
| Browser support | Check during analysis |
| Old code fate | Leave untouched |
| Test plan | Separate document |
