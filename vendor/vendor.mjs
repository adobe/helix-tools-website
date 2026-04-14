#!/usr/bin/env node
/**
 * Bundles vendored browser builds from node_modules into vendor/.
 * Run via `npm run vendor` after updating dependencies.
 * Also runs automatically via postinstall and Renovate postUpgradeTasks.
 *
 * Idempotent: skips rebuild when package-lock.json is unchanged.
 */

import { createHash } from 'crypto';
import { build } from 'esbuild';
import {
  existsSync, mkdirSync, readFileSync, rmSync, writeFileSync,
} from 'fs';
import { join } from 'path';

const root = new URL('..', import.meta.url).pathname;
const lockfile = join(root, 'package-lock.json');
const vendorDir = join(root, 'vendor');
const hashFile = join(vendorDir, '.vendor-hash');

const currentHash = createHash('sha256').update(readFileSync(lockfile)).digest('hex');
const storedHash = existsSync(hashFile) ? readFileSync(hashFile, 'utf8').trim() : '';

if (currentHash === storedHash) {
  console.log('vendor: up to date');
  process.exit(0);
}

mkdirSync(vendorDir, { recursive: true });

async function bundle(pkg, outfile) {
  const entryPoint = join(root, 'node_modules', pkg);
  const out = join(vendorDir, outfile);
  await build({
    entryPoints: [entryPoint],
    bundle: true,
    format: 'esm',
    outfile: out,
    platform: 'browser',
  });
  console.log(`vendored: ${pkg} → vendor/${outfile}`);
}

// Remove legacy directory-based vendor output if present
const legacyYaml = join(vendorDir, 'yaml');
if (existsSync(legacyYaml) && !legacyYaml.endsWith('.js')) {
  rmSync(legacyYaml, { recursive: true });
}

await bundle('yaml/browser/index.js', 'yaml.js');

writeFileSync(hashFile, currentHash);
