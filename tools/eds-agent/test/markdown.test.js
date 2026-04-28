/* eslint-env node, es2020 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml, renderMarkdown } from '../helpers/markdown.js';

describe('eds-agent:markdown.js — escapeHtml', () => {
  it('escapes &, <, >, "', () => {
    assert.equal(escapeHtml('a & b'), 'a &amp; b');
    assert.equal(escapeHtml('<div>'), '&lt;div&gt;');
    assert.equal(escapeHtml('say "hi"'), 'say &quot;hi&quot;');
  });

  it('handles empty string', () => {
    assert.equal(escapeHtml(''), '');
  });
});

describe('eds-agent:markdown.js — renderMarkdown', () => {
  it('returns empty string for falsy input', () => {
    assert.equal(renderMarkdown(''), '');
    assert.equal(renderMarkdown(null), '');
    assert.equal(renderMarkdown(undefined), '');
  });

  it('renders fenced code blocks with language class', () => {
    const out = renderMarkdown('```js\nconst x = 1;\n```');
    assert.match(out, /<pre><code class="lang-js">const x = 1;<\/code><\/pre>/);
  });

  it('renders fenced code blocks without language', () => {
    const out = renderMarkdown('```\nplain code\n```');
    assert.match(out, /<pre><code class="lang-">plain code<\/code><\/pre>/);
  });

  it('escapes HTML inside code blocks', () => {
    const out = renderMarkdown('```\n<script>\n```');
    assert.match(out, /&lt;script&gt;/);
  });

  it('renders a basic table', () => {
    const md = '| h1 | h2 |\n|---|---|\n| a | b |\n| c | d |';
    const out = renderMarkdown(md);
    assert.match(out, /<table><thead><tr><th>h1<\/th><th>h2<\/th><\/tr><\/thead>/);
    assert.match(out, /<tbody><tr><td>a<\/td><td>b<\/td><\/tr><tr><td>c<\/td><td>d<\/td><\/tr><\/tbody>/);
  });

  it('renders inline code', () => {
    assert.match(renderMarkdown('use `foo` here'), /<code>foo<\/code>/);
  });

  it('renders bold and italic', () => {
    assert.match(renderMarkdown('**bold**'), /<strong>bold<\/strong>/);
    assert.match(renderMarkdown('*italic*'), /<em>italic<\/em>/);
  });

  it('renders headers h1 through h4', () => {
    assert.match(renderMarkdown('# H1'), /<h1>H1<\/h1>/);
    assert.match(renderMarkdown('## H2'), /<h2>H2<\/h2>/);
    assert.match(renderMarkdown('### H3'), /<h3>H3<\/h3>/);
    assert.match(renderMarkdown('#### H4'), /<h4>H4<\/h4>/);
  });

  it('wraps consecutive list items in <ul>', () => {
    const out = renderMarkdown('- one\n- two\n- three');
    assert.match(out, /<ul><li>one<\/li>\n<li>two<\/li>\n<li>three<\/li>\n?<\/ul>/);
  });

  it('renders links with target=_blank rel=noopener', () => {
    const out = renderMarkdown('[Adobe](https://adobe.com)');
    assert.match(out, /<a href="https:\/\/adobe\.com" target="_blank" rel="noopener">Adobe<\/a>/);
  });

  it('does not double-wrap headers in paragraphs', () => {
    const out = renderMarkdown('# Title');
    assert.doesNotMatch(out, /<p><h1>/);
    assert.doesNotMatch(out, /<\/h1><\/p>/);
  });

  it('escapes raw HTML in plain text', () => {
    const out = renderMarkdown('hello <world>');
    assert.match(out, /&lt;world&gt;/);
    assert.doesNotMatch(out, /<world>/);
  });
});
