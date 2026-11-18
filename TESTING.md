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

### Incremental JavaScript type checking

#### Purpose

TypeScript is a development-time safety net for shared JavaScript API contracts,
**not a migration to TypeScript or a new application build step**. Shared libraries
have callers across multiple tools; checking their contracts helps developers and
agents catch incompatible API changes before they become runtime failures.
JSDoc also makes supported calls and return types discoverable in editors.

The initial focus is the admin-client boundary: distinguish bound from unbound
clients, preserve resource capabilities, prevent accidental retargeting, and keep
both auth call formats compatible. The goal is to make these guarantees explicit
without requiring every existing tool to adopt type checking at once.

Run the check with:

```sh
npm run typecheck
```

Browsers still run the `.js` files directly. The checker uses `noEmit` and produces
no application JavaScript, declarations, or other generated output. Keep type-only
references in JSDoc `import(...)`; do not add runtime imports for typedefs.

#### Scope and limits

`tsconfig.json` keeps `strict: true`, `checkJs: false`, and explicit entry points.
Individual files opt in with `// @ts-check`, so importing an existing library does
not automatically enable diagnostics throughout its unchecked implementation.
Use `tsconfig.json` and the files' `// @ts-check` directives as the source of truth
for checking scope; do not maintain a duplicate per-module inventory here.

Compile-only contract fixtures are checked, **not executed**. Valid examples must type-check;
invalid examples use explanatory `@ts-expect-error` directives. If an API change
accidentally permits an invalid call, its now-unused directive makes the check fail.
Examples cover coordinate mutation, bound-client retargeting, unsupported resource
methods, auth options, and inferred response types.

A passing check does not certify unchecked callers, validate server JSON,
or prove request routing and auth behavior. Parsed JSON is `unknown` in the shared
response contract and must be narrowed or validated before use in checked code.
Type checking complements runtime tests; it does not replace input validation,
runtime guards, or `Object.freeze()` for actual immutability.

#### Extending the checks

When changing a checked API, update its shared JSDoc contract and compile-only
examples alongside the implementation, then run `npm run typecheck` in addition
to lint and the relevant runtime tests. Preserve supported legacy calls during
incremental migrations.

Adopt checking in other shared libraries as they are changed: add `// @ts-check`,
reuse shared contracts, and ensure the file is part of the `tsconfig.json` program
through an import or a new explicit entry point. Do not enable repository-wide
`checkJs` or convert unrelated files just to extend one library's coverage.
Fix mismatches rather than widening contracts to `any` or adding suppressions to
silence diagnostics; reserve `@ts-expect-error` for intentional negative checks.

#### Admin-client contracts

`scripts/admin-types.js` describes the unbound and bound APIs. The bound
factory returns cached clients with a read-only `coords` property exposing
the target to auth without exposing backend selection; `raw()` accepts absolute
or root-relative URLs only within the selected backend and bound org/site
(and H5 ref, unless null). Out-of-scope URLs throw before fetching. Bound derivation
returns another bound client; unbound derivation stays unbound.

`executeAdminRequest(requestFn, client, { policy })` obtains auth coordinates
from the bound client's `coords`; omitting options keeps the 401-retry default.
The existing `executeAdminRequest(requestFn, { org, site, policy })` form
remains supported. Both signatures share the same login, retry, cancellation,
and persistence flow; accepting a client avoids repeating auth coordinates,
but does not validate the request callback's target.

`getAdminClientForSite({ org, site, ref })` now returns the bound API:
`client.status().get(path)`, not `client.status(coords).get(path)`. Resource
accessors reject arguments rather than silently ignoring old coordinates.
Org/site and non-null refs must be non-empty strings. Omitted refs default
to `main`; `null` retains ref-less H5 operation URLs while probing `main`
for backend detection.

Client creation is cached per org/site/ref and temporary H6 override state.
Concurrent callers share creation; failures are evicted. `getAdminClient()`
remains unbound and keeps its override behavior during migration.

Admin API integration tests exercise real H5/H6 adapters with network interception.
These runtime tests complement the static contracts by checking backend detection,
request routing, and per-target execution. Keep tool-specific behavior and coverage
in the corresponding tests.

### Runtime tests

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
