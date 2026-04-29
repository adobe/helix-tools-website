import { DATE_GROUP_LABELS, ANONYMOUS_ORG_KEY } from './constants.js';
import { loadIcon } from './icons.js';
import { escapeHtml } from './markdown.js';
import { loadChats, groupChatsByDate } from './chats.js';
import { setSidebarCollapsed } from './config-storage.js';

let sidebarDismissAttached = false;

export function renderChatRow(chat, isActive, callbacks) {
  const row = document.createElement('div');
  row.className = `eds-chat-row${isActive ? ' eds-chat-row-active' : ''}`;
  row.dataset.chatId = chat.id;
  row.innerHTML = `
    <button class="eds-chat-row-title" type="button" title="${escapeHtml(chat.title)}">${escapeHtml(chat.title || '(untitled)')}</button>
    <button class="eds-chat-row-delete" type="button" aria-label="Delete chat"></button>
    <span class="eds-chat-row-confirm" hidden>
      <button class="eds-chat-row-confirm-yes" type="button">Delete?</button>
      <button class="eds-chat-row-confirm-no" type="button" aria-label="Cancel">×</button>
    </span>
  `;
  loadIcon('trash').then((svg) => {
    const btn = row.querySelector('.eds-chat-row-delete');
    if (btn) btn.appendChild(svg);
  });
  row.querySelector('.eds-chat-row-title').addEventListener('click', () => callbacks.onSwitchChat(chat.id));
  const deleteBtn = row.querySelector('.eds-chat-row-delete');
  const confirmEl = row.querySelector('.eds-chat-row-confirm');
  const yesBtn = row.querySelector('.eds-chat-row-confirm-yes');
  const noBtn = row.querySelector('.eds-chat-row-confirm-no');
  deleteBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    deleteBtn.hidden = true;
    confirmEl.hidden = false;
  });
  noBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    deleteBtn.hidden = false;
    confirmEl.hidden = true;
  });
  yesBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    callbacks.onDeleteChat(chat.id);
  });
  return row;
}

export function renderSidebar(container, { activeChatId, config, callbacks }) {
  const chats = loadChats(config.org || ANONYMOUS_ORG_KEY);
  const groups = groupChatsByDate(chats);

  // eslint-disable-next-line no-param-reassign
  container.innerHTML = '';
  container.className = 'eds-agent-sidebar';

  const top = document.createElement('div');
  top.className = 'eds-sidebar-top';
  const newBtn = document.createElement('button');
  newBtn.className = 'eds-btn eds-btn-accent eds-sidebar-new-chat';
  newBtn.type = 'button';
  newBtn.textContent = '+ New chat';
  newBtn.addEventListener('click', () => callbacks.onNewChat());

  const collapseBtn = document.createElement('button');
  collapseBtn.className = 'eds-sidebar-collapse';
  collapseBtn.type = 'button';
  collapseBtn.title = 'Collapse sidebar';
  collapseBtn.setAttribute('aria-label', 'Collapse sidebar');
  loadIcon('Smock_ChevronLeft_18_N').then((svg) => collapseBtn.appendChild(svg));
  collapseBtn.addEventListener('click', () => setSidebarCollapsed(true));

  top.append(newBtn, collapseBtn);
  container.appendChild(top);

  const list = document.createElement('div');
  list.className = 'eds-sidebar-list';

  let totalRendered = 0;
  Object.entries(DATE_GROUP_LABELS).forEach(([key, label]) => {
    const bucket = groups[key];
    if (!bucket.length) return;
    const heading = document.createElement('div');
    heading.className = 'eds-date-group-label';
    heading.textContent = label;
    list.appendChild(heading);
    bucket.forEach((chat) => {
      list.appendChild(renderChatRow(chat, activeChatId === chat.id, callbacks));
      totalRendered += 1;
    });
  });

  if (!totalRendered) {
    const empty = document.createElement('div');
    empty.className = 'eds-sidebar-empty';
    empty.textContent = 'No chats yet';
    list.appendChild(empty);
  }

  container.appendChild(list);
}

// Capture phase + closest() checks let this single document-level listener
// dismiss the sidebar on outside clicks while ignoring clicks on the sidebar
// itself or the hamburger toggle (which has its own handler). Both checks
// are required: removing either re-introduces the bug they prevent.
export function attachSidebarBackdropDismiss() {
  if (sidebarDismissAttached) return;
  sidebarDismissAttached = true;
  document.addEventListener('click', (e) => {
    if (!document.body.classList.contains('eds-sidebar-open')) return;
    if (e.target.closest('.eds-agent-sidebar')) return;
    if (e.target.closest('.eds-hamburger-btn')) return;
    document.body.classList.remove('eds-sidebar-open');
    const sidebarEl = document.querySelector('.eds-agent-sidebar');
    if (sidebarEl) sidebarEl.classList.remove('eds-agent-sidebar-open');
    const hamburgerEl = document.querySelector('.eds-hamburger-btn');
    if (hamburgerEl) hamburgerEl.setAttribute('aria-expanded', 'false');
  }, { capture: true });
}
