#!/usr/bin/env node
/**
 * Bundles vendored browser builds from node_modules into vendor/.
 * Run via `npm run vendor` after updating dependencies.
 * Also runs automatically via postinstall and Renovate postUpgradeTasks.
 *
 * Idempotent: skips rebuild when package-lock.json is unchanged.
 *
 * To add a dependency: add an entry to DEPS below, then run `npm run vendor`.
 */

import { createHash } from 'crypto';
import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { join } from 'path';

const root = new URL('..', import.meta.url).pathname;
const vendorDir = join(root, 'vendor');
const hashFile = join(vendorDir, '.vendor-hash');

// --- Dependencies ---
// Each entry maps a node_modules entry point to a single bundled output file.
const DEPS = [
  { pkg: 'yaml/browser/index.js', out: 'yaml.js' },
];
// ---

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

await Promise.all(DEPS.map(async ({ pkg, out }) => {
  await build({
    entryPoints: [join(root, 'node_modules', pkg)],
    bundle: true,
    format: 'esm',
    outfile: join(vendorDir, out),
    platform: 'browser',
  });
  console.log(`vendored: ${pkg} → vendor/${out}`);
}));
