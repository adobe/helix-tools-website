import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseCategories, slugify } from '../../../blocks/header/categories.js';

const fixture = `
  <div>
    <ul>
      <li><a href="https://tools.aem.live/">🏠 Home</a></li>
      <li>Setup &amp; Configure
        <ul>
          <li><a href="https://tools.aem.live/tools/admin-edit/index.html">Admin Edit</a></li>
          <li><a href="https://tools.aem.live/tools/site-admin/index.html">Site Admin</a></li>
        </ul>
      </li>
      <li>Publish &amp; Manage
        <ul>
          <li><a href="https://tools.aem.live/tools/bulk/index.html">Bulk Operations</a></li>
        </ul>
      </li>
      <li>Dev &amp; Diagnostics
        <ul>
          <li><a href="https://tools.aem.live/tools/svg-doctor/">SVG Doctor</a></li>
        </ul>
      </li>
    </ul>
    <p>🧪 = Experimental tools from our labs</p>
  </div>
`;

describe('blocks/header/categories.js', () => {
  describe('slugify', () => {
    it('lowercases and dasherises labels', () => {
      assert.equal(slugify('Setup & Configure'), 'setup-configure');
      assert.equal(slugify('Publish & Manage'), 'publish-manage');
      assert.equal(slugify('Dev & Diagnostics'), 'dev-diagnostics');
    });
    it('strips repeated dashes and trims', () => {
      assert.equal(slugify('  Foo  --  Bar  '), 'foo-bar');
    });
  });

  describe('parseCategories', () => {
    it('returns ordered categories from a nav fragment', () => {
      const cats = parseCategories(fixture);
      assert.deepEqual(cats.map((c) => c.slug), ['setup-configure', 'publish-manage', 'dev-diagnostics']);
      assert.deepEqual(cats.map((c) => c.label), ['Setup & Configure', 'Publish & Manage', 'Dev & Diagnostics']);
    });

    it('collects tools per category with author labels', () => {
      const cats = parseCategories(fixture);
      const setup = cats.find((c) => c.slug === 'setup-configure');
      assert.ok(Array.isArray(setup.tools));
      assert.equal(setup.tools.length, 2);
      assert.deepEqual(setup.tools[0], { url: '/tools/admin-edit/index.html', label: 'Admin Edit' });
      assert.deepEqual(setup.tools[1], { url: '/tools/site-admin/index.html', label: 'Site Admin' });
    });

    it('skips top-level links that are not categories (e.g. Home)', () => {
      const cats = parseCategories(fixture);
      assert.ok(!cats.some((c) => /home/i.test(c.label)));
    });

    it('returns an empty array for empty input', () => {
      assert.deepEqual(parseCategories(''), []);
      assert.deepEqual(parseCategories('<div></div>'), []);
    });

    it('handles absolute and relative tool URLs', () => {
      const html = `
        <div><ul><li>X
          <ul>
            <li><a href="/tools/relative/index.html">Rel</a></li>
            <li><a href="https://tools.aem.live/tools/abs/index.html">Abs</a></li>
          </ul>
        </li></ul></div>`;
      const cats = parseCategories(html);
      assert.equal(cats.length, 1);
      const urls = cats[0].tools.map((t) => t.url);
      assert.ok(urls.includes('/tools/relative/index.html'));
      assert.ok(urls.includes('/tools/abs/index.html'));
    });
  });
});
