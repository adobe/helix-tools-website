import { registerToolReady } from '../../scripts/scripts.js';
import {
  loadChats,
  saveChats,
  createChat,
  deleteChat,
  getActiveChatId,
  setActiveChatId,
  migrateLegacyMessages,
} from './helpers/chats.js';
import { DESKTOP_BREAKPOINT } from './helpers/constants.js';
import {
  getStoredTheme,
  effectiveTheme,
  applyTheme,
  themeTitle,
} from './helpers/theme.js';
import {
  getConfig,
  getSidebarCollapsed,
  setSidebarCollapsed,
} from './helpers/config-storage.js';
import {
  loadIcon,
  attachCopyDelegation,
} from './helpers/icons.js';
import {
  showError,
  hideStatusRow,
  renderMessageBubble,
  finalizeStreamingMessage,
  renderAllMessages,
} from './helpers/messages-view.js';
import { renderWelcome } from './helpers/welcome-view.js';
import {
  renderSidebar,
  attachSidebarBackdropDismiss,
} from './helpers/sidebar-view.js';
import { openSetupModal } from './helpers/setup-modal.js';
import { streamChat } from './helpers/agent-client.js';

let messages = [];
let isStreaming = false;
let currentAbortController = null;
let activeChatId = null;

const sendBtnState = {
  el: null,
  sendIconHTML: '',
  stopIconHTML: '<span class="eds-stop" aria-hidden="true"></span>',
};

function setSendButtonMode(mode) {
  const btn = sendBtnState.el;
  if (!btn) return;
  if (mode === 'stop') {
    btn.innerHTML = sendBtnState.stopIconHTML;
    btn.setAttribute('aria-label', 'Stop generating');
    btn.title = 'Stop';
  } else {
    btn.innerHTML = sendBtnState.sendIconHTML;
    btn.setAttribute('aria-label', 'Send message');
    btn.title = 'Send';
  }
}

function isDesktopViewport() {
  return window.matchMedia(DESKTOP_BREAKPOINT).matches;
}

function getActiveChat(org) {
  if (!activeChatId) return null;
  const chats = loadChats(org);
  return chats.find((c) => c.id === activeChatId) ?? null;
}

function persistMessages(org) {
  if (!org || !activeChatId) return;
  const chats = loadChats(org);
  const chat = chats.find((c) => c.id === activeChatId);
  if (!chat) return;
  chat.messages = messages.slice();
  chat.updatedAt = Date.now();
  saveChats(org, chats);
}

async function sendMessage(textarea, messagesEl) {
  const text = textarea.value.trim();
  if (!text) return;

  const config = getConfig();
  if (!config.authToken) {
    showError('No API key configured. Go to Settings.');
    return;
  }

  textarea.value = '';
  textarea.style.height = 'auto';
  isStreaming = true;
  setSendButtonMode('stop');

  const userMsg = { role: 'user', content: text };

  if (!activeChatId) {
    const newChat = createChat(config.org, text, config.site);
    activeChatId = newChat.id;
    setActiveChatId(config.org, newChat.id);
    const sidebarEl = document.querySelector('.eds-agent-sidebar');
    if (sidebarEl) {
      renderSidebar(sidebarEl, {
        activeChatId,
        config: getConfig(),
        // eslint-disable-next-line no-use-before-define
        callbacks: buildSidebarCallbacks(document.getElementById('agent-app')),
      });
    }
  }

  const sendChatId = activeChatId;

  messages.push(userMsg);
  renderMessageBubble(messagesEl, userMsg);

  try {
    await streamChat(messagesEl, {
      messages,
      config,
      setAbortController: (c) => { currentAbortController = c; },
      onAuthError: (errorText) => openSetupModal({
        mode: 'required',
        errorText,
        onConnect: () => renderChat(document.getElementById('agent-app')), // eslint-disable-line no-use-before-define
      }),
    });
  } catch (err) {
    if (err.name !== 'AbortError') {
      showError(err.message || 'Failed to connect to agent');
    }
  } finally {
    hideStatusRow();
    finalizeStreamingMessage(messagesEl);
    isStreaming = false;
    setSendButtonMode('send');
    textarea.focus();
    if (activeChatId === sendChatId) persistMessages(config.org);
  }
}

function cancelStreamIfActive() {
  if (isStreaming && currentAbortController) currentAbortController.abort();
}

function buildSidebarCallbacks(container) {
  return {
    onNewChat: () => {
      cancelStreamIfActive();
      const cfg = getConfig();
      if (cfg.org) setActiveChatId(cfg.org, null);
      activeChatId = null;
      document.body.classList.remove('eds-sidebar-open');
      renderChat(container); // eslint-disable-line no-use-before-define
    },
    onSwitchChat: (id) => {
      cancelStreamIfActive();
      const cfg = getConfig();
      activeChatId = id;
      if (cfg.org) setActiveChatId(cfg.org, id);
      document.body.classList.remove('eds-sidebar-open');
      renderChat(container); // eslint-disable-line no-use-before-define
    },
    onDeleteChat: (id) => {
      cancelStreamIfActive();
      const cfg = getConfig();
      if (!cfg.org) return;
      const result = deleteChat(cfg.org, id);
      if (activeChatId === id) {
        activeChatId = result.nextActiveId;
        setActiveChatId(cfg.org, result.nextActiveId);
      }
      renderChat(container); // eslint-disable-line no-use-before-define
    },
    onOpenSettings: () => openSetupModal({
      mode: 'optional',
      onConnect: () => renderChat(container), // eslint-disable-line no-use-before-define
    }),
  };
}

