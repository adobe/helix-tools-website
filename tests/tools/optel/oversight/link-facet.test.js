import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { labelURLParts } from '../../../../tools/optel/oversight/elements/link-facet.js';

describe('optel/oversight: labelURLParts', () => {
  it('renders parts for a https url', () => {
    const html = labelURLParts('https://example.com/path', '', true);
    assert.match(html, /<span class="protocol"[^>]*>https:<\/span>/);
    assert.match(html, /<span class="hostname"[^>]*>example\.com<\/span>/);
    assert.match(html, /<span class="pathname"[^>]*>\/path<\/span>/);
  });

  it('renders the port for http://localhost:5710/path', () => {
    const html = labelURLParts('http://localhost:5710/path', '', true);
    assert.match(html, /<span class="hostname"[^>]*>localhost<\/span>/);
    assert.match(
      html,
      /<span class="port"[^>]*>5710<\/span>/,
      'port should be rendered as its own span — without it the rendered URL silently drops :5710',
    );
    assert.match(html, /<span class="pathname"[^>]*>\/path<\/span>/);
  });

  it('keeps the port when collapsing against a prefix', () => {
    const html = labelURLParts(
      'http://localhost:5710/foo/bar',
      'http://localhost:5710/',
      false,
    );
    assert.match(html, /class="collapse"/);
    assert.match(html, /title="http:\/\/localhost:5710\/foo\/bar"/);
  });

  it('preserves : in the displayed URL when no prefix', () => {
    const html = labelURLParts('http://localhost:5710/foo', '', false);
    assert.ok(
      html.includes('5710'),
      `expected port 5710 in rendered output, got: ${html}`,
    );
  });
});
