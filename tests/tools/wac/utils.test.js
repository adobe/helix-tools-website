import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  secretStorageKey,
  deliveryUrl,
  formatBytes,
  kebabFromZipName,
  isZipFile,
  commonRoot,
  htmlFilesForWac,
  pickDefaultHtmlFile,
  buildTree,
  getTreeNode,
  listChildEntries,
  buildMagicBannerClipboard,
  parentFolder,
  editorPageUrl,
  browsePageUrl,
  formatModified,
  containerMetaText,
  toUiPath,
  toApiPath,
  displayPath,
  scopeToWacRoot,
  WAC_WORKER_ORIGIN,
  mixerConfigSnippet,
  isMixerConfigured,
} from '../../../tools/wac/utils.js';

describe('wac:utils.js', () => {
  describe('secretStorageKey', () => {
    it('scopes the key by org/site', () => {
      assert.equal(secretStorageKey('goodness', 'demo'), 'wac-secret:goodness/demo');
    });
  });

  describe('toUiPath', () => {
    it('strips the wac root prefix', () => {
      assert.equal(toUiPath('wac/drafts/david/demo'), 'drafts/david/demo');
    });

    it('returns "" for the wac root itself', () => {
      assert.equal(toUiPath('wac'), '');
    });

    it('leaves a path outside the wac root unchanged', () => {
      assert.equal(toUiPath('other/drafts/demo'), 'other/drafts/demo');
    });
  });

  describe('toApiPath', () => {
    it('adds the wac root prefix', () => {
      assert.equal(toApiPath('drafts/david/demo'), 'wac/drafts/david/demo');
    });

    it('returns just "wac" for the empty/root path', () => {
      assert.equal(toApiPath(''), 'wac');
    });

    it('round-trips with toUiPath', () => {
      assert.equal(toUiPath(toApiPath('drafts/david')), 'drafts/david');
    });
  });

  describe('displayPath', () => {
    it('adds a single leading slash', () => {
      assert.equal(displayPath('drafts/david'), '/drafts/david');
    });

    it('shows just "/" for the root', () => {
      assert.equal(displayPath(''), '/');
    });
  });

  describe('scopeToWacRoot', () => {
    it('strips the wac prefix from paths under the root', () => {
      const scoped = scopeToWacRoot([{ path: 'wac/drafts/david' }]);
      assert.deepEqual(scoped.map((w) => w.path), ['drafts/david']);
    });

    it('includes the wac root itself as ""', () => {
      const scoped = scopeToWacRoot([{ path: 'wac' }]);
      assert.deepEqual(scoped.map((w) => w.path), ['']);
    });

    it('excludes containers outside the wac root', () => {
      const scoped = scopeToWacRoot([{ path: 'wac/a' }, { path: 'other/b' }]);
      assert.deepEqual(scoped.map((w) => w.path), ['a']);
    });

    it('returns [] for missing input', () => {
      assert.deepEqual(scopeToWacRoot(undefined), []);
    });
  });

  describe('mixerConfigSnippet', () => {
    it('builds the expected public.mixerConfig block for an org/site', () => {
      assert.deepEqual(mixerConfigSnippet('goodness', 'demo'), {
        public: {
          mixerConfig: {
            patterns: { '/wac/**': 'wac' },
            backends: {
              wac: {
                origin: WAC_WORKER_ORIGIN,
                pathPrefix: '/goodness/demo/',
                headers: { 'x-forwarded-host': 'main--demo--goodness.aem.network' },
              },
            },
          },
        },
      });
    });
  });

  describe('isMixerConfigured', () => {
    it('returns true for an exact match', () => {
      const config = mixerConfigSnippet('goodness', 'demo');
      assert.equal(isMixerConfigured(config, 'goodness', 'demo'), true);
    });

    it('returns false for null/missing config', () => {
      assert.equal(isMixerConfigured(null, 'goodness', 'demo'), false);
      assert.equal(isMixerConfigured({}, 'goodness', 'demo'), false);
    });

    it('returns false when the backend points at a different org/site', () => {
      const config = mixerConfigSnippet('other-org', 'other-site');
      assert.equal(isMixerConfigured(config, 'goodness', 'demo'), false);
    });

    it('returns false when the pattern is missing', () => {
      const config = mixerConfigSnippet('goodness', 'demo');
      delete config.public.mixerConfig.patterns['/wac/**'];
      assert.equal(isMixerConfigured(config, 'goodness', 'demo'), false);
    });

    it('ignores unrelated keys already present under public', () => {
      const config = mixerConfigSnippet('goodness', 'demo');
      config.public.otherStuff = { some: 'thing' };
      assert.equal(isMixerConfigured(config, 'goodness', 'demo'), true);
    });
  });

  describe('deliveryUrl', () => {
    it('builds a container URL with no file path', () => {
      assert.equal(
        deliveryUrl('goodness', 'demo', 'drafts/david/demo'),
        'https://main--demo--goodness.aem.network/drafts/david/demo',
      );
    });

    it('appends the file path', () => {
      assert.equal(
        deliveryUrl('goodness', 'demo', 'drafts/david/demo', 'index.html'),
        'https://main--demo--goodness.aem.network/drafts/david/demo/index.html',
      );
    });

    it('ignores leading/trailing slashes on either segment', () => {
      assert.equal(
        deliveryUrl('goodness', 'demo', '/drafts/david/demo/', '/index.html'),
        'https://main--demo--goodness.aem.network/drafts/david/demo/index.html',
      );
    });

    it('encodes path segments', () => {
      assert.equal(
        deliveryUrl('goodness', 'demo', 'drafts/my file', null),
        'https://main--demo--goodness.aem.network/drafts/my%20file',
      );
    });

    it('falls back to the bare host when there is no path at all', () => {
      assert.equal(deliveryUrl('goodness', 'demo', '', null), 'https://main--demo--goodness.aem.network/');
    });
  });

  describe('formatBytes', () => {
    it('handles invalid input', () => {
      assert.equal(formatBytes(NaN), '0 B');
      assert.equal(formatBytes(-5), '0 B');
    });

    it('formats bytes', () => {
      assert.equal(formatBytes(512), '512 B');
    });

    it('formats kilobytes', () => {
      assert.equal(formatBytes(2048), '2.0 KB');
    });

    it('formats megabytes', () => {
      assert.equal(formatBytes(5 * 1024 * 1024), '5.0 MB');
    });
  });

  describe('formatModified', () => {
    it('returns "" for missing input', () => {
      assert.equal(formatModified(null), '');
      assert.equal(formatModified(undefined), '');
      assert.equal(formatModified(''), '');
    });

    it('returns "" for an unparseable date', () => {
      assert.equal(formatModified('not-a-date'), '');
    });

    it('returns a non-empty string for a valid ISO date', () => {
      // Locale/timezone-dependent formatting — just check it produced something.
      assert.ok(formatModified('2026-08-26T18:09:00Z').length > 0);
    });
  });

  describe('containerMetaText', () => {
    it('combines modified date and author when both are present', () => {
      const text = containerMetaText({ lastModified: '2026-08-26T18:09:00Z', author: 'david@adobe.com' });
      assert.match(text, / · david@adobe\.com$/);
    });

    it('falls back to zip size when neither modified date nor author is present', () => {
      assert.equal(containerMetaText({ zipSize: 2048 }), '2.0 KB');
    });

    it('uses just the author when there is no modified date', () => {
      assert.equal(containerMetaText({ author: 'david@adobe.com' }), 'david@adobe.com');
    });

    it('returns "" when nothing at all is available', () => {
      assert.equal(containerMetaText({}), '');
    });
  });

  describe('kebabFromZipName', () => {
    it('slugifies a zip filename', () => {
      assert.equal(kebabFromZipName('My Fun Page.zip'), 'my-fun-page');
    });

    it('falls back to "container" when nothing usable remains', () => {
      assert.equal(kebabFromZipName('???.zip'), 'container');
    });
  });

  describe('isZipFile', () => {
    it('returns false for null/undefined', () => {
      assert.equal(isZipFile(null), false);
      assert.equal(isZipFile(undefined), false);
    });

    it('accepts a .zip filename regardless of MIME type', () => {
      assert.equal(isZipFile({ name: 'demo.ZIP', type: '' }), true);
    });

    it('accepts a recognized zip MIME type regardless of filename', () => {
      assert.equal(isZipFile({ name: 'demo', type: 'application/zip' }), true);
      assert.equal(isZipFile({ name: 'demo', type: 'application/x-zip-compressed' }), true);
    });

    it('rejects anything else', () => {
      assert.equal(isZipFile({ name: 'demo.png', type: 'image/png' }), false);
    });
  });

  describe('commonRoot', () => {
    it('returns "" for an empty list', () => {
      assert.equal(commonRoot([]), '');
    });

    it('finds a shared top-level folder', () => {
      assert.equal(commonRoot(['pkg/index.html', 'pkg/style.css']), 'pkg/');
    });

    it('returns "" when files do not share a root', () => {
      assert.equal(commonRoot(['a/index.html', 'b/style.css']), '');
    });
  });

  describe('htmlFilesForWac', () => {
    it('filters to html files and ranks index first', () => {
      const wac = { files: ['style.css', 'about.html', 'index.html'] };
      assert.deepEqual(htmlFilesForWac(wac), ['index.html', 'about.html']);
    });

    it('ranks the declared default second, then alphabetical', () => {
      const wac = { files: ['z.html', 'a.html', 'default.html'], default: 'default.html' };
      assert.deepEqual(htmlFilesForWac(wac), ['default.html', 'a.html', 'z.html']);
    });

    it('returns [] when there are no files listed', () => {
      assert.deepEqual(htmlFilesForWac({}), []);
    });
  });

  describe('pickDefaultHtmlFile', () => {
    it('returns null when there are no html files', () => {
      assert.equal(pickDefaultHtmlFile({}, []), null);
    });

    it('prefers index.html', () => {
      assert.equal(pickDefaultHtmlFile({}, ['about.html', 'index.html']), 'index.html');
    });

    it('falls back to the declared default', () => {
      assert.equal(pickDefaultHtmlFile({ default: 'about.html' }, ['about.html', 'other.html']), 'about.html');
    });

    it('falls back to the first file otherwise', () => {
      assert.equal(pickDefaultHtmlFile({}, ['about.html', 'other.html']), 'about.html');
    });
  });

  describe('buildTree', () => {
    it('nests containers by path segment', () => {
      const items = [{ path: 'drafts/david/demo' }, { path: 'drafts/other/thing' }];
      const root = buildTree(items);
      assert.ok(root.children.has('drafts'));
      const drafts = root.children.get('drafts');
      assert.ok(drafts.children.has('david'));
      assert.ok(drafts.children.has('other'));
      assert.equal(drafts.children.get('david').children.get('demo').wac, items[0]);
    });

    it('handles a single-segment path as a direct child leaf', () => {
      const items = [{ path: 'root-container' }];
      const root = buildTree(items);
      assert.equal(root.children.get('root-container').wac, items[0]);
    });

    it('handles an empty list', () => {
      const root = buildTree([]);
      assert.equal(root.children.size, 0);
    });
  });

  describe('getTreeNode', () => {
    const root = buildTree([{ path: 'drafts/david/demo' }, { path: 'root-container' }]);

    it('returns the root for an empty/falsy folder path', () => {
      assert.equal(getTreeNode(root, ''), root);
    });

    it('walks down to a nested folder', () => {
      const node = getTreeNode(root, 'drafts/david');
      assert.ok(node.children.has('demo'));
    });

    it('returns null for a path that does not exist', () => {
      assert.equal(getTreeNode(root, 'nope/nada'), null);
    });
  });

  describe('listChildEntries', () => {
    it('returns [] for a null node', () => {
      assert.deepEqual(listChildEntries(null), []);
    });

    it('lists subfolders and containers, folders sorted before containers', () => {
      const root = buildTree([{ path: 'drafts/david/demo' }, { path: 'root-container' }]);
      const entries = listChildEntries(root);
      assert.deepEqual(entries.map((e) => [e.name, e.isContainer]), [
        ['drafts', false],
        ['root-container', true],
      ]);
    });

    it('emits both a folder and a container entry when a name is both', () => {
      const root = buildTree([{ path: 'drafts' }, { path: 'drafts/sub' }]);
      const entries = listChildEntries(root);
      assert.deepEqual(entries.map((e) => [e.name, e.isContainer]), [
        ['drafts', false],
        ['drafts', true],
      ]);
    });

    it('sorts alphabetically within each group', () => {
      const root = buildTree([{ path: 'zeta' }, { path: 'alpha' }]);
      const entries = listChildEntries(root);
      assert.deepEqual(entries.map((e) => e.name), ['alpha', 'zeta']);
    });
  });

  describe('parentFolder', () => {
    it('drops the last path segment', () => {
      assert.equal(parentFolder('drafts/david/demo'), 'drafts/david');
    });

    it('returns "" for a root-level container', () => {
      assert.equal(parentFolder('root-container'), '');
    });

    it('returns "" for empty/falsy input', () => {
      assert.equal(parentFolder(''), '');
      assert.equal(parentFolder(null), '');
    });
  });

  describe('editorPageUrl', () => {
    it('builds a link to the editor page with org/site/path params', () => {
      const url = editorPageUrl('https://tools.aem.live', 'goodness', 'demo', 'drafts/david/x');
      assert.equal(
        url,
        'https://tools.aem.live/tools/wac/wac-editor.html?org=goodness&site=demo&path=drafts%2Fdavid%2Fx',
      );
    });
  });

  describe('browsePageUrl', () => {
    it('builds a bare link when no org/site/folder are given', () => {
      assert.equal(browsePageUrl('https://tools.aem.live', '', ''), 'https://tools.aem.live/tools/wac/index.html');
    });

    it('includes org/site but omits path when folder is empty', () => {
      assert.equal(
        browsePageUrl('https://tools.aem.live', 'goodness', 'demo'),
        'https://tools.aem.live/tools/wac/index.html?org=goodness&site=demo',
      );
    });

    it('includes the folder as a path param when given', () => {
      assert.equal(
        browsePageUrl('https://tools.aem.live', 'goodness', 'demo', 'drafts/david'),
        'https://tools.aem.live/tools/wac/index.html?org=goodness&site=demo&path=drafts%2Fdavid',
      );
    });
  });

  describe('buildMagicBannerClipboard', () => {
    it('builds a link-only payload when there is no content', () => {
      const { html, plain } = buildMagicBannerClipboard('', 'https://example.com/x');
      assert.equal(plain, 'magic-banner\nhttps://example.com/x');
      assert.match(html, /<table>/);
      assert.match(html, /href="https:\/\/example\.com\/x"/);
    });

    it('includes the content text above the link', () => {
      const { plain } = buildMagicBannerClipboard('Hello\nWorld', 'https://example.com/x');
      assert.equal(plain, 'magic-banner\nHello\nWorld\n\nhttps://example.com/x');
    });

    it('escapes HTML-sensitive characters in the content', () => {
      const { html } = buildMagicBannerClipboard('<script>alert(1)</script>', 'https://example.com/x');
      assert.doesNotMatch(html, /<script>alert/);
      assert.match(html, /&lt;script&gt;/);
    });
  });
});
