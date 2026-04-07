/*
 * Vendor script — copies or bundles runtime JS dependencies from node_modules
 * into vendor/ as browser-ready ES modules. Run automatically via postinstall.
 *
 * Idempotency: hashes package-lock.json and skips if vendor/.vendor-hash matches.
 */

import { readFileSync, writeFileSync, copyFileSync, mkdirSync, existsSync } from 'fs';
import { createHash } from 'crypto';
import { join } from 'path';
import * as esbuild from 'esbuild';

const VENDOR_DIR = 'vendor';
const HASH_FILE = join(VENDOR_DIR, '.vendor-hash');

// --- Idempotency check ---
const lockContent = readFileSync('package-lock.json', 'utf8');
const lockHash = createHash('sha256').update(lockContent).digest('hex');

if (existsSync(HASH_FILE) && readFileSync(HASH_FILE, 'utf8').trim() === lockHash) {
  console.log('vendor/ up to date, skipping.');
  process.exit(0);
}

console.log('Generating vendor/ files...');
mkdirSync(VENDOR_DIR, { recursive: true });
mkdirSync(join(VENDOR_DIR, 'prismjs', 'components'), { recursive: true });

// --- Direct copies (pre-bundled dist files) ---

copyFileSync(
  'node_modules/echarts/dist/echarts.esm.min.js',
  join(VENDOR_DIR, 'echarts.js'),
);

copyFileSync(
  'node_modules/prismjs/prism.js',
  join(VENDOR_DIR, 'prismjs', 'prism.min.js'),
);

// Prism language components — add entries here as needed
const prismLanguages = ['json'];
for (const lang of prismLanguages) {
  copyFileSync(
    `node_modules/prismjs/components/prism-${lang}.min.js`,
    join(VENDOR_DIR, 'prismjs', 'components', `prism-${lang}.min.js`),
  );
}

// --- esbuild bundles ---

// Shared esbuild options
const shared = { bundle: true, format: 'esm', minify: true, logLevel: 'warning' };

await Promise.all([
  // chart.js — combined main + helpers entry, inlines @kurkle/color.
  // Both "chart.js" and "chart.js/helpers" import map entries point to this file.
  esbuild.build({
    ...shared,
    stdin: {
      contents: "export * from 'chart.js';\nexport * from 'chart.js/helpers';",
      resolveDir: process.cwd(),
    },
    outfile: join(VENDOR_DIR, 'chart.js'),
  }),

  // chartjs-adapter-luxon — inlines luxon, externalizes chart.js
  esbuild.build({
    ...shared,
    stdin: {
      contents: "import 'chartjs-adapter-luxon';",
      resolveDir: process.cwd(),
    },
    external: ['chart.js'],
    outfile: join(VENDOR_DIR, 'chartjs-adapter-luxon.js'),
  }),

  // chartjs-plugin-datalabels — externalizes chart.js
  esbuild.build({
    ...shared,
    stdin: {
      contents: "export { default } from 'chartjs-plugin-datalabels';",
      resolveDir: process.cwd(),
    },
    external: ['chart.js'],
    outfile: join(VENDOR_DIR, 'chartjs-plugin-datalabels.js'),
  }),

  // chartjs-chart-sankey — externalizes chart.js
  esbuild.build({
    ...shared,
    stdin: {
      contents: "export * from 'chartjs-chart-sankey';",
      resolveDir: process.cwd(),
    },
    external: ['chart.js'],
    outfile: join(VENDOR_DIR, 'chartjs-chart-sankey.js'),
  }),

  // @adobe/rum-distiller — bundles all internal modules into one file
  esbuild.build({
    ...shared,
    stdin: {
      contents: "export * from '@adobe/rum-distiller';",
      resolveDir: process.cwd(),
    },
    outfile: join(VENDOR_DIR, 'rum-distiller.js'),
  }),

  // yaml — bundles browser entry (has relative imports internally)
  esbuild.build({
    ...shared,
    stdin: {
      contents: "export * from 'yaml';",
      resolveDir: process.cwd(),
    },
    conditions: ['browser'],
    outfile: join(VENDOR_DIR, 'yaml.js'),
  }),

  // diff — bundles into single file (centralizes from duplicate copies)
  esbuild.build({
    ...shared,
    stdin: {
      contents: "export * from 'diff';",
      resolveDir: process.cwd(),
    },
    outfile: join(VENDOR_DIR, 'diff.js'),
  }),
]);

// --- Write hash marker ---
writeFileSync(HASH_FILE, lockHash);
console.log('vendor/ files generated successfully.');