function renderChat(container) {
  const config = getConfig();
  container.innerHTML = '';

  const app = document.createElement('div');
  app.className = 'eds-agent-app';

  const sidebar = document.createElement('aside');
  app.appendChild(sidebar);

  const main = document.createElement('div');
  main.className = 'eds-agent-main';
  app.appendChild(main);

  // Header
  const header = document.createElement('header');
  header.className = 'eds-agent-header';

  const actions = document.createElement('div');
  actions.className = 'eds-actions';

  const hamburgerBtn = document.createElement('button');
  hamburgerBtn.className = 'eds-icon-btn eds-hamburger-btn';
  hamburgerBtn.id = 'btn-hamburger';
  hamburgerBtn.title = 'Open chats';
  hamburgerBtn.setAttribute('aria-label', 'Open chats');
  hamburgerBtn.setAttribute('aria-expanded', 'false');
  hamburgerBtn.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <line x1="3" y1="6" x2="21" y2="6"></line>
      <line x1="3" y1="12" x2="21" y2="12"></line>
      <line x1="3" y1="18" x2="21" y2="18"></line>
    </svg>
  `;

  const newChatBtn = document.createElement('button');
  newChatBtn.className = 'eds-icon-btn eds-mobile-only';
  newChatBtn.id = 'btn-new-chat';
  newChatBtn.title = 'New chat';
  newChatBtn.setAttribute('aria-label', 'New chat');
  loadIcon('s2-icon-aichat-20-n').then((svg) => newChatBtn.appendChild(svg));

  const themeBtn = document.createElement('button');
  themeBtn.className = 'eds-icon-btn';
  themeBtn.id = 'btn-theme';
  themeBtn.title = themeTitle(effectiveTheme());
  themeBtn.setAttribute('aria-label', 'Toggle theme');
  loadIcon('S2_Icon_Contrast_20_N').then((svg) => themeBtn.appendChild(svg));

  actions.append(hamburgerBtn, newChatBtn, themeBtn);
  header.append(actions);
  main.appendChild(header);

  hamburgerBtn.addEventListener('click', () => {
    if (isDesktopViewport()) {
      setSidebarCollapsed(false);
      hamburgerBtn.setAttribute('aria-expanded', 'true');
      return;
    }
    const willOpen = !sidebar.classList.contains('eds-agent-sidebar-open');
    sidebar.classList.toggle('eds-agent-sidebar-open', willOpen);
    document.body.classList.toggle('eds-sidebar-open', willOpen);
    hamburgerBtn.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
  });

  // Messages area
  const messagesEl = document.createElement('div');
  messagesEl.className = 'eds-agent-messages';
  main.appendChild(messagesEl);
  attachCopyDelegation(messagesEl);

  // Input area
  const inputArea = document.createElement('div');
  inputArea.className = 'eds-agent-input';
  inputArea.innerHTML = `
    <div class="eds-agent-input-row">
      <textarea id="agent-input" rows="1" placeholder="Ask me anything about Edge Delivery Services..."></textarea>
      <button class="eds-agent-send" id="btn-send" aria-label="Send message">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="22" y1="2" x2="11" y2="13"></line>
          <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
        </svg>
      </button>
    </div>
  `;
  main.appendChild(inputArea);

  renderSidebar(sidebar, {
    activeChatId,
    config: getConfig(),
    callbacks: buildSidebarCallbacks(container),
  });

  container.appendChild(app);

  const textarea = app.querySelector('#agent-input');
  const sendBtn = app.querySelector('#btn-send');
  sendBtnState.el = sendBtn;
  sendBtnState.sendIconHTML = sendBtn.innerHTML;

  const active = config.org ? getActiveChat(config.org) : null;
  if (active) {
    activeChatId = active.id;
    messages = active.messages.slice();
    renderAllMessages(messagesEl, messages);
  } else {
    activeChatId = null;
    messages = [];
    renderWelcome(messagesEl, {
      onPromptClick: (prompt) => {
        textarea.value = prompt;
        textarea.dispatchEvent(new Event('input'));
        sendMessage(textarea, messagesEl);
      },
    });
  }

  textarea.addEventListener('input', () => {
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`;
  });

  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!isStreaming) sendMessage(textarea, messagesEl);
    }
  });

  sendBtn.addEventListener('click', () => {
    if (isStreaming) {
      if (currentAbortController) currentAbortController.abort();
    } else {
      sendMessage(textarea, messagesEl);
    }
  });

  newChatBtn.addEventListener('click', () => {
    buildSidebarCallbacks(container).onNewChat();
  });

  themeBtn.addEventListener('click', () => {
    const next = effectiveTheme() === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    themeBtn.title = themeTitle(next);
  });

  textarea.focus();
}

// --- Initialization ---

function initEdsAgent() {
  const appContainer = document.getElementById('agent-app');
  if (!appContainer) return;

  applyTheme(getStoredTheme());
  setSidebarCollapsed(getSidebarCollapsed());
  attachSidebarBackdropDismiss();

  const config = getConfig();
  if (config.org) {
    migrateLegacyMessages(config.org, config.site);
    activeChatId = getActiveChatId(config.org);
  }

  if (config.authToken && config.org) {
    renderChat(appContainer);
  } else {
    renderChat(appContainer);
    openSetupModal({
      mode: 'required',
      onConnect: () => renderChat(appContainer),
    });
  }
}

registerToolReady(new Promise((resolve) => {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      initEdsAgent();
      resolve();
    });
  } else {
    initEdsAgent();
    resolve();
  }
}));
