import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const toolDirectory = new URL('../../../tools/asset-sourcing-portal/', import.meta.url);

const readToolFile = (name) => readFile(new URL(name, toolDirectory), 'utf8');

describe('portal static shell', () => {
  it('preserves stable branding hooks and one-page states', async () => {
    const html = await readToolFile('index.html');
    [
      'asp-portal-shell',
      'asp-portal-header',
      'asp-portal-brand',
      'asp-portal-logo',
      'asp-portal-title',
      'asp-portal-banner',
      'asp-portal-main',
      'asp-portal-signin',
      'asp-portal-footer',
      'asp-upload-view',
      'asp-confirmation-view',
    ].forEach((id) => assert.match(html, new RegExp(`id="${id}"`)));
  });

  it('ships restrictive CSP directives and nonce-based scripts', async () => {
    const html = await readToolFile('index.html');
    assert.match(html, /script-src 'nonce-aem' 'strict-dynamic'/);
    assert.match(html, /object-src 'none'/);
    assert.match(html, /base-uri 'none'/);
    assert.match(html, /frame-ancestors 'none'/);
    assert.match(html, /form-action 'none'/);
    assert.match(html, /connect-src/);
    assert.match(html, /nonce="aem"/);
  });

  it('keeps the public API configuration aligned with CSP', async () => {
    const [html, configSource] = await Promise.all([
      readToolFile('index.html'),
      readToolFile('portal-config.json'),
    ]);
    const config = JSON.parse(configSource);
    assert.match(html, new RegExp(new URL(config.apiBaseUrl).origin));
    assert.equal(config.imsOrgId, '');
  });

  it('does not add unsafe DOM parsing or session-token persistence', async () => {
    const source = await readToolFile('asset-sourcing-portal.js');
    assert.doesNotMatch(source, /innerHTML|insertAdjacentHTML/);
    assert.doesNotMatch(source, /(?:session|local)Storage\.setItem/);
    assert.doesNotMatch(source, /\.style\./);
  });
});
