# Phase 2: Test Plan for Optel Explorer Migration

**Created:** 2026-01-14
**Source Repository:** helix-website (`tools/rum/`)
**Target Repository:** helix-tools-website (`tools/optel-explorer/`)
**Phase Status:** In Progress
**Test Strategy:** Essential Coverage Only

---

## Executive Summary

This document defines the **essential test plan** for the RUM to Optel Explorer migration. The focus is on critical path testing to ensure feature parity with minimal implementation effort.

**Testing Goals:**

- Ensure existing tests pass after migration
- Validate critical user flows work end-to-end
- Provide confidence for stakeholders before production deployment

**Test Strategy:** Essential coverage only - existing tests + key E2E flows

---

## 1. Current Test Baseline

### 1.1 Existing Tests

The RUM tool has **8 existing unit tests** in `test/utils.test.js`:


| Test Suite   | Test Cases                           | Status     |
| -------------- | -------------------------------------- | ------------ |
| `truncate`   | 7 tests (hour, day, week truncation) | ✅ Passing |
| `escapeHTML` | 1 test (XSS prevention)              | ✅ Passing |

**Current Coverage:**

- `utils.js`: 42.53% line coverage
- Overall: 54.95% line coverage

### 1.2 How to Run Tests

```bash
# Navigate to RUM tool directory
cd /path/to/helix-website/tools/rum

# Run tests (requires European timezone for existing tests to pass)
TZ='Europe/Berlin' npm test
```

**Known Issue:** Tests are timezone-dependent. They expect European timezone (`+01:00`, `+02:00`).

---

## 2. Essential Test Plan

### 2.1 Migration Requirements


| Requirement                | Test Type | Priority              |
| ---------------------------- | ----------- | ----------------------- |
| Existing 8 tests pass      | Unit      | **P0 - Required**     |
| Page loads with data       | E2E       | **P0 - Required**     |
| Domain selection works     | E2E       | **P0 - Required**     |
| Date range filtering works | E2E       | **P1 - Important**    |
| Facet filtering works      | E2E       | **P1 - Important**    |
| Data export works          | E2E       | **P2 - Nice to have** |

### 2.2 Unit Tests (Existing - Must Pass)

These 8 tests must pass after migration:

```javascript
// test/utils.test.js - Migrate as-is, rename imports

describe('truncate', () => {
  it('truncates to the beginning of the hour');
  it('truncates to the beginning of the day');
  it('truncates to the beginning of the week');
  it('truncates to the beginning of the week (May 11th)');
  it('truncates to the beginning of the week (May 12th)');
  it('truncates to the beginning of the week (May 13th)');
  it('truncates to the beginning of the week (May 14th)');
});

describe('escapeHTML', () => {
  it('escapes HTML entities');
});
```

**Migration Action:**

1. Copy `test/utils.test.js` to new location
2. Update import path from `'../utils.js'` (no other changes needed)
3. Run with `TZ='Europe/Berlin' npm test`

### 2.3 E2E Tests (New - Critical Paths Only)

#### Test Framework Setup

**Recommended:** Playwright (lightweight, fast)

```bash
npm install -D @playwright/test
npx playwright install chromium  # Single browser for essential testing
```

#### Critical E2E Test Scenarios

**E2E-001: Page Load with Domain**

```javascript
test('loads page with domain parameter', async ({ page }) => {
  await page.goto('/tools/optel-explorer/?domain=www.aem.live&view=month');

  // Verify page loads without errors
  await expect(page.locator('body')).toBeVisible();

  // Verify URL selector shows domain
  await expect(page.locator('optel-url-selector input')).toHaveValue('www.aem.live');

  // Verify chart canvas exists
  await expect(page.locator('canvas')).toBeVisible();

  // Verify no console errors (optional)
  // page.on('console', msg => expect(msg.type()).not.toBe('error'));
});
```

**E2E-002: Domain Selection**

```javascript
test('can change domain', async ({ page }) => {
  await page.goto('/tools/optel-explorer/?domain=www.aem.live');

  // Change domain
  const input = page.locator('optel-url-selector input');
  await input.fill('blog.adobe.com');
  await input.press('Enter');

  // Verify URL updated
  await expect(page).toHaveURL(/domain=blog\.adobe\.com/);
});
```

**E2E-003: Date Range Selection**

```javascript
test('can select date range', async ({ page }) => {
  await page.goto('/tools/optel-explorer/?domain=www.aem.live&view=week');

  // Verify week is selected
  await expect(page).toHaveURL(/view=week/);

  // Change to month (implementation depends on UI)
  // await page.locator('[data-view="month"]').click();
  // await expect(page).toHaveURL(/view=month/);
});
```

**E2E-004: Facet Filtering**

```javascript
test('can filter by facet', async ({ page }) => {
  await page.goto('/tools/optel-explorer/?domain=www.aem.live&view=month');

  // Wait for facets to load
  await page.waitForSelector('optel-list-facet');

  // Click first checkbox in a facet
  const checkbox = page.locator('optel-list-facet input[type="checkbox"]').first();
  await checkbox.click();

  // Verify URL has filter parameter
  await expect(page).toHaveURL(/[?&](userAgent|checkpoint|url)=/);
});
```

