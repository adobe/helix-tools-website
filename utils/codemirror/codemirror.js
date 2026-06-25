/**
 * Source-only module — this is the esbuild entry point for the CodeMirror
 * bundle (see DEPS in `vendor/vendor.js`). It is built into
 * `vendor/codemirror/codemirror.js`, which is what runtime code should
 * dynamically import. Do not import this file directly from browser code —
 * the bare `@codemirror/*` specifiers are only resolvable by the bundler.
 *
 * Only `codemirror`, `@codemirror/lang-json`, `@codemirror/lang-yaml`, and
 * `@codemirror/lang-html` are listed in package.json; the other
 * `@codemirror/*` and `@lezer/*` sub-packages are resolved as transitive
 * dependencies of those four. Bundling everything from one entry guarantees
 * a single shared `@codemirror/state` instance at runtime, which CodeMirror
 * requires.
 */

/* The @codemirror/* and @lezer/* sub-packages below resolve transitively via
   `codemirror`, `@codemirror/lang-json`, `@codemirror/lang-yaml`, and
   `@codemirror/lang-html`, so they aren't listed individually in package.json. */
/* eslint-disable import/no-extraneous-dependencies */
import { EditorView, basicSetup } from 'codemirror';
import { EditorState, Compartment } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import { indentWithTab } from '@codemirror/commands';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { json, jsonParseLinter } from '@codemirror/lang-json';
import { yaml } from '@codemirror/lang-yaml';
import { html } from '@codemirror/lang-html';
import { linter, lintGutter, setDiagnostics } from '@codemirror/lint';
import { tags } from '@lezer/highlight';
/* eslint-enable import/no-extraneous-dependencies */

/**
 * Custom highlight style. `light-dark()` works here because CodeMirror writes
 * these rules into a real `<style>` element, and the page sets
 * `color-scheme: light dark`. Tags map to both `@lezer/json` and
 * `@lezer/yaml` token names.
 */
const tokenHighlight = HighlightStyle.define([
  { tag: tags.propertyName, color: 'light-dark(#4b0082, #d2a8ff)' },
  { tag: tags.string, color: 'light-dark(#690, #a5d6ff)' },
  { tag: [tags.number, tags.bool, tags.null], color: 'light-dark(#905, #ff7b72)' },
  { tag: [tags.separator, tags.brace, tags.squareBracket], color: 'light-dark(#999, #8b949e)' },
  { tag: tags.comment, color: 'light-dark(#708090, #8b949e)', fontStyle: 'italic' },
  { tag: [tags.tagName, tags.angleBracket], color: 'light-dark(#22863a, #7ee787)' },
  { tag: tags.attributeName, color: 'light-dark(#6f42c1, #d2a8ff)' },
  { tag: tags.attributeValue, color: 'light-dark(#690, #a5d6ff)' },
]);

/**
 * Builds the language-specific extensions for a given language. JSON also
 * gets a parse linter that surfaces diagnostics in the gutter and on hover.
 * The HTML parser handles Mustache `{{...}}` as plain text, which is fine
 * for the Handlebars/Mustache use case in json2html-simulator. `plain` is an
 * explicit opt-out used for raw log/text viewers — no highlighting, no linter.
 * @param {'json'|'yaml'|'html'|'plain'} language
 * @returns {import('@codemirror/state').Extension[]}
 */
function languageExtensions(language) {
  if (language === 'yaml') return [yaml()];
  if (language === 'html') return [html({ autoCloseTags: false, matchClosingTags: false })];
  if (language === 'plain') return [];
  return [json(), linter(jsonParseLinter())];
}

/**
 * Resolves a 1-based line number to a `{from, to}` document range, clamping
 * out-of-range values to the last line of the document.
 * @param {import('@codemirror/state').EditorState} state
 * @param {number} line - 1-based line number
 * @returns {{ from: number, to: number }}
 */
function lineRange(state, line) {
  const clamped = Math.max(1, Math.min(line, state.doc.lines));
  const lineInfo = state.doc.line(clamped);
  return { from: lineInfo.from, to: lineInfo.to };
}

/**
 * Creates a CodeMirror editor inside `parent`.
 *
 * @param {object} options
 * @param {HTMLElement} options.parent - Element the editor mounts into
 * @param {string} [options.doc] - Initial document contents
 * @param {'json'|'yaml'|'html'|'plain'} [options.language] - Initial language (default 'json')
 * @param {boolean} [options.readOnly] - When true the editor is a read-only viewer
 * @param {(doc: string) => void} [options.onChange] - Fires after each doc change
 * @param {string} [options.labelledBy] - id of an element labelling the editor;
 *   forwarded as `aria-labelledby` to CodeMirror's inner `.cm-content` (the
 *   element that actually carries `role="textbox"`).
 * @returns {{
 *   view: EditorView,
 *   getValue: () => string,
 *   setValue: (text: string) => void,
 *   setLanguage: (language: 'json'|'yaml'|'html'|'plain') => void,
 *   setDiagnostics: (
 *     items: Array<{line: number, severity?: 'error'|'warning'|'info', message: string}>,
 *   ) => void,
 *   scrollToLine: (line: number) => void,
 * }}
 */
export default function createEditor({
  parent, doc = '', language = 'json', readOnly = false, onChange, labelledBy,
}) {
  const langCompartment = new Compartment();

  const extensions = [
    basicSetup,
    keymap.of([indentWithTab]),
    langCompartment.of(languageExtensions(language)),
    syntaxHighlighting(tokenHighlight),
    lintGutter(),
    EditorState.readOnly.of(readOnly),
    EditorView.editable.of(!readOnly),
    EditorView.updateListener.of((u) => {
      if (u.docChanged && onChange) onChange(u.state.doc.toString());
    }),
  ];
  if (labelledBy) {
    extensions.push(EditorView.contentAttributes.of({ 'aria-labelledby': labelledBy }));
  }

  const view = new EditorView({
    parent,
    state: EditorState.create({ doc, extensions }),
  });

  return {
    view,
    getValue: () => view.state.doc.toString(),
    setValue: (text) => {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
    },
    setLanguage: (next) => {
      view.dispatch({ effects: langCompartment.reconfigure(languageExtensions(next)) });
    },
    setDiagnostics: (items) => {
      const diagnostics = (items || []).flatMap((d) => {
        if (!d || !d.line) return [];
        const { from, to } = lineRange(view.state, d.line);
        return [{
          from,
          to,
          severity: d.severity || 'error',
          message: d.message || '',
        }];
      });
      view.dispatch(setDiagnostics(view.state, diagnostics));
    },
    scrollToLine: (line) => {
      if (!line) return;
      const { from } = lineRange(view.state, line);
      view.dispatch({ effects: EditorView.scrollIntoView(from, { y: 'center' }) });
    },
  };
}
