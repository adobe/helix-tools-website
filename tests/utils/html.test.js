import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import escapeHtml from '../../utils/html.js';

describe('utils/html.js', () => {
  describe('escapeHtml', () => {
    it('escapes HTML via the DOM (named entities for special chars)', () => {
      assert.equal(escapeHtml('&<>"\' '), '&amp;&lt;&gt;&quot;&#39; ');
    });

    it('escapes script-like markup', () => {
      assert.equal(
        escapeHtml('<script>alert("xss")</script>'),
        '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;',
      );
      assert.equal(
        escapeHtml("<script>alert('xss')</script>"),
        '&lt;script&gt;alert(&#39;xss&#39;)&lt;/script&gt;',
      );
      assert.equal(escapeHtml('<div>hello</div>'), '&lt;div&gt;hello&lt;/div&gt;');
    });

    it('returns plain strings unchanged', () => {
      assert.equal(escapeHtml('hello world'), 'hello world');
    });

    it('handles empty string', () => {
      assert.equal(escapeHtml(''), '');
    });

    it('handles null and undefined', () => {
      assert.equal(escapeHtml(null), '');
      assert.equal(escapeHtml(undefined), '');
    });

    it('coerces non-strings', () => {
      assert.equal(escapeHtml(42), '42');
    });

    it('escapes multiple occurrences', () => {
      assert.equal(escapeHtml('a & b & c'), 'a &amp; b &amp; c');
    });
  });
});
