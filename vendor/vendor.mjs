#!/usr/bin/env node
/**
 * Bundles all entries in package.json `dependencies` into vendor/ as
 * single-file browser ESM modules.
 *
 * Run via `npm run vendor` after updating dependencies.
 * Also runs automatically via postinstall and Renovate postUpgradeTasks.
 *
 * Idempotent: skips rebuild when package-lock.json is unchanged.
 *
 * To add a dependency: add it to `dependencies` in package.json and
 * run `npm install`. No changes to this file are needed.
 */

import { createHash } from 'crypto';
import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { join } from 'path';

const root = new URL('..', import.meta.url).pathname;
const vendorDir = join(root, 'vendor');
const hashFile = join(vendorDir, '.vendor-hash');

const [lockfile, pkgJson, storedHash] = await Promise.all([
  readFile(join(root, 'package-lock.json')),
  readFile(join(root, 'package.json'), 'utf8').then(JSON.parse),
  readFile(hashFile, 'utf8').then((h) => h.trim()).catch(() => ''),
]);

const currentHash = createHash('sha256').update(lockfile).digest('hex');

if (currentHash === storedHash) {
  console.log('vendor: up to date');
  process.exit(0);
}

await mkdir(vendorDir, { recursive: true });
await writeFile(hashFile, currentHash);

const deps = Object.keys(pkgJson.dependencies ?? {});

await Promise.all(deps.map(async (name) => {
  // Strip npm scope prefix for the output filename (e.g. @adobe/foo → foo.js)
  const outname = name.replace(/^@[^/]+\//, '');
  await build({
    entryPoints: [name],
    bundle: true,
    format: 'esm',
    outfile: join(vendorDir, `${outname}.js`),
    platform: 'browser',
  });
  console.log(`vendored: ${name} → vendor/${outname}.js`);
}));
