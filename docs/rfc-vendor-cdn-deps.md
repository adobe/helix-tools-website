# RFC: Vendoring Runtime CDN Dependencies

## Problem Statement

The tools.aem.live website loads 9 runtime JavaScript libraries from 4 different public CDNs (esm.sh, unpkg.com, cdnjs.cloudflare.com, cdn.jsdelivr.net) with no lockfile protection, no subresource integrity, and no automated mechanism for security update notifications. This creates supply chain risk and operational fragility.

## Current State

| Package | Version | CDN | Load Method | Consumers |
|---------|---------|-----|-------------|-----------|
| `@adobe/rum-distiller` | 1.23.0 | esm.sh | import map | 8 optel pages, error-analyzer |
| `chart.js` | 4.4.8 / 4.4.2 | esm.sh | import map | 7 optel pages |
| `chartjs-adapter-luxon` | 1.3.1 | esm.sh | import map | 4 optel pages |
| `chartjs-plugin-datalabels` | 2.2.0 | esm.sh | import map | 1 optel page |
| `chartjs-chart-sankey` | 0.12.1 | esm.sh | import map | 1 optel page |
| `luxon` | (transitive) | esm.sh | bundled by CDN | via chartjs-adapter-luxon |
| `echarts` | 6.x | cdn.jsdelivr.net | import map | error-analyzer |
| `yaml` | 2.8.1 | unpkg.com | dynamic import | index-admin, sitemap-admin |
| `prismjs` | 1.29.0 | cdnjs.cloudflare.com | loadScript (UMD) | utils/prism, admin-edit |
| `diff` | 8.0.2 | (already vendored) | local import | version-admin, pdp-scanner |

Additionally, `chart.js` has a version mismatch: `explorer/explorer.html` loads 4.4.2 while all oversight pages load 4.4.8.

`@adobe/rum-distiller` is listed in `devDependencies` at 1.23.0 but serves no purpose there — runtime loading goes through esm.sh import maps. Redundant sub-directory `package.json`/`package-lock.json` files exist in `tools/optel/explorer/` and `tools/optel/oversight/`.

## Options Considered

### Option A: Full Vendoring (esbuild + postinstall) — SELECTED

Add all runtime deps to `package.json`. A `postinstall` script uses esbuild to bundle them into a `vendor/` directory as browser-ready ES modules. Vendor files are committed to git (required by EDS — no build step in deployment). Import maps and JS imports point to local `/vendor/` paths.

**Pros:**
- Zero runtime CDN dependency — no external service can break the site
- Full lockfile protection with integrity hashes
- Dependabot PRs are actionable (bump version -> `npm install` regenerates vendor/ -> commit)
- Eliminates esm.sh exposure (see Security Concerns below)
- Works offline during local development
- Single source of truth for versions (package.json)
- Fixes chart.js version mismatch automatically (one version in package.json)
- CSP can be tightened (remove `https://esm.sh` from `script-src`)

**Cons:**
- Increases repo size (committed vendor bundles)
- Adds esbuild as a dev dependency
- Postinstall script adds complexity (though idempotent via lockfile hash)
- Chart.js + plugins require careful esbuild configuration to share module instances

### Option B: CDN Consolidation + Dependabot Tracking

Consolidate from 4 CDNs to 2 (esm.sh for chart.js ecosystem, jsDelivr for everything else). Add all packages to `package.json` purely for dependabot security tracking. Keep loading from CDNs at runtime.

**Pros:**
- Simpler — no vendor directory, no esbuild, no postinstall script
- Smaller repo (no committed bundles)
- CDNs handle ESM conversion and peer dependency resolution
- Dependabot still provides security notifications

**Cons:**
- Runtime CDN dependency remains — outages break the site
- Dependabot PRs are advisory only — they bump `package.json` but a developer must manually update CDN URLs across 8+ HTML files and 5 JS files
- Version drift risk between `package.json` and CDN URLs (requires CI lint check)
- No offline development
- esm.sh security concerns remain (see below)
- SRI via import map `integrity` is fragile for on-the-fly CDN transformations (esm.sh, jsDelivr `/+esm` can change output)

**Sub-option B+: CDN + Automated URL Sync**

Same as B, but add a postinstall script that reads versions from `package.json` and auto-updates CDN URLs across all HTML/JS files. This addresses the manual update pain but converges with Option A in complexity (postinstall script, derived file changes, GitHub Action for dependabot PRs) while retaining CDN runtime dependency. At similar complexity, vendoring gives strictly better security and reliability.

### Option C: Inline / Reimplement

For each dependency, evaluate whether the specific functions used could be hand-ported into the codebase (as was done with jstat statistical functions in deep-psi).

**Assessment by library:**

| Package | Could inline? | Worth it? | Reason |
|---------|:---:|:---:|--------|
| chart.js | No | — | Massive charting library |
| echarts | No | — | Massive charting library |
| @adobe/rum-distiller | No | — | Complex internal data processing library |
| chartjs-plugin-datalabels | No | — | Complex positioning/animation logic |
| chartjs-chart-sankey | No | — | Specialized chart type implementation |
| chartjs-adapter-luxon | Maybe | Not now | Could write ~50-line native Date adapter, but subtle timezone/locale risk |
| yaml | Maybe | No | YAML spec is deceptively complex; hand-rolled parser is a maintenance liability |
| prismjs | Maybe | No | Core is only ~17KB; reimplementing syntax highlighting gains little |
| diff | Maybe | No | Myers diff is non-trivial; already vendored at 17KB |

