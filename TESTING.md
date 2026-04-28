# TESTING.md

This document defines the testing philosophy for this project. It is intended as a decision-making guide — use it to evaluate whether a given tool or function warrants tests, and what kind.

## Philosophy

Testing is a cost-benefit decision, not a ritual. We want tests whose value in finding and preventing bugs exceeds their cost to maintain. Use these guidelines to make that judgement:

- **Logic complexity drives value.** Non-trivial transformations, edge cases, and branching logic are worth testing. Single-expression helpers and obvious pass-throughs are not.
- **Harder to catch manually = higher test value.** If a bug in this code would be invisible until something breaks in production, a test pays for itself.
- **Unstable tests have high cost.** A test that needs rewriting every time the UI changes is a liability. Prefer tests that survive refactoring.
- **Refactor for testability when the logic warrants it.** Logic doesn't need to be pure today to be worth testing. If the logic is complex and entangled with DOM or fetch calls, extract it into a pure function and test that. If the logic is trivial, don't bother — the refactoring cost exceeds the value.
- **Tool complexity sets the baseline.** A thin tool that fetches data and renders it with very little intermediate logic rarely has anything worth testing. The more state, data processing, and coordination a tool has, the more likely there's a meaningful logic layer worth extracting and testing.
- **Add tests when you touch a tool.** If you add or change an existing tool, add or update tests alongside the change. The same goes for bug fixes — add a test that would have caught it.
- **Avoid mocks whenever possible.** Mocked tests are expensive to maintain and give false confidence when the code being tested *consumes* a mocked dependency — the mock can drift from reality, and the test passes while production breaks. Reach for mocks only when the unit under test *is* the contract with a collaborator (shared libraries, orchestration helpers); see "When Mocking Is Acceptable" below.
- **Comprehensive coverage is an explicit non-goal.** A small set of high-confidence tests is more valuable than broad coverage that breaks frequently or tests the obvious.

Reference: https://www.aem.live/blog/testing-in-aem

## What To Test

Focus on **pure logic** — functions with no DOM access, no fetch calls, and no side effects:

- **Data transformation**: URL normalization, path sanitization, deduplication
- **Formatting utilities**: number formatting, date/time formatting, relative time
- **Parsing and extraction**: structured data parsing, pattern matching
- **Aggregation and filtering**: data layer logic that feeds the UI, not the UI itself
- **Comparison and diff logic**: non-trivial comparisons, structural diffing
- **Edge cases**: empty inputs, boundary values, special characters, type coercion

## What Not To Test

Avoid:

- **DOM manipulation**: decorating elements, building markup, attaching classes
- **Event handler wiring**: click handlers, form submission, UI state transitions
- **API calls**: do not mock `fetch` or simulate responses — test the logic that processes the data instead
- **Visual behavior**: anything that only matters if you can see it
- **Trivially simple functions**: single-expression helpers where the implementation is obvious from the name

## The Decision Checklist

Before writing a test, ask:

- [ ] Does it contain **branching logic**, transformations, or non-obvious behavior?
- [ ] Would a bug here be **silent or hard to catch** in manual testing?
- [ ] Can the logic be **extracted into a pure function**, and is it complex enough to justify doing so?
- [ ] Would the test **survive a UI refactor** without needing to be rewritten?

If most answers are yes, write the test — refactoring first if needed.

## Refactoring For Testability

When logic worth testing is tangled with DOM manipulation, refactor by extraction:

1. Identify the pure logic (transformations, calculations, data processing)
2. Move it into a module co-located with the tool — name it after what it does (`parser.js`, `scoring.js`, `transforms.js`) or use a generic name if the contents are genuinely mixed
3. Export individual functions
4. The main script imports and calls them

Only refactor when the logic is genuinely complex enough to justify it. Over-engineering a simple tool into modules is worse than leaving it as-is.

## When Mocking Is Acceptable

Avoid mocks whenever possible. They're expensive to maintain and give false confidence when the code under test *consumes* a mocked dependency — the mock can drift from the real API, and the test passes while production breaks.

Mocks are acceptable, and sometimes the right call, in a narrow case: **shared library or orchestration code where the unit under test IS the contract with a collaborator**, and that contract is the very thing you want to pin. The mock is the system under test, not a stand-in for it. Examples:

- `tests/scripts/helix-admin.test.js` — fetches are spied because the wrapper's job is to construct fetch arguments and shape the response. The spy *is* the SUT.
- `tests/utils/admin-request.test.js` — `ensureLogin` is mocked via `node:test`'s `mock.module` and `window` events are dispatched against an `EventTarget`, because the helper's job is to orchestrate those collaborators into a result. The orchestration logic itself is the contract under test.

If you find yourself reaching for a mock outside this case, stop and refactor. The pull toward "I'll just mock this one fetch" is exactly when the test starts giving false confidence.

Conventions when mocking *is* used:
- Prefer `mock.module` over global monkey-patching for ES module imports (the `package.json` test script already enables `--experimental-test-module-mocks`)
- For DOM events, set up a minimal `global.window` shim using `EventTarget` rather than pulling in `jsdom` or `happy-dom`
- Keep the mocked surface small — mock only what the unit under test directly collaborates with

## Test Conventions

- **Framework**: Node.js built-in `node:test` + `node:assert/strict`
- **Location**: `tests/{path-mirroring-source}/{module}.test.js` — all tests live under the top-level `tests/` directory, mirroring the layout of the code under test (e.g. `tools/bulk/utils.js` → `tests/tools/bulk/utils.test.js`). Name the test file after the module it tests.
- **Run**: `npm test` (executes all `tests/**/*.test.js`)
- **Mocks**: avoid whenever possible; see "When Mocking Is Acceptable" for the narrow exception

See existing tests for reference:
- `tests/tools/bulk/utils.test.js` — URL sanitization and normalization
- `tests/tools/error-analyzer/utils.test.js` — formatting with edge cases
- `tests/tools/index-admin/utils.test.js` — path derivation with branching logic
- `tests/tools/log-viewer/utils.test.js` — date utility extraction from a larger script
- `tests/scripts/helix-admin.test.js` — orchestration code with a fetch spy as SUT
- `tests/utils/admin-request.test.js` — orchestration code with `mock.module` and a `window` event-target shim
