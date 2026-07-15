import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  appendThumbnail,
  getFaviconUrl,
  getOgImageUrl,
  is404CheckpointActive,
  isThumbnailUrl,
  labelURLParts,
} from '../../../../tools/optel/oversight/elements/link-facet.js';

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

describe('optel/oversight: thumbnail helpers', () => {
  class MockImage {
    constructor() {
      this.onload = null;
      this.onerror = null;
      this.srcValue = '';
      MockImage.instances.push(this);
    }

    set src(value) {
      this.srcValue = value;
    }

    get src() {
      return this.srcValue;
    }
  }

  MockImage.instances = [];

  const createContainer = () => ({ children: [], prepend(node) { this.children.unshift(node); } });

  it('detects thumbnail-eligible urls', () => {
    assert.equal(isThumbnailUrl('https://example.com/path'), true);
    assert.equal(isThumbnailUrl('http://example.com/path'), true);
    assert.equal(isThumbnailUrl('android-app://com.example/app'), true);
    assert.equal(isThumbnailUrl('/products/foo'), false);
  });

  it('builds og image proxy urls', () => {
    const url = getOgImageUrl('https://example.com/page');
    assert.match(url, /^https:\/\/www\.aem\.live\/tools\/rum\/_ogimage\?/);
    assert.match(url, /proxyurl=https%3A%2F%2Fexample\.com%2Fpage/);
  });

  it('builds favicon fallback urls', () => {
    const url = getFaviconUrl('https://example.com/page');
    assert.match(url, /^https:\/\/www\.google\.com\/s2\/favicons\?/);
    assert.match(url, /domain=https%3A%2F%2Fexample\.com%2Fpage/);
  });

  it('skips thumbnails when the 404 checkpoint is active', () => {
    assert.equal(is404CheckpointActive({ href: 'https://tools.aem.live/tools/optel/oversight/explorer.html?checkpoint=404' }), true);
    assert.equal(is404CheckpointActive({ href: 'https://tools.aem.live/tools/optel/oversight/explorer.html?checkpoint=enter&checkpoint=404' }), true);
    assert.equal(is404CheckpointActive({ href: 'https://tools.aem.live/tools/optel/oversight/explorer.html?checkpoint=enter' }), false);
  });

  it('appends an image only after a successful probe', () => {
    MockImage.instances = [];
    const container = createContainer();
    appendThumbnail(container, 'https://example.com/page', { ImageCtor: MockImage });
    assert.equal(container.children.length, 0);
    MockImage.instances[0].onload();
    assert.equal(container.children.length, 1);
    assert.equal(container.children[0].tagName, 'IMG');
    assert.equal(container.children[0].alt, '');
    assert.equal(container.children[0].src, getOgImageUrl('https://example.com/page'));
  });

  it('falls back to favicon when og image probe fails', () => {
    MockImage.instances = [];
    const container = createContainer();
    appendThumbnail(container, 'https://example.com/page', { favicon: true, ImageCtor: MockImage });
    MockImage.instances[0].onerror();
    MockImage.instances[1].onload();
    assert.equal(container.children.length, 1);
    assert.equal(container.children[0].className, 'favicon');
    assert.equal(container.children[0].src, getFaviconUrl('https://example.com/page'));
  });

  it('does not append an image when og image probe fails without favicon fallback', () => {
    MockImage.instances = [];
    const container = createContainer();
    appendThumbnail(container, 'https://example.com/page', { ImageCtor: MockImage });
    MockImage.instances[0].onerror();
    assert.equal(container.children.length, 0);
  });
});
