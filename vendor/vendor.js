#!/usr/bin/env node
/**
 * Bundles vendor dependencies into single-file browser ESM modules.
 *
 * Run via `npm run vendor` after updating dependencies.
 * Also runs automatically via postinstall. On Mend-hosted Renovate PRs, CI
 * auto-commits vendor updates in `.github/workflows/main.yaml` (same job as
 * the build) because Renovate cannot run post-upgrade vendor there.
 *
 * Idempotent locally: skips rebuild when package-lock.json is unchanged and
 * `.vendor-hash` matches. In CI (`CI` env, e.g. GitHub Actions) always rebuilds
 * so vendored files cannot quietly drift from hand edits without a lockfile change.
 *
 * To add a dependency:
 *   1. Add it to `dependencies` in package.json and run `npm install`
 *   2. Add an entry to DEPS below
 *
 * Config shape:
 *   pkg      - npm package name used as the esbuild entry point
 *   out      - output filename under vendor/
 *   external - (optional) bare specifiers to leave unresolved in the bundle.
 *              Use this when multiple bundles must share the same module
 *              instance at runtime (e.g. chart.js plugins externalising chart.js).
 *              The host page is responsible for resolving these via an import map.
 */

import { createHash } from 'crypto';
import { build } from 'esbuild';
import { mkdir, readdir, readFile, rm, writeFile } from 'fs/promises';
import { join } from 'path';

// =============================================================================
// DEPS — update this when adding or changing vendored dependencies
// =============================================================================
const DEPS = [
  { pkg: 'diff', out: 'diff/diff.js' },
  { pkg: 'yaml', out: 'yaml/yaml.js' },

  // Prism core + language components as separate bundles.
  // Language component files reference Prism as a bare global (no require/import),
  // so esbuild leaves that reference intact — same as how the CDN scripts worked.
  { pkg: 'prismjs', out: 'prismjs/prismjs.js' },
  { pkg: 'prismjs/components/prism-json.js', out: 'prismjs/prism-json.js' },
  { pkg: 'prismjs/components/prism-markup.js', out: 'prismjs/prism-markup.js' },
  { pkg: 'prismjs/components/prism-markup-templating.js', out: 'prismjs/prism-markup-templating.js' },
  { pkg: 'prismjs/components/prism-handlebars.js', out: 'prismjs/prism-handlebars.js' },

  // Chart.js must be listed before its plugins so the output file exists when
  // the plugins are loaded. Plugins declare chart.js as external so all bundles
  // share the same Chart instance; the import map in each HTML file resolves it.
  // { pkg: 'chart.js', out: 'chartjs/chartjs.js' },
  // { pkg: 'luxon', out: 'luxon/luxon.js' },
  // { pkg: 'chartjs-adapter-luxon', out: 'chartjs-adapter-luxon/chartjs-adapter-luxon.js', external: ['chart.js', 'luxon'] },
  // { pkg: 'chartjs-plugin-datalabels', out: 'chartjs-plugin-datalabels/chartjs-plugin-datalabels.js', external: ['chart.js'] },
  // { pkg: 'chartjs-chart-sankey', out: 'chartjs-chart-sankey/chartjs-chart-sankey.js', external: ['chart.js'] },
  // { pkg: '@adobe/rum-distiller', out: 'rum-distiller/rum-distiller.js' },
  // { pkg: 'echarts', out: 'echarts/echarts.js' },
];
// =============================================================================

const root = new URL('..', import.meta.url).pathname;
const vendorDir = join(root, 'vendor');
const hashFile = join(vendorDir, '.vendor-hash');

const [lockfile, storedHash] = await Promise.all([
  readFile(join(root, 'package-lock.json')),
  readFile(hashFile, 'utf8').then((h) => h.trim()).catch(() => ''),
]);

const currentHash = createHash('sha256').update(lockfile).digest('hex');

if (currentHash === storedHash && !process.env.CI) {
  console.log('vendor: up to date');
  process.exit(0);
}

await mkdir(vendorDir, { recursive: true });

const existing = await readdir(vendorDir, { withFileTypes: true });
await Promise.all(
  existing.filter((e) => e.isDirectory()).map((e) => rm(join(vendorDir, e.name), { recursive: true })),
);

await Promise.all(DEPS.map(async ({ pkg, out, external = [] }) => {
  await build({
    entryPoints: [pkg],
    bundle: true,
    format: 'esm',
    outfile: join(vendorDir, out),
    platform: 'browser',
    minify: true,
    external,
  });
  console.log(`vendored: ${pkg} → vendor/${out}`);
}));

await writeFile(hashFile, currentHash);