**Follow-up opportunity:** `chartjs-adapter-luxon` + `luxon` (~70KB combined) could be replaced with a native `Intl.DateTimeFormat`-based adapter in a separate PR. Chart.js 4 supports custom date adapters.

### Option D: download-esm Tool

Use Simon Willison's `download-esm` (https://github.com/simonw/download-esm) to download pre-built ESM bundles from jsDelivr and commit them.

**Assessment:** Not suitable.
- Alpha quality (`0.1a0`), unmaintained since May 2023
- No peer dependency handling (critical for chart.js plugin ecosystem)
- Produces many small files instead of bundles (40+ files for a complex package)
- Python dependency in a Node.js project
- Known breakage with duplicate versions and dynamic imports

The concept is sound but esbuild does it better from `node_modules`.

## CDN Comparison

We evaluated consolidating to a single CDN as part of Option B:

| | esm.sh | jsDelivr | unpkg | cdnjs |
|---|---|---|---|---|
| ESM support | Native (purpose-built) | Via `/+esm` suffix | Only if package ships ESM | No |
| Peer dep bundling | Yes (`?deps=` param) | No equivalent | No | N/A |
| SRI support | No | Partial (static files only) | No | Yes |
| Reliability | Concerns (small team, no SLA) | Excellent (multi-CDN, 150B+ req/mo) | Poor (effectively unmaintained) | Excellent (Cloudflare-backed) |
| Security posture | CVE-2026-27730 (SSRF, unpatched) | Cached malicious packages can persist | No security features | Curated catalog |

**Key finding:** No single CDN can replace all 4. esm.sh's `?deps=` parameter for chart.js plugin peer dependency pinning has no equivalent on jsDelivr. Consolidation to 2 CDNs (esm.sh + jsDelivr) was the best possible outcome for Option B, but esm.sh's unpatched CVE is a concern.

## Security Concerns

### esm.sh CVE-2026-27730

An SSRF vulnerability was disclosed in February 2026 with no patch from the maintainers. The project is run by a small independent team with no published SLA or uptime guarantees. This CDN currently serves all chart.js ecosystem imports and rum-distiller for the optel tools.

### Supply Chain Attack Window

Analysis by William Woodruff (https://blog.yossarian.net/2025/11/21/We-should-all-be-using-dependency-cooldowns) found that 8 of 10 major npm supply chain attacks had exploitation windows under 1 week. Dependabot's `cooldown` feature (GA July 2025) delays version update PRs, reducing exposure to compromised releases while still allowing security advisories through immediately.

### SRI via Import Maps

Browser support for import map `integrity` field is now available (Chrome 127+, Safari 18+, Firefox). However, SRI only works with byte-identical responses. CDNs that do on-the-fly ESM transformation (esm.sh, jsDelivr `/+esm`) can change output when they update their build pipeline, silently breaking integrity checks. This makes SRI fragile for the CDN approach but irrelevant for vendoring (local files are inherently stable).

## Dependabot Cooldown Configuration

Cooldown is configured per semver level. Security updates bypass cooldown entirely.

```yaml
cooldown:
  semver-major-days: 30    # Major versions: wait 30 days
  semver-minor-days: 7     # Minor versions: wait 7 days
  semver-patch-days: 3     # Patch versions: wait 3 days
```

This matches GitHub's documented recommendation. The chart.js ecosystem is grouped so chart.js and its plugins are bumped together in a single PR.

Reference: https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference

## Decision

**Option A (Full Vendoring)** was selected because:

1. At similar implementation complexity to Option B+ (automated URL sync), vendoring provides strictly better security and reliability
2. Eliminates the esm.sh CVE exposure
3. Dependabot PRs become directly actionable (`npm install` -> commit) rather than advisory
4. No CDN can go down and break the site
5. Single source of truth for versions in `package.json`

The postinstall script uses a lockfile hash for idempotency, making it safe and fast on repeated `npm install` / `npm ci` runs.

## Implementation Summary

- Add all runtime deps to `package.json` as `dependencies`
- Add `esbuild` as a dev dependency for bundling packages with bare-specifier imports
- Create `scripts/vendor.mjs` (postinstall hook) that copies or esbuild-bundles each dep into `vendor/`
- Commit `vendor/` to git (required by EDS — no server-side build step)
- Update import maps in HTML files and dynamic imports in JS files to point to `/vendor/` paths
- Remove CDN URLs from CSP headers
- Configure dependabot with weekly schedule and cooldown
- Clean up redundant sub-directory package.json files and duplicated vendored diff.js copies

## Follow-up Opportunities

- Replace `chartjs-adapter-luxon` + `luxon` with a native `Intl.DateTimeFormat`-based date adapter (~50 lines, eliminates 2 deps and ~70KB)
- GitHub Action to auto-commit `vendor/` updates on dependabot PRs
