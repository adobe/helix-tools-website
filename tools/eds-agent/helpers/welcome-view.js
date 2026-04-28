/* eslint-disable import/prefer-default-export */
import { WELCOME_GROUPS } from './constants.js';
import { escapeHtml } from './markdown.js';

export function renderWelcome(messagesEl, { onPromptClick }) {
  const welcome = document.createElement('div');
  welcome.className = 'eds-welcome';
  welcome.innerHTML = `
    <h2>How can I help?</h2>
    <p>I can manage your AEM EDS configurations, check page status, query audit logs, search documentation, and more.</p>
    <div class="eds-welcome-groups">
      ${WELCOME_GROUPS.map((g) => `
        <div class="eds-welcome-group">
          <div class="eds-welcome-label">${escapeHtml(g.label)}</div>
          ${g.prompts.map((p) => `<button class="eds-suggestion-chip">${escapeHtml(p)}</button>`).join('')}
        </div>
      `).join('')}
    </div>
  `;
  messagesEl.appendChild(welcome);

  welcome.querySelectorAll('.eds-suggestion-chip').forEach((chip) => {
    chip.addEventListener('click', () => onPromptClick(chip.textContent));
  });
}
