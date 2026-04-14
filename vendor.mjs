#!/usr/bin/env node
/**
 * Copies vendored browser builds from node_modules into vendor/.
 * Run via `npm run vendor` after updating dependencies.
 * Renovate runs this automatically via postUpgradeTasks.
 */

import { cpSync, mkdirSync } from 'fs';
import { join } from 'path';

const root = new URL('.', import.meta.url).pathname;

function vendor(src, dest) {
  const from = join(root, 'node_modules', src);
  const to = join(root, 'vendor', dest);
  mkdirSync(to, { recursive: true });
  cpSync(from, to, { recursive: true });
  console.log(`vendored: ${src} → vendor/${dest}`);
}

vendor('yaml/browser', 'yaml');