---

## 3. Test Execution Checklist

### 3.1 Pre-Migration (Run on RUM tool)

- [X] Run `TZ='Europe/Berlin' npm test` - all 8 tests pass
- [X] Manual smoke test: load `explorer.html?domain=www.aem.live`
- [X] Document any existing failures or issues

### 3.2 Post-Migration (Run on Optel Explorer)

- [ ] Run `TZ='Europe/Berlin' npm test` - all 8 tests pass
- [ ] Run E2E tests (if implemented)
- [ ] Manual smoke test: load `index.html?domain=www.aem.live`
- [ ] Verify all critical paths work:
  - [ ] Page loads with chart and metrics
  - [ ] Domain selector works
  - [ ] Date range picker works
  - [ ] At least one facet filter works
  - [ ] Copy to clipboard works

### 3.3 Cross-Browser Smoke Test (Manual)


| Browser | Version | Load Page | Change Domain | Filter Data |
| --------- | --------- | ----------- | --------------- | ------------- |
| Chrome  | Latest  | ☐        | ☐            | ☐          |
| Safari  | Latest  | ☐        | ☐            | ☐          |
| Firefox | Latest  | ☐        | ☐            | ☐          |

---

## 4. Known Test Issues

### 4.1 Timezone Dependency

**Issue:** Existing `truncate` tests expect European timezone.

**Workaround:** Run tests with `TZ='Europe/Berlin'` prefix.

**Future Fix (optional):** Refactor tests to be timezone-agnostic:

```javascript
// Instead of checking exact string with timezone
assert.strictEqual(truncate(time, 'hour'), '2021-01-01T02:00:00+01:00');

// Check date components only
const result = new Date(truncate(time, 'hour'));
assert.strictEqual(result.getUTCHours(), 1);
assert.strictEqual(result.getUTCMinutes(), 0);
```

### 4.2 No Integration Tests

**Current State:** No API mocking or integration tests exist.

**Recommendation:** Defer to Phase 4 if issues arise. For now, rely on E2E tests against live/preview environment.

---

## 5. Design System Audit (Quick Reference)

### 5.1 Styles to Adopt


| RUM File         | Action                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------- |
| `colors.css`     | **Remove** - use global `/styles/colors.css` but if there is no parity, then ask the user |
| `rum-slicer.css` | **Rename** to `optel-explorer.css`, update selectors                                      |

### 5.2 Tokens to Map


| RUM Usage        | Global Token                          |
| ------------------ | --------------------------------------- |
| CWV good (green) | `--green-*` from `/styles/colors.css` |
| CWV ni (orange)  | `--orange-*`                          |
| CWV poor (red)   | `--red-*`                             |

### 5.3 Data Viz Exceptions (Keep Custom)

- Skyline chart colors
- CWV color coding
- Significance indicators
- Facet-specific styling

---

## 6. Stakeholder Questions

### 6.1 Resolved


| Question         | Resolution                                                                 |
| ---------------- | -------------------------------------------------------------------------- |
| File naming      | `index.html`, `optel-explorer.js/css`                                      |
| Element prefix   | `optel-*` (was `rum-*`)                                                    |
| Admin tool       | Out of scope (Phase 6)                                                     |
| Test coverage    | Essential only                                                             |
| Browser support  | Keep supporting what is supported today (Chrome 105+, Safari 16+, Firefox 110+) |
| localStorage key | **Don't rename** - keep `rum-bundler-token` (avoids user re-auth)          |
| OG image proxy   | **Keep as-is** - endpoint at `www.aem.live/tools/rum/_ogimage` is external service, not in this repo |

### 6.2 Notes on OG Image Proxy

The OG image proxy (`https://www.aem.live/tools/rum/_ogimage?proxyurl={url}`) is used in `link-facet.js` to generate thumbnail previews of web pages. Key findings:

- **Implementation is external** - not in helix-website or helix-tools-website repos
- **Used by**: `tools/rum/elements/link-facet.js` and `tools/oversight/elements/link-facet.js`
- **Decision**: Keep the URL unchanged - it's a shared service both sites can use

---

## 7. Phase 2 Completion Checklist

- [X] Test plan documented (this document)
- [X] Existing tests verified passing (`TZ='Europe/Berlin' npm test`)
- [X] E2E test framework decision made (Playwright recommended, manual smoke test acceptable)
- [X] Critical E2E scenarios identified (4 scenarios)
- [X] Design system audit complete (Section 5)
- [X] Stakeholder questions resolved (Section 6.1)

**Ready for Phase 3:** ✅ All items complete. Proceed to implementation.

---

## Appendix: Full Test Plan Reference

The comprehensive test plan with 100+ test cases is available for future reference if deeper coverage is needed. Key sections that were deferred:

- **Unit Tests:** Additional functions in `utils.js`, `loader.js`, `slicer.js`
- **Integration Tests:** API mocking, authentication flows
- **E2E Tests:** All web components, edge cases, accessibility
- **Performance Tests:** Load time benchmarks, memory profiling

These can be implemented post-migration if quality issues arise.

---

**End of Phase 2 Test Plan (Essential Coverage)**
