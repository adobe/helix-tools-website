#!/usr/bin/env node

/**
 * Generate tool thumbnail images using Adobe Firefly API (v3 async).
 *
 * Prerequisites:
 *   - FIREFLY_CLIENT_ID and FIREFLY_CLIENT_SECRET in .cache/.env or environment
 *   - See references/firefly-setup.md for credential setup instructions
 *
 * Usage:
 *   node generate.mjs --prompt "your firefly prompt" [--output tool-image] [--n 4]
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = resolve(__dirname, '.cache');
const TOKEN_CACHE_PATH = resolve(CACHE_DIR, 'token.json');
const ENV_PATH = resolve(CACHE_DIR, '.env');

// Load .env file from .cache dir if it exists
try {
  const envRaw = await readFile(ENV_PATH, 'utf-8');
  for (const line of envRaw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
} catch {
  // No .env file — rely on environment variables
}

const IMS_TOKEN_URL = 'https://ims-na1.adobelogin.com/ims/token/v3';
const FIREFLY_API_BASE = 'https://firefly-api.adobe.io';
const GENERATE_ENDPOINT = `${FIREFLY_API_BASE}/v3/images/generate-async`;
const TOKEN_MAX_AGE_MS = 23 * 60 * 60 * 1000; // 23 hours (tokens expire at 24h)

const { values: args } = parseArgs({
  options: {
    prompt: { type: 'string' },
    output: { type: 'string', default: 'tool-image' },
    n: { type: 'string', default: '4' },
  },
});

if (!args.prompt) {
  console.error('Usage: node generate.mjs --prompt "your prompt" [--output name] [--n 4]');
  process.exit(1);
}

const clientId = process.env.FIREFLY_CLIENT_ID;
const clientSecret = process.env.FIREFLY_CLIENT_SECRET;

if (!clientId || !clientSecret) {
  console.error('Missing FIREFLY_CLIENT_ID or FIREFLY_CLIENT_SECRET.');
  console.error('Add them to .cache/.env or set as environment variables.');
  console.error('See references/firefly-setup.md for setup instructions.');
  process.exit(1);
}

async function loadCachedToken() {
  try {
    const raw = await readFile(TOKEN_CACHE_PATH, 'utf-8');
    const cached = JSON.parse(raw);
    if (cached.clientId === clientId && Date.now() - cached.createdAt < TOKEN_MAX_AGE_MS) {
      return cached.accessToken;
    }
  } catch {
    // No cache or unreadable — will fetch fresh
  }
  return null;
}

async function saveCachedToken(accessToken) {
  await mkdir(dirname(TOKEN_CACHE_PATH), { recursive: true });
  await writeFile(TOKEN_CACHE_PATH, JSON.stringify({
    accessToken,
    clientId,
    createdAt: Date.now(),
  }));
}

async function getAccessToken() {
  const cached = await loadCachedToken();
  if (cached) {
    console.log('Using cached token.');
    return cached;
  }

  const params = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
    scope: 'openid,AdobeID,session,additional_info,read_organizations,firefly_api,ff_apis',
  });

  const resp = await fetch(IMS_TOKEN_URL, { method: 'POST', body: params });
  if (!resp.ok) {
    throw new Error(`Auth failed: ${resp.status} ${await resp.text()}`);
  }
  const data = await resp.json();
  await saveCachedToken(data.access_token);
  return data.access_token;
}

async function submitJob(token, prompt, numVariations) {
  const body = {
    prompt,
    numVariations,
    contentClass: 'art',
    size: { width: 2048, height: 2048 },
  };

  const resp = await fetch(GENERATE_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'x-api-key': clientId,
      'x-model-version': 'image4_standard',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    throw new Error(`Job submission failed: ${resp.status} ${await resp.text()}`);
  }
  return resp.json();
}

async function pollJob(token, statusUrl, maxAttempts = 30) {
  for (let i = 0; i < maxAttempts; i++) {
    const resp = await fetch(statusUrl, {
      headers: {
        'x-api-key': clientId,
        Authorization: `Bearer ${token}`,
      },
    });

    if (!resp.ok) {
      throw new Error(`Status check failed: ${resp.status} ${await resp.text()}`);
    }

    const data = await resp.json();
    const { status } = data;

    if (status === 'succeeded') return data;
    if (status === 'failed') throw new Error(`Job failed: ${JSON.stringify(data)}`);

    console.log(`Status: ${status} (attempt ${i + 1}/${maxAttempts})...`);
    await new Promise((r) => { setTimeout(r, 2000); });
  }
  throw new Error('Job timed out');
}

async function downloadImage(url, filePath) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Download failed: ${resp.status}`);
  const buffer = Buffer.from(await resp.arrayBuffer());
  await writeFile(filePath, buffer);
}

async function main() {
  const numVariations = parseInt(args.n, 10);

  console.log('Authenticating...');
  const token = await getAccessToken();

  console.log(`Submitting job (${numVariations} variations)...`);
  const job = await submitJob(token, args.prompt, numVariations);

  const { statusUrl } = job;
  if (!statusUrl) {
    // Synchronous-style response — images returned directly
    const outputs = job.outputs || [];
    for (let i = 0; i < outputs.length; i++) {
      const url = outputs[i].image?.url;
      if (url) {
        const filePath = `${args.output}-${i + 1}.jpg`;
        console.log(`Downloading ${filePath}...`);
        await downloadImage(url, filePath);
      }
    }
    console.log(`Done. ${outputs.length} image(s) saved.`);
    return;
  }

  console.log('Waiting for results...');
  const result = await pollJob(token, statusUrl);

  const outputs = result.outputs || result.result?.outputs || [];
  for (let i = 0; i < outputs.length; i++) {
    const url = outputs[i].image?.url;
    if (url) {
      const filePath = `${args.output}-${i + 1}.jpg`;
      console.log(`Downloading ${filePath}...`);
      await downloadImage(url, filePath);
    }
  }
  console.log(`Done. ${outputs.length} image(s) saved.`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
