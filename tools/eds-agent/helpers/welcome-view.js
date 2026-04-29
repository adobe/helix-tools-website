/* eslint-disable import/prefer-default-export */
import { getWelcomeGroups } from './constants.js';
import { escapeHtml } from './markdown.js';

export function renderWelcome(messagesEl, { onPromptClick, config }) {
  const groups = getWelcomeGroups(config || {});
  const subtitle = config?.org
    ? 'I can manage your AEM Edge Delivery configurations, check page status, query audit logs, search documentation, and more.'
    : 'Ask me anything about Edge Delivery, Document Authoring, or Configuration Service. To run actions on a specific site, set org/site and an API token in Settings.';
  const welcome = document.createElement('div');
  welcome.className = 'eds-welcome';
  welcome.innerHTML = `
    <h2>How can I help?</h2>
    <p>${escapeHtml(subtitle)}</p>
    <div class="eds-welcome-groups">
      ${groups.map((g) => `
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
