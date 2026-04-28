export function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderMarkdown(text) {
  if (!text) return '';
  let html = escapeHtml(text);

  // Code blocks
  html = html.replace(
    /```(\w*)\n([\s\S]*?)```/g,
    (_, lang, code) => `<pre><code class="lang-${lang}">${code.trim()}</code></pre>`,
  );

  // Tables: | h1 | h2 |\n|---|---|\n| c1 | c2 |\n...
  const cellsOf = (row) => row.split('|').slice(1, -1).map((s) => s.trim());
  html = html.replace(
    /^(\|.+\|)\n\|[-:\s|]+\|\n((?:\|.*\|\n?)+)/gm,
    (_, headerLine, bodyLines) => {
      const thead = `<thead><tr>${cellsOf(headerLine).map((c) => `<th>${c}</th>`).join('')}</tr></thead>`;
      const tbody = `<tbody>${bodyLines.trim().split('\n').map(
        (r) => `<tr>${cellsOf(r).map((c) => `<td>${c}</td>`).join('')}</tr>`,
      ).join('')}</tbody>`;
      return `<table>${thead}${tbody}</table>`;
    },
  );

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

  // Italic
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // Headers
  html = html.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

  // Unordered lists
  html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>\n?)+/g, (match) => `<ul>${match}</ul>`);

  // Links
  html = html.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener">$1</a>',
  );

  // Paragraphs
  html = html.replace(/^(?!<[hupolt])(.*\S.*)$/gm, '<p>$1</p>');

  // Clean up double wrapping
  html = html.replace(/<p><(h[1-4]|ul|ol|pre|li|table)/g, '<$1');
  html = html.replace(/<\/(h[1-4]|ul|ol|pre|li|table)><\/p>/g, '</$1>');

  return html;
}
