#!/usr/bin/env node
/**
 * Bundles vendor dependencies into single-file browser ESM modules.
 *
 * Run via `npm run vendor` after updating dependencies.
 * Also runs automatically via postinstall and Renovate postUpgradeTasks.
 *
 * Idempotent: skips rebuild when package-lock.json is unchanged.
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
import { mkdir, readFile, writeFile } from 'fs/promises';
import { join } from 'path';

// =============================================================================
// DEPS — update this when adding or changing vendored dependencies
// =============================================================================
const DEPS = [
  { pkg: 'yaml', out: 'yaml.js' },

  // Chart.js must be listed before its plugins so the output file exists when
  // the plugins are loaded. Plugins declare chart.js as external so all bundles
  // share the same Chart instance; the import map in each HTML file resolves it.
  // { pkg: 'chart.js', out: 'chartjs.js' },
  // { pkg: 'luxon', out: 'luxon.js' },
  // { pkg: 'chartjs-adapter-luxon', out: 'chartjs-adapter-luxon.js', external: ['chart.js', 'luxon'] },
  // { pkg: 'chartjs-plugin-datalabels', out: 'chartjs-plugin-datalabels.js', external: ['chart.js'] },
  // { pkg: 'chartjs-chart-sankey', out: 'chartjs-chart-sankey.js', external: ['chart.js'] },
  // { pkg: '@adobe/rum-distiller', out: 'rum-distiller.js' },
  // { pkg: 'echarts', out: 'echarts.js' },
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

if (currentHash === storedHash) {
  console.log('vendor: up to date');
  process.exit(0);
}

await mkdir(vendorDir, { recursive: true });
await writeFile(hashFile, currentHash);

await Promise.all(DEPS.map(async ({ pkg, out, external = [] }) => {
  await build({
    entryPoints: [pkg],
    bundle: true,
    format: 'esm',
    outfile: join(vendorDir, out),
    platform: 'browser',
    external,
  });
  console.log(`vendored: ${pkg} → vendor/${out}`);
}));
